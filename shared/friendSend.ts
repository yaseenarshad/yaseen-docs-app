import { NUMBERS_FILE, gistErrorCode, gistErrorRate, gistErrorResetAt, readStatsFile, type GistDoc, type GistRate, type GistsApi } from './friendGists'
import type { FriendDay, FriendStats } from './friendStats'
import { FRIEND_DAYS } from './friendStats'

/**
 * THE SEND OF THE NUMBERS (YAZ-5082, 4E1): pure rules that the phone (4E1) and the Mac (4E5) share. The HTTP calls are
 * behind `GistsApi` (`friendGists.ts`). The rules (YAZ-5057):
 * - decision 14 (round 16): ONE update of ONE numbers gist for each send, for any number of friends.
 * - decision 16: a device sends only after a sync pass, and never lowers a day's numbers that the gist holds.
 * - round 12, item 2: "never lower" covers the entries of `days`; `totals` are the sender's newest count.
 * - decision 22: no send with zero friends and groups.
 * - round 12, item 3: count the vaults of `FriendsIndex.vaults`, and send only when the device holds them all.
 * - proof 1C: `PATCH /gists/{id}` counts on `gist_update`, 100 an hour for the ACCOUNT (phone, Mac, cheers, nudges).
 *   The sender counts its own updates, reads GitHub's count from each answer, slows down before the limit, and keeps a
 *   reserve for a remove (4E2: one update for each other pointer).
 */

/** Send my numbers at most this often while I review; also when the app goes to the background (decision 14). */
export const PUBLISH_EVERY_MS = 5 * 60_000
/** While the Friends tab is open, read each friend's numbers this often. An unchanged answer is free (decision 14). */
export const FRIENDS_POLL_MS = 60_000
/**
 * Before YAZ-5192 the background send waited only this long. Now every send keeps `sendGap` (at least
 * `PUBLISH_EVERY_MS`). Kept so older callers still build; no rule reads it.
 */
export const BACKGROUND_GAP_MS = 60_000
/** GitHub's `gist_update` limit for the account (proof 1C). */
export const GIST_UPDATES_PER_HOUR = 100
/** Updates kept for cheers and nudges (4E4), on top of one for each pointer. */
export const MARK_HEADROOM = 5
const HOUR = 3600_000

/** The updates a send never spends: one for each pointer (a remove rewrites each other pointer, 4E2), and a few for marks. */
export const reserveFor = (pointers: number): number => pointers + MARK_HEADROOM

/** Who sends: from `GET /user` (3E keeps it as the account facts). The nickname replaces the name (decision 22). */
export interface StatsProfile {
  login: string
  name: string | null
  avatar: string
  nickname: string | null
}

/** The numbers file of a send: `friendStats` plus who sends and when. */
export function numbersFor(counted: Pick<FriendStats, 'days' | 'totals'>, profile: StatsProfile, now: number): FriendStats {
  return {
    v: 1,
    login: profile.login,
    name: profile.nickname ?? profile.name ?? profile.login,
    avatar: profile.avatar,
    days: counted.days,
    totals: counted.totals,
    at: new Date(now).toISOString(),
  }
}

/** JSON with the keys in order, so two equal files give one text. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (typeof value === 'object' && value !== null)
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  return JSON.stringify(value)
}

/** The key of a numbers file: everything but `at`. Equal keys: nothing new to send. */
export const numbersKey = (file: unknown): string => {
  if (typeof file !== 'object' || file === null) return stable(file)
  const { at: _at, ...rest } = file as Record<string, unknown>
  return stable(rest)
}

