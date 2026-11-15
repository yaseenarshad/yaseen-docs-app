import type { VaultStore } from '../store'
import type { TaskTick } from './taskWrite'

/**
 * YAZ-5461: THE COMMENT LIST, the comments written on the phone that GitHub does not hold yet. It is the vault's
 * phone-only state `COMMENTS_STATE`, kept in IndexedDB as the answer list is (`answers/outbox.ts`): every change is
 * written BEFORE its promise resolves, so a closed app, a restart or no signal loses no comment. A comment gets its id
 * (`newCommentId`) when it goes in, before any try: a retry that finds that id on the page adds nothing, so a comment
 * is never posted twice.
 *
 * Small and free of the writer: the engine's chunk reads it at the start to learn whether a send must load
 * (`waitingComments`); the writer and the send are a chunk of their own.
 */
export const COMMENTS_STATE = 'comments'

export interface WaitingComment {
  /** The comment's id on the page (8 hex, the Mac's form). Given once, here. */
  id: string
  /** The page. The send writes ONLY this page's `comments` list. */
  path: string
  body: string
  /** ISO UTC, seconds: when the person wrote it (the comment's `at`). */
  at: string
  /** The writer's handle (`by`), from the vault's GitHub login (`signer.ts`). */
  by?: string
  madeAt: number
  /** Not sent before this time (ms): the one-tap "Approved" waits out its Undo (4 s). */
  notBefore: number
  /** A send has put it in a commit: GitHub may hold it, so Undo can no longer take it back. */
  tried?: true
  /**
   * YAZ-5513: the commit that try made, and its parent (GitHub made it; the branch may or may not have moved to it). A
   * retry after a lost answer asks whether the branch holds it: a tick whose commit is there was done, and is not
   * written again.
   */
  commit?: { sha: string; parent: string }
  /** The fresh page refused it (`REFUSED_WORDS`): it is not sent again; the page shows it with Discard. */
  refused?: 'foreign' | 'invalid' | 'layout' | 'gone' | 'too-large' | 'changed'
  /**
   * YAZ-5494: not a comment but a TICK of a task check box on the page (`taskWrite.ts`): what the box becomes, and how
   * to find the same task again. It goes the comment's way (this list, the send, the dot); its `body` is empty and it
   * needs no `by`.
   */
  task?: TaskTick
  /**
   * YAZ-5517: how to find the page again when the Mac moves it before the send: its file's blob SHA when no other file
   * of the vault had the same bytes, and its page `id`. Taken when the comment goes in (from the stored copy).
   */
  was?: { sha?: string; id?: string }
}

export interface CommentBook {
  v: 1
  waiting: WaitingComment[]
}

export interface CommentBox {
  waiting(): readonly WaitingComment[]
  add(comment: WaitingComment): Promise<void>
  /** Undo: out of the list, unless a send has tried it. True when it left. */
  remove(id: string): Promise<boolean>
  /** Discard of a refused comment. */
  discard(id: string): Promise<boolean>
  /** Just before a commit: resolves with the ids it marked (one that Undo took meanwhile is not there). */
  markTried(ids: readonly string[]): Promise<string[]>
  /** The commit a try made for `ids`, before the branch moves to it (`commit` above). */
  noteCommit(ids: readonly string[], commit: { sha: string; parent: string }): Promise<void>
  /** After a send: `done` leave (GitHub holds them); `refused` stay, marked, never sent again. */
  settle(done: readonly string[], refused: readonly { id: string; why: NonNullable<WaitingComment['refused']> }[]): Promise<void>
  /** YAZ-5517: the page moved (found again for sure): the comments go with it, to their new `path`. */
  follow(moves: readonly { id: string; path: string }[]): Promise<void>
  /** Signs the comments that had no `by` yet (the account was not known when they were written). */
  sign(ids: readonly string[], by: string): Promise<void>
  refresh(): Promise<void>
}

const EMPTY: CommentBook = { v: 1, waiting: [] }
const bookOf = (saved: CommentBook | undefined): CommentBook => (saved?.v === 1 && Array.isArray(saved.waiting) ? saved : EMPTY)

/** How many comments wait to be sent (refused ones do not). The engine's chunk asks it at the start, with no writer. */
export async function waitingComments(store: VaultStore, vault: string): Promise<number> {
  return bookOf(await store.getState<CommentBook>(vault, COMMENTS_STATE)).waiting.filter((c) => c.refused === undefined).length
}

