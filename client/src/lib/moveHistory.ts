/**
 * The undo list for moves (YAZ-3255 D10): per window, in App, for the session only. Each entry is
 * one move GESTURE — a drag of one row or of many, a Paste of a Cut, a move in from Finder — never
 * a copy, a rename, a title edit or a delete.
 *
 * Two lists. `push` puts a new gesture on the undo list and empties the redo list (S38); past
 * `limit` the oldest goes (S41). `undo` and `redo` TAKE the newest entry off their list; the caller
 * runs it, then hands back what actually ran: `undone` puts that on the redo list, `redone` puts it
 * back on the undo list and leaves the redo list as it is. So an undo where one item moved again
 * (S36) redoes only what moved back, and a redo keeps the values it cleared this time.
 */
import type { ClearedValues, Move } from '../links/shortcuts'

/** The undo list's length (D10): the last 20 gestures. */
export const MOVE_HISTORY_LIMIT = 20

/**
 * What one move gesture did (YAZ-3250 D1): the moves main made, in order, and the folder values D20
 * cleared on the way. One drag of one row or of many is one gesture; the undo list records one of these for each.
 */
export interface MovedGesture {
  moves: Move[]
  cleared: ClearedValues[]
}

export interface MoveHistory<T> {
  /** A new gesture: on the undo list, and the redo list empties. */
  push(entry: T): void
  /** The newest gesture to undo, taken off the list; undefined when there is none (S35). */
  undo(): T | undefined
  /** The newest gesture to redo, taken off the list; undefined when there is none. */
  redo(): T | undefined
  /** What an undo moved back: it goes on the redo list. */
  undone(entry: T): void
  /** What a redo moved again: it goes back on the undo list; the rest of the redo list stays. */
  redone(entry: T): void
}

export function createMoveHistory<T = MovedGesture>(limit: number = MOVE_HISTORY_LIMIT): MoveHistory<T> {
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
