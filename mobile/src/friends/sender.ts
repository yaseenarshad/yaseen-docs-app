import { DESCRIPTIONS, gistErrorCode, gistErrorResetAt, listPatch, pointersOf, type GistDoc, type GistsApi, type IndexHandle, type WriteOptions } from '@shared/friendGists'
import { BrokenList, NewerList, latestList, listErrorCode, openFriendsList, writeList } from '@shared/friendListHome'
import {
  PUBLISH_EVERY_MS,
  emptyBudget,
  mayUpdate,
  recordUpdate,
  numbersFor,
  numbersKey,
  reserveFor,
  sendGap,
  sendGate,
  sendNumbers,
  type GistBudget,
  type SendReason,
} from '@shared/friendSend'
import { deviceZone, friendStats } from '@shared/friendStats'
import { finishRemove, pendingRemove, remakeNumbers, settlePointers } from '@shared/friendsList'
import { recordGistsRefused } from '../auth/friends'
import type { FetchLike } from '../github/client'
import { PHONE, VaultClosedError, type TokenStore, type VaultStore } from '../store'
import type { Clock, SyncEvent } from '../sync/engine'
import { countedVaults, openFriendsApi } from './friendsApi'
import type { OwnNumbers } from './ownNumbers'
import { friendsGuard } from './guard'
import { deviceTag } from './deviceTag'
import { drainQueue, loadQueue } from './removeQueue'

/**
 * The phone's send of the numbers (YAZ-5082, 4E1). It listens to the sync engine (3B) and sends the person's ONE
 * numbers gist (round 16) with the shared rules of `shared/friendSend.ts`:
 * - only after a sync pass (decision 16), so the numbers hold the other devices' reviews;
 * - only with at least one friend or group (decision 22). It never MAKES a friends file: 4E2 does, at the first friend;
 * - only when the phone holds all the vaults that count (round 12, item 3);
 * - only when the numbers changed; at most once each 5 minutes while the person reviews; also when the app goes to the
 *   background (4A calls `background()` on `visibilitychange` to hidden);
 * - inside the `gist_update` budget (100 an hour for the account), with a reserve for a remove;
 * - never lower: read the gist, merge, write.
 * A refused write (no Gists permission) calls 3E's `recordGistsRefused`. No connection, a rate limit, GitHub down:
 * quiet; it tries again at the time GitHub gives or at the next pass. The numbers gist deleted on GitHub: a new one,
 * each pointer and the list updated (`remakeNumbers`: the same saga as a remove, so one generation, never two).
 *
 * Statuses (for 4E4, never a message with a secret):
 * `idle`, `no-pass`, `no-account` (no vault with a checked token), `no-gists`, `no-friends`, `missing-vaults`,
 * `waiting` (the 5-minute rule; `retryAt`), `slowed` (budget or rate limit; `retryAt`), `offline`, `sent`,
 * `unchanged`, `needs-newer-app` (a friends file of a newer app), `sign-in-again` (401), `failed`.
 */
export type FriendsSendStatus =
  | 'idle'
  | 'no-pass'
  | 'no-account'
  | 'no-gists'
  | 'no-friends'
  | 'missing-vaults'
  | 'waiting'
  | 'slowed'
  | 'offline'
  | 'sent'
  | 'unchanged'
  | 'needs-newer-app'
  | 'needs-repair'
  /** YAZ-5083: the friends list is in a vault this phone does not have; nothing is sent from here. */
  | 'list-elsewhere'
  /** YAZ-5083: the token cannot read the vault that holds the friends list. */
  | 'no-list-access'
  | 'sign-in-again'
  | 'failed'

export interface FriendsSendState {
  status: FriendsSendStatus
  /** The time of the last update of the numbers gist from this phone (ms), or null. */
  lastSentAt: number | null
  /** For `waiting` and `slowed`: when the sender tries again. */
  retryAt: number | null
  /** The numbers gist was deleted on GitHub and made again (with each pointer updated) in this session. */
  remade: boolean
}

/** What the phone keeps between starts (phone-only state `friendsSend`; no token, no card text). */
interface Saved {
  lastSentAt: number | null
  lastKey: string | null
  budget: GistBudget
  /** Pointers at the last read, for the reserve before the list is read again. */
  pointers: number
}
export const SEND_STATE = 'friendsSend'

