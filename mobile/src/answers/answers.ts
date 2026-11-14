import { cardsById } from '@shared/cardLinks'
import { GithubError, MAX_RATE_WAIT_MS, MIN_RATE_WAIT_MS, rateLimitedUntil, type GithubErrorCode } from '../github/client'
import type { VaultStore } from '../store'
import { SEND_AFTER_MS } from '../sync/cadence'
import type { Clock, SyncEngine } from '../sync/engine'
import { phoneRecord, type PhoneIndex } from '../sync/phoneIndex'
import { applyOps, type CardOp } from './ops'
import { openOutbox, type LostAnswer, type Outbox, type WaitingAnswer } from './outbox'
import { sendOutbox } from './send'

/** Why the last send did not end well: a `GithubErrorCode`, or `FAILED` (anything else). Never a message with a secret. */
export type SendProblem = GithubErrorCode | 'FAILED'

/**
 * The answer list's part of the status (4D combines it with the engine's: `phoneSyncState` in `status.ts`).
 * - `waiting`: actions not sent yet ("N answers waiting", amber; decision 12).
 * - `lost`: actions whose card was gone ("1 answer could not be saved", amber, with Discard; round 12 item 9).
 * - `sending`: a send runs (blue "Syncing…").
 * - `problem`: why the last send failed. `OFFLINE` / `GITHUB_DOWN`: it sends again when the signal comes back.
 *   `RATE_LIMITED`: it sends again at `retryAt`. `UNAUTHORIZED`, `READ_ONLY`, `NOT_FOUND`, `NO_ACCESS`: the person must
 *   act (red); the answers stay, and `sendNow()` tries again after a new sign-in.
 */
export interface AnswersState {
  vault: string | null
  waiting: number
  lost: LostAnswer[]
  sending: boolean
  problem: SendProblem | null
  retryAt: number | null
  /** The end of the last send that GitHub took (ms since 1970). */
  lastSentAt: number | null
}

export type AnswersEvent =
  | { type: 'state'; state: AnswersState }
  /** The phone's view of these files changed (an action was added or undone): Review and the due list read again. */
  | { type: 'changed'; vault: string; paths: string[] }

export interface AnswersOptions {
  store: VaultStore
  /** The sync engine of 3B: the send runs in its lane, never while a pass writes the store. */
  engine: Pick<SyncEngine, 'state' | 'subscribe' | 'lane'>
  clock?: Clock
  /** Default `SEND_AFTER_MS` (decision 4). */
  sendAfterMs?: number
  yieldToUi?: () => Promise<void>
}

export interface Answers {
  state(): AnswersState
  subscribe(listener: (event: AnswersEvent) => void): () => void
  /** The open vault's waiting actions, in order. */
  waiting(): readonly WaitingAnswer[]
  /** One person action (one or more card actions): kept on the phone, then sent `SEND_AFTER_MS` after the last one. */
  add(entries: readonly { op: CardOp; path: string; title: string }[]): Promise<number>
  /**
   * Undo of an UNSENT action: its group leaves the list. False when it is gone, or when a send has tried it (it may be
   * on GitHub, YAZ-5180): the host then adds `unreview`.
   */
  undo(group: number): Promise<boolean>
  /** Discard of a lost action (the tap on the amber dot). */
  discard(seq: number): Promise<boolean>
  /** A file of the open vault as the phone shows it: the stored copy with the waiting actions applied. Null: not stored. */
  text(path: string): Promise<string | null>
  /** The index as the phone shows it: each file that a waiting action changes, read again with the action applied. */
  view(index: PhoneIndex): Promise<PhoneIndex>
  /** A send now, or after the running one. */
  sendNow(): Promise<void>
  /** Hidden: a send at once (decision 4: "at once when the app goes to the background"). */
  setVisible(visible: boolean): void
  /** The connection came back: a send at once. */
  online(): void
  /** Resolves when the list is read and no send runs. */
  idle(): Promise<void>
  stop(): void
}

const browserClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** The person must act: no send by itself until `sendNow()` (after "Sign in again") or a new answer. */
const NEEDS_PERSON: readonly SendProblem[] = ['UNAUTHORIZED', 'READ_ONLY', 'NOT_FOUND', 'NO_ACCESS']
/** No signal: a good pass of the engine (or the `online` event) sends again. */
const NO_SIGNAL: readonly SendProblem[] = ['OFFLINE', 'GITHUB_DOWN']

/**
 * The answer list of the open vault and WHEN it is sent (decisions 2 and 4; round 10 item 20; round 12 item 9). It
 * follows the engine's open vault. One send at a time, in the engine's lane (never while a pass writes the store).
 *  - `SEND_AFTER_MS` after the last answer, so a burst of answers is ONE commit;
 *  - at once when the app goes to the background, when the connection comes back, and when the engine's poll works
 *    again after no signal;
 *  - at once at the start when the stored list has waiting actions (a closed app, October E8);
 *  - "slow down": at the time GitHub gives.
 */
