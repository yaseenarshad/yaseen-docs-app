/**
 * The Search tab's bar (YAZ-739 A-, YAZ-801/803; a tab of its own since YAZ-2638 D2): its query, the
 * ranked results, and ⌘K's focus handshake. The query lives while the panel is mounted, so it stays
 * while a different tab shows. Since YAZ-2620 the sidebar draws the results as a TREE — the Files tree cut down
 * to the matches (`searchTree`) — so this also holds that tree, its folds and the keyboard's
 * highlighted match. With two or more vaults the tree that is cut is the forest (YAZ-2602 A9): each
 * match stands under its vault's row. Since YAZ-2662 the matches of the pinned items — the focus
 * list and the favorites — are a group of their own, drawn first (D2). The shortcut picker keeps
 * the flat list and shares `useResultKeys`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import type { TreeNode } from '@shared/types'
import { withoutPaths } from '../../lib/treeState'
import type { SearchCandidate } from '../../search/searchCandidates'
import { searchTree } from '../../search/searchTree'
import { useSearchResults, type SearchVault } from '../../search/useSearchResults'
import type { TreeMarks, TreeSelection } from '../Tree'

/**
 * The keys of a result list driven from its input (YAZ-803), shared by the search bar and the
 * shortcut picker: ↑/↓ move the highlight and stop at both ends, never wrapping — the `[[`
 * picker's rule — and Enter activates the highlighted row.
 */
export function resultKeys<T>(results: readonly T[], sel: number, move: (at: number) => void, activate: (hit: T, e: KeyboardEvent) => void) {
  return (e: KeyboardEvent<HTMLInputElement>): void => {
    if (results.length === 0) return
    if (e.key === 'ArrowDown') move(Math.min(sel + 1, results.length - 1))
    else if (e.key === 'ArrowUp') move(Math.max(sel - 1, 0))
    else if (e.key === 'Enter') activate(results[sel], e)
    else return
    e.preventDefault()
  }
}

/**
 * A flat result list's highlight, held by its POSITION, and its keys (the shortcut picker's). Every
 * reader clamps, since an index refresh can shrink the list under the keyboard's index (YAZ-808).
 */
export function useResultKeys<T>(results: readonly T[], activate: (hit: T, e: KeyboardEvent) => void) {
  const [selected, setSelected] = useState(0)
  const sel = Math.max(0, Math.min(selected, results.length - 1))
  return { sel, setSelected, onKeys: resultKeys(results, sel, setSelected, activate) }
}

/** No fold and no highlight: one object each, so a search that has neither hands the memoised tree nothing new (YAZ-2194). */
const NO_FOLDS: ReadonlySet<string> = new Set()
const NO_CURSOR: ReadonlySet<string> = new Set()
/** A search has no multi-select (S29, YAZ-2620): shift-click on its tree toggles nothing. */
const noToggle = (): void => undefined

