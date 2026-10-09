/**
 * The Search tab's bar (YAZ-739 A-, YAZ-801/803; a tab of its own since YAZ-2638 D2): its query, the
 * ranked results, and ⌘K's focus handshake. The query lives while the panel is mounted, so it stays
 * while a different tab shows. Since YAZ-2620 the sidebar draws the results as a TREE — the Files tree cut down
 * to the matches (`searchTree`) — so this also holds that tree, its folds and the keyboard's
 * highlighted match. With two or more vaults the tree that is cut is the forest (YAZ-2602 A9): each
 * match stands under its vault's row. Since YAZ-2662 the matches of the pinned items — the focus
 * list and the favorites — are a group of their own, drawn first (D2), Space, → and ← act on
 * the highlighted folder (D6, D7), and Space on the highlighted file shows App's preview panel,
 * which then follows the highlight (D5). The shortcut picker keeps the flat list and shares `useResultKeys`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import type { TreeNode } from '@shared/types'
import { withoutPaths } from '../../lib/treeState'
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

/** The preview panel follows the highlight this long after its LAST move (YAZ-2662 S32): a walk with ↑ or ↓ reads no file on its way. */
export const PREVIEW_FOLLOW_MS = 120

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
  /** Enter on the highlight, a match or not (YAZ-2662 S52); `background` is ⌘, and `reveal` is Shift (D8). */
  activate: (row: TreeNode, background: boolean, reveal: boolean) => void,
  /** The file that App's preview panel draws (YAZ-2662 D5), or `null` with no panel on show. App's ✕ clears it too. */
  previewPath: string | null,
  /** The one door of the preview panel: the file to draw, or `null` for no panel. */
  onPreview: (path: string | null) => void,
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
  // only, so the two share one set of open folders and one order. A folder of `full` shows ALL that
  // it holds (D6): Space or → put it there, and it lasts as long as its query, as a fold does. In
  // `rest` that is all but the pinned items that `top` draws, so no row shows two times (S19).
  const [full, setFull] = useState<ReadonlySet<string>>(NO_FOLDS)
  const found = useMemo(() => {
    const top = searchTree(pinned, hits, full)
    const rest = searchTree(withoutPaths(tree, new Set(top.nodes.map((node) => node.path))), hits, full)
    return { top: top.nodes, rest: rest.nodes, open: new Set([...top.open, ...rest.open]), order: [...top.order, ...rest.order] }
  }, [tree, pinned, hits, full])
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
  // a match of the top group start at its pinned item, not at its vault. Inside a folder that shows
  // all, each row on show is a stop, a match or not (YAZ-2662 S48).
  const rows = useMemo(() => {
    const shown: TreeNode[] = []
    const walk = (nodes: readonly TreeNode[], all: boolean): void => {
      for (const node of nodes) {
        if (all || hits.has(node.path)) shown.push(node)
        if (node.type === 'dir' && searchOpen.has(node.path)) walk(node.children, all || full.has(node.path))
      }
    }
    walk(found.top, false)
    walk(found.rest, false)
    return shown
  }, [found, searchOpen, hits, full])
  // The highlight is held by its PATH (`null`: nobody moved it yet), so a fold that moves rows in or
  // out above it leaves it on its match. Unmoved, it is on the BEST match — the ranking's first, a
  // pinned match when there is one (YAZ-2662 S23) — wherever the tree draws it (S19); once its match
  // has left the screen, it is on the next row the tree still draws, else the last (S21).
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
  // The preview panel (YAZ-2662 D5). "A panel is on show" is `previewPath`, App's alone, so the
  // keys here and the ✕ there cannot disagree. `parked` is what App cannot hold: the preview is on
  // and the highlight is on a folder, so no panel is drawn (S38).
  const [parked, setParked] = useState(false)
  const previewing = previewPath !== null || parked
  const stopPreview = () => {
    setParked(false)
    onPreview(null)
  }
  // With the preview on, the panel follows the highlight (S32): a file shows `PREVIEW_FOLLOW_MS`
  // after the last move, and the earlier file stays until then. On a folder no panel is drawn, at once (S38).
  const followed = previewing ? rows[sel] : undefined
  const followedPath = followed?.path
  const followsFile = followed?.type === 'file'
  useEffect(() => {
    if (followedPath === undefined || followedPath === previewPath) return
    if (!followsFile) {
      setParked(true)
      onPreview(null)
      return
    }
    const timer = setTimeout(() => {
      setParked(false)
      onPreview(followedPath)
    }, PREVIEW_FOLLOW_MS)
    return () => clearTimeout(timer)
  }, [followedPath, followsFile, previewPath, onPreview])
  // A different tab shows, or the sidebar is hidden (S37): the bar that drives the panel is gone, and the panel with it.
  useEffect(() => {
    if (!active) return
    return () => {
      setParked(false)
      onPreview(null)
    }
  }, [active, onPreview])

  // The bar keeps focus while the tree is driven from it (YAZ-803). Opening leaves the results up.
  const onKeys = resultKeys(rows, sel, (at) => setPicked(rows[at].path), (row, e) => {
    if (previewing) stopPreview() // Enter does its own work and closes the preview panel (YAZ-2662 S36)
    activate(row, e.metaKey, e.shiftKey)
  })
  // With text typed the Search tab's body is the search tree (YAZ-2620); with none it is one line
  // of help (YAZ-2638 D2). A conditional render, not a teardown — every bit of the other tabs' tree
  // state (data, expansion, pending create/rename, drag) lives in the Sidebar's other hooks
  // (useVaultTree, rowGestures) and is waiting untouched when one of them shows again.
  const typed = query.trim() !== ''

  // The highlight as the tree takes a selection (S39): the one row the keys are on. A click moves
  // it to the clicked row when the keys can stop on that row (S26, S27) and leaves it be otherwise (S28).
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
    setFull(NO_FOLDS) // and no folder shows all (YAZ-2662 S53)
    if (previewing) stopPreview() // and no preview: Space is the text's again (S35)
  }

  // The list keys (YAZ-2662 D7): Space, → and ← act on the highlight once ↑ or ↓ moved it. Until
  // then, after a change of the text, and with a modifier they are the text's; so is a list key with
  // nothing to do on the highlight (S50, S51), which is not taken. Says whether the key was taken.
  const listKey = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    const row = picked === null || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey ? undefined : rows[sel]
    // Space on a file shows the preview panel on it, at once, and Space again closes the panel (D5, S33).
    if (row?.type === 'file' && e.key === ' ') {
      if (previewing) stopPreview()
      else onPreview(row.path)
      e.preventDefault()
      return true
    }
    // On a file → and ← have nothing to do (S50, S51).
    if (row?.type !== 'dir') return false
    const dir = row.path
    const open = searchOpen.has(dir)
    // ← closes an open folder (S51).
    if (e.key === 'ArrowLeft' && open) toggleSearchDir(dir)
    // Space and → open the folder with ALL that it holds (D6, S50): whatever its fold was, it is open.
    else if ((e.key === ' ' || e.key === 'ArrowRight') && !(open && full.has(dir))) {
      setFull((prev) => new Set([...prev, dir]))
      setFlipped((prev) => new Set([...prev].filter((path) => path !== dir)))
    }
    // Space on a folder that shows all puts it, and each folder inside it, back as the search drew it (S49).
    else if (e.key === ' ') {
      const outside = (prev: ReadonlySet<string>) => new Set([...prev].filter((path) => path !== dir && !path.startsWith(`${dir}/`)))
      setFull(outside)
      setFlipped(outside)
    } else return false
    e.preventDefault()
    return true
  }

  const searchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      // The first Esc closes the panel only (S34). With none on show — the highlight on a folder too (S38) — Esc leaves.
      if (previewPath !== null) stopPreview()
      else onLeave()
    } else if (!listKey(e)) onKeys(e)
  }

  return { query, searchInput, results, typed, found, searchOpen, toggleSearchDir, searchCursor, marks, changeQuery, searchKeyDown }
}
