import { POINTER_FILE, gistErrorCode, gistErrorRate, gistErrorResetAt, readPointerFile, type GistsApi } from '@shared/friendGists'
import { GIST_UPDATES_PER_HOUR, MARK_HEADROOM, budgetLeft, mayMark, emptyBudget, mayUpdate, recordUpdate, type GistBudget } from '@shared/friendSend'
import type { FriendMark } from '@shared/friendStats'
import { recordGistsRefused } from '../../auth/friends'
import type { FetchLike } from '../../github/client'
import { PHONE, VaultClosedError, type TokenStore, type VaultStore } from '../../store'
import { openFriendsApi } from '../friendsApi'
import { friendsGuard } from '../guard'
import { queuedMines } from '../removeQueue'
import { SEND_STATE } from '../sender'
import { seeMark, type SeenMark } from './board'

/**
 * Cheer and Nudge (decision 24; round 16): ONE `gist_update` of MY pointer for that friend, which gets `mark`. The other
 * fields of the pointer stay (`stats`, `reads`, and what a newer app added). It counts on the account's 100 updates an
 * hour, as the sends do (4E1): it may use the 5 updates that the sender keeps for marks (`MARK_HEADROOM`), never the
 * reserve for a remove (one for each pointer).
 *
 * A mark that cannot go now (the budget is used up, no signal, GitHub asks to wait) is KEPT on the phone and goes later
 * (`flush`, on each read of the Friends tab). It is never lost and never sent twice: one send runs for a pointer at a
 * time, and a second tap while it runs gets the same answer.
 *
 * The other side: what this phone has SEEN of a friend's mark (phone-only state, 3A; the gist does not change for it).
 */
export type MarkKind = FriendMark['kind']
/** Why a mark waits: the account's budget, the hourly cap of marks (YAZ-5258), no signal, GitHub's rate limit. */
export type MarkWait = 'budget' | 'marks-limit' | 'offline' | 'rate-limited'

export type MarkSend =
  | { kind: 'sent'; mark: FriendMark }
  /** YAZ-5258: this friend already has this kind of mark from me today (one cheer and one nudge a day): no write. */
  | { kind: 'already'; mark: FriendMark }
  /** Kept on the phone; it goes at `retryAt` (null: at the next read with a signal). */
  | {
      kind: 'waiting'
      mark: FriendMark
      why: MarkWait
      retryAt: number | null
    }
  | { kind: 'no-gists' }
  | { kind: 'no-account' }
  | { kind: 'unauthorized' }
  /** My pointer for that friend is gone (the friend was removed on another device). */
  | { kind: 'gone' }
  | { kind: 'newer-app' }
  | { kind: 'failed' }

/** What this phone sent, or keeps to send, to one friend (by my pointer `mine`). */
export interface OutMark {
  mark: FriendMark
  state: 'sent' | 'waiting'
  why?: MarkWait
  retryAt?: number | null
}

export interface Marks {
  /** `pointers`: my pointers in the list (one remove-reserve update each), for a phone where the sender has not counted them yet. */
  send(mine: string, kind: MarkKind, pointers?: number): Promise<MarkSend>
  /** Sends each kept mark whose time has come. */
  /**
   * Sends each kept mark whose time has come. `pointers`: my pointers in the list (the remove reserve, YAZ-5294).
   * `keep`: whether a pointer is still a friend's whom a mark may reach (YAZ-5293); a mark for any other is dropped.
   */
  flush(options: { pointers: number; keep(mine: string): boolean }): Promise<void>
  /** By my pointer. */
  outbox(): Promise<Record<string, OutMark>>
  /** By the friend's pointer (`theirs`). */
  seen(): Promise<Record<string, SeenMark>>
  /** These marks were on the screen now. */
  see(marks: readonly { theirs: string; mark: FriendMark }[]): Promise<void>
  stop(): void
}

export const MARKS_OUT = 'friendsMarksOut'
export const MARKS_SEEN = 'friendsMarksSeen'
/** YAZ-5258: the times of my mark writes in the last hour, and the local day of the last cheer and nudge for each pointer. */
export const MARKS_LOG = 'friendsMarksLog'
interface MarksLog {
  times: number[]
  days: Record<string, Partial<Record<MarkKind, string>>>
}

export interface MarksOptions {
  store: VaultStore
  tokens: TokenStore
  fetch?: FetchLike
  now?: () => number
  lock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  signal?: AbortSignal
}

