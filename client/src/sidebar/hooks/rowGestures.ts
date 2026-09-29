/**
 * What the rows do (YAZ-2202, moved out of `Sidebar.tsx` as-is): the multi-select both trees share,
 * and the two drags — a file onto a folder (a move on disk) and a favorite along its list.
 */
import { useCallback, useEffect, useMemo, useReducer, useState, type RefObject } from 'react'
import type { SidebarLens, TreeNode, TreeResponse } from '@shared/types'
import { basename } from '../../lib/paths'
import { EMPTY_SELECTION, orderedSelection, selectionReducer } from '../../lib/selection'
import { treeHasPath } from '../../lib/treeState'
import type { TreeFileMove, TreeReorder, TreeSelection } from '../Tree'

export function useSelection(lens: SidebarLens, searching: boolean, tree: TreeResponse | null, selectionRef: { current: ReadonlySet<string> }, bodyRef: RefObject<HTMLDivElement | null>) {
  // Multi-select (YAZ-1336, 🔒 D1): the selected PATHS — files and, since YAZ-1578, folders —
  // shared by BOTH lenses, one entry per path however many rows draw it (🔒 D3). It lives HERE
  // and nowhere else on purpose: this component is mounted `key={root}` and only while the
  // sidebar is open, so a selection is honestly about rows currently on screen and cannot
  // outlive them (a collapse ends it).
  const [selectedPaths, dispatchSelection] = useReducer(selectionReducer, EMPTY_SELECTION)

  // A selection is about the rows on screen (YAZ-1336), so whatever REPLACES them ends it: the
  // other lens is a different reading of the vault, and a typed query swaps the body for the flat
  // list entirely (🔒 the flat-list ruling on YAZ-739). `clear` on an empty selection returns the
  // same set, so the mount pass and every ordinary render below cost nothing.
  useEffect(() => {
    dispatchSelection({ type: 'clear' })
  }, [lens, searching])

  // The loaded tree is the canonical disk truth for BOTH lenses — Topics draws the same files —
  // so a path it no longer has cannot stay selected. A selected path is a file OR a folder
  // (YAZ-1578, 🔒 D1), hence `treeHasPath` here and nowhere else. Reference-stable when nothing
  // was dropped, which is every refresh that changed something else.
  useEffect(() => {
    if (tree === null) return
    dispatchSelection({ type: 'prune', exists: (path) => treeHasPath(tree.tree, path) })
  }, [tree])

  // ⌘⇧C's window onto the selection (🔒 D4, YAZ-1338): App holds the box, this panel keeps it
  // current — and EMPTIES it on the way out, so a collapsed or root-switched sidebar can never
  // hand the chord a selection nobody can see. A ref, so this costs no render on either side.
  useEffect(() => {
    selectionRef.current = selectedPaths
    return () => {
      selectionRef.current = EMPTY_SELECTION
    }
  }, [selectionRef, selectedPaths])

  /**
   * The whole selection as a list, ordered by the PANEL (YAZ-1337, as ⚡ YAZ-1338 rules it): the
   * rows on screen first, in the order the eye reads them — never click order, which is not an
   * order the user can see — and every still-selected path with no row appended after them, so
   * collapsing a folder over a selected note hides the row and keeps the note. The one rule lives
   * in `orderedSelection`, which ⌘⇧C reads too: the menu and the chord cannot spell one selection
   * two ways.
   */
  const orderedSelectedPaths = useCallback((): string[] => orderedSelection(selectedPaths, bodyRef.current), [selectedPaths])

  /** The multi-select as both trees take it (YAZ-1336): the set, plus its two gestures — toggle (shift) and set (any other click, D9). */
  const toggleSelection = useCallback((path: string) => dispatchSelection({ type: 'toggle', path }), [])
  const setSelection = useCallback((path: string) => dispatchSelection({ type: 'set', path }), [])
  const selection: TreeSelection = useMemo(() => ({ paths: selectedPaths, toggle: toggleSelection, set: setSelection }), [selectedPaths, toggleSelection, setSelection])

  return { selectedPaths, dispatchSelection, orderedSelectedPaths, selection }
}

export function useTreeDrag(
  onRenameFile: (oldPath: string, newPath: string, kind: TreeNode['type']) => Promise<void>,
  favoritesRef: RefObject<readonly string[]>,
  saveFavorites: (next: readonly string[]) => void,
  focusFavorites: readonly string[],
) {
  // File drag-to-move (E1b, GRO-2241): the dragged file row + the highlighted drop target.
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropDir, setDropDir] = useState<string | null>(null)
  // Favorites drag-to-reorder (D4): the dragged root row + the hovered row and edge.
  const [reorderDragging, setReorderDragging] = useState<string | null>(null)
  const [reorderOver, setReorderOver] = useState<{ path: string; edge: 'before' | 'after' } | null>(null)

  // ---- File drag-to-move (E1b, GRO-2241): drop a FILE row on a folder row or the root header ----

  const dropOnDir = useCallback(
    (dir: string) => {
      const path = dragging
      setDragging(null)
      setDropDir(null)
      if (path === null) return
      const target = `${dir}/${basename(path)}`
      if (target === path) return // dropped into its own folder: nothing to do
      // The SAME rename flow as the context menu — never-overwrite and every failure as a
      // passive notice come with it; link updates and the workspace remap ride the same pipeline.
      void onRenameFile(path, target, 'file')
    },
    [dragging, onRenameFile],
  )

  const fileMove: TreeFileMove = useMemo(
    () => ({
      dragging,
      dropDir,
      start: setDragging,
      end: () => {
        setDragging(null)
        setDropDir(null)
      },
      hover: setDropDir,
      drop: dropOnDir,
    }),
    [dragging, dropDir, dropOnDir],
  )

  // ---- Favorites drag-to-reorder (YAZ-1766 D4): a root row dropped above/below another rewrites the list ----

  const dropReorder = useCallback(() => {
    const from = reorderDragging
    const over = reorderOver
    setReorderDragging(null)
    setReorderOver(null)
    if (from === null || over === null || over.path === from) return
    const prev = favoritesRef.current
    const without = prev.filter((p) => p !== from)
    const i = without.indexOf(over.path)
    if (i < 0) return
    const at = over.edge === 'before' ? i : i + 1
    saveFavorites([...without.slice(0, at), from, ...without.slice(at)])
  }, [reorderDragging, reorderOver, saveFavorites])

  /** Off while the tab is focused: the focus list is what is shown then, not the favorites order. */
  const reorderOff = focusFavorites.length > 0
  const favoriteReorder: TreeReorder = useMemo(
    () => ({
      dragging: reorderDragging,
      over: reorderOver,
      start: reorderOff ? () => undefined : setReorderDragging,
      hover: (path, edge) => setReorderOver((prev) => (prev?.path === path && prev.edge === edge ? prev : { path, edge })),
      drop: dropReorder,
      end: () => {
        setReorderDragging(null)
        setReorderOver(null)
      },
    }),
    [reorderDragging, reorderOver, reorderOff, dropReorder],
  )

  return { dragging, dropDir, setDropDir, dropOnDir, fileMove, favoriteReorder }
}
