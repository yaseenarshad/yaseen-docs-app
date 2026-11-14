import { cardTime, type CardRecord, type CardReview } from './cardLine'
import { cardHistory } from './cardSchedule'
import type { ReviewSettings } from './reviews'

/**
 * THE FRIENDS NUMBERS (YAZ-5069, decisions 23, 24 and 25 on YAZ-5057; the files of round 16): what a person shares with
 * friends and groups, counted from the card lines of the vaults that count. One numbers gist for the person
 * (`FriendStats`), and one small pointer gist for each friend and each group (`FriendPointer`). Numbers only: no card text and no title ever goes in. The
 * phone (4E1) and the Mac (4E5) send the result; the Friends screens (4E4) read its shape. The card lines sync, so each
 * device that holds the same vaults counts the same numbers. Pure: no Node import, no DOM.
 *
 * A day is the person's own LOCAL day (YAZ-5058), midnight to midnight on this device's clock, as `reviewedToday`
 * counts the Mac's "Today". "The daily" is the DUE cards only (round 8): a new card is never part of it.
 */

/** What a person shares with friends and groups: numbers only, never card text. ONE file in ONE secret gist for the person (round 16). */
export interface FriendStats {
  v: 1
  login: string
  name: string
  avatar: string
  /** Local days, newest first, 90 at most. `done`: the due cards were finished that day (the streak rule). */
  days: FriendDay[]
  /** `inReview`: answered at least one time and not archived. `newLeft`: never answered and not archived. `mature`: next gap of 21 days or more. */
  totals: FriendTotals
  at: string
}

/** A cheer or a nudge (decision 24). The friend's app shows it until it was seen, then to the end of the next local day. */
export interface FriendMark {
  kind: 'cheer' | 'nudge'
  at: string
}

/**
 * One small gist for ONE friend, or for one group that the person is in (round 16 of YAZ-5057: GitHub allows 100 gist
 * updates an hour, so a send writes ONE numbers gist, not one for each friend). The friend's link is this gist's ID.
 */
export interface FriendPointer {
  v: 1
  /** The ID of the person's numbers gist (`FriendStats`). It changes when the person removes a friend. */
  stats: string
  /** The pointer gist that this person reads from that friend: the automatic pairing (round 12, item 5). Absent for a group. */
  reads?: string
  /** A cheer or a nudge for that friend (decision 24). Absent for a group. */
  mark?: FriendMark
}

/** One local day of `FriendStats.days`. */
export interface FriendDay {
  /** The local date, `2026-11-13`. */
  day: string
  /** Each card answered that day, new cards too (round 9). A card answered three times counts one time. */
  cards: number
  /** The seconds the day's answers took; an answer with no time counts 0. */
  seconds: number
  /** The answers that were not Forgot (`hard`, `good`, `easy`). Each answer counts, also one in the same-day steps. */
  remembered: number
  /** The answers that were Forgot (`again`). */
  forgot: number
  /** The cards whose first answer is that day. The day's due cards are `cards` minus `newCards`. */
  newCards: number
  /** The due cards were finished that day. A day with no due card is finished. */
  done: boolean
}

export interface FriendTotals {
  /** Every card in the vaults that count, archived cards too. */
  cards: number
  inReview: number
  newLeft: number
  mature: number
  /** The due cards of today that are not finished: with the cards that come back in the same session, no new card. */
  dueLeft: number
  /** The cards whose first answer is in this local week (Monday to Sunday). */
  addedThisWeek: number
  /** Finished days in a row up to today; today counts once it is finished, and an unfinished today does not stop it. */
  streak: number
  /** The longest run of finished days since the first answer. */
  bestStreak: number
  /** The most cards (`FriendDay.cards`) in one day since the first answer. */
  bestDay: number
  /** The most cards in one local week (Monday to Sunday), the sum of its days' `cards`. */
  bestWeek: number
}

/** The vaults that count (`FriendsIndex.vaults`): each one's index records and its own review settings (FSRS). */
export interface FriendVault {
  pages: readonly { cards?: readonly CardRecord[] }[]
  settings: ReviewSettings
}

/** `FriendStats.days` keeps this many days at most. */
export const FRIEND_DAYS = 90
/** A card is mature when the gap to its next review is this many days or more. */
export const MATURE_DAYS = 21
/** "Remembered %" and "days reviewed" look at this many days (round 12, item 1). */
export const RECENT_DAYS = 30