const HOUR = 3600_000
const pad2 = (n: number) => String(n).padStart(2, '0')
const dayOf = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * When `need` updates may go and still leave `reserve`: the time the oldest of my updates leave the hour (and GitHub's
 * own reset, when its count is the lower one). Pure; `mayUpdate` is true at that time.
 */
export function freeAt(b: GistBudget, now: number, need: number, reserve: number): number {
  let at = b.blockedUntil !== null && b.blockedUntil > now ? b.blockedUntil : now
  const short = need + reserve - budgetLeft(b, now)
  if (short <= 0) return at
  const mine = b.updates.filter((t) => t > now - HOUR && t <= now).sort((x, y) => x - y)
  const own = mine.length - (GIST_UPDATES_PER_HOUR - need - reserve)
  if (own > 0 && own <= mine.length) at = Math.max(at, mine[own - 1] + HOUR + 1)
  if (b.seen !== null && now < b.seen.resetAt && b.seen.remaining - (b.seen.after ?? 0) < need + reserve) at = Math.max(at, b.seen.resetAt)
  return Math.max(at, now + 1)
}

function webLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = (
    globalThis as {
      navigator?: {
        locks?: { request(name: string, fn: () => Promise<T>): Promise<T> }
      }
    }
  ).navigator?.locks
  return locks === undefined ? fn() : locks.request(name, fn)
}

interface SendSaved {
  budget?: GistBudget
  pointers?: number
}

