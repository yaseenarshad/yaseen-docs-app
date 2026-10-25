/**
 * What the rows do (YAZ-2202, moved out of `Sidebar.tsx` as-is): the multi-select both trees share,
 * the file clipboard, the inline create and rename inputs, and the two drags — a row, or the
 * selection, onto a folder (a move on disk; folders and the selection since YAZ-3251) and a top row
 * along its tab's list.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type RefObject } from 'react'
import { isMarkdown } from '@shared/fileKind'
import type { FileClipState, SidebarLens, SidebarTab, TreeNode } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import type { NoticeKind } from '../../lib/notice'
import { pageName, pathTitles } from '../../lib/pageLabel'
import { basename } from '../../lib/paths'
import { EMPTY_SELECTION, orderedSelection, selectionReducer } from '../../lib/selection'
import { fetchTree } from '../../lib/treeFeed'
import { findDirNode, notesAt, treeHasPath } from '../../lib/treeState'
import { dropFolderValuesAfterMove, dropStaleFolderValues, valuesLeftBehind, type LeftBehind, type Move } from '../../links/shortcuts'
import { createNote, folderPath } from '../../views/scaffold'
import { transformFile } from '../../views/writeProperty'
import { boardPath, renamedPath, targetDirFor, untitledNames, type EntryKind } from '../createEntry'
import { dragPill, pillLabel } from '../dragPill'
import { countItems } from '../menuSections'
import type { MenuTargets, SidebarClipboard, SidebarVault } from '../Sidebar'
import type { PendingCreate, PendingRename, TreeFileMove, TreeReorder, TreeSelection } from '../Tree'

/**
 * A new board (YAZ-3028 D9): name first, then birth. `fs:create-board` writes the empty scene or the
 * empty diagram and never over a file. What was typed is the file NAME — a board has no title and no
 * note ID. An EMPTY name (`''`, the box's seed alone) is `Untitled`, then `Untitled 2`, …: only that
 * case steps past a name that is taken; a typed name that is taken is refused, and the box says so.
 */