const pad = (n: number): string => String(n).padStart(2, '0')
/** The local date of `d`, `2026-11-13`. */
const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The reviews in time order (a hand edit can change the line's order). */
const inOrder = (reviews: readonly CardReview[]): CardReview[] => [...reviews].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

/** How many of `bounds` (sorted card times) are at or before `at`, less one: the index of the day `at` is in. */
function dayOf(bounds: readonly string[], at: string): number {
  let lo = 0
  let hi = bounds.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (bounds[mid] <= at) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/**
 * Pure: the numbers of `vaults` at `now`. "Remembered %" and "days reviewed of 30" are worked out from `days`
 * (`rememberedPercent`, `daysReviewed`). The days run from the local day of the first answer (90 at most go out);
 * today is always there.
 *
 * Due cards, for today and for each past day: a card is a due card of a day when it was answered before that day, it
 * is not archived, it has an ID, and the answers made before that day made it due before the day's end (or left it in
 * its same-day steps). It is finished when the answers up to the day's end move its due date past the day's end, out
 * of its steps. So a card that is new that day, or an Up next card that was not due, is never a due card of it. A copy
 * of an ID on the same page counts one time, as the Inbox shows it one time. A vault with review off has no due card.
 */
export function friendStats(vaults: readonly FriendVault[], now: number): Omit<FriendStats, 'login' | 'name' | 'avatar'> {
  const steps = friendStatsSteps(vaults, now)
  for (let step = steps.next(); ; step = steps.next()) if (step.done === true) return step.value
}

/**
 * The same count as `friendStats`, in small steps (YAZ-5255): it waits for `slice()` after each card, so the phone
 * gives the UI thread back (`uiSlicer`) and no step comes near a long task (50 ms). Same numbers, same order.
 */
export async function friendStatsSliced(vaults: readonly FriendVault[], now: number, slice: () => Promise<void>): Promise<Omit<FriendStats, 'login' | 'name' | 'avatar'>> {
  const steps = friendStatsSteps(vaults, now)
  for (let step = steps.next(); ; step = steps.next()) {
    if (step.done === true) return step.value
    await slice()
  }
}

/** The count of `friendStats` as steps: it yields after each card (and after each page in the first scan). */
function* friendStatsSteps(vaults: readonly FriendVault[], now: number): Generator<void, Omit<FriendStats, 'login' | 'name' | 'avatar'>> {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const todayEnd = cardTime(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime())
  // The first answer across all vaults, before the end of today: the history starts on its local day.
  let firstAt: string | null = null
  for (const { pages } of vaults)
    for (const page of pages) {
      for (const card of page.cards ?? []) for (const r of card.reviews) if (r.at < todayEnd && (firstAt === null || r.at < firstAt)) firstAt = r.at
      yield
    }
  const start = firstAt === null ? new Date(today) : new Date(Date.parse(firstAt))
  start.setHours(0, 0, 0, 0)
  if (start > today) start.setTime(today.getTime())

  // Each local day from the first one to today: its date, its start and end (ms), and its start as a card time.
  const keys: string[] = []
  const ends: number[] = []
  const bounds: string[] = []
  const weekStarts: boolean[] = []
  for (let d = new Date(start); d <= today; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    keys.push(dayKey(d))
    bounds.push(cardTime(d.getTime()))
    ends.push(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime())
    weekStarts.push(d.getDay() === 1)
  }
  const n = keys.length
  const last = n - 1
  const cards = new Array<number>(n).fill(0)
  const seconds = new Array<number>(n).fill(0)
  const remembered = new Array<number>(n).fill(0)
  const forgot = new Array<number>(n).fill(0)
  const newCards = new Array<number>(n).fill(0)
  const undone = new Array<boolean>(n).fill(false)
  const totals = { cards: 0, inReview: 0, newLeft: 0, mature: 0, dueLeft: 0 }

  for (const { pages, settings } of vaults) {
    for (const page of pages) {
      const ids = new Set<string>()
      for (const card of page.cards ?? []) {
        yield
        totals.cards++
        const reviews = inOrder(card.reviews).filter((r) => r.at < todayEnd)
        // The day's numbers: every answer counts, archived cards too (their answers were made).
        let prev = -1
        for (const r of reviews) {
          const i = dayOf(bounds, r.at)
          if (i < 0) continue
          seconds[i] += r.seconds ?? 0
          if (r.rating === 'again') forgot[i]++
          else remembered[i]++
          if (i !== prev) cards[i]++
          prev = i
        }
        const firstDay = reviews.length > 0 ? dayOf(bounds, reviews[0].at) : -1
        if (firstDay >= 0) newCards[firstDay]++
        if (card.off) continue
        if (reviews.length === 0) {
          totals.newLeft++
          continue
        }
        totals.inReview++
        const history = cardHistory(reviews, settings)
        if (history[history.length - 1].interval >= MATURE_DAYS) totals.mature++
        if (!settings.enabled || card.id === null || ids.has(card.id)) continue
        ids.add(card.id)
        // Each day after the first answer: was the card due that day, and did the day's answers finish it?
        let before = 0
        for (let d = Math.max(firstDay + 1, 0); d <= last; d++) {
          while (before < history.length && history[before].review.at < bounds[d]) before++
          const was = history[before - 1]
          if (!(was.inSteps || was.due < ends[d])) continue
          let upTo = before
          const end = d === last ? todayEnd : bounds[d + 1]
          while (upTo < history.length && history[upTo].review.at < end) upTo++
          const after = history[upTo - 1]
          if (after.inSteps || after.due < ends[d]) {
            undone[d] = true
            if (d === last) totals.dueLeft++
          }
        }
      }
    }
  }

  // The streak: finished days in a row up to today, or up to yesterday while today is not finished yet.
  // With no answer ever, there is no streak day (YAZ-5168): each day is before the first answer. Today still shows
  // `done: true`, as a day with no due card does (round 8); only the streak waits for the first answer.
  const answered = firstAt !== null
  let streak = 0
  if (answered) for (let d = undone[last] ? last - 1 : last; d >= 0 && !undone[d]; d--) streak++
  let bestStreak = 0
  let run = 0
  let bestWeek = 0
  let week = 0
  // This week's first day: the last Monday at or before today (or the first day of the history).
  let thisWeek = 0
  for (let d = 0; d <= last; d++) {
    run = undone[d] || !answered ? 0 : run + 1
    bestStreak = Math.max(bestStreak, run)
    if (weekStarts[d]) {
      week = 0
      thisWeek = d
    }
    week += cards[d]
    bestWeek = Math.max(bestWeek, week)
  }
  let addedThisWeek = 0
  for (let d = thisWeek; d <= last; d++) addedThisWeek += newCards[d]

  const days: FriendDay[] = []
  for (let d = last; d >= 0 && days.length < FRIEND_DAYS; d--) {
    days.push({ day: keys[d], cards: cards[d], seconds: seconds[d], remembered: remembered[d], forgot: forgot[d], newCards: newCards[d], done: !undone[d] })
  }
  return {
    v: 1,
    days,
    totals: { ...totals, addedThisWeek, streak, bestStreak, bestDay: cards.reduce((a, b) => Math.max(a, b), 0), bestWeek },
    at: new Date(now).toISOString(),
  }
}

/** The days of `days` (newest first) in the `RECENT_DAYS` days that end on the newest one. */
function recent(days: readonly FriendDay[]): FriendDay[] {
  if (days.length === 0) return []
  const [y, m, d] = days[0].day.split('-').map(Number)
  const from = dayKey(new Date(y, m - 1, d - (RECENT_DAYS - 1)))
  return days.filter((day) => day.day >= from)
}

/** "Remembered %" (round 12, item 1): the answers of the last 30 days that were not Forgot, 0 to 100; null with no answer. */
export function rememberedPercent(days: readonly FriendDay[]): number | null {
  let yes = 0
  let no = 0
  for (const day of recent(days)) {
    yes += day.remembered
    no += day.forgot
  }
  return yes + no === 0 ? null : Math.round((100 * yes) / (yes + no))
}

/** "Days reviewed of 30": the days of the last 30 with at least one card answered. */
export const daysReviewed = (days: readonly FriendDay[]): number => recent(days).filter((day) => day.cards > 0).length

/** A friend's gist file as read: the file in a clean copy (known fields only), or why it cannot be read. Never a throw. */
export type FriendFileRead<T> = { ok: true; value: T } | { ok: false; why: string }

/** The largest friend file read, in characters: a real numbers file is a few kilobytes. */
export const FRIEND_FILE_MAX_BYTES = 256 * 1024
/** The largest count a number in a friend file may hold. */
const MAX_COUNT = 1e9
const MAX_TEXT = 300
const GIST_ID_RE = /^[0-9a-f]{1,64}$/i
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/

/** Thrown inside the readers only, and caught there: the reason a file is unreadable. */
class Unreadable extends Error {}
const fail = (why: string): never => {
  throw new Unreadable(why)
}
const objectAt = (v: unknown, where: string): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(`${where} is not an object`)
const countAt = (o: Record<string, unknown>, key: string, where: string): number => {
  const v = o[key]
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_COUNT ? v : fail(`${where}.${key} is not a count`)
}
const textAt = (o: Record<string, unknown>, key: string, where: string, max = MAX_TEXT): string => {
  const v = o[key]
  return typeof v === 'string' && v.length <= max ? v : fail(`${where}.${key} is not a text`)
}
const timeAt = (o: Record<string, unknown>, key: string, where: string): string => {
  const v = textAt(o, key, where, 40)
  return TIME_RE.test(v) && !Number.isNaN(Date.parse(v)) ? v : fail(`${where}.${key} is not a time`)
}
const gistIdAt = (o: Record<string, unknown>, key: string, where: string): string => {
  const v = o[key]
  return typeof v === 'string' && GIST_ID_RE.test(v) ? v : fail(`${where}.${key} is not a gist ID`)
}

/** `text` as JSON with `v: 1`, then `read` on it; any fault is "unreadable". */
function readFile<T>(text: unknown, read: (o: Record<string, unknown>) => T): FriendFileRead<T> {
  try {
    if (typeof text !== 'string') return { ok: false, why: 'the file is not text' }
    if (text.length > FRIEND_FILE_MAX_BYTES) return { ok: false, why: 'the file is too large' }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      return { ok: false, why: 'the file is not JSON' }
    }
    const o = objectAt(raw, 'the file')
    if (o.v !== 1) return { ok: false, why: 'the file has another version' }
    return { ok: true, value: read(o) }
  } catch (err) {
    if (err instanceof Unreadable) return { ok: false, why: err.message }
    return { ok: false, why: 'the file cannot be read' }
  }
}

const DAY_COUNTS = ['cards', 'seconds', 'remembered', 'forgot', 'newCards'] as const
const TOTALS = ['cards', 'inReview', 'newLeft', 'mature', 'dueLeft', 'addedThisWeek', 'streak', 'bestStreak', 'bestDay', 'bestWeek'] as const

/** A friend's numbers file (`FriendStats`), from untrusted text: checked field by field, at most `FRIEND_DAYS` days. */
export const parseFriendStats = (text: string): FriendFileRead<FriendStats> =>
  readFile(text, (o) => {
    const rawDays = Array.isArray(o.days) ? o.days : fail('days is not a list')
    if (rawDays.length > FRIEND_DAYS) fail('days has too many days')
    const days = rawDays.map((d, i): FriendDay => {
      const where = `days[${i}]`
      const day = objectAt(d, where)
      const key = textAt(day, 'day', where, 10)
      if (!DAY_RE.test(key)) fail(`${where}.day is not a date`)
      if (typeof day.done !== 'boolean') fail(`${where}.done is not true or false`)
      const counts = Object.fromEntries(DAY_COUNTS.map((k) => [k, countAt(day, k, where)])) as Record<(typeof DAY_COUNTS)[number], number>
      return { day: key, ...counts, done: day.done as boolean }
    })
    const t = objectAt(o.totals, 'totals')
    const totals = Object.fromEntries(TOTALS.map((k) => [k, countAt(t, k, 'totals')])) as unknown as FriendTotals
    return { v: 1, login: textAt(o, 'login', 'the file', 100), name: textAt(o, 'name', 'the file'), avatar: textAt(o, 'avatar', 'the file', 2000), days, totals, at: timeAt(o, 'at', 'the file') }
  })

/** A friend's or a group's pointer file (`FriendPointer`), from untrusted text. */
export const parseFriendPointer = (text: string): FriendFileRead<FriendPointer> =>
  readFile(text, (o) => {
    const out: FriendPointer = { v: 1, stats: gistIdAt(o, 'stats', 'the file') }
    if (o.reads !== undefined) out.reads = gistIdAt(o, 'reads', 'the file')
    if (o.mark !== undefined) {
      const m = objectAt(o.mark, 'mark')
      if (m.kind !== 'cheer' && m.kind !== 'nudge') fail('mark.kind is not cheer or nudge')
      out.mark = { kind: m.kind as FriendMark['kind'], at: timeAt(m, 'at', 'mark') }
    }
    return out
  })