export function createMarks(options: MarksOptions): Marks {
  const { store, tokens } = options
  const now = options.now ?? Date.now
  const lock = options.lock ?? webLock
  const guard = friendsGuard(store, options.fetch, options.signal)
  const running = new Map<string, Promise<MarkSend>>()

  const outbox = async () => (await store.getState<Record<string, OutMark>>(PHONE, MARKS_OUT)) ?? {}
  async function saveOut(session: VaultStore, mine: string, entry: OutMark | null) {
    if (!(await guard.live())) return
    const all = { ...(await outbox()) }
    if (entry === null) delete all[mine]
    else all[mine] = entry
    await session.setState(PHONE, MARKS_OUT, all)
  }

  /** One write of the mark into my pointer, under the friends lock. */
  async function write(mine: string, mark: FriendMark, pointers: number): Promise<MarkSend> {
    if (!(await guard.live())) return { kind: 'no-account' }
    const session = await store.session(PHONE)
    const friends = await openFriendsApi(store, tokens, {
      fetch: guard.fetch,
      now,
    })
    if (friends.kind !== 'ok') return { kind: friends.kind }
    const api: GistsApi = friends.api
    return lock('notecards-friends', async () => {
      const saved = (await store.getState<SendSaved & Record<string, unknown>>(PHONE, SEND_STATE)) ?? {}
      let budget = saved.budget ?? emptyBudget()
      const saveBudget = async (b: GistBudget) => {
        if (await guard.live())
          await session.setState(PHONE, SEND_STATE, {
            lastSentAt: null,
            lastKey: null,
            pointers: 0,
            ...saved,
            budget: b,
          })
      }
      const wait = async (why: MarkWait, retryAt: number | null): Promise<MarkSend> => {
        await saveOut(session, mine, { mark, state: 'waiting', why, retryAt })
        return { kind: 'waiting', mark, why, retryAt }
      }
      // The reserve for a remove stays: one update for each pointer (the sender's count, or the list's on a new phone).
      const reserve = Math.max(saved.pointers ?? 0, pointers)
      const t = now()
      const log = (await store.getState<MarksLog>(PHONE, MARKS_LOG)) ?? { times: [], days: {} }
      // YAZ-5258: one cheer and one nudge a day for each friend; a second tap of the day makes no write.
      if (log.days[mine]?.[mark.kind] === dayOf(t)) return { kind: 'already', mark: (await outbox())[mine]?.mark ?? mark }
      // YAZ-5258: the 5 updates an hour kept for marks are a hard cap, so marks never take the numbers send's budget.
      const hour = log.times.filter((x) => x > t - HOUR && x <= t).sort((a, b) => a - b)
      // YAZ-5293: checked at SEND time too: a mark never goes to a friend whose remove waits (the phone's queue).
      if ((await queuedMines(store)).has(mine)) {
        await saveOut(session, mine, null)
        return { kind: 'gone' }
      }
      // YAZ-5294: the order of the hour is `mayMark`'s (removes, then the numbers send, then marks from their own 5).
      if (!mayMark(budget, t, reserve, hour.length)) {
        if (hour.length >= MARK_HEADROOM) return wait('marks-limit', hour[hour.length - MARK_HEADROOM] + HOUR + 1)
        return wait('budget', freeAt(budget, t, 1, reserve))
      }
      try {
        const gist = await api.read(mine)
        if (gist === 'unchanged') return { kind: 'failed' }
        const file = gist.files[POINTER_FILE]
        const pointer = readPointerFile(file?.truncated ? null : file?.content)
        if (pointer.kind === 'newer') return { kind: 'newer-app' }
        if (pointer.kind === 'unreadable') return { kind: 'failed' }
        const text = JSON.stringify({
          ...pointer.raw,
          v: 1,
          stats: pointer.value.stats,
          ...(pointer.value.reads === undefined ? {} : { reads: pointer.value.reads }),
          mark,
        })
        const answer = await api.update(mine, { [POINTER_FILE]: text })
        budget = recordUpdate(budget, now(), answer.rate)
        await saveBudget(budget)
        if (await guard.live())
          await session.setState(PHONE, MARKS_LOG, {
            times: [...hour, now()],
            days: { ...log.days, [mine]: { ...log.days[mine], [mark.kind]: dayOf(t) } },
          } satisfies MarksLog)
        await saveOut(session, mine, { mark, state: 'sent' })
        return { kind: 'sent', mark }
      } catch (err) {
        if (err instanceof VaultClosedError) return { kind: 'no-account' }
        switch (gistErrorCode(err)) {
          case 'NOT_FOUND':
            await saveOut(session, mine, null)
            return { kind: 'gone' }
          case 'READ_ONLY':
            if (await guard.live()) await recordGistsRefused(store, friends.vault)
            return { kind: 'no-gists' }
          case 'UNAUTHORIZED':
            return { kind: 'unauthorized' }
          case 'RATE_LIMITED': {
            const at = gistErrorResetAt(err) ?? gistErrorRate(err)?.resetAt ?? now() + 60_000
            await saveBudget({ ...budget, blockedUntil: at })
            return wait('rate-limited', at)
          }
          case 'OFFLINE':
          case 'GITHUB_DOWN':
            return wait('offline', null)
          case null:
            throw err
          default:
            return { kind: 'failed' }
        }
      }
    })
  }

  function once(mine: string, mark: FriendMark, pointers = 0): Promise<MarkSend> {
    const run = running.get(mine)
    if (run !== undefined) return run
    const next = write(mine, mark, pointers).finally(() => running.delete(mine))
    running.set(mine, next)
    return next
  }

  return {
    async send(mine, kind, pointers) {
      // A mark of this kind that already waits for this friend: no second one (it goes by itself).
      const waiting = (await outbox())[mine]
      if (waiting?.state === 'waiting' && waiting.mark.kind === kind && !running.has(mine))
        return { kind: 'waiting', mark: waiting.mark, why: waiting.why ?? 'offline', retryAt: waiting.retryAt ?? null }
      return once(mine, { kind, at: new Date(now()).toISOString() }, pointers)
    },
    async flush({ pointers, keep }) {
      const t = now()
      for (const [mine, out] of Object.entries(await outbox())) {
        if (out.state !== 'waiting') continue
        // YAZ-5293: a friend who is being removed, is removed, stopped, or no longer shares: the mark is dropped.
        if (!keep(mine)) {
          if (await guard.live()) await saveOut(await store.session(PHONE), mine, null)
          continue
        }
        if (out.retryAt === null || out.retryAt === undefined || t >= out.retryAt) await once(mine, out.mark, pointers)
      }
    },
    outbox,
    seen: async () => (await store.getState<Record<string, SeenMark>>(PHONE, MARKS_SEEN)) ?? {},
    async see(marks) {
      if (marks.length === 0 || !(await guard.live())) return
      const all = (await store.getState<Record<string, SeenMark>>(PHONE, MARKS_SEEN)) ?? {}
      let changed = false
      const t = now()
      for (const { theirs, mark } of marks) {
        const next = seeMark(mark, all[theirs], t)
        if (next !== all[theirs]) {
          all[theirs] = next
          changed = true
        }
      }
      if (changed) await (await store.session(PHONE)).setState(PHONE, MARKS_SEEN, all)
    },
    stop: () => guard.stop(),
  }
}
