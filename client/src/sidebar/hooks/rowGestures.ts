/**
 * What the rows do (YAZ-2202, moved out of `Sidebar.tsx` as-is): the multi-select both trees share,
 * the file clipboard, the inline create and rename inputs, and the two drags — a file onto a folder
 * (a move on disk) and a favorite along its list.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type RefObject } from 'react'
import { isMarkdown } from '@shared/fileKind'
import type { FileClipState, SidebarLens, TreeNode } from '@shared/types'
import { api } from '../../api'
import type { NoticeKind } from '../../lib/notice'
import { pageName, pathTitles } from '../../lib/pageLabel'
import { basename } from '../../lib/paths'
import { EMPTY_SELECTION, orderedSelection, selectionReducer } from '../../lib/selection'
import { fetchTree } from '../../lib/treeFeed'
import { findDirNode, notesAt, treeHasPath } from '../../lib/treeState'
import { dropFolderValuesAfterMove, dropStaleFolderValues, valuesLeftBehind, type LeftBehind, type Move } from '../../links/shortcuts'
import { createNote, folderPath } from '../../views/scaffold'
import { transformFile } from '../../views/writeProperty'
import { renamedPath, targetDirFor, type EntryKind } from '../createEntry'
import { countItems } from '../menuSections'
import type { MenuTargets, SidebarClipboard, SidebarVault } from '../Sidebar'
import type { PendingCreate, PendingRename, TreeFileMove, TreeReorder, TreeSelection } from '../Tree'

/** `tree` is every row the panel can hold — the forest (YAZ-2602 D3) — or null until every vault's tree has landed. */
export function useSelection(lens: SidebarLens, searching: boolean, tree: TreeNode[] | null, roots: readonly string[], selectionRef: { current: ReadonlySet<string> }, bodyRef: RefObject<HTMLDivElement | null>) {
  // Multi-select (YAZ-1336, 🔒 D1): the selected PATHS — files and, since YAZ-1578, folders —
  // shared by BOTH lenses, one entry per path however many rows draw it (🔒 D3). It lives HERE
  // and nowhere else on purpose: the Sidebar (which calls this hook) is mounted on its first vault and
  // only while the sidebar is open, so a selection is honestly about rows currently on screen and
  // cannot outlive them (a collapse ends it). It may hold rows of two vaults (YAZ-2602 S18).
  const [selectedPaths, dispatchSelection] = useReducer(selectionReducer, EMPTY_SELECTION)

  // A vault that leaves the window ends the selection (YAZ-2602 S50): the rows it was about moved.
  const before = useRef(roots)
  useEffect(() => {
    const left = before.current.some((vault) => !roots.includes(vault))
    before.current = roots
    if (left) dispatchSelection({ type: 'clear' })
  }, [roots])

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
    dispatchSelection({ type: 'prune', exists: (path) => treeHasPath(tree, path) })
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
  /** Each vault's favorites, by its root (YAZ-2602 D5), and the writer of one vault's list. */
  favoritesRef: RefObject<Readonly<Record<string, readonly string[]>>>,
  saveFavorites: (vault: string, next: readonly string[]) => void,
  rootOf: (path: string) => string,
  onNotice: (message: string, kind?: NoticeKind) => void,
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
      // A drag moves inside ONE vault (YAZ-2602 R11): a folder, or a vault row, of a different vault refuses it.
      if (rootOf(path) !== rootOf(dir)) return onNotice('To move between vaults, use cut and paste')
      const target = `${dir}/${basename(path)}`
      if (target === path) return // dropped into its own folder: nothing to do
      // The SAME rename flow as the context menu — never-overwrite and every failure as a
      // passive notice come with it; link updates and the workspace remap ride the same pipeline.
      void onRenameFile(path, target, 'file')
    },
    [dragging, onRenameFile, rootOf, onNotice],
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
    // The order is its own vault's (YAZ-2602 S26): the list of the vault that holds the dragged row.
    const vault = rootOf(from)
    const without = (favoritesRef.current[vault] ?? []).filter((p) => p !== from)
    const i = without.indexOf(over.path)
    if (i < 0) return
    const at = over.edge === 'before' ? i : i + 1
    saveFavorites(vault, [...without.slice(0, at), from, ...without.slice(at)])
  }, [reorderDragging, reorderOver, rootOf, saveFavorites])

  const favoriteReorder: TreeReorder = useMemo(
    () => ({
      dragging: reorderDragging,
      over: reorderOver,
      start: setReorderDragging,
      // A row of a different vault's group is no place for it (S26): no marker there, so a drop changes nothing.
      hover: (path, edge) => setReorderOver((prev) => (reorderDragging === null || rootOf(path) !== rootOf(reorderDragging) ? null : prev?.path === path && prev.edge === edge ? prev : { path, edge })),
      drop: dropReorder,
      end: () => {
        setReorderDragging(null)
        setReorderOver(null)
      },
    }),
    [reorderDragging, reorderOver, dropReorder, rootOf],
  )

  return { dragging, dropDir, setDropDir, dropOnDir, fileMove, favoriteReorder }
}

