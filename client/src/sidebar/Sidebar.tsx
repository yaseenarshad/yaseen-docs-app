import { useCallback, useEffect, useRef, useState, type Ref } from 'react'
import { SIDEBAR_LENSES, type SettingsState, type SidebarLens, type TreeNode, type TreeResponse } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { ChevronsIcon, EyeIcon, HeartIcon, SearchIcon, SidebarPanelIcon } from '../views/view/icons'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { WatchSource } from '../hooks/useWatch'
import { focusOpenDocument } from '../lib/focusHandoff'
import { pageName, usePathTitles } from '../lib/pageLabel'
import { relTo } from '../lib/paths'
import { countLinkReferences } from '../links/renameLinks'
import { addShortcut, removeShortcut, valuesLeftByShortcut, type LeftBehind } from '../links/shortcuts'
import { ancestorDirs, findDirNode, treeHasFile } from '../lib/treeState'
import { SearchResults } from '../search/SearchResults'
import type { SearchCandidate } from '../search/searchCandidates'
import { ConfirmDelete, type DeleteTarget } from './ConfirmDelete'
import { ConfirmMove } from './ConfirmMove'
import { ContextMenu } from './ContextMenu'
import { folderCounts } from './folderCounts'
import { datedSeed, targetDirFor, type MenuRow } from './createEntry'
import { SettingsButton } from '../settings/SettingsButton'
import { buildMenuSections } from './menuSections'
import { ShortcutPicker } from './ShortcutPicker'
import type { NoticeKind } from '../lib/notice'
import { Tree, type TreeFileMove } from './Tree'
import { VaultSwitcher } from './VaultSwitcher'
import { useSidebarSearch } from './hooks/useSidebarSearch'
import { useVaultTree } from './hooks/useVaultTree'
import { useFileClipboard, useInlineEdits, useSelection, useTreeDrag } from './hooks/rowGestures'
import { flashTreeRows, revealMissingMessage, type SidebarRevealRequest } from './revealRow'

interface SidebarProps {
  root: string
  /** The width in px (YAZ-738), set on this aside alone (YAZ-2194). */
  width: number
  /** This aside, for App's resize drag, which writes the live width to it between renders (YAZ-2239). */
  asideRef?: Ref<HTMLElement>
  activeFile: string | null
  watch: WatchSource
  onOpenFile: (path: string) => void
  /** ⌘-click on a file row (I3 LOCKED ruling, GRO-2235): open in a background tab; App passes the workspace's openBackground. */
  onOpenFileBackground: (path: string) => void
  /**
   * A search row's menu item that draws into the tree was chosen (🔒 D2, YAZ-2050): App flips the
   * lens to Files and issues the same reveal request the tab menu uses, so the row unfolds and
   * flashes below — whichever lens was showing.
   */
  onRevealInFiles: (path: string) => void
  /** "Open folder…" — the last row of the header's vault switcher (YAZ-1767 D4) — runs App's picker; the picked vault opens beside (YAZ-1914). */
  onPickFolder: () => void
  /** True while the native folder dialog is open; the switcher's "Open folder…" row is disabled meanwhile. */
  pickDisabled: boolean
  /**
   * ⌘O (YAZ-1767 D8): App's request counter for the vault switcher, threaded straight to the
   * header's `VaultSwitcher`, which opens its panel and focuses the filter on every new value.
   * 0 = nothing requested (App pins a request to the root it was made on, so a remount on
   * another vault never replays it).
   */
  switcherOpenRequest: number
  /** The vault menu's "Open in this window" (YAZ-1798 D8): App's in-place switch, threaded to the `VaultSwitcher`. */
  onOpenVaultHere: (path: string) => Promise<boolean>
  /** Hide the sidebar (GRO-2023); TabBar leads its nav row with the Show-sidebar button while hidden (YAZ-1759). */
  onCollapse: () => void
  /**
   * Which lens the tabs row shows (🔒 D4, YAZ-847). App-owned and persisted as window identity
   * (`WindowEntry.sidebarLens`, per window since YAZ-1628), never Sidebar-local: this component
   * is mounted `key={root}` and only while the sidebar is open, so local state would forget the
   * choice on every collapse/reopen and every root switch.
   */
  lens: SidebarLens
  /** A lens tab was clicked; App writes it through to the window identity and passes the new value back down. */
  onLensChange: (lens: SidebarLens) => void
  /** One reveal in Files; a request that arrives on another lens is dropped. */
  revealRequest: SidebarRevealRequest | null
  /** The request has been accepted into Sidebar-local work and must not replay after a remount. */
  onRevealConsumed: (id: number) => void
  /**
   * The settings (GRO-2024); App owns and applies them. The sidebar no longer edits them (the
   * dialog does, YAZ-1679) but still READS `confirmDelete` and writes it back through the
   * delete sheet's "Don't ask me again" (GRO-2272).
   */
  settings: SettingsState
  onChangeSettings: (next: SettingsState) => void
  /** The footer cog: App mounts the settings dialog, so the cog only asks for it (YAZ-1679). */
  onOpenSettings: () => void
  /** The stored root could not be read (e.g. deleted); parent decides what to do. */
  onRootMissing: () => void
  /** The restored last file is not in the tree any more (checked once per root). */
  onFileMissing: () => void
  /**
   * Context-menu "Rename" committed (files E1 GRO-2194, folders E1b GRO-2241) — and the
   * drag-a-file-onto-a-folder move (E1b) lands here too, as a plain old→new rename: App
   * orchestrates flush → index/tree snapshots → `fs:rename` → link rewrites, and routes ANY
   * failure to the passive notice — this promise never rejects, so the inline input just
   * closes.
   */
  onRenameFile: (oldPath: string, newPath: string, kind: TreeNode['type']) => Promise<void>
  /** A title edit (YAZ-2420 🔒 D16), to the same door: the inline rename of a note or a folder. */
  onRetitle: (path: string, title: string, kind: TreeNode['type']) => Promise<void>
  /**
   * Context-menu "Delete" confirmed (GRO-2272): App moves the entry to the system Trash and
   * routes ANY failure to the passive notice — this promise never rejects, so the sheet just
   * closes. No link rewriting happens downstream (LOCKED decision C).
   */
  onDeleteFile: (path: string) => Promise<void>
  /** Show a transient, unobtrusive message — never a dialog (E1, GRO-2171). App owns the banner. */
  onNotice: (message: string, kind?: NoticeKind) => void
  /**
   * The window's index snapshot, for the folder rows' note counts (🔒 E6, YAZ-2290): the SAME
   * object `WikilinkIndexBridge` already feeds — App's one per-window index source — read, never
   * written, and no second feed. `records` is `[]` until the first index lands, so no row shows a
   * number before then.
   */
  indexSource: WikilinkResolveSource
  /**
   * ⌘K asked for the search bar (YAZ-801): the bar focuses its input. True at MOUNT is the
   * ⌘K-while-collapsed path (App un-collapses, so the sidebar mounts with it already set), not an
   * edge case. Nothing sets it true yet — YAZ-804 wires the shortcut.
   */
  pendingSearchFocus: boolean
  /** The focus above happened (YAZ-801); App clears its flag so the next ⌘K is a fresh request. */
  onSearchFocusHandled: () => void
  /**
   * ⌘⇧C's read-only window onto the multi-selection (🔒 D4, YAZ-1338). The state stays HERE
   * (🔒 D1) — it is per root and dies with the panel — but the CHORD is App's: this component is
   * unmounted while the sidebar is collapsed, and a shortcut that stops existing when a panel is
   * hidden is not a window shortcut. So the Sidebar writes its current selection into this box on
   * every render and empties it on unmount, and App only ever reads it — a ref, not state,
   * precisely so keeping App able to answer costs this tree no render at all.
   */
  selectionRef: { current: ReadonlySet<string> }
  /**
   * The file clipboard's two verbs for App's ⌘C / ⌘X / ⌘V listener (D6 amended, YAZ-1674) —
   * `selectionRef`'s idiom, the other way round: App owns the LISTENER (the same reason as ⌘⇧C:
   * focus after a click may sit in the editor or nowhere focusable, so a panel listener never
   * heard the key) and this component owns the RULES, behind a handle rewritten whenever a rule
   * input changes and emptied on unmount. Each verb answers whether it acted, so App knows what to swallow.
   */
  clipboardRef: { current: SidebarClipboard | null }
  /** Whether the vault has upkeep review on (YAZ-2322 🔒 D7): off, there is no Inbox row and no "Review this folder". */
  upkeep: boolean
  /**
   * The Inbox row (YAZ-2322): how many notes are due, and whether a review is open. App counts
   * and owns the session — this component is unmounted while collapsed, and the count has to be
   * right the moment it comes back.
   */
  dueCount: number
  reviewing: boolean
  onOpenInbox: () => void
  /** The folder row's "Review this folder" (YAZ-2322): App starts a review of what is due inside it. */
  onReviewFolder: (dirPath: string) => void
  /**
   * The note row's review toggle (YAZ-2322): whether a path is in review — null for anything
   * that is not a note in the index — and the write. Both App's: the sidebar has no index.
   */
  reviewState: (path: string) => boolean | null
  onSetReview: (path: string, on: boolean) => void
}

