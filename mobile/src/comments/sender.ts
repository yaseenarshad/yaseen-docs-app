import { newCommentId, nowIso } from '@shared/comments'
import { GithubError, slowedUntil, staleUntil } from '../github/client'
import type { VaultStore } from '../store'
import { browserClock } from '../sync/browser'
import type { Clock, SyncEngine } from '../sync/engine'
import { openCommentBox, type CommentBox, type WaitingComment } from './outbox'
import type { TaskTick } from './taskWrite'
import { pageMark, sendComments } from './send'
import { commentSigner } from './signer'

/**
 * Why the last comment send did not end well: a `GithubErrorCode`, `NO_LOGIN` (the phone does not know the vault's
 * GitHub account yet, so it cannot sign), or `FAILED`.
 */
export type CommentProblem = string

export interface CommentsState {
  vault: string | null
  /** Comments not sent yet (refused ones not counted): the dot counts them as waiting. */
  waiting: number
  /** YAZ-5494: of `waiting`, the check box ticks. */
  ticks: number
  refused: number
  /** YAZ-5517: of `refused`, the ticks, and those whose page is gone. */
  refusedTicks: number
  refusedGone: number
  sending: boolean
  problem: CommentProblem | null
  retryAt: number | null
}

export interface NewCommentInput {
  path: string
  body: string
  by?: string
  /** A hold before any send, with its Undo (the one-tap "Approved" of YAZ-5461; since YAZ-5478 the page sends at once, 0). */
  holdMs?: number
  /** YAZ-5494: a tick of a task check box, not a comment (`body` is then empty). */
  task?: TaskTick
}

export interface CommentSender {
  state(): CommentsState
  subscribe(listener: (state: CommentsState) => void): () => void
  /** The open vault's comments not sent yet (refused ones too), in the order written; of one page with `path`. */
  waiting(path?: string): readonly WaitingComment[]
  add(input: NewCommentInput): Promise<WaitingComment>
  /** Undo of a comment not tried yet. False: it is gone, or a send has tried it (GitHub may hold it). */
  undo(id: string): Promise<boolean>
  discard(id: string): Promise<boolean>
  sendNow(): Promise<void>
  setVisible(visible: boolean): void
  online(): void
  idle(): Promise<void>
  stop(): void
}

export interface CommentSenderOptions {
  store: VaultStore
  engine: Pick<SyncEngine, 'state' | 'subscribe' | 'lane'>
  clock?: Clock
}


/** The person must act: no send by itself until `sendNow()` (after "Sign in again") or a new comment. */
const NEEDS_PERSON = ['UNAUTHORIZED', 'READ_ONLY', 'NOT_FOUND', 'NO_ACCESS']
const NO_SIGNAL = ['OFFLINE', 'GITHUB_DOWN', 'NO_LOGIN']

/**
 * YAZ-5461: the comment list of the open vault and WHEN it is sent, as the answer list is (`answers/answers.ts`): at
 * once when a comment is due (a typed one at once, the one-tap "Approved" after its 4-second Undo), at once when the
 * app goes to the background, when the connection comes back and when the engine's poll works again; "slow down" at
 * the time GitHub gives. One send at a time, in the engine's lane (never while a pass writes the store, and never at
 * the same time as an answer send). Loaded only when a comment is written or waits (`bridge.ts`).
 */