export function useSidebarSearch(
  /** Every vault of the window (YAZ-2602 R2), in vault order; the list is the caller's to keep while nothing in it changed. */
  vaults: readonly SearchVault[],
  /** What the Files tab draws: one vault's tree, or the forest — one row per vault (YAZ-2602 D3). */
  tree: readonly TreeNode[],
  /** The pinned items (YAZ-2662 D3), as nodes of that tree: the top rows of the top group, in its order (`pinnedRoots`). */
  pinned: readonly TreeNode[],
  /** The Search tab shows (YAZ-2638 D2): the query is ranked only then. */
  active: boolean,
  /** Esc: back to the lens the window last showed, the caret into the open page (YAZ-2662 D9). The query stays. */
  onLeave: () => void,
  pendingSearchFocus: boolean,
  onSearchFocusHandled: () => void,
  /** Enter on the highlight; `background` is ⌘, and `reveal` is Shift (YAZ-2662 D8). */
  activate: (hit: SearchCandidate, background: boolean, reveal: boolean) => void,
) {
  // The search bar's query (YAZ-801). It lives HERE rather than in the bar because the bar is
  // drawn on the Search tab only (YAZ-2638 D2) and the query stays while a different tab shows;
  // Sidebar is mounted on one vault of the window, so it resets on unmount and on a root switch
  // without any clearing code.
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const pinnedPaths = useMemo(() => new Set(pinned.map((node) => node.path)), [pinned])
  // A search that is not on screen ranks nothing (YAZ-2638 D2): with no results it has no highlight,
  // so it scrolls no row of the tab that shows. The ranking is synchronous, so the results are back
  // in the render that shows the Search tab again. A match of a pinned item ranks first (YAZ-2662 D4).
  const results = useSearchResults(vaults, active ? query : '', pinnedPaths)
  // The results as a tree (YAZ-2620 🔒 D1): the Files tree — the WHOLE vault's, whichever tab or
  // focus is showing (S33) — cut down to the matches and their parents. A vault's row is a parent
  // like any folder (YAZ-2602 A9): no row of the ranking is a vault, so it is never a match, and it
  // stands open over its matches whatever its fold on the Files tab.
  const hits = useMemo(() => new Set(results.map((r) => r.path)), [results])
  // The two groups (YAZ-2662 D2): `top` is the pinned items cut to their matches — a pinned item is
  // a top row, so no folder above it is drawn (S14) — and `rest` is every other match, cut from the
  // tree without the pinned items that `top` draws (S19). A pinned item that `top` does not draw
  // stays in its folder, and no pinned match is the one tree of before (S21). A row is in one group
  // only, so the two share one set of open folders and one order.
  const found = useMemo(() => {
    const top = searchTree(pinned, hits)
    const rest = searchTree(withoutPaths(tree, new Set(top.nodes.map((node) => node.path))), hits)
    return { top: top.nodes, rest: rest.nodes, open: new Set([...top.open, ...rest.open]), order: [...top.order, ...rest.order] }
  }, [tree, pinned, hits])
  // What that tree marks (🔒 D5): the matches, and the typed text as the matcher reads it (S40).
  const marks: TreeMarks = useMemo(() => ({ hits, needle: query.trim().toLowerCase() }), [hits, query])
  // A fold clicked during a search lasts as long as its query (S15, S16) and lives here alone (R4):
  // the Files tree's folds, and the store behind them, stay as they were (S17).
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(NO_FOLDS)
  const searchOpen = useMemo(() => new Set([...found.open, ...flipped].filter((dir) => found.open.has(dir) !== flipped.has(dir))), [found, flipped])
  const toggleSearchDir = useCallback((dir: string) => setFlipped((prev) => new Set(prev.has(dir) ? [...prev].filter((d) => d !== dir) : [...prev, dir])), [])
  // ↑/↓ walk the MATCHES in the order the tree draws them (🔒 D4) — the top group, then the rest
  // (YAZ-2662 S22); a note and its alias rows are one row (S9), and a match below a folder the user
  // closed is not on screen, so it is no stop (S21). Read off the two trees as drawn: the rows above
  // a match of the top group start at its pinned item, not at its vault.
  const byPath = useMemo(() => new Map([...results].reverse().map((r) => [r.path, r])), [results])
  const rows = useMemo(() => {
    const shown: SearchCandidate[] = []
    const walk = (nodes: readonly TreeNode[]): void => {
      for (const node of nodes) {
        const hit = byPath.get(node.path)
        if (hit !== undefined) shown.push(hit)
        if (node.type === 'dir' && searchOpen.has(node.path)) walk(node.children)
      }
    }
    walk(found.top)
    walk(found.rest)
    return shown
  }, [found, searchOpen, byPath])
  // The highlight is held by its PATH (`null`: nobody moved it yet), so a fold that moves rows in or
  // out above it leaves it on its match. Unmoved, it is on the BEST match — the ranking's first, a
  // pinned match when there is one (YAZ-2662 S23) — wherever the tree draws it (S19); once its match
  // has left the screen, it is on the next match the tree still draws, else the last (S21).
  const [picked, setPicked] = useState<string | null>(null)
  const sel = useMemo(() => {
    const at = (path: string | undefined) => rows.findIndex((r) => r.path === path)
    if (picked === null) return Math.max(0, at(results[0]?.path))
    const held = at(picked)
    if (held !== -1) return held
    const after = new Set(found.order.slice(found.order.indexOf(picked) + 1))
    const next = rows.findIndex((r) => after.has(r.path))
    return next !== -1 ? next : Math.max(0, rows.length - 1)
  }, [rows, picked, results, found])
  // The bar keeps focus while the tree is driven from it (YAZ-803). Opening leaves the results up.
  const onKeys = resultKeys(rows, sel, (at) => setPicked(rows[at].path), (hit, e) => activate(hit, e.metaKey, e.shiftKey))
  // With text typed the Search tab's body is the search tree (YAZ-2620); with none it is one line
  // of help (YAZ-2638 D2). A conditional render, not a teardown — every bit of the other tabs' tree
  // state (data, expansion, pending create/rename, drag) lives in the Sidebar's other hooks
  // (useVaultTree, rowGestures) and is waiting untouched when one of them shows again.
  const typed = query.trim() !== ''

  // The highlight as the tree takes a selection (S39): the one match the keys are on. A click moves
  // it to the clicked row when that row is a match (S26, S27) and leaves it be otherwise (S28).
  // Stable while nothing moved, as the per-level memo of `Tree` asks (YAZ-2194).
  const cursor = rows[sel]?.path
  const cursorPaths = useMemo(() => (cursor === undefined ? NO_CURSOR : new Set([cursor])), [cursor])
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const moveCursor = useCallback((path: string) => {
    if (rowsRef.current.some((r) => r.path === path)) setPicked(path)
  }, [])
  const searchCursor: TreeSelection = useMemo(() => ({ paths: cursorPaths, toggle: noToggle, set: moveCursor }), [cursorPaths, moveCursor])

  // The focus handshake (YAZ-801), the ONE path of the caret to the bar: ⌘K or a click on the
  // Search tab raises the flag, and the caret lands in the bar, the text that is there selected
  // (YAZ-2638 D2). Firing on MOUNT is deliberate, not a side effect to guard against: ⌘K with the
  // sidebar collapsed un-collapses it, so the sidebar mounts with the flag already true (0- re-scope
  // on YAZ-800). A mount on the Search tab with the flag false moves no caret.
  useEffect(() => {
    if (!pendingSearchFocus) return
    searchInput.current?.focus()
    searchInput.current?.select()
    onSearchFocusHandled()
  }, [pendingSearchFocus, onSearchFocusHandled])

  const changeQuery = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
    setPicked(null) // a new query is a new ranking: the best match is the highlight again
    setFlipped(NO_FOLDS) // and a new tree: its folds are the search's own again (S16)
  }

  const searchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onLeave()
    } else onKeys(e)
  }

  return { query, searchInput, results, typed, found, searchOpen, toggleSearchDir, searchCursor, marks, changeQuery, searchKeyDown }
}