export interface FriendsSenderOptions {
  store: VaultStore
  tokens: TokenStore
  /** The sync engine of 3B (`createSyncEngine`), or anything with its `subscribe`. */
  sync: { subscribe(listener: (event: SyncEvent) => void): () => void }
  clock?: Clock
  fetch?: FetchLike
  /** The wait between two writes (GitHub advises 1 second). Tests pass one that does not wait. */
  sleep?: (ms: number) => Promise<void>
  /** One tab sends at a time. Default: the Web Lock `notecards-friends`, else no lock. */
  lock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  /**
   * YAZ-5195: the app's erase. Aborted (before "Sign out and erase this phone"), the sender stops as `stop()` does:
   * the running request is aborted and nothing is stored again.
   */
  signal?: AbortSignal
  /**
   * YAZ-5255: my numbers, counted once for each change and kept (`ownNumbers.ts`), shared with the Friends tab. Absent:
   * the sender counts them itself (2C's `friendStats`) at each try.
   */
  numbers?: OwnNumbers
  /** The description of a gist the sender makes (only when the numbers gist must be made again). */
  describe?: WriteOptions['describe']
}

export interface FriendsSender {
  state(): FriendsSendState
  /** The app went to the background: send now if the numbers changed (no 5-minute wait). */
  background(): Promise<FriendsSendState>
  /** One try now, for `reason`. The sync events call it; 4A and tests may too. */
  attempt(reason: SendReason): Promise<FriendsSendState>
  /** Resolves when no try runs and none waits to run. */
  idle(): Promise<void>
  /** Stops the timers and the polling, aborts a running request (YAZ-5195), and resolves when the running try ended. */
  stop(): Promise<void>
}

const browserClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}
function webLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: { request(name: string, fn: () => Promise<T>): Promise<T> } } }).navigator?.locks
  return locks === undefined ? fn() : locks.request(name, fn)
}
const STRENGTH: Record<SendReason, number> = { timer: 0, pass: 1, background: 2 }
/** A timer never waits longer than this (a browser timer over 2^31-1 ms fires at once). */
const MAX_TIMER_MS = 60 * 60_000

