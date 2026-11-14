import type { VaultStore } from '../store'
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
}

/** An action whose card was gone at the send (round 12 item 9): never sent again, kept until the person discards it. */
export interface LostAnswer {
  seq: number
  op: CardOp
  path: string
  title: string
  /** When the send found the card gone. */
  lostAt: number
}

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
  /** Undo of an unsent action: its group leaves the list. Resolves with what left (empty: nothing waited). */
  removeGroup(group: number): Promise<WaitingAnswer[]>
  /** After a send: the actions `done` (GitHub has them) leave; the actions `lost` move to the lost list. */
  settle(done: readonly number[], lost: readonly number[], now: number): Promise<void>
  /** The person tapped Discard on a lost action. False when it was not there. */
  discard(seq: number): Promise<boolean>
  /** Reads the stored list again (another tab of the app may have changed it, row P4). */
  refresh(): Promise<void>
}

const EMPTY: AnswerBook = { v: 1, next: 1, waiting: [], lost: [] }

/** The answer list of vault `vault`, read from the store. */
export async function openOutbox(store: VaultStore, vault: string): Promise<Outbox> {
  const saved = await store.getState<AnswerBook>(vault, ANSWERS_STATE)
  let book: AnswerBook = saved?.v === 1 ? saved : EMPTY
  const reread = async () => {
    const stored = await store.getState<AnswerBook>(vault, ANSWERS_STATE)
    book = stored?.v === 1 ? stored : EMPTY
  }
  // One write at a time, in order. Each one starts from the STORED list, so a second tab's change is kept (P4). A write
  // that fails (a full phone) leaves the list in memory as it was.
  let chain: Promise<unknown> = Promise.resolve()
  const change = <T>(edit: (book: AnswerBook) => { next: AnswerBook; out: T } | null, fallback: T): Promise<T> => {
    const run = chain.then(async () => {
      await reread()
      const made = edit(book)
      if (made === null) return fallback
      await store.setState(vault, ANSWERS_STATE, made.next)
      book = made.next
      return made.out
    })
    chain = run.catch(() => undefined)
    return run
  }
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
        return gone.length === 0 ? null : { next: { ...b, waiting: b.waiting.filter((w) => w.group !== group) }, out: gone }
      }, [] as WaitingAnswer[])
    },
    settle(done, lost, now) {
      return change((b) => {
        const leave = new Set([...done, ...lost])
        const isLost = new Set(lost)
        if (!b.waiting.some((w) => leave.has(w.seq))) return null
        const newlyLost = b.waiting.filter((w) => isLost.has(w.seq)).map((w): LostAnswer => ({ seq: w.seq, op: w.op, path: w.path, title: w.title, lostAt: now }))
        return { next: { ...b, waiting: b.waiting.filter((w) => !leave.has(w.seq)), lost: [...b.lost, ...newlyLost] }, out: undefined }
      }, undefined)
    },
    refresh() {
      const run = chain.then(reread)
      chain = run.catch(() => undefined)
      return run
    },
    discard(seq) {
      return change((b) => (b.lost.some((l) => l.seq === seq) ? { next: { ...b, lost: b.lost.filter((l) => l.seq !== seq) }, out: true } : null), false)
    },
  }
}