/** What App's ⌘C / ⌘X / ⌘V listener may ask of the mounted sidebar (D6 amended, YAZ-1674); each answers whether it acted. */
export interface SidebarClipboard {
  cutOrCopy: (op: 'copy' | 'cut') => boolean
  paste: () => boolean
}

/**
 * What the open context menu targets (GRO-2296). Every item has its OWN field: no item
 * derives its target — or its visibility — from another item's value.
 *
 * This split exists because the items are about to diverge. `copyPath` gains a blank-space
 * fallback to the vault ROOT (GRO-2273) and `revealPath` will want the same (GRO-2274),
 * while `renamePath` must NOT: main refuses to rename a window's own vault root
 * (`BAD_REQUEST`, E1b GRO-2241), so offering it would be an item that can only ever fail.
 * Before the split, `renamePath` was literally `menu.copyPath` and the two would have moved
 * together silently.
 */
export interface MenuTargets {
  x: number
  y: number
  /** Where "New …" creates: a dir row → itself, a file row → its parent, blank space → the root. */
  targetDir: string
  /** The right-clicked row's kind; null for blank space. Drives the Rename input's mode. */
  rowKind: 'file' | 'dir' | null
  /** "Copy path" — the right-clicked row (file or folder), or the vault ROOT for blank space (GRO-2273). */
  copyPath: string | null
  /**
   * "Open" — a FOLDER row outside a plural selection (YAZ-2290 D3): the folder opens as the current
   * tab. Null on a file row (its click opens it), on blank space, and inside a 2+ selection, where
   * "Open N in new tabs" is the item. Its OWN field.
   */
  openPath: string | null
  /**
   * "Copy N paths" — the MULTI-SELECT target (🔒 D5, YAZ-1337): the WHOLE selection, ordered by
   * the panel (on-screen rows first, hidden ones after — `orderedSelection`, ⚡ YAZ-1338), or null
   * when there is no plural gesture to offer (a right-click outside the selection, on blank
   * space, or on a selection of one — where the singular items already ARE this menu).
   *
   * Its OWN field per this split's whole point, and emphatically NOT `copyPath` in a list: that
   * one falls back to the vault ROOT on blank space, which is precisely a target this item must
   * never have — "Copy 1 paths" over the root is an item that means nothing. The two are free to
   * diverge again (a selection may one day hold folders, which the singular item already allows).
   */
  copyPaths: string[] | null
  /**
   * "Open N in new tabs" — the same multi-select target asked SEPARATELY (🔒 D5, YAZ-1337), and
   * `newWindowPath`'s plural sibling in spirit only: that one opens ONE file in a whole new
   * window (D2, GRO-2168), this one appends N background tabs to THIS window (I3's opener,
   * GRO-2235). Equal today, independent by construction — the doctrine above is exactly about
   * fields that happen to agree.
   */
  openTabPaths: string[] | null
  /**
   * "Cut" / "Copy" — the file-clipboard target (🔒 D5, YAZ-1674): the ORDERED 2+ selection when the
   * right-clicked row is in one (`copyPaths`' plural rule — labels "Cut 3 items"), else the one
   * row, file or dir; null on blank space, which has nothing to clip. Its OWN field, per this
   * split's doctrine: `copyPaths` is null outside a plural gesture and `copyPath` falls back to
   * the vault root, and neither is what a Cut may name.
   */
  clipPaths: string[] | null
  /** "Open in new window" — FILE rows only (D2, GRO-2168). */
  newWindowPath: string | null
  /** "Rename" — a concrete row only, NEVER blank space: the vault root is not renameable (E1b, GRO-2241). */
  renamePath: string | null
  /** "Delete" — a concrete row only, NEVER blank space: there is no target, and main refuses the vault root (GRO-2272). */
  deletePath: string | null
  /** "Reveal in Finder" — the row, or the vault ROOT for blank space (GRO-2274); same target as `copyPath`. */
  revealPath: string | null
  /** "Open in VS Code" — the same target rule again (YAZ-963); its OWN field, per this split's whole point. */
  openVsCodePath: string | null
  /** "Open in default app" — the same target rule a third time (YAZ-1577); its OWN field, same doctrine. */
  openDefaultPath: string | null
  /**
   * "Focus on folder" / "Focus on N folders" (YAZ-1605): the DIRS the active lens narrows to.
   * Inside a 2+ selection that holds the right-clicked
   * row it is the selection's eligible rows, in panel order — `copyPaths`' plural rule, counting
   * only what can be focused. Otherwise the one row, or null
   * on file rows and blank space. Its OWN field, per this split's doctrine.
   */
  focusPaths: string[] | null
  /**
   * "Add to favorites" / "Remove from favorites" (YAZ-1766 D3): the row, or the ordered 2+
   * selection holding it — files and folders alike, every lens; null on blank space. Its OWN field.
   */
  favoritePaths: string[] | null
  /** True only when EVERY `favoritePaths` entry is already a favorite — a mixed selection reads as Add. */
  favoriteIsOn: boolean
  /** "Review this folder" (YAZ-2322) — FOLDER rows only: a review is of the notes inside one. */
  reviewDir: string | null
  /** "Turn review off" / "Turn review on" (YAZ-2322) — a NOTE row only; null for every other row and blank space. */
  reviewPath: string | null
  /** That note's state when the menu opened; picks the label. */
  reviewIsOn: boolean
  /**
   * "Add note shortcut" — a FOLDER row outside a plural selection (YAZ-2290 D2): the folder the
   * picked note will also appear in. Null on a file row, on blank space and inside a 2+
   * selection. Equal to `openPath` today; its OWN field, per this split's doctrine.
   */
  shortcutDir: string | null
  /**
   * "Remove shortcut" — a SHORTCUT row only (YAZ-2290 E5): the note and the folder it stands in.
   * Such a row has no `deletePath` (it is deleted from where it lives), no `renamePath` (the inline
   * input is the real row's) and no `clipPaths` (it is not a file in this folder), whatever the
   * selection holds.
   */
  removeShortcut: { path: string; dir: string } | null
  /**
   * The lens the items act in (🔒 D1, YAZ-2050): the active one, or FILES for a search row — a search
   * row is a disk row, whichever tab sits under the query. Every lens rule in the menu path reads this.
   */
  lens: SidebarLens
  /**
   * A search row's path (🔒 D2, YAZ-2050), null for every tree row and blank space: the items that
   * draw INTO the tree (an inline input, Focus) reveal it in Files first, since the tree is hidden.
   */
  leaveSearchTo: string | null
}

