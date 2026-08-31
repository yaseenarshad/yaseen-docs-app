/**
 * The sidebar's multi-select, pure (YAZ-1336, 🔒 D1) — `treeState.ts`'s sibling: the Sidebar owns
 * the state, this owns the rules. A selection is a set of file PATHS, so ONE path is ONE entry
 * however many rows draw it (🔒 D3: the Topics lens stands one page under every parent that
 * claims it, and all of those rows are the same selected thing).
 */

/** The one empty selection: an untouched sidebar and a cleared one are then the SAME value. */
export const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>()

export type SelectionAction =
  /** 🔒 D2 as Yasin amended it: shift+click ADDS or REMOVES the one row. There is no range. */
  | { type: 'toggle'; path: string }
  | { type: 'clear' }
  /** Drop what the vault no longer has; `exists` is asked once per selected path. */
  | { type: 'prune'; exists: (path: string) => boolean }

/**
 * Every no-op returns the SAME set, deliberately: this feeds a `useReducer`, so an unchanged
 * selection has to be reference-identical or React re-renders the whole tree for nothing — and
 * the clear-on-lens-change / prune-on-refresh effects fire far more often than they change
 * anything. No input set is ever mutated.
 */
export function selectionReducer(sel: ReadonlySet<string>, action: SelectionAction): ReadonlySet<string> {
  switch (action.type) {
    case 'toggle': {
      const next = new Set(sel)
      if (!next.delete(action.path)) next.add(action.path)
      return next
    }
    case 'clear':
      return sel.size === 0 ? sel : EMPTY_SELECTION
    case 'prune': {
      const kept = [...sel].filter(action.exists)
      return kept.length === sel.size ? sel : new Set(kept)
    }
  }
}