/** YAZ-5517: how many comments the stored list keeps, refused ones too: they load the sender, so the dot counts them. */
export async function keptComments(store: VaultStore, vault: string): Promise<number> {
  return bookOf(await store.getState<CommentBook>(vault, COMMENTS_STATE)).waiting.length
}

/** One change at a time, in every tab (Web Locks), as the answer list does; one queue per vault where they are missing. */
const pageQueues = new Map<string, Promise<unknown>>()
function bookLock<T>(vault: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: { request(name: string, fn: () => Promise<T>): Promise<T> } } }).navigator?.locks
  if (locks !== undefined) return locks.request(`notecards-comments:${vault}`, fn)
  const run = (pageQueues.get(vault) ?? Promise.resolve()).then(fn, fn)
  const settled = run.catch(() => undefined)
  pageQueues.set(vault, settled)
  void settled.then(() => {
    if (pageQueues.get(vault) === settled) pageQueues.delete(vault)
  })
  return run
}

export async function openCommentBox(store: VaultStore, vault: string): Promise<CommentBox> {
  let book = bookOf(await store.getState<CommentBook>(vault, COMMENTS_STATE))
  const reread = async () => {
    book = bookOf(await store.getState<CommentBook>(vault, COMMENTS_STATE))
  }
  // Each change starts from the STORED list (another tab's change is kept); a failed write leaves it as it was.
  const change = <T>(edit: (b: CommentBook) => { next: CommentBook; out: T } | null, fallback: T): Promise<T> =>
    bookLock(vault, async () => {
      await reread()
      const made = edit(book)
      if (made === null) return fallback
      await store.setState(vault, COMMENTS_STATE, made.next)
      book = made.next
      return made.out
    })
  return {
    waiting: () => book.waiting,
    add: (comment) => change((b) => (b.waiting.some((c) => c.id === comment.id) ? null : { next: { ...b, waiting: [...b.waiting, comment] }, out: undefined }), undefined),
    remove: (id) =>
      change((b) => {
        const c = b.waiting.find((w) => w.id === id)
        if (c === undefined || c.tried === true) return null
        return { next: { ...b, waiting: b.waiting.filter((w) => w.id !== id) }, out: true }
      }, false),
    discard: (id) => change((b) => (b.waiting.some((w) => w.id === id && w.refused !== undefined) ? { next: { ...b, waiting: b.waiting.filter((w) => w.id !== id) }, out: true } : null), false),
    markTried: (ids) =>
      change((b) => {
        const want = new Set(ids)
        const marked = b.waiting.filter((w) => want.has(w.id)).map((w) => w.id)
        return { next: { ...b, waiting: b.waiting.map((w) => (want.has(w.id) ? { ...w, tried: true as const } : w)) }, out: marked }
      }, [] as string[]),
    noteCommit: (ids, commit) =>
      change((b) => {
        const want = new Set(ids)
        if (!b.waiting.some((w) => want.has(w.id))) return null
        return { next: { ...b, waiting: b.waiting.map((w) => (want.has(w.id) ? { ...w, commit } : w)) }, out: undefined }
      }, undefined),
    settle: (done, refused) =>
      change((b) => {
        const leave = new Set(done)
        const why = new Map(refused.map((r) => [r.id, r.why]))
        if (!b.waiting.some((w) => leave.has(w.id) || why.has(w.id))) return null
        const waiting = b.waiting.filter((w) => !leave.has(w.id)).map((w) => (why.has(w.id) ? { ...w, refused: why.get(w.id)! } : w))
        return { next: { ...b, waiting }, out: undefined }
      }, undefined),
    follow: (moves) =>
      change((b) => {
        const to = new Map(moves.map((m) => [m.id, m.path]))
        if (!b.waiting.some((w) => to.has(w.id) && to.get(w.id) !== w.path)) return null
        return { next: { ...b, waiting: b.waiting.map((w) => (to.has(w.id) ? { ...w, path: to.get(w.id)! } : w)) }, out: undefined }
      }, undefined),
    sign: (ids, by) =>
      change((b) => {
        const want = new Set(ids)
        if (!b.waiting.some((w) => want.has(w.id) && w.by === undefined)) return null
        return { next: { ...b, waiting: b.waiting.map((w) => (want.has(w.id) && w.by === undefined ? { ...w, by } : w)) }, out: undefined }
      }, undefined),
    refresh: () => bookLock(vault, reread),
  }
}