/**
 * Notes and subfolders inside `dir`, counted RECURSIVELY from the already-loaded tree
 * (GRO-2272 `C3-`) — a delete takes the whole subtree, so a shallow count would understate
 * what the user is about to lose. No fetch: the sidebar already holds this tree.
 */
export function countChildren(nodes: readonly TreeNode[], dir: string): { notes: number; folders: number } {
  const found = findDirNode(nodes, dir)
  if (found?.type !== 'dir') return { notes: 0, folders: 0 }
  let notes = 0
  let folders = 0
  const walk = (children: readonly TreeNode[]): void => {
    for (const child of children) {
      if (child.type === 'dir') {
        folders++
        walk(child.children)
      } else notes++
    }
  }
  walk(found.children)
  return { notes, folders }
}

/**
 * The rows a "Focus on …" may narrow to, out of the right-clicked row or its 2+ selection (YAZ-1605):
 * Files — and Favorites (YAZ-1766 D5), the same disk reading — keeps DIRS (a shift-selection may hold files — they are simply not focusable).
 * Null, not `[]`, hides the item.
 */
function focusable(paths: readonly string[], tree: TreeResponse | null): string[] | null {
  const kept = paths.filter((p) => tree !== null && findDirNode(tree.tree, p) !== null)
  return kept.length > 0 ? kept : null
}

/** "Focus on folder" / "Focus on 3 folders" — the plural items' own labelling rule (YAZ-1337). */
function focusLabel(count: number): string {
  return count > 1 ? `Focus on ${count} folders` : 'Focus on folder'
}

/** The lens tabs' copy; the ORDER is `SIDEBAR_LENSES`', so the default lens leads (YAZ-847). */
const LENS_LABEL: Record<SidebarLens, string> = { files: 'Files', favorites: 'Favorites' }

/** Which note is a shortcut where, as one comparable string: all a shortcut row draws is its path. */
const shortcutStamp = (shortcuts: ReadonlyMap<string, readonly TreeNode[]>): string => JSON.stringify([...shortcuts].map(([dir, rows]) => [dir, rows.map((row) => row.path)]))

/** The Favorites tree's file move (YAZ-1766 D4): nothing on that tab drags to disk, so every callback is a no-op. */
const INERT_MOVE: TreeFileMove = { dragging: null, dropDir: null, start: () => undefined, end: () => undefined, hover: () => undefined, drop: () => undefined }

