import type { VaultStore } from '../store'
import { vaultLock } from '../sync/browser'
import type { CardOp } from './ops'

/**
 * THE ANSWER LIST (decision 2 of YAZ-5055): the actions the person made on the phone, kept until GitHub has them. It is
 * the vault's phone-only state `ANSWERS_STATE` (3A: a format change and "Reset local copy" keep it; only removing the
 * vault or "Sign out and erase" removes it). Every change is written, and committed by IndexedDB, BEFORE its promise
 * resolves and before the list in memory changes: a closed app, a restart or no signal loses nothing (October E8).
 */
export const ANSWERS_STATE = 'answers'

/** One action that waits for the send. */
export interface WaitingAnswer {
  /** Its number in the list: it only grows, so it gives the order. */
  seq: number
  /** The actions of ONE person action share a group (an answer is `next` off and the review): Undo removes the group. */
  group: number
  op: CardOp
  /** The file that held the card when the person acted. The send finds the file again by card ID (it can move). */
  path: string
  /** The card's title when the person acted, for the lost-answer sheet (round 12 item 9). */
  title: string
  /** When the person acted (ms since 1970). */
  madeAt: number
  /**
   * A send put this action in a commit (YAZ-5180). From then on GitHub MAY hold it: the reply can be lost, or the ref
   * move can still be on its way. Such an action is never removed by Undo; Undo adds an `unreview` instead.
   */
  tried?: true
  /**
   * YAZ-5514 (W3): the commit of the last send that put this action in one, kept BEFORE its ref move. After a lost
   * answer, the next send asks GitHub whether the branch holds it: then the action is done, and nothing is written
   * again (a write again would undo what the Mac changed since). A commit the branch never took is sent again.
   */
  commit?: string
}

/** An action whose card was gone at the send (round 12 item 9): never sent again, kept until the person discards it. */
export interface LostAnswer {
  seq: number
  op: CardOp
  path: string
  title: string
  /** When the send found the card gone. */
  lostAt: number
  /** Why, when the card is not simply gone (YAZ-5514): `two-files`, two other files hold its ID, so the send cannot tell which. */
  why?: LostWhy
}

/** Why a send refused an action whose card it still finds. */
export type LostWhy = 'two-files'

/** The stored shape. Raise `v` when it changes. */
export interface AnswerBook {
  v: 1
  next: number
  waiting: WaitingAnswer[]
  lost: LostAnswer[]
}

export interface Outbox {
  /** The waiting actions, in the order the person made them. */
  waiting(): readonly WaitingAnswer[]
  lost(): readonly LostAnswer[]
  /** One person action (one or more actions): kept, then resolves with its group number. */
  add(entries: readonly { op: CardOp; path: string; title: string }[], now: number): Promise<number>
  /**
   * Undo of an unsent action: its group leaves the list. Resolves with what left. Empty: the group is not there, or a
   * send has TRIED it (GitHub may hold it): then the caller adds `unreview` (YAZ-5180).
   */
  removeGroup(group: number): Promise<WaitingAnswer[]>
  /**
   * Just before a commit: marks these actions as tried. Resolves with the ones it marked; one that Undo removed
   * meanwhile is not there, and the send must plan again (YAZ-5180).
   */
  markTried(seqs: readonly number[]): Promise<number[]>
  /** YAZ-5514: the commit these actions are in, before its ref move. Resolves with the ones it marked. */
  markCommit(seqs: readonly number[], commit: string): Promise<number[]>
  /** After a send: the actions `done` (GitHub has them) leave; the actions `lost` move to the lost list (with `why`, when given). */
  settle(done: readonly number[], lost: readonly number[], now: number, why?: ReadonlyMap<number, LostWhy>): Promise<void>
  /** The person tapped Discard on a lost action. False when it was not there. */
  discard(seq: number): Promise<boolean>
  /** Reads the stored list again (another tab of the app may have changed it, row P4). */
  refresh(): Promise<void>
}

const EMPTY: AnswerBook = { v: 1, next: 1, waiting: [], lost: [] }

