/**
 * What the rows do (YAZ-2202, moved out of `Sidebar.tsx` as-is): the multi-select both trees share,
 * the file clipboard, the inline create and rename inputs, and the two drags — a file onto a folder
 * (a move on disk) and a favorite along its list.
 */
import { useCallback, useEffect, useMemo, useReducer, useState, type Dispatch, type RefObject } from 'react'
import type { FileClipState, SidebarLens, TreeNode, TreeResponse } from '@shared/types'
import { api } from '../../api'
import type { NoticeKind } from '../../lib/notice'
import { basename } from '../../lib/paths'
import { EMPTY_SELECTION, orderedSelection, selectionReducer } from '../../lib/selection'
import { findDirNode, treeHasPath, type TreeAction } from '../../lib/treeState'
import { createNote } from '../../views/scaffold'
import { entryPath, renamedPath, targetDirFor, type EntryKind } from '../createEntry'
import { countItems } from '../menuSections'
import type { MenuTargets, SidebarClipboard } from '../Sidebar'
import type { PendingCreate, PendingRename, TreeFileMove, TreeReorder, TreeSelection } from '../Tree'

export function useSelection(lens: SidebarLens, searching: boolean, tree: TreeResponse | null, selectionRef: { current: ReadonlySet<string> }, bodyRef: RefObject<HTMLDivElement | null>) {
  // Multi-select (YAZ-1336, 🔒 D1): the selected PATHS — files and, since YAZ-1578, folders —
  // shared by BOTH lenses, one entry per path however many rows draw it (🔒 D3). It lives HERE
  // and nowhere else on purpose: the Sidebar (which calls this hook) is mounted `key={root}` and
  // only while the sidebar is open, so a selection is honestly about rows currently on screen and
  // cannot outlive them (a collapse ends it).
  const [selectedPaths, dispatchSelection] = useReducer(selectionReducer, EMPTY_SELECTION)

  // A selection is about the rows on screen (YAZ-1336), so whatever REPLACES them ends it: the
  // other lens is a different reading of the vault, and a typed query swaps the body for the flat
  // list entirely (🔒 the flat-list ruling on YAZ-739). `clear` on an empty selection returns the
  // same set, so the mount pass and every ordinary render below cost nothing.
  useEffect(() => {
    dispatchSelection({ type: 'clear' })
  }, [lens, searching])

  // The loaded tree is the canonical disk truth for BOTH lenses,
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

export function useFileClipboard(
  root: string,
  menu: MenuTargets | null,
  selectedPaths: ReadonlySet<string>,
  orderedSelectedPaths: () => string[],
  dirs: string[],
  refresh: () => void,
  dispatch: Dispatch<TreeAction>,
  clipboardRef: { current: SidebarClipboard | null },
  onNotice: (message: string, kind?: NoticeKind) => void,
) {
  /**
   * Main's ONE app-wide file clipboard (🔒 D1): `{ count, op }` or null, pushed to every window on
   * every change, so a menu opened here can label "Paste N items" for a copy made in another
   * window on another vault. Session-only, never persisted. A window opened AFTER a clip reads the
   * current state ONCE on mount (`clipState`), so its Paste is labelled from the start.
   */
  const [clip, setClip] = useState<FileClipState>(null)
  useEffect(() => {
    // Subscribe FIRST, then read: a push that lands while the read is in flight is newer than the
    // read and must win — the read only fills a window nothing has pushed to yet.
    let live = true
    let pushed = false
    const unsubscribe = api.file.onClipChanged((state) => {
      pushed = true
      setClip(state)
    })
    api.file.clipState().then(
      (state) => {
        if (live && !pushed) setClip(state)
      },
      () => undefined, // an empty clipboard is the honest fallback; the next push corrects it
    )
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  /**
   * Cut / Copy: hand the ordered paths to main (🔒 D1) and SAY SO — every clipboard write confirms
   * (YAZ-1341), and a refusal is reported, never swallowed. The selection stands: acting on it is
   * not the same as ending it (YAZ-1337).
   */
  const clipTo = useCallback(
    (paths: string[], op: 'copy' | 'cut') => {
      const what = countItems(paths.length)
      api.file.clip({ paths, op }).then(
        () => onNotice(op === 'cut' ? `Cut ${what}` : `Copied ${what}`, op),
        (err: unknown) => onNotice(`Can't ${op}: ${err instanceof Error ? err.message : String(err)}`, 'error'),
      )
    },
    [onNotice],
  )

  /**
   * Paste into `dir` (🔒 D2–D4): PER-ENTRY results, so one bad entry never hides the rest — the
   * notice counts both halves and names the first failure. The target opens (the synthetic-child
   * idiom `startCreate` uses) and the tree refreshes EXPLICITLY: a copy moves nothing, so no
   * `fileRenamed` broadcast repairs it, and the watcher's add echo is a courtesy, not a contract
   * (`refresh` is idempotent).
   */
  const pasteInto = useCallback(
    async (dir: string) => {
      try {
        const res = await api.file.paste({ targetDir: dir })
        if (dir !== root) dispatch({ type: 'expandTo', root, file: `${dir}/x` })
        refresh()
        const first = res.failed[0]
        if (first === undefined) {
          // Reachable only when EVERY entry was a cut into the folder it is already in (skipped silently, D2) — nothing went wrong.
          if (res.pasted.length === 0) onNotice('Nothing to paste', 'info')
          else onNotice(`Pasted ${countItems(res.pasted.length)}`, 'paste')
        } else if (res.pasted.length === 0) onNotice(`Couldn't paste: ${basename(first.from)} — ${first.message}`, 'error')
        else onNotice(`Pasted ${countItems(res.pasted.length)}, skipped ${res.failed.length}: ${basename(first.from)} — ${first.message}`, 'paste')
      } catch (err: unknown) {
        onNotice(`Can't paste: ${err instanceof Error ? err.message : String(err)}`, 'error')
      }
    },
    [root, refresh, onNotice],
  )

  /**
   * ⌘V's target (D6, YAZ-1674): beside the FIRST ordered selected row — a dir → into it, a file →
   * its parent (the "New note" rule, `targetDirFor`) — or the vault root with no selection at all.
   */
  const pasteTargetDir = useCallback((): string => {
    const first = orderedSelectedPaths()[0]
    if (first === undefined) return root
    return targetDirFor({ type: dirs.includes(first) ? 'dir' : 'file', path: first }, root)
  }, [orderedSelectedPaths, dirs, root])

  /**
   * The chords' handle (D6 amended, YAZ-1674): App's window listener asks these two verbs; the
   * rules stay HERE. Cut / Copy need a selection ≥1 (since D9 a plain click is one); Paste needs
   * a non-empty clipboard; an open context menu owns the verbs outright (its items ARE them).
   * Rewritten whenever a rule input changes, emptied on unmount (`selectionRef`'s idiom) — a
   * collapsed sidebar has no tree to paste into or read an order from.
   */
  useEffect(() => {
    clipboardRef.current = {
      cutOrCopy: (op) => {
        if (menu !== null || selectedPaths.size === 0) return false
        clipTo(orderedSelectedPaths(), op)
        return true
      },
      paste: () => {
        if (menu !== null || clip === null) return false
        void pasteInto(pasteTargetDir())
        return true
      },
    }
    return () => {
      clipboardRef.current = null
    }
  }, [clipboardRef, menu, selectedPaths, clip, clipTo, orderedSelectedPaths, pasteInto, pasteTargetDir])

  return { clip, clipTo, pasteInto }
}

export function useInlineEdits(
  root: string,
  menu: MenuTargets | null,
  setMenu: (menu: MenuTargets | null) => void,
  favoriteNodes: TreeNode[],
  onLensChange: (lens: SidebarLens) => void,
  refresh: () => void,
  onOpenFile: (path: string) => void,
  onRenameFile: (oldPath: string, newPath: string, kind: TreeNode['type']) => Promise<void>,
  dispatch: Dispatch<TreeAction>,
) {
  const [creating, setCreating] = useState<{ kind: EntryKind; seed: string; parentDir: string } | null>(null)
  const [renamingEntry, setRenamingEntry] = useState<{ path: string; kind: 'file' | 'dir' } | null>(null)

  const startCreate = useCallback(
    (kind: EntryKind, seed = '') => {
      if (menu === null) return
      // The input renders inside the target dir's children, so that dir must be open;
      // expandTo opens every dir ABOVE the given path, so a synthetic child opens targetDir itself.
      if (menu.targetDir !== root) dispatch({ type: 'expandTo', root, file: `${menu.targetDir}/x` })
      // Favorites shows a SUBSET of the vault (YAZ-1766, 3B1): a target dir it does not hold would give
      // the input nowhere to mount, so the create moves to Files — where the `expandTo` above has
      // already opened that dir. The reveal hop's rule (D10), applied to the other gesture that needs a row.
      if (menu.lens === 'favorites' && menu.targetDir !== root && findDirNode(favoriteNodes, menu.targetDir) === null) onLensChange('files')
      setCreating({ kind, seed, parentDir: menu.targetDir })
      setMenu(null)
    },
    [menu, root, favoriteNodes, onLensChange],
  )

  const submitCreate = useCallback(
    async (name: string) => {
      if (creating === null) return
      const p = entryPath(creating.parentDir, name, creating.kind)
      if (creating.kind === 'dir') await api.createDir(p)
      else await createNote(p)
      setCreating(null)
      refresh()
      if (creating.kind !== 'dir') onOpenFile(p)
    },
    [creating, refresh, onOpenFile],
  )

  const cancelCreate = useCallback(() => setCreating(null), [])

  const submitRename = useCallback(
    async (name: string) => {
      if (renamingEntry === null) return
      const target = renamedPath(renamingEntry.path, name, renamingEntry.kind)
      setRenamingEntry(null)
      if (target === renamingEntry.path) return // same name = no-op
      // App owns the whole flow (and routes failures to the passive notice — never a dialog);
      // the tree row follows via the watcher's unlink+add refresh.
      await onRenameFile(renamingEntry.path, target, renamingEntry.kind)
    },
    [renamingEntry, onRenameFile],
  )

  const renaming: PendingRename | null = useMemo(
    () => (renamingEntry === null ? null : { path: renamingEntry.path, onSubmit: submitRename, onCancel: () => setRenamingEntry(null) }),
    [renamingEntry, submitRename],
  )

  const pending: PendingCreate | null = useMemo(
    () =>
      creating === null
        ? null
        : {
            kind: creating.kind,
            seed: creating.seed,
            parentDir: creating.parentDir,
            onSubmit: submitCreate,
            onCancel: cancelCreate,
          },
    [creating, submitCreate, cancelCreate],
  )

  return { setRenamingEntry, startCreate, renaming, pending }
}