export function createAnswers(options: AnswersOptions): Answers {
  const { store, engine } = options
  const clock = options.clock ?? browserClock
  const sendAfter = options.sendAfterMs ?? SEND_AFTER_MS
  const listeners = new Set<(event: AnswersEvent) => void>()

  let vault: string | null = null
  let box: Outbox | null = null
  let loading: Promise<void> = Promise.resolve()
  let running: Promise<void> | null = null
  let rerun = false
  let timer: unknown = null
  let stopped = false
  /** Actions GitHub has, but the stored copy not yet (the pass after the commit failed): shown until the next pass. */
  let afterglow: CardOp[] = []
  /** "Slow down" answers to a send in a row: each one doubles the wait, up to 1 hour, as the engine does (YAZ-5169). */
  let slowedInRow = 0
  /** Sends in a row that ended in `STALE_HEAD` (the branch kept moving): each one doubles the wait (YAZ-5183). */
  let staleInRow = 0
  let state: AnswersState = { vault: null, waiting: 0, lost: [], sending: false, problem: null, retryAt: null, lastSentAt: null }
  /**
   * YAZ-5078: the view's mtime of each file whose shown text differs from the stored copy, with that text. The shared
   * due list keeps a page's card facts by path, mtime and size (`cardFacts`): the Mac's index gives a new mtime on each
   * write, so the view does too. The same text keeps its mtime (the cache hits); a new text gets a newer one.
   */
  let shownAt = new Map<string, { text: string; mtime: number }>()

  const emit = (event: AnswersEvent) => {
    for (const listener of [...listeners]) listener(event)
  }
  const setState = (next: Partial<AnswersState>) => {
    state = { ...state, ...next, waiting: box?.waiting().length ?? 0, lost: [...(box?.lost() ?? [])], vault }
    emit({ type: 'state', state: { ...state } })
  }
  const clearTimer = () => {
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
  }
  const plan = (at: number) => {
    clearTimer()
    if (stopped) return
    timer = clock.setTimeout(() => {
      timer = null
      void sendNow()
    }, Math.max(0, at - clock.now()))
  }
  const waiting = () => (box?.waiting().length ?? 0) > 0
  /** GitHub asked to wait, or the branch kept moving: no send before `retryAt`. */
  const slowed = () => (state.problem === 'RATE_LIMITED' || state.problem === 'STALE_HEAD') && state.retryAt !== null && state.retryAt > clock.now()
  const needsPerson = () => state.problem !== null && NEEDS_PERSON.includes(state.problem)
  /** A send at once, unless the person must act first or GitHub asked to wait. */
  const sendSoon = () => {
    if (!waiting() || needsPerson() || slowed()) return
    void sendNow()
  }

  function follow(next: string | null) {
    if (next === vault) return
    clearTimer()
    vault = next
    box = null
    afterglow = []
    shownAt = new Map()
    state = { ...state, problem: null, retryAt: null, lastSentAt: null }
    const id = next
    loading = (async () => {
      if (id === null) return setState({})
      const opened = await openOutbox(store, id)
      if (vault !== id || stopped) return
      box = opened
      setState({})
      // Waiting actions from an earlier start go at once (the lane waits for the engine's first pass).
      if (waiting()) void sendNow()
    })()
  }

  const unsubscribe = engine.subscribe((event) => {
    if (event.type === 'state') {
      follow(event.state.vault)
      // The engine's poll works again after no signal: send what waits.
      if (event.state.status === 'synced' && !state.sending && running === null && timer === null && state.problem !== null && NO_SIGNAL.includes(state.problem)) sendSoon()
    } else if (event.type === 'changed' && event.vault === vault && afterglow.length > 0 && !state.sending) afterglow = []
  })
  follow(engine.state().vault)

  function sendNow(): Promise<void> {
    if (stopped) return Promise.resolve()
    if (running !== null) {
      rerun = true
      return running
    }
    const own = box
    const id = vault
    if (own === null || id === null || own.waiting().length === 0) return Promise.resolve()
    clearTimer()
    running = (async () => {
      setState({ sending: true })
      const before = own.waiting()
      try {
        const report = await engine.lane(async (remote, pass, laneVault) => {
          if (laneVault !== id) return null // the open vault changed: this list waits for its vault
          return sendOutbox({ remote, store, vault: id, outbox: own, pass, now: clock.now, yieldToUi: options.yieldToUi })
        })
        if (report === null) return
        slowedInRow = 0
        staleInRow = 0
        if (report.result === 'offline') return setState({ problem: 'OFFLINE', retryAt: null })
        if (!report.stored) {
          const still = new Set(own.waiting().map((w) => w.seq))
          const lost = new Set(own.lost().map((l) => l.seq))
          afterglow = [...afterglow, ...before.filter((w) => !still.has(w.seq) && !lost.has(w.seq)).map((w) => w.op)]
        }
        setState({ problem: null, retryAt: null, ...(report.sent > 0 && { lastSentAt: clock.now() }) })
      } catch (error) {
        const problem: SendProblem = error instanceof GithubError ? error.code : 'FAILED'
        if (problem === 'RATE_LIMITED') {
          slowedInRow++
          const backoff = Math.min(MAX_RATE_WAIT_MS, MIN_RATE_WAIT_MS * 2 ** Math.min(slowedInRow - 1, 16))
          const given = ((error as GithubError).resetAt ?? clock.now()) - clock.now()
          const retryAt = clock.now() + Math.min(MAX_RATE_WAIT_MS, Math.max(MIN_RATE_WAIT_MS, given, backoff))
          setState({ problem, retryAt })
          plan(retryAt)
        } else {
          setState({ problem, retryAt: null })
          // A branch that kept moving (YAZ-5183): wait 1, 2, 4 … minutes, up to 1 hour, with the client's clamp. Each
          // send is up to 6 tries of 3 writes, so this stays far under GitHub's write limit. Other problems wait for
          // the person or a trigger.
          if (problem === 'STALE_HEAD') {
            staleInRow++
            const retryAt = rateLimitedUntil(clock.now() + MIN_RATE_WAIT_MS * 2 ** Math.min(staleInRow - 1, 16), clock.now())
            setState({ retryAt })
            plan(retryAt)
          }
        }
      } finally {
        running = null
        setState({ sending: false })
        if (rerun) {
          rerun = false
          sendSoon()
        }
      }
    })()
    return running
  }

  async function text(path: string): Promise<string | null> {
    await loading
    if (vault === null) return null
    const file = await store.read(vault, path)
    if (file === null || typeof file.content !== 'string') return null
    const ops = [...afterglow, ...(box?.waiting().map((w) => w.op) ?? [])]
    return applyOps(file.content, ops).content
  }

  return {
    state: () => ({ ...state }),
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    waiting: () => box?.waiting() ?? [],
    async add(entries) {
      await loading
      if (box === null || vault === null) throw new Error('No vault is open')
      const group = await box.add(entries, clock.now())
      setState({})
      emit({ type: 'changed', vault, paths: [...new Set(entries.map((e) => e.path))] })
      if (!slowed()) plan(clock.now() + sendAfter)
      return group
    },
    async undo(group) {
      await loading
      if (box === null || vault === null) return false
      const gone = await box.removeGroup(group)
      if (gone.length === 0) return false
      setState({})
      emit({ type: 'changed', vault, paths: [...new Set(gone.map((w) => w.path))] })
      if (!waiting()) clearTimer()
      return true
    },
    async discard(seq) {
      await loading
      if (box === null) return false
      const done = await box.discard(seq)
      if (done) setState({})
      return done
    },
    text,
    async view(index) {
      await loading
      const ops = [...afterglow, ...(box?.waiting().map((w) => w.op) ?? [])]
      if (ops.length === 0) return index
      const byId = cardsById(Object.values(index.records))
      const paths = new Set<string>()
      for (const op of ops) {
        const link = byId.get(op.id.toLowerCase())
        if (link !== undefined) paths.add(link.path)
      }
      const records = { ...index.records }
      for (const path of paths) {
        const shown = await text(path)
        const old = records[path]
        if (shown === null || old === undefined || vault === null) continue
        const stored = await store.read(vault, path)
        if (stored !== null && stored.content === shown) continue // the actions change nothing here: the stored record
        const last = shownAt.get(path)
        const mtime = last !== undefined && last.text === shown ? last.mtime : Math.max(old.mtime, last?.mtime ?? 0) + 1
        shownAt.set(path, { text: shown, mtime })
        records[path] = phoneRecord(path, new TextEncoder().encode(shown).length, shown, { ctime: old.ctime, mtime })
      }
      return { commit: index.commit, records }
    },
    sendNow,
    setVisible(visible) {
      if (!visible) sendSoon()
      else if (timer === null && running === null && state.problem !== null && NO_SIGNAL.includes(state.problem)) sendSoon()
    },
    online() {
      sendSoon()
    },
    async idle() {
      await loading
      while (running !== null) await running
    },
    stop() {
      stopped = true
      clearTimer()
      unsubscribe()
    },
  }
}