/**
 * Each change of a vault's list runs alone, in every tab (YAZ-5182): the read of the stored list and its write are held
 * together by the Web Lock `notecards-answers:<vault>`. Where Web Locks are missing, one queue for each vault in this
 * page does it (two lists of one vault in one page, and the tests).
 */
const listLock = <T>(vault: string, fn: () => Promise<T>): Promise<T> => vaultLock('notecards-answers', vault, fn)

/** The answer list of vault `vault`, read from the store. */
export async function openOutbox(store: VaultStore, vault: string): Promise<Outbox> {
  const saved = await store.getState<AnswerBook>(vault, ANSWERS_STATE)
  let book: AnswerBook = saved?.v === 1 ? saved : EMPTY
  const reread = async () => {
    const stored = await store.getState<AnswerBook>(vault, ANSWERS_STATE)
    book = stored?.v === 1 ? stored : EMPTY
  }
  // One change at a time, in every tab (`listLock`). Each one starts from the STORED list, so another tab's change is
  // kept (P4). A write that fails (a full phone) leaves the stored list as it was.
  const change = <T>(edit: (book: AnswerBook) => { next: AnswerBook; out: T } | null, fallback: T): Promise<T> =>
    listLock(vault, async () => {
      await reread()
      const made = edit(book)
      if (made === null) return fallback
      await store.setState(vault, ANSWERS_STATE, made.next)
      book = made.next
      return made.out
    })
  return {
    waiting: () => book.waiting,
    lost: () => book.lost,
    add(entries, now) {
      return change((b) => {
        const group = b.next
        const waiting = entries.map((e, i): WaitingAnswer => ({ seq: b.next + i, group, op: e.op, path: e.path, title: e.title, madeAt: now }))
        return { next: { ...b, next: b.next + Math.max(1, entries.length), waiting: [...b.waiting, ...waiting] }, out: group }
      }, 0)
    },
    removeGroup(group) {
      return change((b) => {
        const gone = b.waiting.filter((w) => w.group === group)
        if (gone.length === 0 || gone.some((w) => w.tried === true)) return null
        return { next: { ...b, waiting: b.waiting.filter((w) => w.group !== group) }, out: gone }
      }, [] as WaitingAnswer[])
    },
    markTried(seqs) {
      return change((b) => {
        const want = new Set(seqs)
        const marked = b.waiting.filter((w) => want.has(w.seq)).map((w) => w.seq)
        if (marked.length === 0) return { next: b, out: marked }
        return { next: { ...b, waiting: b.waiting.map((w) => (want.has(w.seq) ? { ...w, tried: true as const } : w)) }, out: marked }
      }, [] as number[])
    },
    markCommit(seqs, commit) {
      return change((b) => {
        const want = new Set(seqs)
        const marked = b.waiting.filter((w) => want.has(w.seq)).map((w) => w.seq)
        if (marked.length === 0) return { next: b, out: marked }
        return { next: { ...b, waiting: b.waiting.map((w) => (want.has(w.seq) ? { ...w, commit } : w)) }, out: marked }
      }, [] as number[])
    },
    settle(done, lost, now, why) {
      return change((b) => {
        const leave = new Set([...done, ...lost])
        const isLost = new Set(lost)
        if (!b.waiting.some((w) => leave.has(w.seq))) return null
        const newlyLost = b.waiting.filter((w) => isLost.has(w.seq)).map((w): LostAnswer => ({ seq: w.seq, op: w.op, path: w.path, title: w.title, lostAt: now, ...(why?.has(w.seq) && { why: why.get(w.seq) }) }))
        return { next: { ...b, waiting: b.waiting.filter((w) => !leave.has(w.seq)), lost: [...b.lost, ...newlyLost] }, out: undefined }
      }, undefined)
    },
    refresh: () => listLock(vault, reread),
    discard(seq) {
      return change((b) => (b.lost.some((l) => l.seq === seq) ? { next: { ...b, lost: b.lost.filter((l) => l.seq !== seq) }, out: true } : null), false)
    },
  }
}