export function createFriendsSender(options: FriendsSenderOptions): FriendsSender {
  const { store, tokens } = options
  const clock = options.clock ?? browserClock
  const lock = options.lock ?? webLock
  const writeOptions: WriteOptions = {
    describe: options.describe ?? ((kind) => DESCRIPTIONS[kind]),
    sleep: options.sleep ?? ((ms) => new Promise((done) => clock.setTimeout(done, ms))),
    now: () => clock.now(),
  }

  const guard = friendsGuard(store, options.fetch, options.signal)
  let state: FriendsSendState = { status: 'idle', lastSentAt: null, retryAt: null, remade: false }
  let passSeen = false
  /** Something changed since the last send (the first pass of a session counts as a change). */
  let dirty = true
  let stopped = false
  let timer: unknown = null
  let chain: Promise<void> = Promise.resolve()
  let queued: SendReason | null = null
  /** The list as last read, with its ETag (a 304 is free). Only for this session. */
  let index: IndexHandle | null = null
  /** No list was found at this time: look again only after PUBLISH_EVERY_MS, or on a background send. */
  let noIndexAt: number | null = null

  const set = (patch: Partial<FriendsSendState>) => {
    state = { ...state, retryAt: null, ...patch }
  }
  const schedule = (at: number) => {
    if (timer !== null) clock.clearTimeout(timer)
    timer = clock.setTimeout(() => {
      timer = null
      void attempt('timer')
    }, Math.min(MAX_TIMER_MS, Math.max(1000, at - clock.now())))
  }

  async function loadSaved(): Promise<Saved> {
    const saved = await store.getState<Saved>(PHONE, SEND_STATE)
    return saved ?? { lastSentAt: null, lastKey: null, budget: emptyBudget(), pointers: 0 }
  }

  /** YAZ-5354: the pointers as last read (ETags: an unchanged pointer is a free 304), for the check before each send. */
  const pointerCache = new Map<string, { etag: string | null; gist: GistDoc }>()

  /** The list: the copy of this session (an ETag read of the vault's branch), or found by the note. Null: no list. */
  async function readIndex(api: GistsApi, now: number, reason: SendReason): Promise<IndexHandle | 'newer' | 'broken' | 'elsewhere' | 'no-access' | null> {
    if (index !== null) {
      try {
        return (index = await latestList(index))
      } catch (err) {
        if (err instanceof NewerList) return 'newer'
        if (!(err instanceof BrokenList) && listErrorCode(err) === null) throw err
      }
      index = null // gone or broken: find it again
    }
    if (noIndexAt !== null && reason !== 'background' && now < noIndexAt + PUBLISH_EVERY_MS) return null
    // YAZ-5083: an old gist list is moved into the vault here too; the sender never MAKES a list (decision 22).
    const found = await openFriendsList(api, writeOptions)
    if (found.kind === 'none') {
      noIndexAt = now
      return null
    }
    noIndexAt = null
    if (found.kind === 'newer') return 'newer'
    if (found.kind === 'broken') return 'broken'
    if (found.kind === 'elsewhere') return 'elsewhere'
    if (found.kind === 'no-vault') return 'no-access'
    return (index = found.handle)
  }

  async function run(reason: SendReason): Promise<void> {
    if (stopped || guard.stopped) return
    const now = clock.now()
    if (!passSeen) return set({ status: 'no-pass' })
    const saved = await loadSaved()
    // YAZ-5195: the phone-wide session of this try. After "Sign out and erase this phone" (in any tab) its writes
    // throw `VaultClosedError`, so nothing of this try is stored again.
    const session = await store.session(PHONE)
    // YAZ-5083: this phone's tag in the list's steps (stable across restarts).
    writeOptions.device ??= await deviceTag(session)
    // YAZ-5195: after an erase or a stop, nothing of the friends state is stored again.
    const save = async (patch: Partial<Saved>) => {
      if (await guard.live()) await session.setState(PHONE, SEND_STATE, { ...saved, ...patch })
    }

    // The cheap checks first: the 5-minute rule and the budget need no network and no count.
    // YAZ-5192: also for a background send. `lastSentAt` is phone-only state, so the rule holds after a restart too.
    if (saved.lastSentAt !== null) {
      const at = saved.lastSentAt + sendGap(saved.budget, now, reserveFor(saved.pointers))
      if (now < at) {
        schedule(at)
        return set({ status: 'waiting', retryAt: at, lastSentAt: saved.lastSentAt })
      }
    }

    const friends = await openFriendsApi(store, tokens, { fetch: guard.fetch, now: () => clock.now() })
    if (friends.kind !== 'ok') return set({ status: friends.kind })
    const { api, vault, account } = friends

    try {
      let handle = await readIndex(api, now, reason)
      if (handle === 'newer') return set({ status: 'needs-newer-app' })
      // YAZ-5191: a list that cannot be read: no send and no write; 4E4 shows LIST_NEEDS_REPAIR.
      if (handle === 'broken') return set({ status: 'needs-repair' })
      if (handle === 'elsewhere') return set({ status: 'list-elsewhere' })
      if (handle === 'no-access') return set({ status: 'no-list-access' })
      if (handle === null) return set({ status: 'no-friends' })
      // YAZ-5236: removes that wait on the phone go first: a remove has priority over a numbers update.
      if ((await loadQueue(session)).length > 0) {
        const drained = await drainQueue(api, handle, session, saved.budget, { ...writeOptions, now: () => clock.now() })
        if (drained !== null) {
          saved.budget = drained.budget
          await save({ budget: drained.budget })
          index = drained.handle
          handle = drained.handle
          if (drained.kind === 'paused' && pendingRemove(drained.handle) === null) {
            if (drained.why === 'offline') return set({ status: 'offline' })
            const at = drained.retryAt ?? clock.now() + 60_000
            schedule(at)
            return set({ status: 'slowed', retryAt: at })
          }
        }
      }
      // 4E2 (YAZ-5083): a remove waits in the list (the app closed, or the budget ran out). Finish it first; never
      // send to the old numbers gist while it waits, so the removed friend's last numbers do not change.
      if (pendingRemove(handle) !== null) {
        const finished = await finishRemove(api, handle, saved.budget, { ...writeOptions, now: () => clock.now() })
        saved.budget = finished.budget
        await save({ budget: finished.budget })
        index = finished.handle
        if (finished.kind === 'paused') {
          if (finished.why === 'refused') {
            if (await guard.live()) await recordGistsRefused(store, vault)
            return set({ status: 'no-gists' })
          }
          if (finished.why === 'unauthorized') return set({ status: 'sign-in-again' })
          if (finished.why === 'offline') return set({ status: 'offline' })
          if (finished.why === 'needs-repair') return set({ status: 'needs-repair' })
          if (finished.retryAt !== null) schedule(finished.retryAt)
          return set({ status: 'slowed', retryAt: finished.retryAt })
        }
        handle = finished.handle
      }
      const pointers = pointersOf(handle.index).length
      // YAZ-5251: a list with no home time zone gets this phone's zone, one write, once. Until it is written, the count
      // uses this phone's zone, as before. YAZ-5083: a commit of the vault repo (compare-and-swap; no `gist_update`):
      // a zone that another device wrote at the same moment stays.
      const own = deviceZone()
      if (handle.index.zone === undefined && own !== null && pointers > 0) {
        handle = await writeList(handle, (cur) => (cur.index.zone !== undefined ? null : listPatch(cur, { ...cur.index, zone: own })), writeOptions)
        index = handle
      }
      const zone = handle.index.zone ?? null
      const kept = options.numbers === undefined ? undefined : await options.numbers.counted(handle.index.vaults, now, zone)
      const vaults = kept === undefined ? await countedVaults(store, handle.index.vaults) : null
      const gate = sendGate({ pointers, passSeen, holdsAll: kept === undefined ? vaults !== null : kept !== null, lastSentAt: saved.lastSentAt, now, reason, budget: saved.budget })
      if (!gate.go) {
        if (gate.why === 'wait' || gate.why === 'budget') {
          schedule(gate.retryAt!)
          await save({ pointers })
          return set({ status: gate.why === 'wait' ? 'waiting' : 'slowed', retryAt: gate.retryAt! })
        }
        return set({ status: gate.why === 'no-friends' ? 'no-friends' : gate.why === 'missing-vaults' ? 'missing-vaults' : 'no-pass' })
      }

      // The count: about 200 ms for a large vault (2C). It runs at most once each 5 minutes, and on a background send.
      const fresh = numbersFor(kept ?? friendStats(vaults!, now, zone), { login: account.login, name: account.name, avatar: account.avatarUrl, nickname: handle.index.nickname }, now)
      const key = numbersKey(fresh)
      if (key === saved.lastKey && handle.index.stats !== null) {
        dirty = false
        await save({ pointers })
        return set({ status: 'unchanged' })
      }
      // YAZ-5354: each pointer of the list names the numbers gist this send writes (a pointer that a slow run of another
      // device wrote back to an older gist moves now), so every kept friend reads these numbers (I6). Reads with ETags
      // (free when nothing changed); a write only for a pointer that is wrong.
      handle = await settlePointers(api, handle, { ...writeOptions, now: () => clock.now() }, pointerCache, 'stats')
      index = handle
      const reserve = reserveFor(pointers)
      let outcome
      let budget = saved.budget
      if (handle.index.stats === null) outcome = { kind: 'numbers-gone' as const }
      else ({ outcome, budget } = await sendNumbers(api, { statsId: handle.index.stats, fresh, budget, reserve, now }))

      if (outcome.kind === 'numbers-gone') {
        // Made again as a remove with no friend in it (one generation, each pointer moved): this may use the reserve,
        // which is kept for exactly this kind of change; it waits when even that is not there.
        if (!mayUpdate(budget, now, pointers, 0)) {
          const at = now + sendGap(budget, now, 0)
          schedule(at)
          return set({ status: 'slowed', retryAt: at })
        }
        const result = await remakeNumbers(api, handle, budget, { ...writeOptions, now: () => clock.now() })
        index = result.handle
        budget = result.budget
        await save({ budget, pointers })
        if (result.kind !== 'done') {
          if (result.kind === 'paused' && result.retryAt !== null) schedule(result.retryAt)
          return set({ status: result.kind === 'paused' && result.why === 'offline' ? 'offline' : 'slowed', retryAt: result.kind === 'paused' ? result.retryAt : null })
        }
        // The new numbers gist is in the list: these numbers go to it now.
        handle = result.handle
        if (handle.index.stats === null) return set({ status: 'failed' })
        ;({ outcome, budget } = await sendNumbers(api, { statsId: handle.index.stats, fresh, budget, reserve, now }))
        if (outcome.kind === 'sent' || outcome.kind === 'unchanged') {
          dirty = false
          await save({ lastSentAt: now, lastKey: key, budget, pointers })
          return set({ status: 'sent', lastSentAt: now, remade: true })
        }
      }
      switch (outcome.kind) {
        case 'sent':
          dirty = false
          await save({ lastSentAt: now, lastKey: key, budget, pointers })
          return set({ status: 'sent', lastSentAt: now })
        case 'unchanged':
          dirty = false
          await save({ lastKey: key, budget, pointers })
          return set({ status: 'unchanged' })
        case 'newer-app':
          return set({ status: 'needs-newer-app' })
        case 'budget':
        case 'rate-limited':
          schedule(outcome.retryAt)
          await save({ budget, pointers })
          return set({ status: 'slowed', retryAt: outcome.retryAt })
        case 'refused':
          if (await guard.live()) await recordGistsRefused(store, vault)
          return set({ status: 'no-gists' })
        case 'offline':
          return set({ status: 'offline' })
        case 'unauthorized':
          return set({ status: 'sign-in-again' })
        default:
          return set({ status: 'failed' })
      }
    } catch (err) {
      if (err instanceof VaultClosedError) throw err
      // YAZ-5083: the list in the vault repo.
      if (err instanceof NewerList) return set({ status: 'needs-newer-app' })
      if (err instanceof BrokenList) return set({ status: 'needs-repair' })
      if (listErrorCode(err) === 'NO_LIST_ACCESS') return set({ status: 'no-list-access' })
      // A failure while the list is found or the numbers gist is made again.
      switch (gistErrorCode(err)) {
        case 'OFFLINE':
        case 'GITHUB_DOWN':
          return set({ status: 'offline' })
        case 'UNAUTHORIZED':
          return set({ status: 'sign-in-again' })
        case 'READ_ONLY':
          if (await guard.live()) await recordGistsRefused(store, vault)
          return set({ status: 'no-gists' })
        case 'RATE_LIMITED': {
          const at = Math.max(now + 60_000, gistErrorResetAt(err) ?? 0)
          schedule(at)
          return set({ status: 'slowed', retryAt: at })
        }
        default:
          return set({ status: 'failed' })
      }
    }
  }

  function attempt(reason: SendReason): Promise<FriendsSendState> {
    if (stopped || guard.stopped) return Promise.resolve(state)
    if (queued !== null) {
      if (STRENGTH[reason] > STRENGTH[queued]) queued = reason
      return chain.then(() => state)
    }
    queued = reason
    chain = chain
      .then(async () => {
        const next = queued!
        queued = null
        await lock('notecards-friends', () => run(next))
      })
      // An erase during the try: it ends quietly, with nothing stored (YAZ-5195).
      .catch((err) => set({ status: err instanceof VaultClosedError ? 'idle' : 'failed' }))
    return chain.then(() => state)
  }

  const unsubscribe = options.sync.subscribe((event) => {
    if (stopped || guard.stopped) return
    if (event.type === 'changed') {
      // Only a pass that read GitHub moves the numbers (`diff` null: the stored index was loaded on open).
      if (event.diff !== null) dirty = true
      if (passSeen && dirty) void attempt('pass')
      return
    }
    if (event.state.status === 'synced') {
      passSeen = true
      if (dirty) void attempt('pass')
    }
  })

  return {
    state: () => state,
    background: () => attempt('background'),
    attempt,
    async idle() {
      for (;;) {
        const current = chain
        await current
        if (current === chain && queued === null) return
      }
    },
    stop() {
      stopped = true
      guard.stop()
      unsubscribe()
      if (timer !== null) clock.clearTimeout(timer)
      timer = null
      return chain.then(() => undefined)
    },
  }
}