async function createBoardFile(vault: string, parentDir: string, typed: string, kind: 'drawing' | 'diagram', seed: string): Promise<string> {
  if (typed !== '') return (await api.createBoard({ root: vault, path: boardPath(parentDir, typed, kind) })).path
  for (const name of untitledNames(seed)) {
    try {
      return (await api.createBoard({ root: vault, path: boardPath(parentDir, name, kind) })).path
    } catch (err) {
      if (!(err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS')) throw err
    }
  }
  throw new Error(`Every name from "${untitledNames(seed)[0]}" to "${untitledNames(seed).at(-1)}" is taken here`)
}

/** No copy recorded (YAZ-3131): the one empty value, so a reset on an empty one is no render. */
const NO_COPIES: ReadonlyMap<string, string> = new Map()

/** `tree` is every row the panel can hold — the forest (YAZ-2602 D3) — or null until every vault's tree has landed. */
export function useSelection(lens: SidebarTab, tree: TreeNode[] | null, roots: readonly string[], selectionRef: { current: ReadonlySet<string> }, bodyRef: RefObject<HTMLDivElement | null>) {
  // Multi-select (YAZ-1336, 🔒 D1): the selected PATHS — files and, since YAZ-1578, folders —
  // shared by BOTH lenses, one entry per path however many rows draw it (🔒 D3). It lives HERE
  // and nowhere else on purpose: the Sidebar (which calls this hook) is mounted on one vault of the window and
  // only while the sidebar is open, so a selection is honestly about rows currently on screen and
  // cannot outlive them (a collapse ends it). It may hold rows of two vaults (YAZ-2602 S18).
  const [selectedPaths, dispatchSelection] = useReducer(selectionReducer, EMPTY_SELECTION)
  // The copy each path was picked in (YAZ-3131 Decision 3): a row of Focus or Favorites can stand
  // under two top rows, and only the picked one lights. A plain click starts it again, and a tab
  // change empties it, so it holds at most one entry for each pick since the last plain click.
  const [copies, setCopies] = useState<ReadonlyMap<string, string>>(NO_COPIES)

  // A vault that leaves the window ends the selection (YAZ-2602 S50): the rows it was about moved.
  const before = useRef(roots)
  useEffect(() => {
    const left = before.current.some((vault) => !roots.includes(vault))
    before.current = roots
    if (left) dispatchSelection({ type: 'clear' })
  }, [roots])

  // A selection is about the rows on screen (YAZ-1336), so whatever REPLACES them ends it: the
  // other lens is a different reading of the vault, and the Search tab (YAZ-2638 D2) draws the
  // search tree (YAZ-2620), which has a highlight of its own and no multi-select. `clear` on an
  // empty selection returns the same set, so the mount pass and every ordinary render below cost nothing.
  useEffect(() => {
    dispatchSelection({ type: 'clear' })
    setCopies(NO_COPIES)
  }, [lens])

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
  const toggleSelection = useCallback((path: string, top?: string) => {
    dispatchSelection({ type: 'toggle', path })
    if (top !== undefined) setCopies((prev) => (prev.get(path) === top ? prev : new Map(prev).set(path, top)))
  }, [])
  const setSelection = useCallback((path: string, top?: string) => {
    dispatchSelection({ type: 'set', path })
    setCopies((prev) => (top === undefined ? NO_COPIES : prev.size === 1 && prev.get(path) === top ? prev : new Map([[path, top]])))
  }, [])
  const selection: TreeSelection = useMemo(() => ({ paths: selectedPaths, copies, toggle: toggleSelection, set: setSelection }), [selectedPaths, copies, toggleSelection, setSelection])

  return { selectedPaths, dispatchSelection, orderedSelectedPaths, selection }
}

/** How long a drag holds over a closed folder before it opens (YAZ-3251 D8). */
export const SPRING_MS = 700

/**
 * What a row drag carries (YAZ-3251 D5, Finder's rule): a selected row takes the whole selection,
 * in on-screen order (`ordered`); any other row goes alone. A row inside another row that goes is
 * left out — the folder carries it (S5) — and a row that never moves on disk (`fixed`: a vault
 * row) stays (S8). A shortcut row never starts a drag, and a click on one selects nothing, so no
 * selection holds one (YAZ-2290 D2).
 */
export function dragSet(path: string, selected: ReadonlySet<string>, ordered: () => string[], fixed: (path: string) => boolean): string[] {
  const picked = (selected.has(path) ? ordered() : [path]).filter((p) => !fixed(p))
  return picked.filter((p) => !picked.some((other) => p.startsWith(`${other}/`)))
}

/** The moves that a drop of `paths` into `dir` makes: none for an item already there (S7), nor for a folder into itself or a folder inside it (S6). */
export function movesInto(dir: string, paths: readonly string[], folders: readonly string[]): Move[] {
  return paths.flatMap((oldPath): Move[] => {
    const newPath = `${dir}/${basename(oldPath)}`
    if (newPath === oldPath || dir === oldPath || dir.startsWith(`${oldPath}/`)) return []
    return [{ oldPath, newPath, kind: folders.includes(oldPath) ? 'dir' : 'file' }]
  })
}

/** The same items, in any order: a drop of this window's own OS drag (YAZ-3254 D4), told apart by its paths. */
const sameItems = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((path) => b.includes(path))

/** The sentence a drag between vaults hears (YAZ-2602 R11), from the sidebar and from main (`fs:import`, S22) alike. */
export const BETWEEN_VAULTS = 'To move between vaults, use cut and paste'

/** The class a lit drop target wears (YAZ-3251 D2): the root header has its own. */
const dropClass = (el: HTMLElement): string => (el.classList.contains('sidebar__header') ? 'sidebar__header--drop' : 'tree__row--drop')

export function useTreeDrag(
  onRenameFile: (oldPath: string, newPath: string, kind: TreeNode['type']) => Promise<void>,
  /** A drop of two or more rows (YAZ-3250 D1): App's door for a list of moves. */
  onMoveEntries: (moves: Move[]) => Promise<void>,
  /** The list the shown tab's top rows reorder, and its writer (YAZ-2631 D3). */
  orderRef: RefObject<readonly string[]>,
  saveOrder: (next: string[]) => void,
  rootOf: (path: string) => string,
  onNotice: (message: string, kind?: NoticeKind) => void,
  /** What a drag carries (D5): the selection, in on-screen order, and its `set`. */
  selection: TreeSelection,
  orderedSelectedPaths: () => string[],
  /** Every folder of the window, so a move names its kind; and the vault rows, which never move on disk. */
  dirs: readonly string[],
  vaultRows: ReadonlyMap<string, string>,
  /**
   * The drags with Finder (YAZ-3252): a row's name for the pill (D6), the door for Finder's items
   * dropped into a folder (YAZ-3253 D3), and App's box for rows dragged out (YAZ-3254 D9B).
   */
  finder: { nameOf: (path: string) => string; onImport: (dir: string, paths: string[]) => void; onDraggedOut: (paths: string[]) => void },
) {
  // Drag-to-move (E1b; folders and the selection since YAZ-3251): the dragged paths and the lit
  // target live in REFS (D2), so a hover renders nothing — the lit row wears its class by DOM.
  // Since YAZ-3254 D4 a row drag is the OS drag: no `dragend` comes back, so the ref also clears
  // on a drop in the window and on the first pointer move after the drag (see the effect below).
  const dragging = useRef<string[]>([])
  // A drop came inside the window while a row drag was in flight (S30): no box asks after it.
  const droppedInside = useRef(false)
  const lit = useRef<{ dir: string | null; el: HTMLElement | null }>({ dir: null, el: null })
  const spring = useRef<ReturnType<typeof setTimeout> | null>(null)
  // What the callbacks read at the moment of the gesture, so the `move` they make keeps ONE identity.
  const live = useRef({ onRenameFile, onMoveEntries, rootOf, onNotice, selection, orderedSelectedPaths, dirs, vaultRows, finder })
  live.current = { onRenameFile, onMoveEntries, rootOf, onNotice, selection, orderedSelectedPaths, dirs, vaultRows, finder }
  // Drag-to-reorder (YAZ-2631 D3), ONE state for the tab that is shown: the dragged top row + the hovered row and edge.
  const [reorderDragging, setReorderDragging] = useState<string | null>(null)
  const [reorderOver, setReorderOver] = useState<{ path: string; edge: 'before' | 'after' } | null>(null)

  const fileMove: TreeFileMove = useMemo(() => {
    /**
     * The ONE place the lit target changes (D2): the old target loses its class, the new one gains
     * it, and a spring armed for the old one is cleared (D8). `open` arms a new one: a closed folder.
     */
    const light = (dir: string | null, el: HTMLElement | null, open?: () => void) => {
      const now = lit.current
      if (now.dir === dir && now.el === el) return
      now.el?.classList.remove(dropClass(now.el))
      el?.classList.add(dropClass(el))
      lit.current = { dir, el }
      if (spring.current !== null) clearTimeout(spring.current)
      spring.current = open === undefined ? null : setTimeout(() => {
        spring.current = null
        open()
      }, SPRING_MS)
    }
    /**
     * A drop lands here: never in a dragged folder, nor in a folder inside one (S6). With no row drag
     * in flight, a drag from Finder (`files`: its `types` hold `Files`) lands in any folder (YAZ-3253).
     */
    const accepts = (dir: string, files = false) => (dragging.current.length > 0 ? !dragging.current.some((path) => dir === path || dir.startsWith(`${path}/`)) : files)
    const end = () => {
      dragging.current = []
      light(null, null)
    }
    /** The moves into `dir`, through the door the context menu's rename uses for one row, and App's list door for more (YAZ-3250 D1): links follow. */
    const send = (dir: string, paths: readonly string[]) => {
      const { dirs: folders, onRenameFile: renameOne, onMoveEntries: moveAll } = live.current
      const moves = movesInto(dir, paths, folders)
      const [one] = moves
      if (moves.length === 1) void renameOne(one.oldPath, one.newPath, one.kind)
      else if (moves.length > 1) void moveAll(moves)
    }
    const drop = (dir: string) => {
      const paths = dragging.current
      const ok = accepts(dir)
      end()
      if (!ok) return
      const { rootOf: vaultOf, onNotice: say } = live.current
      // A drag moves inside ONE vault (YAZ-2602 R11): a folder, or a vault row, of a different vault refuses it (S9).
      if (paths.some((path) => vaultOf(path) !== vaultOf(dir))) return say(BETWEEN_VAULTS)
      // An item already in this folder is no move (S7).
      send(dir, paths)
    }
    return {
      isDragging: () => dragging.current.length > 0,
      accepts,
      /**
       * Where every row drag to move begins (D5), and since YAZ-3254 D4 it is the OS drag: the Tree
       * stops the page's own drag, and main starts one that Finder takes (copies). The paths stay in
       * the ref, so a drop back in this window is told apart by them (`dropFiles`).
       */
      start: (path, top) => {
        const { selection: picked, orderedSelectedPaths: ordered, vaultRows: vaults, finder: out, onNotice: say } = live.current
        const paths = dragSet(path, picked.paths, ordered, (p) => vaults.has(p))
        dragging.current = paths
        droppedInside.current = false
        // An unselected row first becomes the selection (S4), then goes alone.
        if (!picked.paths.has(path)) picked.set(path, top)
        if (paths.length === 0) return
        api.file.dragOut({ paths, icon: dragPill(pillLabel(paths.map(out.nameOf))) }).catch((err: unknown) => {
          // No OS drag started: nothing is in flight.
          if (dragging.current === paths) end()
          say(`Can't drag: ${err instanceof Error ? err.message : String(err)}`, 'error')
        })
      },
      end,
      hover: light,
      leave: (dir) => {
        if (lit.current.dir === dir) light(null, null)
      },
      drop,
      /**
       * Files dropped on a folder (YAZ-3253 D3). This window's own drag comes back as files (YAZ-3254
       * D4): the same paths are a move in the app. Items all of the target's vault came from a second
       * window of it: App's door, so links follow (S23). Anything else is Finder's: `fs:import` (S17).
       */
      dropFiles: (dir, files) => {
        const paths = files.map((file) => api.file.pathFor(file)).filter((path) => path !== '')
        if (dragging.current.length > 0 && sameItems(dragging.current, paths)) return drop(dir)
        end()
        if (paths.length === 0) return
        const { rootOf: vaultOf, finder: out } = live.current
        const vault = vaultOf(dir)
        if (paths.every((path) => path.startsWith(`${vault}/`))) return send(dir, paths)
        out.onImport(dir, paths)
      },
    }
  }, [])
  // A spring left armed when the panel goes would open a folder of a tree that is gone.
  useEffect(
    () => () => {
      if (spring.current !== null) clearTimeout(spring.current)
    },
    [],
  )
  /**
   * After the OS drag (YAZ-3254 D4) no `dragend` comes back. A drop inside the window is marked in the
   * CAPTURE phase, so a drop a handler stops still counts (S30), and the drag clears once the drop's
   * targets ran. The first pointer move with no button down is the drag's end: the moves before the
   * OS drag takes over still hold the button. With the drag still set and no drop inside, it ended
   * outside the window, and App's box asks (D9B, S26). A cancelled drag looks the same (S29).
   */
  useEffect(() => {
    const marked = () => {
      if (dragging.current.length > 0) droppedInside.current = true
    }
    const dropped = () => {
      if (dragging.current.length > 0) fileMove.end()
    }
    const moved = (e: MouseEvent) => {
      if (e.buttons !== 0 || dragging.current.length === 0) return
      const paths = dragging.current
      const outside = !droppedInside.current
      fileMove.end()
      if (outside) live.current.finder.onDraggedOut(paths)
    }
    window.addEventListener('drop', marked, true)
    window.addEventListener('drop', dropped)
    window.addEventListener('mousemove', moved)
    return () => {
      window.removeEventListener('drop', marked, true)
      window.removeEventListener('drop', dropped)
      window.removeEventListener('mousemove', moved)
    }
  }, [fileMove])

  const dropReorder = useCallback(() => {
    const from = reorderDragging
    const over = reorderOver
    setReorderDragging(null)
    setReorderOver(null)
    if (from === null || over === null || over.path === from) return
    if (!orderRef.current.includes(from)) return // not a row of the shown tab's list (YAZ-2631 R24): nothing is written
    const without = orderRef.current.filter((p) => p !== from)
    const i = without.indexOf(over.path)
    if (i < 0) return
    const at = over.edge === 'before' ? i : i + 1
    if (orderRef.current[at] === from) return // the row already stands there: nothing is written
    saveOrder([...without.slice(0, at), from, ...without.slice(at)])
  }, [reorderDragging, reorderOver, orderRef, saveOrder])

  const reorder: TreeReorder = useMemo(
    () => ({
      dragging: reorderDragging,
      over: reorderOver,
      start: setReorderDragging,
      hover: (path, edge) => setReorderOver((prev) => (prev?.path === path && prev.edge === edge ? prev : { path, edge })),
      drop: dropReorder,
      end: () => {
        setReorderDragging(null)
        setReorderOver(null)
      },
    }),
    [reorderDragging, reorderOver, dropReorder],
  )

  return { fileMove, reorder }
}

export function useFileClipboard(
  /** The first vault's root: where ⌘V pastes with no selection, in a window with one vault. */
  root: string,
  /** The vault that holds a path (YAZ-2602): a paste is judged by the vault it lands in. */
  vaultOf: (path: string) => SidebarVault,
  /** The vault rows' paths; empty with one vault. */
  vaultRows: ReadonlyMap<string, string>,
  menu: MenuTargets | null,
  selection: TreeSelection,
  orderedSelectedPaths: () => string[],
  dirs: string[],
  refresh: (root: string) => void,
  openTo: (file: string, top?: string) => void,
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
  const [pendingPaste, setPendingPaste] = useState<{ dir: string; top?: string; moves: Move[]; lost: LeftBehind; copy: boolean } | null>(null)
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
    // `top`: the copy of Focus or Favorites the paste came from (YAZ-3131 S21), which opens the folder there too.
    async (dir: string, top?: string) => {
      const { root: vault, index } = vaultOf(dir)
      try {
        const before = clip?.op === 'cut' ? { records: index.records, folders: index.folders } : null
        const res = await api.file.paste({ targetDir: dir })
        openTo(`${dir}/x`, top)
        refresh(vault)
        if (before !== null) for (const { from, to, kind } of res.pasted) await dropFolderValuesAfterMove({ root: vault, oldPath: from, newPath: to, kind, ...before })
        else if (index.ids) {
          const [{ tree }, { folders }] = await Promise.all([fetchTree(vault), api.index(vault)])
          for (const { to } of res.pasted) for (const path of notesAt(tree, to)) await transformFile(path, dropStaleFolderValues(vault, path, folders), true).catch(() => undefined) // quiet (YAZ-3235 D1)
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
    (dir: string, top?: string) => {
      if (clip !== null) {
        const moves = clip.paths.flatMap((oldPath): Move[] => {
          const newPath = `${dir}/${basename(oldPath)}`
          return newPath === oldPath ? [] : [{ oldPath, newPath, kind: dirs.includes(oldPath) ? 'dir' : 'file' }]
        })
        const { root: vault, index } = vaultOf(dir)
        const lost = valuesLeftBehind({ root: vault, moves, records: index.records, folders: index.folders })
        if (lost.folders.length > 0) return setPendingPaste({ dir, top, moves, lost, copy: clip.op === 'copy' })
      }
      void runPaste(dir, top)
    },
    [vaultOf, clip, dirs, runPaste],
  )

  /** The sheet's Move or Copy: the paste runs as it does unasked. Its Cancel only closes it — the clipboard stays as it was. */
  const confirmPaste = useCallback(() => {
    if (pendingPaste === null) return
    setPendingPaste(null)
    void runPaste(pendingPaste.dir, pendingPaste.top)
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
        if (menu !== null || selection.paths.size === 0 || [...selection.paths].some((path) => vaultRows.has(path))) return false
        clipTo(orderedSelectedPaths(), op)
        return true
      },
      paste: () => {
        if (menu !== null || clip === null) return false
        const dir = pasteTargetDir()
        if (dir === null) onNotice('Select a vault or a folder first')
        // The copy of the first selected row (YAZ-3131 S21): the folder opens in that copy too.
        else pasteInto(dir, selection.copies?.get(orderedSelectedPaths()[0] ?? ''))
        return true
      },
    }
    return () => {
      clipboardRef.current = null
    }
  }, [clipboardRef, menu, selection, vaultRows, clip, clipTo, orderedSelectedPaths, pasteInto, pasteTargetDir, onNotice])

  /**
   * Finder's items dropped into `dir` (YAZ-3253 D3, D9A): `fs:import` moves them in, or copies them
   * from another disk; the app clipboard is not touched. Then the paste's own steps: the folder
   * opens, the tree reads again (the watcher's echo is a courtesy), and ONE notice counts what
   * landed and names the first item that did not (S19). An item of another open vault says the rule
   * of drags between vaults (S22). Items that come from outside every vault left no folder of it,
   * so no values are cleared (D20). Copies are not moves: only `moved` is for undo (YAZ-3255).
   */
  const importFiles = useCallback(
    async (dir: string, paths: string[]) => {
      const { root: vault } = vaultOf(dir)
      try {
        const { moved, copied, failed } = await api.file.import({ paths, targetDir: dir })
        if (moved.length + copied.length > 0) {
          openTo(`${dir}/x`)
          refresh(vault)
        }
        const done =
          copied.length === 0 ? `Moved ${countItems(moved.length)} from Finder`
          : moved.length === 0 ? `Copied ${countItems(copied.length)} from another disk`
          : `Moved ${countItems(moved.length)}, copied ${copied.length} from another disk`
        const [first] = failed
        if (first === undefined) {
          // Every item hidden (S20): nothing landed, and nothing to say.
          if (moved.length + copied.length > 0) onNotice(done, 'paste')
        } else if (moved.length + copied.length === 0) {
          if (failed.every((f) => f.message === BETWEEN_VAULTS)) onNotice(BETWEEN_VAULTS, 'info')
          else onNotice(`Couldn't move: ${basename(first.from)} — ${first.message}`, 'error')
        } else onNotice(`${done}, skipped ${failed.length}: ${basename(first.from)} — ${first.message}`, 'paste')
      } catch (err: unknown) {
        onNotice(`Can't move: ${err instanceof Error ? err.message : String(err)}`, 'error')
      }
    },
    [vaultOf, refresh, openTo, onNotice],
  )

  return { clip, clipTo, pasteInto, pendingPaste, confirmPaste, cancelPaste: () => setPendingPaste(null), importFiles }
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
  openTo: (file: string, top?: string) => void,
) {
  const [creating, setCreating] = useState<{ kind: EntryKind; seed: string; parentDir: string; top: string | null } | null>(null)
  const [renamingEntry, setRenamingEntry] = useState<{ path: string; kind: 'file' | 'dir'; top: string | null } | null>(null)

  const startCreate = useCallback(
    (kind: EntryKind, seed = '') => {
      if (menu === null || menu.targetDir === null) return
      // Favorites and Focus each show a SUBSET of the vault (YAZ-1766 3B1, YAZ-2619 S36): a target dir
      // the tab does not hold — or the root on a tab with no rows — would give the input nowhere to
      // mount, so the create moves to Files, where the `openTo` below opens that dir.
      // A FOLDER made at the root goes there too: it is no item of the list, so the tab would never
      // show it. A note made there opens as a tab, so it stays (YAZ-2619 R18, YAZ-2845 D2).
      // The reveal hop's rule (D10), applied to the other gesture that needs a row. With two or more
      // vaults a vault's root is held only as its row (YAZ-2602), and neither tab has that row (YAZ-2631 D1).
      const shown = menu.lens === 'favorites' ? favoriteNodes : menu.lens === 'focus' ? focusNodes : null
      const toFiles = shown !== null && (menu.targetDir === root ? shown.length === 0 || kind === 'dir' : findDirNode(shown, menu.targetDir) === null)
      // The input renders inside the target dir's children, so that dir must be open — and its
      // vault's row with it; `openTo` opens every dir ABOVE the given path, so a synthetic child opens targetDir itself.
      // In a copy of Focus or Favorites it opens there too, and in that copy alone (YAZ-3131 S20).
      openTo(`${menu.targetDir}/x`, shown === null || toFiles ? undefined : (menu.top ?? undefined))
      if (toFiles) onLensChange('files')
      // The copy this tab's row stands under means nothing in Files, which draws each row once (YAZ-2845 D1).
      setCreating({ kind, seed, parentDir: menu.targetDir, top: toFiles ? null : menu.top })
      setMenu(null)
    },
    [menu, root, favoriteNodes, focusNodes, onLensChange, openTo],
  )

  const submitCreate = useCallback(
    async (name: string) => {
      if (creating === null) return
      const { root: vault, index } = vaultOf(creating.parentDir)
      // A board needs no index: it has no title and no ID (YAZ-3028 D9).
      if (creating.kind === 'drawing' || creating.kind === 'diagram') {
        const board = await createBoardFile(vault, creating.parentDir, name, creating.kind, creating.seed)
        setCreating(null)
        refresh(vault)
        onOpenFile(board)
        return
      }
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
    () => (renamingEntry === null ? null : { path: renamingEntry.path, top: renamingEntry.top, title: vaultOf(renamingEntry.path).index.ids, onSubmit: submitRename, onCancel: () => setRenamingEntry(null) }),
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
            top: creating.top,
            onSubmit: submitCreate,
            onCancel: cancelCreate,
          },
    [creating, submitCreate, cancelCreate],
  )

  return { setRenamingEntry, startCreate, renaming, pending }
}