const DAY_COUNTS = ['cards', 'seconds', 'remembered', 'forgot', 'newCards'] as const
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Never lower (decision 16; round 12, item 2): each day number is the larger of the gist's and the fresh count; `done`
 * stays true once true; a day only the gist holds (another device's count) stays. The totals, the name and `at` are
 * the fresh ones. Each field that this app does not know stays as the gist has it (round 10, item 17). A broken file
 * on GitHub is replaced by the fresh numbers. `changed`: the result differs from the gist (beyond `at`).
 */
export function mergeNeverLower(remote: unknown, fresh: FriendStats): { file: Record<string, unknown>; changed: boolean } {
  const state = typeof remote === 'string' ? readStatsFile(remote) : isObject(remote) ? readStatsFile(JSON.stringify(remote)) : null
  if (state === null || state.kind !== 'ok') return { file: { ...fresh }, changed: true }
  const raw = state.raw
  const rawDays = Array.isArray(raw.days) ? raw.days.filter(isObject) : []
  const days = new Map<string, Record<string, unknown>>()
  for (const day of state.value.days) days.set(day.day, { ...(rawDays.find((d) => d.day === day.day) ?? {}), ...day })
  for (const day of fresh.days) {
    const had = days.get(day.day) as (FriendDay & Record<string, unknown>) | undefined
    if (had === undefined) {
      days.set(day.day, { ...day })
      continue
    }
    const merged: Record<string, unknown> = { ...had }
    for (const k of DAY_COUNTS) merged[k] = Math.max(had[k], day[k])
    merged.done = had.done || day.done
    days.set(day.day, merged)
  }
  const allDays = [...days.values()].sort((a, b) => (String(a.day) < String(b.day) ? 1 : -1)).slice(0, FRIEND_DAYS)
  const file: Record<string, unknown> = { ...raw, ...fresh, totals: { ...(isObject(raw.totals) ? raw.totals : {}), ...fresh.totals }, days: allDays }
  return { file, changed: numbersKey(file) !== numbersKey(raw) }
}

// ---------------------------------------------------------------------------------------------------------------------
// The budget of `gist_update` (100 an hour for the account).

/** What the sender knows of the account's `gist_update` count. Kept by each device (the phone: as phone-only state). */
export interface GistBudget {
  /** The times of MY updates in the last hour. */
  updates: number[]
  /** GitHub's count at my last update: `remaining` at `at`, until `resetAt`. It includes the Mac's and the marks'. */
  seen: { remaining: number; resetAt: number; at: number; after?: number } | null
  /** GitHub said "rate limit": no update before this time. */
  blockedUntil: number | null
}

export const emptyBudget = (): GistBudget => ({ updates: [], seen: null, blockedUntil: null })

const inHour = (b: GistBudget, now: number) => b.updates.filter((at) => at > now - HOUR && at <= now)

/** One update made at `now`, with GitHub's count from its answer (or from a failure). */
export function recordUpdate(b: GistBudget, now: number, rate: GistRate | null): GistBudget {
  const updates = [...inHour(b, now), now]
  // `after` counts my updates since GitHub's count (YAZ-5083): updates in the same millisecond as it count too.
  const seen =
    rate !== null && rate.remaining !== null
      ? { remaining: rate.remaining, resetAt: rate.resetAt ?? now + HOUR, at: now, after: 0 }
      : b.seen === null
        ? null
        : { ...b.seen, after: (b.seen.after ?? inHour(b, now).filter((at) => at > b.seen!.at).length) + 1 }
  return { updates, seen, blockedUntil: b.blockedUntil !== null && b.blockedUntil > now ? b.blockedUntil : null }
}

/** The updates left this hour, as far as this device knows: the lower of its own count and GitHub's last count. */
export function budgetLeft(b: GistBudget, now: number): number {
  const mine = inHour(b, now)
  const own = GIST_UPDATES_PER_HOUR - mine.length
  if (b.seen === null || now >= b.seen.resetAt) return own
  const since = b.seen.after ?? mine.filter((at) => at > b.seen!.at).length
  return Math.max(0, Math.min(own, b.seen.remaining - since))
}

/** May `need` updates go now and still leave `reserve`? A send passes the reserve for a remove; a remove passes 0. */
export function mayUpdate(b: GistBudget, now: number, need: number, reserve: number): boolean {
  if (b.blockedUntil !== null && now < b.blockedUntil) return false
  return budgetLeft(b, now) - need >= reserve
}

/** The time to the hour's reset, as far as this device knows. */
function toReset(b: GistBudget, now: number): number {
  if (b.seen !== null && now < b.seen.resetAt) return b.seen.resetAt - now
  const oldest = inHour(b, now)[0]
  return oldest === undefined ? HOUR : oldest + HOUR - now
}

/**
 * The gap between two sends. With many spare updates it is `PUBLISH_EVERY_MS`. Near the limit it grows, so the spare
 * updates spread over the rest of the hour: the sender slows down before it reaches the limit. With none spare, it is
 * the time to the reset.
 */
export function sendGap(b: GistBudget, now: number, reserve: number): number {
  const spare = budgetLeft(b, now) - reserve
  const window = toReset(b, now)
  if (spare <= 0) return Math.max(window, 60_000)
  return Math.max(PUBLISH_EVERY_MS, Math.ceil(window / spare))
}

// ---------------------------------------------------------------------------------------------------------------------
// When to send.

export type SendReason = 'pass' | 'timer' | 'background'

export interface GateInput {
  /** Friends and groups in the list (each has one pointer). */
  pointers: number
  /** A sync pass ended since the app opened (decision 16). */
  passSeen: boolean
  /** The device holds every vault that counts (round 12, item 3). */
  holdsAll: boolean
  lastSentAt: number | null
  lastKey?: string | null
  key?: string | null
  now: number
  reason: SendReason
  budget: GistBudget
}

export type Gate = { go: true } | { go: false; why: 'no-friends' | 'no-pass' | 'missing-vaults' | 'unchanged' | 'budget' | 'wait'; retryAt?: number }

/** The checks before a send, cheapest first. A `wait` or `budget` gives the time to try again. */
export function sendGate(input: GateInput): Gate {
  const { now, budget } = input
  const reserve = reserveFor(input.pointers)
  if (input.pointers === 0) return { go: false, why: 'no-friends' }
  if (!input.passSeen) return { go: false, why: 'no-pass' }
  if (!input.holdsAll) return { go: false, why: 'missing-vaults' }
  if (input.key != null && input.key === input.lastKey) return { go: false, why: 'unchanged' }
  if (!mayUpdate(budget, now, 1, reserve)) {
    const blocked = budget.blockedUntil !== null && budget.blockedUntil > now ? budget.blockedUntil : now + sendGap(budget, now, reserve)
    return { go: false, why: 'budget', retryAt: blocked }
  }
  if (input.lastSentAt !== null) {
    // YAZ-5192: the background send keeps the same gap (5 minutes, and longer near the limit). Leaving the app only
    // sends at once when that gap is over; else the change waits for the timer, the next pass or the next leave.
    const gap = sendGap(budget, now, reserve)
    if (now < input.lastSentAt + gap) return { go: false, why: 'wait', retryAt: input.lastSentAt + gap }
  }
  return { go: true }
}

// ---------------------------------------------------------------------------------------------------------------------
// One send.

/**
 * - `sent`: one update of the numbers gist. `unchanged`: the gist holds these numbers or more; nothing written.
 * - `numbers-gone`: the numbers gist is deleted (404). Nothing is made here: the caller makes it again with the list
 *   (`replaceNumbersGist`), which also updates each pointer.
 * - `newer-app`: the numbers file has a newer `v`: this app does not write over it.
 * - `budget`: the spare updates are used; `retryAt` says when.
 * - `refused`: 403 on the write: the token has no Gists permission (the caller calls `recordGistsRefused`, 3E).
 * - `rate-limited`, `offline`: quiet; try again at `retryAt` or at the next chance. `unauthorized`: the token is wrong.
 */
export type SendOutcome =
  | { kind: 'sent' }
  | { kind: 'unchanged' }
  | { kind: 'numbers-gone' }
  | { kind: 'newer-app' }
  | { kind: 'budget'; retryAt: number }
  | { kind: 'refused' }
  | { kind: 'rate-limited'; retryAt: number }
  | { kind: 'offline' }
  | { kind: 'unauthorized' }
  | { kind: 'failed' }

export interface SendInput {
  statsId: string
  fresh: FriendStats
  budget: GistBudget
  reserve: number
  now: number
}

/** Reads the numbers gist, merges (never lower), and writes it ONLY when it changed and the budget allows. */
export async function sendNumbers(api: GistsApi, input: SendInput): Promise<{ outcome: SendOutcome; budget: GistBudget }> {
  let budget = input.budget
  const { now } = input
  try {
    let gist: GistDoc | 'unchanged'
    try {
      gist = await api.read(input.statsId)
    } catch (err) {
      if (gistErrorCode(err) === 'NOT_FOUND') return { outcome: { kind: 'numbers-gone' }, budget }
      throw err
    }
    if (gist === 'unchanged') throw new Error('a read with no ETag cannot be unchanged')
    const file = gist.files[NUMBERS_FILE]
    const text = file === undefined || file.truncated ? null : file.content
    const state = readStatsFile(text)
    if (state.kind === 'newer') return { outcome: { kind: 'newer-app' }, budget }
    const { file: merged, changed } = mergeNeverLower(state.kind === 'ok' ? state.raw : null, input.fresh)
    if (!changed) return { outcome: { kind: 'unchanged' }, budget }
    if (!mayUpdate(budget, now, 1, input.reserve)) return { outcome: { kind: 'budget', retryAt: now + sendGap(budget, now, input.reserve) }, budget }
    const { rate } = await api.update(input.statsId, { [NUMBERS_FILE]: JSON.stringify(merged) })
    budget = recordUpdate(budget, now, rate)
    return { outcome: { kind: 'sent' }, budget }
  } catch (err) {
    const code = gistErrorCode(err)
    switch (code) {
      case 'READ_ONLY':
        return { outcome: { kind: 'refused' }, budget }
      case 'RATE_LIMITED': {
        const retryAt = Math.max(now + 60_000, gistErrorResetAt(err) ?? 0)
        const rate = gistErrorRate(err)
        const seen = rate !== null && rate.remaining !== null ? { remaining: rate.remaining, resetAt: rate.resetAt ?? retryAt, at: now, after: 0 } : budget.seen
        return { outcome: { kind: 'rate-limited', retryAt }, budget: { ...budget, seen, blockedUntil: retryAt } }
      }
      case 'OFFLINE':
      case 'GITHUB_DOWN':
        return { outcome: { kind: 'offline' }, budget }
      case 'UNAUTHORIZED':
        return { outcome: { kind: 'unauthorized' }, budget }
      case null:
        throw err
      default:
        return { outcome: { kind: 'failed' }, budget }
    }
  }
}