export function useFileClipboard(
  /** The first vault's root: where ⌘V pastes with no selection, in a window with one vault. */
  root: string,
  /** The vault that holds a path (YAZ-2602): a paste is judged by the vault it lands in. */
  vaultOf: (path: string) => SidebarVault,
  /** The vault rows' paths; empty with one vault. */
  vaultRows: ReadonlyMap<string, string>,
  menu: MenuTargets | null,
  selectedPaths: ReadonlySet<string>,
  orderedSelectedPaths: () => string[],
  dirs: string[],
  refresh: (root: string) => void,
  openTo: (file: string) => void,
  clipboardRef: { current: SidebarClipboard | null },
  onNotice: (message: string, kind?: NoticeKind) => void,
) {
  /**
   * Main's ONE app-wide file clipboard (🔒 D1): `{ count, op, paths }` or null, pushed to every
   * window on every change, so a menu opened here can label "Paste N items" for a copy made in
   * another window on another vault. Session-only, never persisted. A window opened AFTER a clip
   * reads the current state ONCE on mount (`clipState`), so its Paste is labelled from the start.
   */
  const [clip, setClip] = useState<FileClipState>(null)
  // The paste of a Cut that would clear values, or of a Copy that would not keep them (YAZ-2420 3E1), waiting on its sheet (D21); null when it is closed.
  const [pendingPaste, setPendingPaste] = useState<{ dir: string; moves: Move[]; lost: LeftBehind; copy: boolean } | null>(null)
  // The sheet speaks for the clipboard it was asked about: another one ends the question.
  useEffect(() => setPendingPaste(null), [clip])
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
   * (`refresh` is idempotent). A CUT is a move: each note it moved leaves the values of the folders
   * it left behind (D20), judged on the index as it stood before the paste. A COPY's notes keep no
   * values for the folders that do not show them (YAZ-2420 3E1), judged after it; the original is
   * never written. The copies are listed off the tree that refresh reads — the index hears of them
   * only once the watcher has — and a folder it has not heard of yet, the copy of one, keeps its block.
   * In a vault that does not use IDs a copy is left as it landed (YAZ-2523 🔒 V3): by the data both
   * branches do nothing there, and the gate on the copy's only saves its two fetches.
   * The vault is the one `dir` is in (YAZ-2602 S46): a paste from another vault of this window is
   * judged as a paste from another window is.
   */
  const runPaste = useCallback(
    async (dir: string) => {
      const { root: vault, index } = vaultOf(dir)
      try {
        const before = clip?.op === 'cut' ? { records: index.records, folders: index.folders } : null
        const res = await api.file.paste({ targetDir: dir })
        openTo(`${dir}/x`)
        refresh(vault)
        if (before !== null) for (const { from, to, kind } of res.pasted) await dropFolderValuesAfterMove({ root: vault, oldPath: from, newPath: to, kind, ...before })
        else if (index.ids) {
          const [{ tree }, { folders }] = await Promise.all([fetchTree(vault), api.index(vault)])
          for (const { to } of res.pasted) for (const path of notesAt(tree, to)) await transformFile(path, dropStaleFolderValues(vault, path, folders)).catch(() => undefined)
        }
        const first = res.failed[0]
        if (first === undefined) {
          // Reachable only when EVERY entry was a cut into the folder it is already in (skipped silently, D2) — nothing went wrong.
          if (res.pasted.length === 0) onNotice('Nothing to paste', 'info')
          else onNotice(`Pasted ${countItems(res.pasted.length)}`, 'paste')
        } else {
          const name = pageName(vault, first.from, pathTitles(index.records, index.folders))
          if (res.pasted.length === 0) onNotice(`Couldn't paste: ${name} — ${first.message}`, 'error')
          else onNotice(`Pasted ${countItems(res.pasted.length)}, skipped ${res.failed.length}: ${name} — ${first.message}`, 'paste')
        }
      } catch (err: unknown) {
        onNotice(`Can't paste: ${err instanceof Error ? err.message : String(err)}`, 'error')
      }
    },
    [vaultOf, refresh, openTo, onNotice, clip],
  )

  /**
   * Paste's one door, the menu's and ⌘V's: a Cut that would clear a folder's values asks first
   * (D21), by the window's own snapshot, and so does a Copy whose copies would not keep them
   * (YAZ-2420 3E1); anything else pastes at once. The moves are the clipboard's paths into `dir` —
   * one already there is no move (main skips a cut, D2; a copy beside its original leaves nothing
   * behind), and a folder is one the tree holds as a folder. A path outside this vault matches no
   * record, so it never asks: the index cannot speak for it.
   */
  const pasteInto = useCallback(
    (dir: string) => {
      if (clip !== null) {
        const moves = clip.paths.flatMap((oldPath): Move[] => {
          const newPath = `${dir}/${basename(oldPath)}`
          return newPath === oldPath ? [] : [{ oldPath, newPath, kind: dirs.includes(oldPath) ? 'dir' : 'file' }]
        })
        const { root: vault, index } = vaultOf(dir)
        const lost = valuesLeftBehind({ root: vault, moves, records: index.records, folders: index.folders })
        if (lost.folders.length > 0) return setPendingPaste({ dir, moves, lost, copy: clip.op === 'copy' })
      }
      void runPaste(dir)
    },
    [vaultOf, clip, dirs, runPaste],
  )

  /** The sheet's Move or Copy: the paste runs as it does unasked. Its Cancel only closes it — the clipboard stays as it was. */
  const confirmPaste = useCallback(() => {
    if (pendingPaste === null) return
    setPendingPaste(null)
    void runPaste(pendingPaste.dir)
  }, [pendingPaste, runPaste])

  /**
   * ⌘V's target (D6, YAZ-1674): beside the FIRST ordered selected row — a dir → into it, a file →
   * its parent (the "New note" rule, `targetDirFor`) — or the vault root with no selection at all.
   * With two or more vaults no selection names no vault (YAZ-2602 S10): null, and nothing is pasted.
   */
  const pasteTargetDir = useCallback((): string | null => {
    const first = orderedSelectedPaths()[0]
    if (first === undefined) return vaultRows.size > 0 ? null : root
    return targetDirFor({ type: dirs.includes(first) || vaultRows.has(first) ? 'dir' : 'file', path: first }, root)
  }, [orderedSelectedPaths, dirs, vaultRows, root])

  /**
   * The chords' handle (D6 amended, YAZ-1674): App's window listener asks these two verbs; the
   * rules stay HERE. Cut / Copy need a selection ≥1 (since D9 a plain click is one); Paste needs
   * a non-empty clipboard; an open context menu owns the verbs outright (its items ARE them).
   * Rewritten whenever a rule input changes, emptied on unmount (`selectionRef`'s idiom) — a
   * collapsed sidebar has no tree to paste into or read an order from. A selection that holds a
   * vault row has no Cut and no Copy (YAZ-2602 S18): a vault is not a file to clip.
   */
  useEffect(() => {
    clipboardRef.current = {
      cutOrCopy: (op) => {
        if (menu !== null || selectedPaths.size === 0 || [...selectedPaths].some((path) => vaultRows.has(path))) return false
        clipTo(orderedSelectedPaths(), op)
        return true
      },
      paste: () => {
        if (menu !== null || clip === null) return false
        const dir = pasteTargetDir()
        if (dir === null) onNotice('Select a vault or a folder first')
        else pasteInto(dir)
        return true
      },
    }
    return () => {
      clipboardRef.current = null
    }
  }, [clipboardRef, menu, selectedPaths, vaultRows, clip, clipTo, orderedSelectedPaths, pasteInto, pasteTargetDir, onNotice])

  return { clip, clipTo, pasteInto, pendingPaste, confirmPaste, cancelPaste: () => setPendingPaste(null) }
}

