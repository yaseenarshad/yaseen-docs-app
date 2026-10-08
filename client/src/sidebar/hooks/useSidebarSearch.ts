/**
 * The persistent search bar (YAZ-739 A-, YAZ-801/803): its query, the ranked results, and ⌘K's
 * focus handshake. Since YAZ-2620 the sidebar draws the results as a TREE — the Files tree cut down
 * to the matches (`searchTree`) — so this also holds that tree, its folds and the keyboard's
 * highlighted match. With two or more vaults the tree that is cut is the forest (YAZ-2602 A9): each
 * match stands under its vault's row. The shortcut picker keeps the flat list and shares `useResultKeys`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { rootOfPath, stripSlash, type TreeNode } from '@shared/types'
import { ancestorDirs } from '../../lib/treeState'
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
  pendingSearchFocus: boolean,
  onSearchFocusHandled: () => void,
  activate: (hit: SearchCandidate, background: boolean) => void,
) {
  // The persistent search bar's query (YAZ-801). It lives HERE rather than in the bar because
  // YAZ-803 swaps the BODY while it is non-empty; Sidebar is mounted on one vault of the window, so it resets
  // on unmount and on a root switch without any clearing code.
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const results = useSearchResults(vaults, query)
  // The results as a tree (YAZ-2620 🔒 D1): the Files tree — the WHOLE vault's, whichever tab or
  // focus is showing (S33) — cut down to the matches and their parents. A vault's row is a parent
  // like any folder (YAZ-2602 A9): no row of the ranking is a vault, so it is never a match, and it
  // stands open over its matches whatever its fold on the Files tab.
  const hits = useMemo(() => new Set(results.map((r) => r.path)), [results])
  const found = useMemo(() => searchTree(tree, hits), [tree, hits])
  // What that tree marks (🔒 D5): the matches, and the typed text as the matcher reads it (S40).
  const marks: TreeMarks = useMemo(() => ({ hits, needle: query.trim().toLowerCase() }), [hits, query])
  // A fold clicked during a search lasts as long as its query (S15, S16) and lives here alone (R4):
  // the Files tree's folds, and the store behind them, stay as they were (S17).
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(NO_FOLDS)
  const searchOpen = useMemo(() => new Set([...found.open, ...flipped].filter((dir) => found.open.has(dir) !== flipped.has(dir))), [found, flipped])
  const toggleSearchDir = useCallback((dir: string) => setFlipped((prev) => new Set(prev.has(dir) ? [...prev].filter((d) => d !== dir) : [...prev, dir])), [])
  // ↑/↓ walk the MATCHES in the order the tree draws them (🔒 D4); a note and its alias rows are one
  // row (S9), and a match below a folder the user closed is not on screen, so it is no stop (S21).
  const byPath = useMemo(() => new Map([...results].reverse().map((r) => [r.path, r])), [results])
  const rows = useMemo(() => {
    const roots = vaults.map((vault) => vault.root)
    /** The rows above a match: its folders in the vault that holds it and, with two or more vaults, that vault's row. */
    const above = (path: string): string[] => {
      const vault = rootOfPath(roots, path) ?? roots[0]
      return roots.length > 1 ? [stripSlash(vault), ...ancestorDirs(vault, path)] : ancestorDirs(vault, path)
    }
    return found.order.filter((path) => above(path).every((dir) => searchOpen.has(dir))).flatMap((path) => byPath.get(path) ?? [])
  }, [vaults, found, searchOpen, byPath])
  // The highlight is held by its PATH (`null`: nobody moved it yet), so a fold that moves rows in or
  // out above it leaves it on its match. Unmoved, it is on the BEST match — the ranking's first —
  // wherever the tree draws it (S19); once its match has left the screen, it is on the next match
  // the tree still draws, else the last (S21).
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
  const onKeys = resultKeys(rows, sel, (at) => setPicked(rows[at].path), (hit, e) => activate(hit, e.metaKey))
  // While a query is typed the body shows the search tree instead of the active tab's (YAZ-2620).
  // A conditional render, not a teardown — every bit of that tab's tree state (data, expansion,
  // pending create/rename, drag) lives in the Sidebar's other hooks (useVaultTree, rowGestures)
  // and is waiting untouched when it clears.
  const searching = query.trim() !== ''

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

  // ⌘K's focus handshake (YAZ-801). Firing on MOUNT is deliberate, not a side effect to guard
  // against: ⌘K with the sidebar collapsed un-collapses it, so the sidebar mounts with the flag
  // already true (0- re-scope on YAZ-800). A plain remount with the flag false focuses nothing.
  useEffect(() => {
    if (!pendingSearchFocus) return
    searchInput.current?.focus()
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
      // Esc empties a typed query first and only gives up focus on the second press.
      if (query !== '') setQuery('')
      else e.currentTarget.blur()
    } else onKeys(e)
  }

  return { query, setQuery, searchInput, results, searching, found, searchOpen, toggleSearchDir, searchCursor, marks, changeQuery, searchKeyDown }
}