export function createCommentSender(options: CommentSenderOptions): CommentSender {
  const { store, engine } = options
  const clock = options.clock ?? browserClock
  const listeners = new Set<(state: CommentsState) => void>()
  let vault: string | null = null
  let box: CommentBox | null = null
  let loading: Promise<void> = Promise.resolve()
  let running: Promise<void> | null = null
  let rerun = false
  let timer: unknown = null
  let stopped = false
  let slowedInRow = 0
  let staleInRow = 0
  let state: CommentsState = { vault: null, waiting: 0, ticks: 0, refused: 0, refusedTicks: 0, refusedGone: 0, sending: false, problem: null, retryAt: null }

  const all = () => box?.waiting() ?? []
  const setState = (next: Partial<CommentsState>) => {
    const list = all()
    const waiting = list.filter((c) => c.refused === undefined)
    const refused = list.filter((c) => c.refused !== undefined)
    state = {
      ...state,
      ...next,
      vault,
      waiting: waiting.length,
      ticks: waiting.filter((c) => c.task !== undefined).length,
      refused: refused.length,
      refusedTicks: refused.filter((c) => c.task !== undefined).length,
      refusedGone: refused.filter((c) => c.refused === 'gone').length,
    }
    for (const l of [...listeners]) l({ ...state })
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
  const sendable = () => all().filter((c) => c.refused === undefined)
  const slowed = () => (state.problem === 'RATE_LIMITED' || state.problem === 'STALE_HEAD') && state.retryAt !== null && state.retryAt > clock.now()
  const needsPerson = () => state.problem !== null && NEEDS_PERSON.includes(state.problem)
  /** The next send: at once when one is due, else when the next one's Undo ends. */
  const planNext = () => {
    const list = sendable()
    if (list.length === 0 || needsPerson()) return clearTimer()
    if (slowed()) return plan(state.retryAt!)
    const at = Math.min(...list.map((c) => c.notBefore))
    if (at > clock.now()) return plan(at)
    clearTimer()
    void sendNow()
  }

  function follow(next: string | null) {
    if (next === vault) return
    clearTimer()
    vault = next
    box = null
    slowedInRow = 0
    staleInRow = 0
    state = { ...state, problem: null, retryAt: null }
    const id = next
    loading = (async () => {
      if (id === null) return setState({})
      const opened = await openCommentBox(store, id)
      if (vault !== id || stopped) return
      box = opened
      setState({})
      planNext()
    })()
  }

  const unsubscribe = engine.subscribe((event) => {
    if (event.type !== 'state') return
    follow(event.state.vault)
    if (event.state.status === 'synced' && running === null && state.problem !== null && NO_SIGNAL.includes(state.problem)) planNext()
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
    if (own === null || id === null) return Promise.resolve()
    // Nothing due (an "Approved" still in its Undo): no call to GitHub, a timer for its time.
    if (!own.waiting().some((c) => c.refused === undefined && c.notBefore <= clock.now())) {
      planNext()
      return Promise.resolve()
    }
    clearTimer()
    /** The lane was for another vault (the open vault changed): this list waits for its vault; `follow` plans. */
    let elsewhere = false
    running = (async () => {
      setState({ sending: true })
      try {
        // A comment written before the phone knew the account: sign it now (the sign-in keeps the account).
        const unsigned = own.waiting().filter((c) => c.by === undefined && c.refused === undefined && c.task === undefined)
        if (unsigned.length > 0) {
          const by = await commentSigner(store, id)
          if (by !== undefined) await own.sign(unsigned.map((c) => c.id), by)
        }
        const report = await engine.lane(async (remote, pass, laneVault) => {
          if (laneVault !== id) return null
          return sendComments({ remote, store, vault: id, box: own, pass, now: clock.now })
        })
        if (report === null) return void (elsewhere = true)
        slowedInRow = 0
        staleInRow = 0
        if (report.result === 'offline') return setState({ problem: 'OFFLINE', retryAt: null })
        const stillUnsigned = own.waiting().some((c) => c.by === undefined && c.refused === undefined && c.task === undefined)
        setState({ problem: stillUnsigned ? 'NO_LOGIN' : null, retryAt: null })
      } catch (error) {
        const problem = error instanceof GithubError ? error.code : 'FAILED'
        if (problem === 'RATE_LIMITED') {
          slowedInRow++
          setState({ problem, retryAt: slowedUntil(error as GithubError, slowedInRow, clock.now()) })
        } else if (problem === 'STALE_HEAD') {
          // The branch kept moving: wait 1, 2, 4 … minutes, as the answer list does (YAZ-5183).
          staleInRow++
          setState({ problem, retryAt: staleUntil(staleInRow, clock.now()) })
        } else setState({ problem, retryAt: null })
      } finally {
        running = null
        setState({ sending: false })
        const held = sendable().filter((c) => c.notBefore > clock.now())
        if (elsewhere) rerun = false
        else if (rerun) {
          rerun = false
          void sendNow()
        } else if (state.problem === null || state.problem === 'RATE_LIMITED' || state.problem === 'STALE_HEAD') planNext()
        // No signal (or another failure) waits for a trigger; a comment whose Undo still runs keeps its time.
        else if (held.length > 0 && !needsPerson()) plan(Math.min(...held.map((c) => c.notBefore)))
      }
    })()
    return running
  }

  const soon = () => {
    if (sendable().length === 0 || needsPerson() || slowed()) return
    void sendNow()
  }

  return {
    state: () => ({ ...state }),
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    waiting: (path) => (path === undefined ? all() : all().filter((c) => c.path === path)),
    async add(input) {
      await loading
      if (box === null || vault === null) throw new Error('No vault is open')
      const madeAt = clock.now()
      const was = await pageMark(store, vault, input.path)
      const comment: WaitingComment = {
        id: newCommentId(),
        path: input.path,
        body: input.body.trimEnd(),
        at: nowIso(madeAt),
        ...(input.by === undefined ? {} : { by: input.by }),
        madeAt,
        notBefore: madeAt + Math.max(0, input.holdMs ?? 0),
        ...(input.task === undefined ? {} : { task: input.task }),
        ...(was === undefined ? {} : { was }),
      }
      await box.add(comment)
      // A new comment from the person: a problem that waited for them is theirs to see again at the send.
      if (needsPerson()) state = { ...state, problem: null }
      setState({})
      if (!slowed()) planNext()
      return comment
    },
    async undo(id) {
      await loading
      if (box === null) return false
      const gone = await box.remove(id)
      if (gone) {
        setState({})
        planNext()
      }
      return gone
    },
    async discard(id) {
      await loading
      if (box === null) return false
      const gone = await box.discard(id)
      if (gone) setState({})
      return gone
    },
    sendNow: async () => {
      await loading
      await sendNow()
    },
    setVisible(visible) {
      if (!visible) soon()
    },
    online: soon,
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