export function useInlineEdits(
  /** The top of a list tab, in a window with one vault: its root. Null with two or more, where no one folder stands above the rows. */
  root: string | null,
  /** The vault that holds a path (YAZ-2602 R4): a new note is made as the vault it is made in makes one. */
  vaultOf: (path: string) => SidebarVault,
  menu: MenuTargets | null,
  setMenu: (menu: MenuTargets | null) => void,
  favoriteNodes: TreeNode[],
  focusNodes: TreeNode[],
  onLensChange: (lens: SidebarLens) => void,
  refresh: (root: string) => void,
  onOpenFile: (path: string) => void,
  onRenameFile: (oldPath: string, newPath: string, kind: TreeNode['type']) => Promise<void>,
  onRetitle: (path: string, title: string, kind: TreeNode['type']) => Promise<void>,
  openTo: (file: string) => void,
) {
  const [creating, setCreating] = useState<{ kind: EntryKind; seed: string; parentDir: string } | null>(null)
  const [renamingEntry, setRenamingEntry] = useState<{ path: string; kind: 'file' | 'dir' } | null>(null)

  const startCreate = useCallback(
    (kind: EntryKind, seed = '') => {
      if (menu === null || menu.targetDir === null) return
      // The input renders inside the target dir's children, so that dir must be open — and its
      // vault's row with it; `openTo` opens every dir ABOVE the given path, so a synthetic child opens targetDir itself.
      openTo(`${menu.targetDir}/x`)
      // Favorites and Focus each show a SUBSET of the vault (YAZ-1766 3B1, YAZ-2619 S36): a target dir
      // the tab does not hold — or the root on a tab with no rows — would give the input nowhere to
      // mount, so the create moves to Files, where the `openTo` above has already opened that dir.
      // The reveal hop's rule (D10), applied to the other gesture that needs a row. With two or more
      // vaults a vault's root is held only as its row (YAZ-2602): Favorites has it, Focus never does.
      const shown = menu.lens === 'favorites' ? favoriteNodes : menu.lens === 'focus' ? focusNodes : null
      if (shown !== null && (menu.targetDir === root ? shown.length === 0 : findDirNode(shown, menu.targetDir) === null)) onLensChange('files')
      setCreating({ kind, seed, parentDir: menu.targetDir })
      setMenu(null)
    },
    [menu, root, favoriteNodes, focusNodes, onLensChange, openTo],
  )

  const submitCreate = useCallback(
    async (name: string) => {
      if (creating === null) return
      const { root: vault, index } = vaultOf(creating.parentDir)
      // Until the index lands the vault's kind is not known (YAZ-2523 🔒 V5), and it decides what is written.
      if (index.resolve === null) throw new Error('Vault index is still loading — try again in a moment')
      // What was typed is the TITLE (YAZ-2420 🔒 D6, D20): the name on disk is built from it.
      // In a vault that does not use IDs it is the name itself (YAZ-2523 🔒 V3).
      let note: string | null = null
      if (creating.kind === 'dir') await api.createDir({ path: folderPath(creating.parentDir, name, index.ids), ...(index.ids && { title: name }) })
      else note = await createNote(creating.parentDir, name, index.ids)
      setCreating(null)
      refresh(vault)
      if (note !== null) onOpenFile(note)
    },
    [creating, refresh, onOpenFile, vaultOf],
  )

  const cancelCreate = useCallback(() => setCreating(null), [])

  const submitRename = useCallback(
    async (name: string) => {
      if (renamingEntry === null) return
      const { path, kind } = renamingEntry
      setRenamingEntry(null)
      // App owns the whole flow (and routes failures to the passive notice — never a dialog);
      // the tree row follows via the watcher's unlink+add refresh. What was typed for a note or
      // a folder is its TITLE (YAZ-2420 🔒 D16); for any other file, its name.
      if (kind === 'dir' || isMarkdown(path)) return onRetitle(path, name, kind)
      const target = renamedPath(path, name)
      if (target === path) return // same name = no-op
      await onRenameFile(path, target, 'file')
    },
    [renamingEntry, onRenameFile, onRetitle],
  )

  const renaming: PendingRename | null = useMemo(
    () => (renamingEntry === null ? null : { path: renamingEntry.path, title: vaultOf(renamingEntry.path).index.ids, onSubmit: submitRename, onCancel: () => setRenamingEntry(null) }),
    [renamingEntry, submitRename, vaultOf],
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
