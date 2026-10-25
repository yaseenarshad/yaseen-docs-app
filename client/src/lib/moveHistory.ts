/**
 * The window's undo list (YAZ-3255 D10; YAZ-3268 D17): per window, in App, for the session only.
 * Each entry is one STEP: a move gesture (a drag of one row or of many, a Paste of a Cut, a move in
 * from Finder), a rename through App's door (a path or a title), or a delete (one item or many, the
 * "Remove from vault" of a drag out too). Never a copy, nor Finder's own deletes and renames.
 *
 * Two lists. `push` puts a new step on the undo list and empties the redo list (S38); past `limit`
 * the oldest goes (S41). `undo` and `redo` TAKE the newest entry off their list; the caller runs it,
 * then hands back what actually ran: `undone` puts that on the redo list, `redone` puts it back on
 * the undo list and leaves the redo list as it is. So an undo where one item moved again (S36)
 * redoes only what moved back, and a redo keeps the values it cleared this time. Mixed steps go back
 * newest first, one per ⌘Z (S65).
 */
import type { ClearedValues, Move } from '../links/shortcuts'

/** The undo list's length (D10, D17): the last 20 steps. */
export const MOVE_HISTORY_LIMIT = 20

/**
 * What one move gesture did (YAZ-3250 D1): the moves main made, in order, and the folder values D20
 * cleared on the way. One drag of one row or of many is one gesture; the undo list records one of these for each.
 */
export interface MovedGesture {
  moves: Move[]
  cleared: ClearedValues[]
}

/**
 * The door's input of one side of a rename (YAZ-3268 D17): a new path, or a title in a vault that
 * uses IDs. `RenameTo` of the rename sheet has the same shape.
 */
export type RenameSide = { newPath: string; title?: never } | { title: string; newPath?: never }

/** A rename through App's door (D17): where the item is now, and the door's input back (`from`) and forward (`to`). */
export interface RenameStep {
  step: 'rename'
  path: string
  from: RenameSide
  to: RenameSide
  type: 'file' | 'dir'
}

/** A delete (D17): each item that went, with its place in the Trash (`DeleteResponse.trashed`). One Delete or one "Remove from vault" is one step. */
export interface DeleteStep {
  step: 'delete'
  /** `name` and `type`: the item's name on disk and its kind at the delete (YAZ-3274 D22, YAZ-3293 D23), for the toasts of its undo and redo. */
  items: { path: string; trashed: string; type: 'file' | 'dir'; name: string }[]
}

/** One entry of the undo list (D17): a move gesture (as YAZ-3255 built it), a rename or a delete. */
export type UndoStep = MovedGesture | RenameStep | DeleteStep

/** A move gesture: the entry has `moves` (a rename and a delete name their `step`). */
export const isMoveStep = (entry: UndoStep): entry is MovedGesture => !('step' in entry)

export interface MoveHistory<T = UndoStep> {
  /** A new step: on the undo list, and the redo list empties. */
  push(entry: T): void
  /** The newest step to undo, taken off the list; undefined when there is none (S35). */
  undo(): T | undefined
  /** The newest step to redo, taken off the list; undefined when there is none. */
  redo(): T | undefined
  /** What an undo took back: it goes on the redo list. */
  undone(entry: T): void
  /** What a redo did again: it goes back on the undo list; the rest of the redo list stays. */
  redone(entry: T): void
}

export function createMoveHistory<T = UndoStep>(limit: number = MOVE_HISTORY_LIMIT): MoveHistory<T> {
  const undos: T[] = []
  const redos: T[] = []
  const keep = (list: T[], entry: T): void => {
    list.push(entry)
    if (list.length > limit) list.splice(0, list.length - limit)
  }
  return {
    push(entry) {
      redos.length = 0
      keep(undos, entry)
    },
    undo: () => undos.pop(),
    redo: () => redos.pop(),
    undone: (entry) => keep(redos, entry),
    redone: (entry) => keep(undos, entry),
  }
}

/** The moves that take `moves` back, newest first (D10): each from where it went to where it was. */
export const invertMoves = (moves: readonly Move[]): Move[] => moves.map(({ oldPath, newPath, kind }) => ({ oldPath: newPath, newPath: oldPath, kind })).reverse()
