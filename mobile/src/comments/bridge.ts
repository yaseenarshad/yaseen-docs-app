import type { Answers, AnswersEvent, AnswersOptions, AnswersState } from '../answers/answers'
import type { CommentSender, CommentsState, NewCommentInput } from './sender'
import type { WaitingComment } from './outbox'
import { waitingComments } from './outbox'

/**
 * What a page needs from the comment list (YAZ-5461): the comments of the open vault that GitHub does not hold yet,
 * a new one, its Undo, the Discard of a refused one. Each call loads the sender first (its own chunk).
 */
export interface CommentsPort {
  /** Resolves when the sender is loaded (the first call loads it). */
  ready(): Promise<void>
  waiting(path?: string): readonly WaitingComment[]
  add(input: NewCommentInput): Promise<WaitingComment>
  undo(id: string): Promise<boolean>
  discard(id: string): Promise<boolean>
  /** The list changed (a comment went in, out, or was refused), or a send began or ended. */
  subscribe(listener: () => void): () => void
}

type SenderModule = typeof import('./sender')
const loadSender = (): Promise<SenderModule> => import('./sender')

/**
 * YAZ-5461: the answer list WITH the comment list. ONE object for the dot, the Review tab and the page, as the shell
 * makes one answer list (`app/lazySync.ts`, which this file does not change: it is in the first load). The comments add
 * to the answer list's state (`comments`: the dot counts them as waiting; `sending`; a `problem` of the person's, such
 * as "Sign in again"), and every trigger of the answer list ("Try now", hidden, online) sends both.
 *
 * The comment writer and its send are a chunk of their own: they load the first time a comment is written, or at the
 * start when the stored list has comments waiting (`waitingComments` reads only the stored list). A vault with no
 * waiting comment loads nothing more.
 */
export function withComments(answers: Answers, options: AnswersOptions, load: () => Promise<SenderModule> = loadSender): Answers {
  const { store, engine } = options
  let sender: CommentSender | null = null
  let loading: Promise<CommentSender> | null = null
  let comments: CommentsState | null = null
  const listeners = new Set<(event: AnswersEvent) => void>()
  const portListeners = new Set<() => void>()

  const merged = (inner: AnswersState): AnswersState => {
    if (comments === null || comments.vault !== inner.vault) return { ...inner, comments: 0, ticks: 0 }
    const personal = inner.problem ?? (comments.problem !== null && ['UNAUTHORIZED', 'READ_ONLY', 'NOT_FOUND', 'NO_ACCESS'].includes(comments.problem) ? (comments.problem as AnswersState['problem']) : null)
    return { ...inner, comments: comments.waiting, ticks: comments.ticks, sending: inner.sending || comments.sending, problem: personal }
  }
  const emit = (event: AnswersEvent) => {
    for (const l of [...listeners]) l(event)
  }
  answers.subscribe((event) => emit(event.type === 'state' ? { type: 'state', state: merged(event.state) } : event))

  const ensure = (): Promise<CommentSender> =>
    (loading ??= load().then((m) => {
      const s = m.createCommentSender({ store, engine, clock: options.clock })
      s.subscribe((state) => {
        comments = state
        emit({ type: 'state', state: merged(answers.state()) })
        for (const l of [...portListeners]) l()
      })
      sender = s
      comments = s.state()
      return s
    }))

  // At the start, and at each vault: comments that wait load the sender, which sends them (October E8 for comments).
  let asked: string | null = null
  const ask = (vault: string | null) => {
    if (vault === null || vault === asked || loading !== null) return
    asked = vault
    void waitingComments(store, vault).then((n) => {
      if (n > 0) void ensure()
    }, () => {})
  }
  engine.subscribe((event) => {
    if (event.type === 'state') ask(event.state.vault)
  })
  ask(engine.state().vault)

  const port: CommentsPort = {
    ready: async () => void (await ensure()),
    waiting: (path) => sender?.waiting(path) ?? [],
    add: async (input) => (await ensure()).add(input),
    undo: async (id) => (await ensure()).undo(id),
    discard: async (id) => (await ensure()).discard(id),
    subscribe(listener) {
      portListeners.add(listener)
      return () => void portListeners.delete(listener)
    },
  }

  return {
    ...answers,
    state: () => merged(answers.state()),
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    async sendNow() {
      await Promise.all([answers.sendNow(), sender?.sendNow()])
    },
    setVisible(visible) {
      answers.setVisible(visible)
      sender?.setVisible(visible)
    },
    online() {
      answers.online()
      sender?.online()
    },
    async idle() {
      await answers.idle()
      if (loading !== null) await (await loading).idle()
    },
    stop() {
      answers.stop()
      sender?.stop()
    },
    comments: port,
  }
}