/** Mounted with `key={root}` by App, so all state below is per root. */
export function Sidebar({
  root,
  activeFile,
  watch,
  onOpenFile,
  onOpenFileBackground,
  onRevealInFiles,
  onPickFolder,
  pickDisabled,
  switcherOpenRequest,
  onOpenVaultHere,
  onCollapse,
  lens,
  onLensChange,
  revealRequest,
  onRevealConsumed,
  settings,
  onChangeSettings,
  onOpenSettings,
  onRootMissing,
  onFileMissing,
  onRenameFile,
  onRetitle,
  onDeleteFile,
  onNotice,
  indexSource,
  pendingSearchFocus,
  onSearchFocusHandled,
  selectionRef,
  clipboardRef,
  upkeep,
  dueCount,
  reviewing,
  onOpenInbox,
  onReviewFolder,
  reviewState,
  onSetReview,
  width,
  asideRef,
}: SidebarProps) {
  const { tree, error, refresh, expanded, dispatch, expandedSet, toggleDir, focusDirs, setFocusDirs, focusFavorites, focusNodes, focused, focusOn, exitFocus, favorites, favoritesRef, saveFavorites, toggleFavorite, dirs, shownDirs, favoriteNodes, favoriteDirs } = useVaultTree(root, watch, activeFile, lens, onRootMissing, onFileMissing, onNotice)
  const [menu, setMenu] = useState<MenuTargets | null>(null)
  // The delete confirm sheet's target (GRO-2272 `C3-`); null when the sheet is closed.
  const [confirmingDelete, setConfirmingDelete] = useState<DeleteTarget | null>(null)
  // The "Remove shortcut" that would clear values, waiting on its sheet (D21); null when it is closed.
  const [confirmingShortcut, setConfirmingShortcut] = useState<{ path: string; dir: string; lost: LeftBehind } | null>(null)
  // The folder "Add note shortcut" is picking a note for (YAZ-2290 D2); null when the picker is closed.
  const [pickingShortcut, setPickingShortcut] = useState<string | null>(null)
  const seenRevealId = useRef<number | null>(null)
  const handledFilesRevealId = useRef<number | null>(null)
  const [pendingReveal, setPendingReveal] = useState<SidebarRevealRequest | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // The folder rows' counts (🔒 E6) and shortcut rows (YAZ-2290 D2), rebuilt once per index snapshot.
  // A snapshot that moved no count keeps the Map it had, and one that moved no shortcut keeps that
  // Map, so a save elsewhere in the vault re-renders no tree level (YAZ-2194).
  const [{ counts, shortcuts }, setShown] = useState(() => folderCounts(root, indexSource.records, indexSource.folders))
  useEffect(() => {
    const read = () =>
      setShown((prev) => {
        const next = folderCounts(root, indexSource.records, indexSource.folders)
        const sameCounts = next.counts.size === prev.counts.size && [...next.counts].every(([dir, n]) => prev.counts.get(dir) === n)
        const sameShortcuts = shortcutStamp(next.shortcuts) === shortcutStamp(prev.shortcuts)
        return sameCounts && sameShortcuts ? prev : { counts: sameCounts ? prev.counts : next.counts, shortcuts: sameShortcuts ? prev.shortcuts : next.shortcuts }
      })
    read()
    return indexSource.subscribe(read)
  }, [root, indexSource])
  // The rows' labels (YAZ-2420 🔒 D15), by the same rule: a snapshot that changed no title keeps its Map.
  const titles = usePathTitles(indexSource)
  /** A path as the notices name it: its title (YAZ-2420 🔒 D14). */
  const nameOf = useCallback((path: string) => pageName(root, path, titles), [root, titles])

  // What the chevrons button unfolds on the active lens.
  const bodyDirs = lens === 'favorites' ? favoriteDirs : shownDirs
  // One activation rule for keyboard AND click, and for a folder as for a note: the row's page
  // opens as a tab. The tree rows' rule (YAZ-961): the first Enter PREVIEWS — focus stays in the
  // bar, so ↑/↓ carry on — and a second on the page already open is the deliberate "take me in".
  const activate = (hit: SearchCandidate, background: boolean) => {
    if (background) onOpenFileBackground(hit.path)
    else if (hit.path === activeFile) focusOpenDocument()
    else onOpenFile(hit.path)
  }
  const { setQuery, searchInput, query, results, searching, sel, setSelected, changeQuery, searchKeyDown } = useSidebarSearch(root, watch, dirs, pendingSearchFocus, onSearchFocusHandled, activate)

  useEffect(() => {
    if (revealRequest === null || seenRevealId.current === revealRequest.id) return
    seenRevealId.current = revealRequest.id
    onRevealConsumed(revealRequest.id)
    if (lens !== 'files') {
      setPendingReveal(null)
      return
    }
    setQuery('')
    setPendingReveal(revealRequest)
  }, [lens, onRevealConsumed, revealRequest])

  useEffect(() => {
    if (pendingReveal !== null && lens !== 'files') setPendingReveal(null)
  }, [lens, pendingReveal])

  // Expand / collapse the whole tree (⚡ YAZ-862). "Any open" is
  // measured against what the CURRENT tree can actually unfold (`dirs`, above), never the raw
  // persisted list, which would leave the button offering to collapse nothing.
  const anyExpanded = bodyDirs.some((d) => expanded.includes(d))
  const allLabel = anyExpanded ? 'Collapse all' : 'Expand all'

  const { selectedPaths, dispatchSelection, orderedSelectedPaths, selection } = useSelection(lens, searching, tree, selectionRef, bodyRef)

  // A Files reveal targets a file — or, from a folder search row's menu (YAZ-2050), a DIR of the
  // tree. Both questions are asked once here and read by the two steps below.
  const revealIsDir = pendingReveal !== null && dirs.includes(pendingReveal.path)
  const revealTargetPresent = tree !== null && pendingReveal !== null && (revealIsDir || treeHasFile(tree.tree, pendingReveal.path))

  useEffect(() => {
    if (tree === null || pendingReveal === null || handledFilesRevealId.current === pendingReveal.id) return
    handledFilesRevealId.current = pendingReveal.id
    if (!revealTargetPresent) {
      onNotice(revealMissingMessage(nameOf(pendingReveal.path)), 'error')
      return
    }
    // A reveal is "show me THIS" (YAZ-1605): a target outside every focused folder ends the focus first.
    if (focusDirs.length > 0 && !focusDirs.some((dir) => pendingReveal.path === dir || pendingReveal.path.startsWith(`${dir}/`))) setFocusDirs([])
    // A folder opens ITSELF too — the synthetic-child idiom the create menu already uses.
    dispatch({ type: 'expandTo', root, file: revealIsDir ? `${pendingReveal.path}/x` : pendingReveal.path })
  }, [focusDirs, nameOf, onNotice, pendingReveal, revealIsDir, revealTargetPresent, root, tree])

  const filesRevealReady = revealTargetPresent && ancestorDirs(root, pendingReveal.path).every((dir) => expanded.includes(dir))

  useEffect(() => {
    if (!filesRevealReady || pendingReveal === null || bodyRef.current === null) return
    return flashTreeRows(bodyRef.current, pendingReveal.path) ?? undefined
  }, [filesRevealReady, pendingReveal])

  // ---- New note / new folder (GRO-2022): right-click menu → inline name input ----

  const openMenu = useCallback(
    (node: MenuRow | null, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const filePath = node?.type === 'file' ? node.path : null
      // A right-click on a row the selection does NOT hold is a fresh target, so the selection
      // becomes THAT row (D9, YAZ-1674 — the Finder rule; it used to merely clear), which keeps
      // the plural items honest: whatever they name is what the user can still see highlighted.
      // BLANK SPACE is not a row and never touches it (YAZ-1337): its menu is about the vault
      // root, and a right-click into the empty space below the tree must not throw a selection away.
      // Nor is a SHORTCUT row a pick (YAZ-2290 D2): the selection is what ⌘C / ⌘X act on.
      if (node !== null && node.shortcutIn === undefined && !selectedPaths.has(node.path)) dispatchSelection({ type: 'set', path: node.path })
      // The plural gesture exists only when the right-clicked row — file or folder (YAZ-1578) — is
      // ITSELF in a selection of two or more (🔒 D5): a selection of one already IS the singular
      // menu, and a row outside the selection just ended it above. Read once, here, like every
      // other target this menu pins.
      const plural = node !== null && selectedPaths.has(node.path) && selectedPaths.size >= 2 ? orderedSelectedPaths() : null
      // App's answer for the row (YAZ-2322), asked ONCE here like every other target this menu pins.
      const inReview = filePath === null ? null : reviewState(filePath)
      // Only a search ROW opens a menu while searching (blank space there offers none), so `searching` names the origin.
      const menuLens: SidebarLens = searching ? 'files' : lens
      // A shortcut row (YAZ-2290 E5): `node.path` is the note where it LIVES, this the folder the row stands in.
      const shortcutIn = node?.shortcutIn ?? null
      setMenu({
        x: e.clientX,
        y: e.clientY,
        lens: menuLens,
        leaveSearchTo: searching ? (node?.path ?? null) : null,
        targetDir: targetDirFor(node, root),
        rowKind: node?.type ?? null,
        // ONE field per item, each resolved on its own (GRO-2296). Several are the same
        // expression TODAY and must stay independent anyway — `copyPath`'s root fallback
        // below is exactly the divergence the split exists for.
        //
        // Blank space copies the vault ROOT (GRO-2273): the blank area already means "the
        // root" everywhere else here (`targetDirFor` sends "New note" there), and VS Code's
        // empty-Explorer menu does the same. Trailing separators are stripped so the copied
        // bytes match the root the rest of the app uses.
        copyPath: node?.path ?? root.replace(/\/+$/, ''),
        openPath: plural === null && node?.type === 'dir' ? node.path : null,
        // Both plural fields read the ONE ordered list above and stay separate fields, as the
        // doctrine asks. A folder is a tab too (YAZ-2290 D3), so the open item counts every row.
        copyPaths: plural,
        openTabPaths: plural,
        clipPaths: shortcutIn !== null ? null : plural ?? (node === null ? null : [node.path]),
        newWindowPath: filePath,
        renamePath: shortcutIn !== null ? null : node?.path ?? null,
        deletePath: shortcutIn !== null ? null : node?.path ?? null,
        revealPath: node?.path ?? root.replace(/\/+$/, ''),
        openVsCodePath: node?.path ?? root.replace(/\/+$/, ''),
        openDefaultPath: node?.path ?? root.replace(/\/+$/, ''),
        // Focus Mode (YAZ-1605): the plural selection's eligible rows, else the one row — DIRS only.
        // Empty (a selection of files only) hides the item.
        focusPaths: focusable(plural ?? (node === null ? [] : [node.path]), tree),
        // Favorites (YAZ-1766 D3): the row or its ordered selection, any kind, any lens; blank space has nothing to pin.
        favoritePaths: node === null ? null : plural ?? [node.path],
        favoriteIsOn: node !== null && (plural ?? [node.path]).every((p) => favorites.includes(p)),
        reviewDir: upkeep && node?.type === 'dir' ? node.path : null,
        reviewPath: inReview === null ? null : filePath,
        reviewIsOn: inReview === true,
        shortcutDir: plural === null && node?.type === 'dir' ? node.path : null,
        removeShortcut: node === null || shortcutIn === null ? null : { path: node.path, dir: shortcutIn },
      })
    },
    [root, tree, selectedPaths, orderedSelectedPaths, lens, searching, favorites, upkeep, reviewState],
  )

  const { clip, clipTo, pasteInto, pendingPaste, confirmPaste, cancelPaste } = useFileClipboard(root, menu, selectedPaths, orderedSelectedPaths, dirs, refresh, dispatch, clipboardRef, onNotice, indexSource)

  /**
   * Context menu "Open N in new tabs" (🔒 D5, YAZ-1337): the SAME background opener ⌘-click
   * already uses (I3, GRO-2235), once per selected path. The loop needs no guard of its own —
   * the workspace ignores a path that is already open and appends without stealing activation
   * (`open-background`, useWorkspace.ts) — so N tabs land in tree order and the caret stays put.
   */
  const openFilesInTabs = useCallback(
    (paths: string[]) => {
      for (const path of paths) onOpenFileBackground(path)
    },
    [onOpenFileBackground],
  )

  /** Context menu "Open in new window" (D2, GRO-2168): a fresh window on {root, file}; this one untouched. (⌘-click opens a background tab instead since I3.) */
  const openFileNewWindow = useCallback(
    (path: string) => {
      api.window.open({ root, file: path }).catch((err: unknown) => console.error('[sidebar] window.open failed:', err))
    },
    [root],
  )

  const { setRenamingEntry, startCreate, renaming, pending } = useInlineEdits(root, menu, setMenu, favoriteNodes, onLensChange, refresh, onOpenFile, onRenameFile, onRetitle, dispatch)

  /**
   * Reveal in Finder (GRO-2274). Read-only, so there is no confirm and nothing to repair —
   * but a STALE row (deleted or moved externally) rejects `NOT_FOUND`, and that has to be
   * visible: `showItemInFolder` is silent on a missing path, so without a notice the menu
   * item would just look broken.
   */
  const reveal = useCallback(
    (path: string) => {
      api.shell.reveal({ path }).catch((err: unknown) => {
        onNotice(err instanceof BridgeRequestError && err.code === 'NOT_FOUND' ? `Can't reveal "${nameOf(path)}" — it is no longer there` : `Can't reveal: ${err instanceof Error ? err.message : String(err)}`, 'error')
      })
    },
    [onNotice, nameOf],
  )

  /**
   * Open in VS Code (YAZ-963): `reveal`'s twin, notice included. A dead `vscode://` URL opens
   * an empty editor rather than reporting anything, so the stale-row `NOT_FOUND` is exactly as
   * load-bearing here as it is above.
   */
  const openVsCode = useCallback(
    (path: string) => {
      api.shell.openVsCode({ path }).catch((err: unknown) => {
        onNotice(err instanceof BridgeRequestError && err.code === 'NOT_FOUND' ? `Can't open "${nameOf(path)}" in VS Code — it is no longer there` : `Can't open in VS Code: ${err instanceof Error ? err.message : String(err)}`, 'error')
      })
    },
    [onNotice, nameOf],
  )

  /**
   * Open in default app (YAZ-1577): the third twin. Both the click on a row with no viewer and
   * the menu item land here; the OS' own refusal (`IO_ERROR`, e.g. no app registered for the
   * type) is the one extra message worth showing verbatim.
   */
  const openDefault = useCallback(
    (path: string) => {
      api.shell.openDefault({ path }).catch((err: unknown) => {
        onNotice(err instanceof BridgeRequestError && err.code === 'NOT_FOUND' ? `Can't open "${nameOf(path)}" — it is no longer there` : `Can't open "${nameOf(path)}": ${err instanceof Error ? err.message : String(err)}`, 'error')
      })
    },
    [onNotice, nameOf],
  )

  // ---- Delete (GRO-2272): context menu "Delete" → confirm sheet → App trashes the entry ----

  /**
   * Counts for the sheet, computed ONCE when it opens rather than on every render.
   *
   * Both come from data already in hand — the loaded tree and the vault index — so the delete
   * path makes no extra fetch. When the index is unavailable the backlink line is simply
   * omitted (`backlinks: undefined`): a missing count must never block a delete.
   */
  const askDelete = useCallback(
    (path: string) => {
      // The setting finally gates the sheet (YAZ-857 — it existed end-to-end but nothing read
      // it): off → delete directly, exactly what "Don't ask me again" promised.
      if (!settings.confirmDelete) {
        void onDeleteFile(path)
        return
      }
      const kind: 'file' | 'dir' = menu?.rowKind === 'file' ? 'file' : 'dir'
      const target: DeleteTarget = { path, kind }
      if (kind === 'dir') target.children = countChildren(tree?.tree ?? [], path)
      setConfirmingDelete(target)
      // The index is only needed for the count, so it rides in asynchronously and the sheet
      // opens immediately. Failure leaves the line out; it never blocks or spins.
      api.index(root).then(
        ({ records, folders }) => {
          const n = countLinkReferences({ root, oldPath: path, kind, records, folders, dirs })
          setConfirmingDelete((current) => (current !== null && current.path === path ? { ...current, backlinks: n } : current))
        },
        () => undefined,
      )
    },
    [menu, root, tree, dirs, settings.confirmDelete, onDeleteFile],
  )

  const confirmDelete = useCallback(
    (dontAskAgain: boolean) => {
      const target = confirmingDelete
      setConfirmingDelete(null)
      if (target === null) return
      if (dontAskAgain) onChangeSettings({ ...settings, confirmDelete: false })
      // Fire and forget: App owns the result and routes every failure to the passive notice.
      void onDeleteFile(target.path)
    },
    [confirmingDelete, onDeleteFile, onChangeSettings, settings],
  )

  // The row goes when the index says so, as it came; only a refusal is said.
  const removeShortcutRow = (path: string, dir: string): void =>
    void removeShortcut(dir, path, indexSource.folders, root).catch((err: unknown) => onNotice(`Can't remove the shortcut: ${err instanceof Error ? err.message : String(err)}`, 'error'))

  const { dragging, dropDir, setDropDir, dropOnDir, fileMove, favoriteReorder } = useTreeDrag(onRenameFile, favoritesRef, saveFavorites, focusFavorites)

  /**
   * The Files and Favorites trees are memoised per level (YAZ-2194), so what they get must keep
   * its identity across renders that change nothing for them. The context menu handler reads the
   * selection and the tree, so it changes on every click; the rows call it through this stable door.
   */
  const openMenuRef = useRef(openMenu)
  openMenuRef.current = openMenu
  const openRowMenu = useCallback((node: MenuRow, e: React.MouseEvent) => openMenuRef.current(node, e), [])

  // A search row's tree-drawing items leave the search first (🔒 D2, YAZ-2050) through
  // `onRevealInFiles`: App flips to Files; the reveal clears the query, ends a focus that would hide
  // the row, expands and flashes it — and the item's input or focus lands beside the row it names.
  const viaTree =
    <A extends unknown[]>(run: (...args: A) => void) =>
    (...args: A): void => {
      const leaveTo = menu?.leaveSearchTo ?? null
      if (leaveTo !== null) onRevealInFiles(leaveTo)
      run(...args)
    }

  return (
    <aside ref={asideRef} className="sidebar" style={{ width }}>
      {/* The root header doubles as the "move to the vault root" drop target (E1b). */}
      <div
        className={`sidebar__header${dropDir === root ? ' sidebar__header--drop' : ''}`}
        onDragOver={(e) => {
          if (dragging === null) return
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
          if (dropDir !== root) setDropDir(root)
        }}
        onDragLeave={() => {
          if (dropDir === root) setDropDir(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          dropOnDir(root)
        }}
      >
        {/* The vault switcher (YAZ-1767): the trigger is the header's top-left button (name + chevron,
            D6); its panel hangs off this header's rect (D5). "Open folder…" is its last row (D4). */}
        <VaultSwitcher
          root={root}
          onPickFolder={onPickFolder}
          pickDisabled={pickDisabled}
          openRequest={switcherOpenRequest}
          // The right-click menu (YAZ-1798): the file menu's own OS verbs and notice, App's in-place switch.
          onOpenHere={onOpenVaultHere}
          onReveal={reveal}
          onOpenVsCode={openVsCode}
          onNotice={onNotice}
        />
        <button type="button" className="sidebar__collapse" onClick={onCollapse} title="Hide sidebar" aria-label="Hide sidebar">
          <SidebarPanelIcon />
        </button>
      </div>
      {/* The Inbox (YAZ-2322), with upkeep on: above the lens tabs, so it shows in every lens and during a search. */}
      {upkeep && (
        <button
          type="button"
          className={`sidebar__inbox${reviewing ? ' sidebar__inbox--active' : ''}`}
          aria-pressed={reviewing}
          aria-label={dueCount > 0 ? `Inbox, ${dueCount} due` : 'Inbox'}
          onClick={onOpenInbox}
        >
          Inbox
          {dueCount > 0 && <span className="tree__count">{dueCount}</span>}
        </button>
      )}
      {/* Lens tabs (🔒 D4/D5, YAZ-847) — chrome v2 ROW 1, above the search bar: Files (the file
          explorer) ⇄ Favorites. The row stays VISIBLE and clickable during a search,
          and switching lenses never touches the query (🔒 D5). `role="tab"` + `aria-selected`
          only — no `aria-controls`/`tabpanel`, because the body below is shared with the flat
          search results and belongs to neither lens while a query is typed. */}
      <div className="sidebar__lenses" role="tablist" aria-label="Sidebar lens">
        {SIDEBAR_LENSES.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={lens === id}
            className={`sidebar__lens${id === 'favorites' ? ' sidebar__lens--glyph' : ''}${lens === id ? ' sidebar__lens--active' : ''}`}
            onClick={() => onLensChange(id)}
            // Favorites is a glyph, not a word (YAZ-1766 D1): the label lives in `title` + `aria-label`.
            title={id === 'favorites' ? LENS_LABEL[id] : undefined}
            aria-label={id === 'favorites' ? LENS_LABEL[id] : undefined}
          >
            {id === 'favorites' ? <HeartIcon /> : LENS_LABEL[id]}
          </button>
        ))}
        {/* One button for both directions AND both lenses (⚡ YAZ-862, ⚡ YAZ-873): anything open
            collapses everything, and only a fully closed tree expands it. It acts on whichever
            lens is ACTIVE. Gone — not disabled — while a query is
            typed (the tree is not the body then) and whenever the active reading has nothing to
            unfold: a vault with no folders. */}
        {/* Focus Mode's eye (YAZ-1605): lit ONLY while the active lens is focused, one slot left of
            the chevrons; one click ends the focus. Gone while a query is typed, like its neighbour. */}
        {!searching && focused && (
          <button type="button" className="sidebar__focus-off" aria-label="Exit focus mode" title="Exit focus mode" onClick={exitFocus}>
            <EyeIcon />
          </button>
        )}
        {!searching && bodyDirs.length > 0 && (
          <button
            type="button"
            className="sidebar__expand-all"
            aria-label={allLabel}
            title={allLabel}
            onClick={() =>
              // Only the dirs ON SCREEN move (YAZ-1605): folds outside a focus are exactly as they were when it ends.
              dispatch({ type: 'setAll', dirs: anyExpanded ? expanded.filter((d) => !bodyDirs.includes(d)) : [...new Set([...expanded, ...bodyDirs])] })
            }
          >
            <ChevronsIcon />
          </button>
        )}
      </div>
      {/* Persistent search bar (YAZ-739 A-, chrome v2 row 2 — 🔒 YAZ-797): always visible, never a
          tab or a view — on BOTH lenses (YAZ-847 keeps that rule). YAZ-750's filter affordance
          sits beside it; YAZ-803 swaps the body to results while `query` is non-empty. */}
      <div className="sidebar__search">
        <SearchIcon />
        <input
          ref={searchInput}
          className="sidebar__search-input"
          type="text"
          placeholder="Search"
          title="Search (⌘K)"
          aria-label="Search notes"
          value={query}
          onChange={changeQuery}
          onKeyDown={searchKeyDown}
        />
      </div>
      {/* The blank-space menu is the TREE's ("New note" here creates in the vault root); the
          results list has no such target, so right-clicking it offers nothing (YAZ-803) — not even
          Electron's text menu, which leaked through until YAZ-2050. Its ROWS get the full menu.
          Blank space means the same thing in either lens: the vault ROOT. */}
      <div
        ref={bodyRef}
        className="sidebar__body"
        onContextMenu={(e) => (searching ? e.preventDefault() : openMenu(null, e))}
        // Escape drops the multi-select (YAZ-1336) — and ONLY when there is one: with nothing
        // selected the key still belongs to everyone else listening for it, so this must neither
        // swallow it nor stop it travelling. An OPEN context menu owns the key outright
        // (YAZ-1340): its window listener is closing it on this very press, and one Escape must
        // not also throw the selection the menu was about to act on.
        // (⌘C/⌘X/⌘V are App's window listener, D6 — see `clipboardRef`.)
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || selectedPaths.size === 0 || menu !== null) return
          e.preventDefault()
          e.stopPropagation()
          dispatchSelection({ type: 'clear' })
        }}
        // A plain LEFT click on blank space ends the selection (D6 amended, YAZ-1674), so ⌘V then
        // pastes into the vault root — the Finder rule. Rows, inputs and buttons own their own
        // clicks (a row click SELECTS, D9), and a right-click keeps the selection standing
        // (YAZ-1337: its menu is about the root, not a fresh pick; the menu's overlay lives
        // outside this body, so its own mousedown never arrives here).
        onMouseDown={(e) => {
          if (e.button !== 0 || selectedPaths.size === 0) return
          if (e.target instanceof Element && e.target.closest('button, input, textarea, a, [role="treeitem"]') !== null) return
          dispatchSelection({ type: 'clear' })
        }}
      >
        {searching ? (
          // A typed query replaces the ACTIVE TAB's body, whichever lens that is (🔒 D5).
          results.length > 0 ? (
            <SearchResults results={results} selected={sel} onSelect={setSelected} onActivate={activate} onRowContextMenu={(hit, e) => openMenu({ type: hit.kind, path: hit.path }, e)} />
          ) : (
            <p className="sidebar__msg">No matches</p>
          )
        ) : lens === 'favorites' ? (
          // The Favorites tab (YAZ-1766): the pinned rows in the user's order, each a full tree row —
          // a favorited folder unfolds in place through the SAME `expanded` set as Files (D7) and
          // every row carries the same menu. Nothing here drags to disk (an inert move); root rows
          // drag to reorder the list (D4).
          <>
            {error !== null && <p className="sidebar__msg sidebar__msg--error">{error}</p>}
            {tree === null && error === null && <p className="sidebar__msg">Loading…</p>}
            {tree !== null && favoriteNodes.length === 0 && <p className="sidebar__msg">No favorites yet. Right-click a file or folder → Add to favorites.</p>}
            {tree !== null && favoriteNodes.length > 0 && (
              <Tree
                nodes={favoriteNodes}
                dirPath={root}
                expanded={expandedSet}
                activeFile={activeFile}
                onToggle={toggleDir}
                onOpenFile={onOpenFile}
                onOpenFileBackground={onOpenFileBackground}
                onOpenDefault={openDefault}
                onNodeContextMenu={openRowMenu}
                pending={pending}
                renaming={renaming}
                move={INERT_MOVE}
                reorder={favoriteReorder}
                selection={selection}
                counts={counts}
                shortcuts={shortcuts}
                titles={titles}
              />
            )}
          </>
        ) : (
          <>
            {error !== null && <p className="sidebar__msg sidebar__msg--error">{error}</p>}
            {tree === null && error === null && <p className="sidebar__msg">Loading…</p>}
            {tree !== null && tree.tree.length === 0 && pending === null && (
              <p className="sidebar__msg">No notes here.</p>
            )}
            {tree !== null && (
              <Tree
                nodes={focusNodes.length > 0 ? focusNodes : tree.tree}
                dirPath={root}
                expanded={expandedSet}
                activeFile={activeFile}
                onToggle={toggleDir}
                onOpenFile={onOpenFile}
                onOpenFileBackground={onOpenFileBackground}
                onOpenDefault={openDefault}
                onNodeContextMenu={openRowMenu}
                pending={pending}
                renaming={renaming}
                move={fileMove}
                selection={selection}
                counts={counts}
                shortcuts={shortcuts}
                titles={titles}
              />
            )}
          </>
        )}
      </div>
      <div className="sidebar__footer">
        <SettingsButton onClick={onOpenSettings} />
      </div>
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          // Items as data (🔒 D8, YAZ-1674): every gating rule lives in `menuSections`. `clip` is read
          // at RENDER time, so "Paste N items" follows the app-wide clipboard while the menu stands.
          sections={buildMenuSections(
            { ...menu, clip },
            {
              onOpen: onOpenFile,
              onOpenInNewTabs: openFilesInTabs,
              onOpenNewWindow: openFileNewWindow,
              onOpenVsCode: openVsCode,
              onOpenDefault: openDefault,
              onReveal: reveal,
              focusLabel: focusLabel(menu.focusPaths?.length ?? 0),
              onFocus: viaTree((paths) => focusOn(paths, menu.lens)),
              onCut: (paths) => clipTo(paths, 'cut'),
              onCopy: (paths) => clipTo(paths, 'copy'),
              onPaste: () => pasteInto(menu.targetDir),
              onNotice,
              onNewNote: viaTree(() => startCreate('file')),
              onNewDatedNote: viaTree(() => startCreate('file', datedSeed())),
              onNewFolder: viaTree(() => startCreate('dir')),
              onNewDatedFolder: viaTree(() => startCreate('dir', datedSeed())),
              onToggleFavorite: toggleFavorite,
              onReviewFolder,
              onSetReview,
              onAddShortcut: setPickingShortcut,
              // A removal that would clear a folder's values asks first (D21), by the window's own snapshot.
              onRemoveShortcut: (path, dir) => {
                const lost = valuesLeftByShortcut(dir, path, indexSource.records, indexSource.folders)
                if (lost.folders.length === 0) removeShortcutRow(path, dir)
                else setConfirmingShortcut({ path, dir, lost })
              },
              onRename: viaTree((path) => setRenamingEntry({ path, kind: menu.rowKind === 'file' ? 'file' : 'dir' })),
              onDelete: askDelete,
            },
          )}
          onClose={() => setMenu(null)}
        />
      )}
      {confirmingDelete !== null && <ConfirmDelete target={confirmingDelete} titles={titles} onConfirm={confirmDelete} onCancel={() => setConfirmingDelete(null)} />}
      {pendingPaste !== null && <ConfirmMove moves={pendingPaste.moves} lost={pendingPaste.lost} titles={titles} onConfirm={confirmPaste} onCancel={cancelPaste} />}
      {confirmingShortcut !== null && (
        <ConfirmMove
          shortcut={confirmingShortcut}
          lost={confirmingShortcut.lost}
          titles={titles}
          onConfirm={() => {
            setConfirmingShortcut(null)
            removeShortcutRow(confirmingShortcut.path, confirmingShortcut.dir)
          }}
          onCancel={() => setConfirmingShortcut(null)}
        />
      )}
      {pickingShortcut !== null && (
        <ShortcutPicker
          folder={relTo(root, pickingShortcut)}
          source={indexSource}
          onPick={(path) => {
            setPickingShortcut(null)
            // The row and the count follow the index, as every other write's do; only a refusal is said.
            addShortcut(pickingShortcut, path).catch((err: unknown) => onNotice(`Can't add the shortcut: ${err instanceof Error ? err.message : String(err)}`, 'error'))
          }}
          onClose={() => setPickingShortcut(null)}
        />
      )}
    </aside>
  )
}
