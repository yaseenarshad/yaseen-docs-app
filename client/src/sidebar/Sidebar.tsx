import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { SIDEBAR_TABS, stripSlash, type IndexRecord, type SettingsState, type SidebarLens, type SidebarTab, type TreeNode } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { ChevronsIcon, EyeIcon, HeartIcon, SearchIcon, SidebarPanelIcon } from '../views/view/icons'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { WatchSource } from '../hooks/useWatch'
import { focusOpenDocument } from '../lib/focusHandoff'
import { pageName, useAllPathTitles } from '../lib/pageLabel'
import { relTo } from '../lib/paths'
import { storage } from '../lib/storage'
import { countLinkReferences } from '../links/renameLinks'
import { addShortcut, removeShortcut, valuesLeftByShortcut, type LeftBehind } from '../links/shortcuts'
import { ancestorDirs, findDirNode, findNode, pinnedRoots, treeHasFile } from '../lib/treeState'
import { SEARCH_CAP } from '../search/searchCandidates'
import { ConfirmDelete, type DeleteTarget } from './ConfirmDelete'
import { ConfirmMove } from './ConfirmMove'
import { ContextMenu } from './ContextMenu'
import { folderShortcuts } from './folderShortcuts'
import { datedSeed, targetDirFor, type MenuRow } from './createEntry'
import { SettingsButton } from '../settings/SettingsButton'
import { buildMenuSections } from './menuSections'
import { ShortcutPicker } from './ShortcutPicker'
import type { NoticeKind } from '../lib/notice'
import { Tree, type TreeFileMove } from './Tree'
import { VaultSwitcher } from './VaultSwitcher'
import { useSidebarSearch } from './hooks/useSidebarSearch'
import { useSameList, useVaultTree } from './hooks/useVaultTree'
import { useFileClipboard, useInlineEdits, useSelection, useTreeDrag } from './hooks/rowGestures'
import { flashTreeRows, revealMissingMessage, type SidebarRevealRequest } from './revealRow'

/** One vault of the window as the panel reads it (YAZ-2602 D1): its folder, what the app calls it, its watcher, its index snapshot and its review. */
export interface SidebarVault {
  root: string
  /** Its display name, else its folder name (YAZ-1974 D4): the vault row's label. */
  name: string
  watch: WatchSource
  /**
   * The vault's index snapshot, for the folders' shortcut rows (YAZ-2290 D2) and the rows' titles:
   * the SAME object its `WikilinkIndexBridge` already feeds — read, never written, and no second
   * feed. `records` is `[]` until the first index lands.
   */
  index: WikilinkResolveSource
  /** Whether this vault has upkeep review on (YAZ-2322 🔒 D7): off, it has no Inbox row and its folders no "Review this folder". */
  upkeep: boolean
  /**
   * Its Inbox row (YAZ-2322; one per vault with upkeep on, YAZ-2602 R5): how many notes are due, and
   * whether its review is open. App counts and owns the session — this component is unmounted
   * while collapsed, and the count has to be right the moment it comes back.
   */
  dueCount: number
  reviewing: boolean
}

interface SidebarProps {
  /** The window's vaults, in the window's order (YAZ-2602 D1); never empty. App keys this panel on one of them (YAZ-2631 D5). */
  vaults: readonly SidebarVault[]
  /** The vault rows the user closed (YAZ-2602 R9): App's, so they stay closed while this panel is unmounted. */
  closedVaults: readonly string[]
  onSetVaultOpen: (root: string, open: boolean) => void
  /** "Add vault to this window" (YAZ-2602 D2): App checks the folder and says why it cannot be added; resolves whether it was. */
  onAddVault: (path: string) => Promise<boolean>
  /** Its "Open folder…" (S3): the system picker, and the picked folder is added. */
  onPickVault: () => void
  /** "Remove from this window" (YAZ-2602 D7): App closes the vault's pages and drops it from the window. */
  onRemoveVault: (root: string) => void
  /** A drag of a vault row (YAZ-2631 D5): the window's vaults in the new order, for App to store. */
  onReorderVaults: (next: string[]) => void
  /** The width in px (YAZ-738), set on this aside alone (YAZ-2194). */
  width: number
  /** This aside, for App's resize drag, which writes the live width to it between renders (YAZ-2239). */
  asideRef?: Ref<HTMLElement>
  activeFile: string | null
  /** A click on a row, Enter on a search match: App passes the workspace's openCurrent — the page opens in the preview tab (YAZ-2648 D1). */
  onOpenFile: (path: string) => void
  /** A double click on a row (YAZ-2648 D2): App passes the workspace's openKept. */
  onKeepFile: (path: string) => void
  /** ⌘-click on a file row (I3 LOCKED ruling, GRO-2235): open in a background tab; App passes the workspace's openBackground. */
  onOpenFileBackground: (path: string) => void
  /**
   * A search row's menu item that draws into the tree was chosen (🔒 D2, YAZ-2050), or "Show in
   * sidebar" on a row of Search, Focus or Favorites (YAZ-2638 D1, D3): App flips the lens to Files
   * and issues the same reveal request the tab menu uses, so the row unfolds and flashes below —
   * whichever tab was showing. Enter on a folder of the search tree, and Shift+Enter on a row, ask
   * with `focus` (YAZ-2662 D1, D8): the row gets the keyboard focus too.
   */
  onRevealInFiles: (path: string, focus?: boolean) => void
  /**
   * The preview panel of the search (YAZ-2662 D5) is App's, over the page area: `previewPath` is the
   * file that it draws, or `null` with no panel on show, and `onPreview` is its one door — a file to
   * draw, or `null` for no panel. Space in the search bar asks, and the panel then follows the highlight.
   */
  previewPath: string | null
  onPreview: (path: string | null) => void
  /** "Open folder…" — the last row of the header's vault switcher (YAZ-1767 D4) — runs App's picker; the picked vault opens beside (YAZ-1914). */
  onPickFolder: () => void
  /** True while the native folder dialog is open; the switcher's "Open folder…" row is disabled meanwhile. */
  pickDisabled: boolean
  /**
   * ⌘O (YAZ-1767 D8): App's request counter for the vault switcher, threaded straight to the
   * header's `VaultSwitcher`, which opens its panel and focuses the filter on every new value.
   * 0 = nothing requested (App pins a request to the sidebar it was made on, so a new mount
   * never replays it).
   */
  switcherOpenRequest: number
  /** The vault menu's "Open in this window" (YAZ-1798 D8): App's in-place switch, threaded to the `VaultSwitcher`. */
  onOpenVaultHere: (path: string) => Promise<boolean>
  /** Hide the sidebar (GRO-2023); TabBar leads its nav row with the Show-sidebar button while hidden (YAZ-1759). */
  onCollapse: () => void
  /**
   * Which tab the tabs row shows (🔒 D4, YAZ-847). App-owned and persisted as window identity
   * (`WindowEntry.sidebarLens`, per window since YAZ-1628), never Sidebar-local: this component
   * is mounted on one vault of the window and only while the sidebar is open, so local state would forget the
   * choice on every collapse/reopen and every root switch. Search is a tab too (YAZ-2638 D2): App's, and never stored.
   */
  lens: SidebarTab
  /** A tab was clicked; App writes a lens through to the window identity — never Search — and passes the new value back down. */
  onLensChange: (lens: SidebarTab) => void
  /** One reveal in Files; a request that arrives on another lens is dropped. */
  revealRequest: SidebarRevealRequest | null
  /** The request has been accepted into Sidebar-local work and must not replay after a remount. */
  onRevealConsumed: (id: number) => void
  /**
   * One row menu asked from outside the panel (YAZ-2663 D6): a right-click on a row of the new tab
   * page. The panel opens its OWN row menu for that path at the point, one time. Set at MOUNT is
   * the right-click with the sidebar hidden (S31): App shows the sidebar, and the menu opens when
   * the tree lands.
   */
  menuRequest: SidebarMenuRequest | null
  /** The request was acted on, or its path is not in the tree: it must not replay after a remount. */
  onMenuConsumed: (id: number) => void
  /**
   * The settings (GRO-2024); App owns and applies them. The sidebar no longer edits them (the
   * dialog does, YAZ-1679) but still READS `confirmDelete` and writes it back through the
   * delete sheet's "Don't ask me again" (GRO-2272).
   */
  settings: SettingsState
  onChangeSettings: (next: SettingsState) => void
  /** The footer cog: App mounts the settings dialog, so the cog only asks for it (YAZ-1679). */
  onOpenSettings: () => void
  /** A vault's folder could not be read (e.g. deleted): which one; parent decides what to do. */
  onRootMissing: (root: string) => void
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
   * ⌘K or a click on the Search tab asked for the search bar (YAZ-801, YAZ-2638 D2): App shows the
   * Search tab with it, and the bar focuses its input and selects its text. True at MOUNT is the
   * ⌘K-while-collapsed path (App un-collapses, so the sidebar mounts with it already set), not an
   * edge case. With it false the caret stays where it is, also at a mount on the Search tab.
   */
  pendingSearchFocus: boolean
  /** The focus above happened (YAZ-801); App clears its flag so the next ⌘K is a fresh request. */
  onSearchFocusHandled: () => void
  /**
   * The way to the new tab page: → or ↓ in the EMPTY search bar (YAZ-2663 D7, S33), and → on a
   * row of Files, Focus or Favorites that has nothing to open (D8). It asks App to put the keyboard
   * focus on the page, and App says whether a row took it. Absent, or answered `false` — no page
   * shows, or no column of it has a row — the key does what it did before.
   */
  onLeaveToPage?: () => boolean
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
  /** The folder row's "Review this folder" (YAZ-2322): App starts a review of what is due inside it. */
  onReviewFolder: (dirPath: string) => void
  /**
   * The note row's review toggle (YAZ-2322): whether a path is in review — null for anything
   * that is not a note in the index — and the write. Both App's: the sidebar has no index.
   */
  reviewState: (path: string) => boolean | null
  onSetReview: (path: string, on: boolean) => void
  /** An Inbox row was clicked (YAZ-2602 R5): App opens the review of THAT vault, or closes it when it is the one open. */
  onInbox: (root: string) => void
}

/** One "open the row menu of this path at this point" gesture (YAZ-2663 D6): the reveal request's idiom. */
export interface SidebarMenuRequest {
  id: number
  path: string
  x: number
  y: number
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
  /**
   * Where "New …" creates and Paste pastes: a dir row → itself, a file row → its parent, blank
   * space → the root. Null where blank space is no one vault's (two or more vaults, YAZ-2602 S10).
   */
  targetDir: string | null
  /** The right-clicked row's kind; null for blank space. Drives the Rename input's mode. */
  rowKind: 'file' | 'dir' | null
  /** "Copy path" — the right-clicked row (file or folder), or for blank space the vault ROOT of a window with one vault (GRO-2273); null there with two or more (YAZ-2602 S10). */
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
  /** "Reveal in Finder" — the row, or the one vault's ROOT for blank space (GRO-2274); same target as `copyPath`. */
  revealPath: string | null
  /** "Open in VS Code" — the same target rule again (YAZ-963); its OWN field, per this split's whole point. */
  openVsCodePath: string | null
  /** "Open in default app" — the same target rule a third time (YAZ-1577); its OWN field, same doctrine. */
  openDefaultPath: string | null
  /**
   * "Add to focus" / "Remove from focus" (YAZ-2619 D3): the row, or the ordered 2+ selection holding
   * it — files and folders alike, every lens, a search row too; null on blank space (R7). Its OWN field.
   */
  focusPaths: string[] | null
  /** True only when EVERY `focusPaths` entry is already in the focus list — a mixed selection reads as Add (R9). */
  focusIsOn: boolean
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
   * "Add vault to this window ▸" (YAZ-2602 D2) — BLANK SPACE only: the known vaults that are not in
   * this window, in the order of the `⌘O` list; empty when there is none, and the flyout then holds
   * "Open folder…" alone. Null on every row.
   */
  addVaults: { path: string; name: string }[] | null
  /** "Remove from this window" (YAZ-2602 D7) — a VAULT row only: that vault's root. */
  removeVault: string | null
  /**
   * The lens the items act in (🔒 D1, YAZ-2050): the active one, or FILES for a row of the Search
   * tab — a search row is a disk row. Every lens rule in the menu path reads this.
   */
  lens: SidebarLens
  /**
   * A search row's path (🔒 D2, YAZ-2050), null for every tree row and blank space: the items that
   * draw INTO the tree (an inline input) reveal it in Files first, since the tree is hidden.
   */
  leaveSearchTo: string | null
  /**
   * "Show in sidebar" (YAZ-2638 D1, D3) — a row of Search, Focus or Favorites outside a plural
   * selection: the row to show in Files. Null on a row of the Files tab and on blank space. Its OWN field.
   */
  showPath: string | null
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

/** The tabs' copy; the ORDER is `SIDEBAR_TABS`', so the default lens leads (YAZ-847) and Search stands right after it (YAZ-2638 D2). */
const LENS_LABEL: Record<SidebarTab, string> = { files: 'Files', search: 'Search', focus: 'Focus', favorites: 'Favorites' }

/** The keys of the search, as the empty Search tab lists them (YAZ-2662 D10, S59): the keycaps of a row, and what they do. */
const SEARCH_KEYS: readonly (readonly [keys: readonly string[], does: string])[] = [
  [['↑', '↓'], 'Move'],
  [['↵'], 'Open'],
  [['⌘↵'], 'Open in a background tab'],
  [['⇧↵'], 'Show in Files'],
  [['space'], 'Preview a file or open a folder, after ↑ or ↓'],
  [['→', '←'], 'Open or close a folder, after ↑ or ↓'],
  [['esc'], 'Back to the page'],
]

/** Which note is a shortcut where, as one comparable string: all a shortcut row draws is its path. */
const shortcutStamp = (shortcuts: ReadonlyMap<string, readonly TreeNode[]>): string => JSON.stringify([...shortcuts].map(([dir, rows]) => [dir, rows.map((row) => row.path)]))

/** The search tree's file move (S32, YAZ-2620): nothing there drags to disk, so every callback is a no-op. */
const INERT_MOVE: TreeFileMove = { dragging: null, dropDir: null, start: () => undefined, end: () => undefined, hover: () => undefined, drop: () => undefined }

/** What the search cuts before the tree has loaded, and its shortcut rows — none (S7, YAZ-2620): one object each, so the memoised tree sees no change (YAZ-2194). */
const NO_NODES: readonly TreeNode[] = []
const NO_SHORTCUTS: ReadonlyMap<string, readonly TreeNode[]> = new Map()

/** Mounted with `key={one vault of the window}` by App (YAZ-2631 D5), so all state below lives while that vault is in the window. */
export function Sidebar({
  vaults,
  closedVaults,
  onSetVaultOpen,
  onAddVault,
  onPickVault,
  onRemoveVault,
  onReorderVaults,
  activeFile,
  onOpenFile,
  onKeepFile,
  onOpenFileBackground,
  onRevealInFiles,
  previewPath,
  onPreview,
  onPickFolder,
  pickDisabled,
  switcherOpenRequest,
  onOpenVaultHere,
  onCollapse,
  lens,
  onLensChange,
  revealRequest,
  onRevealConsumed,
  menuRequest,
  onMenuConsumed,
  settings,
  onChangeSettings,
  onOpenSettings,
  onRootMissing,
  onFileMissing,
  onRenameFile,
  onRetitle,
  onDeleteFile,
  onNotice,
  pendingSearchFocus,
  onSearchFocusHandled,
  onLeaveToPage,
  selectionRef,
  clipboardRef,
  onReviewFolder,
  reviewState,
  onSetReview,
  onInbox,
  width,
  asideRef,
}: SidebarProps) {
  const { roots, watches, rootOf, trees, forest, loaded, vaultRows, errors, refresh, expanded, dispatch, openTo, expandedSet, toggleDir, focusList, reorderFocus, focusNodes, focusDirs, toggleFocus, clearFocus, favoritesByRoot, favoritePaths, saveFavoriteOrder, toggleFavorite, dirs, dirsByVault, dirsOf, filesByVault, favoriteNodes, favoriteDirs } = useVaultTree(vaults, closedVaults, onSetVaultOpen, activeFile, onRootMissing, onFileMissing, onNotice)
  // The FIRST vault: the one a window with one vault has.
  const root = roots[0]
  /** Two or more vaults (YAZ-2602 D3): each is a row of the tree, and blank space is no one vault's. */
  const multi = roots.length > 1
  const vaultsRef = useRef(vaults)
  vaultsRef.current = vaults
  /** The vaults that have an Inbox row (YAZ-2602 R5): the ones with upkeep on. */
  const inboxes = vaults.filter((vault) => vault.upkeep)
  /**
   * The vault that holds `path` — the most specific one, else the first (YAZ-2602): every rule
   * about "the vault of this row" asks it. Ref-backed, so the callbacks that ask keep their identity.
   */
  const vaultOf = useCallback((path: string): SidebarVault => vaultsRef.current.find((vault) => vault.root === rootOf(path)) ?? vaultsRef.current[0], [rootOf])
  const [menu, setMenu] = useState<MenuTargets | null>(null)
  // The delete confirm sheet's target (GRO-2272 `C3-`); null when the sheet is closed.
  const [confirmingDelete, setConfirmingDelete] = useState<DeleteTarget | null>(null)
  // The "Remove shortcut" that would clear values, waiting on its sheet (D21); null when it is closed.
  const [confirmingShortcut, setConfirmingShortcut] = useState<{ path: string; dir: string; lost: LeftBehind } | null>(null)
  // The folder "Add note shortcut" is picking a note for (YAZ-2290 D2); null when the picker is closed.
  const [pickingShortcut, setPickingShortcut] = useState<string | null>(null)
  const seenRevealId = useRef<number | null>(null)
  const handledFilesRevealId = useRef<number | null>(null)
  const focusedRevealId = useRef<number | null>(null)
  const [pendingReveal, setPendingReveal] = useState<SidebarRevealRequest | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // The folders' shortcut rows (YAZ-2290 D2), rebuilt once per index snapshot. A snapshot that moved
  // no shortcut keeps the Map it had, so a save elsewhere in the vault re-renders no tree level (YAZ-2194).
  // Each vault's folders by its OWN index (YAZ-2602 S30); the paths of two vaults never meet, so the
  // maps add up. A vault is read again only when ITS snapshot changed — the identity of its two
  // arrays — so a save in one vault scans no record of another.
  const indexes = useSameList(vaults.map((vault) => vault.index))
  const built = useRef(new Map<string, { records: readonly IndexRecord[]; folders: readonly IndexRecord[]; shortcuts: ReturnType<typeof folderShortcuts> }>())
  const readShortcuts = useCallback(() => {
    const next: typeof built.current = new Map()
    roots.forEach((vault, i) => {
      const { records, folders } = indexes[i]
      const last = built.current.get(vault)
      next.set(vault, last !== undefined && last.records === records && last.folders === folders ? last : { records, folders, shortcuts: folderShortcuts(vault, records, folders) })
    })
    built.current = next
    const all = [...next.values()].map((one) => one.shortcuts)
    return all.length === 1 ? all[0] : new Map(all.flatMap((one) => [...one]))
  }, [roots, indexes])
  const [shortcuts, setShown] = useState(readShortcuts)
  useEffect(() => {
    const read = () =>
      setShown((prev) => {
        const next = readShortcuts()
        return shortcutStamp(next) === shortcutStamp(prev) ? prev : next
      })
    read()
    const offs = indexes.map((index) => index.subscribe(read))
    return () => offs.forEach((off) => off())
  }, [readShortcuts, indexes])
  // The rows' labels (YAZ-2420 🔒 D15), by the same rule: a snapshot that changed no title keeps its Map.
  const titles = useAllPathTitles(indexes)
  /** A path as the notices name it: its title (YAZ-2420 🔒 D14). */
  const nameOf = useCallback((path: string) => pageName(rootOf(path), path, titles), [rootOf, titles])

  // What the chevrons button unfolds on the active lens: the folders that tab shows (YAZ-2619 R10).
  const bodyDirs = lens === 'favorites' ? favoriteDirs : lens === 'focus' ? focusDirs : dirs
  // Enter in the search bar, on a file: the highlighted row's page opens as a tab.
  // The tree rows' rule (YAZ-961): the first Enter PREVIEWS — focus stays in the bar, so ↑/↓ carry
  // on — and a second on the page already open is the deliberate "take me in". A CLICK is the tree
  // row's own (YAZ-2620 🔒 D1): it opens a note the same way, and folds a folder.
  // The row is the search tree's own: a match, or a row of a folder that shows all (YAZ-2662 S52).
  const activate = (row: TreeNode, background: boolean, reveal: boolean) => {
    // Enter on a folder, and Shift+Enter on any row, show the row in Files with the keyboard focus on
    // it (YAZ-2662 D1, D8). ⌘ is read first (S7): ⌘Enter is a background tab, of a folder's page too.
    if (!background && (reveal || row.type === 'dir')) onRevealInFiles(row.path, true)
    // A file with no viewer in the app opens in its default app, as its tree row does (YAZ-1577 D2;
    // S24 on YAZ-2620): no tab, so nothing for ⌘ to background either.
    else if (row.type === 'file' && row.kind === null) openDefault(row.path)
    else if (background) onOpenFileBackground(row.path)
    else {
      // The page already open is asked for too: nothing changes in the workspace, and App closes the tab board over it (YAZ-2648 S46).
      onOpenFile(row.path)
      if (row.path === activeFile) focusOpenDocument()
    }
  }
  // The search covers every vault of the window (YAZ-2602 R2): each one's index, read by its own
  // watcher, its own folders and its own files that are no notes. The tree it cuts is the one Files
  // draws — the forest, with two or more vaults (A9).
  const searchVaults = useMemo(() => roots.map((vault, i) => ({ root: vault, watch: watches[i], dirs: dirsByVault[i], files: filesByVault[i] })), [roots, watches, dirsByVault, filesByVault])
  // The Search tab (YAZ-2638 D2): its body is the search, and the query stays while another tab shows.
  const searching = lens === 'search'
  // The way out of the Search tab, for the search's Esc (`searchEsc`): back to the lens the window
  // last showed, and the caret goes into the open page (YAZ-2662 D9). With no page open no caret moves.
  const leaveSearch = useCallback(() => {
    onLensChange(storage.getSidebarLens())
    focusOpenDocument()
  }, [onLensChange])
  // The pinned items (YAZ-2662 D3): the rows of the Focus tab, then those of the Favorites tab. Their matches are the search's top group.
  const pinned = useMemo(() => pinnedRoots([...focusNodes, ...favoriteNodes]), [focusNodes, favoriteNodes])
  const { searchInput, query, results, typed, found, searchOpen, toggleSearchDir, searchCursor, marks, changeQuery, searchKeyDown, searchEsc } = useSidebarSearch(searchVaults, forest ?? NO_NODES, pinned, searching, leaveSearch, pendingSearchFocus, onSearchFocusHandled, activate, previewPath, onPreview)
  // The row whose menu is open wears the selected style beside the highlight, as on Files (S30): a
  // parent row is no match, so the highlight cannot go to it, and the menu must still say what it acts on.
  const menuRow = menu?.leaveSearchTo ?? null
  const searchSelection = useMemo(() => (menuRow === null || searchCursor.paths.has(menuRow) ? searchCursor : { ...searchCursor, paths: new Set([...searchCursor.paths, menuRow]) }), [searchCursor, menuRow])
  // The search tree scrolls inside `.sidebar__body`, so arrowing past its edge must bring the
  // highlighted row along. jsdom has no scrollIntoView — hence the `?.()` (the TabBar idiom).
  useEffect(() => {
    const [path] = searchCursor.paths
    if (path === undefined || bodyRef.current === null) return
    const row = [...bodyRef.current.querySelectorAll<HTMLElement>('.tree__row[data-path]')].find((r) => r.dataset.path === path)
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [searchCursor.paths])

  useEffect(() => {
    if (revealRequest === null || seenRevealId.current === revealRequest.id) return
    seenRevealId.current = revealRequest.id
    onRevealConsumed(revealRequest.id)
    if (lens !== 'files') {
      setPendingReveal(null)
      return
    }
    setPendingReveal(revealRequest)
  }, [lens, onRevealConsumed, revealRequest])

  useEffect(() => {
    if (pendingReveal !== null && lens !== 'files') setPendingReveal(null)
  }, [lens, pendingReveal])

  // Expand / collapse the whole tree (⚡ YAZ-862). "Any open" is
  // measured against what the CURRENT tree can actually unfold (`dirs`, above), never the raw
  // persisted list, which would leave the button offering to collapse nothing.
  // On Files with two or more vaults, the vault rows fold with the rest (YAZ-2631 D6).
  const foldVaults = multi && lens === 'files'
  const anyExpanded = bodyDirs.some((d) => expanded.includes(d)) || (foldVaults && roots.some((vault) => !closedVaults.includes(vault)))
  const allLabel = anyExpanded ? 'Collapse all' : 'Expand all'

  const { selectedPaths, dispatchSelection, orderedSelectedPaths, selection } = useSelection(lens, loaded ? forest : null, roots, selectionRef, bodyRef)

  // A Files reveal targets a file — or, from a folder search row's menu (YAZ-2050) or Enter on it
  // (YAZ-2662 D1), a DIR of the tree. Both questions are asked once here and read by the two steps
  // below — of the tree of the vault that holds the target (YAZ-2602 S17). A vault's row is a dir
  // of the tree too: the cut tree of a search draws it, with its menu (A9).
  const revealRoot = pendingReveal === null ? root : rootOf(pendingReveal.path)
  const revealTree = trees.get(revealRoot) ?? null
  const revealIsDir = pendingReveal !== null && (dirs.includes(pendingReveal.path) || vaultRows.has(pendingReveal.path))
  const revealTargetPresent = revealTree !== null && pendingReveal !== null && (revealIsDir || treeHasFile(revealTree.tree, pendingReveal.path))

  useEffect(() => {
    if (revealTree === null || pendingReveal === null || handledFilesRevealId.current === pendingReveal.id) return
    handledFilesRevealId.current = pendingReveal.id
    if (!revealTargetPresent) {
      onNotice(revealMissingMessage(nameOf(pendingReveal.path)), 'error')
      return
    }
    // A folder opens ITSELF too — the synthetic-child idiom the create menu already uses. Its vault's row opens with it.
    openTo(revealIsDir ? `${pendingReveal.path}/x` : pendingReveal.path)
  }, [nameOf, onNotice, openTo, pendingReveal, revealIsDir, revealTargetPresent, revealTree])

  const filesRevealReady = revealTargetPresent && !closedVaults.includes(revealRoot) && ancestorDirs(revealRoot, pendingReveal.path).every((dir) => expanded.includes(dir))

  useEffect(() => {
    if (!filesRevealReady || pendingReveal === null || bodyRef.current === null) return
    // The keyboard focus goes to the row one time for each request (YAZ-2662 D1, D8): a folder above
    // it that is opened again later flashes the row and moves no focus.
    const focus = pendingReveal.focus === true && focusedRevealId.current !== pendingReveal.id
    focusedRevealId.current = pendingReveal.id
    return flashTreeRows(bodyRef.current, pendingReveal.path, focus) ?? undefined
  }, [filesRevealReady, pendingReveal])

  // ---- New note / new folder (GRO-2022): right-click menu → inline name input ----

  // The ONE builder of the row menu, by the row and the point: a right-click in the panel
  // (`openMenu`) and a menu request (YAZ-2663 D6). `outside` is a row that is not the panel's — a
  // row of the new tab page. It is a row like a search row: a disk row, with "Show in sidebar"
  // first, whose tree-drawing items show it in Files first (S27, S30). It is no pick and no
  // highlight of the panel, and its menu is the menu of one row (S32).
  const openMenuAt = useCallback(
    (node: MenuRow | null, x: number, y: number, outside = false) => {
      const filePath = node?.type === 'file' ? node.path : null
      // A right-click on a row the selection does NOT hold is a fresh target, so the selection
      // becomes THAT row (D9, YAZ-1674 — the Finder rule; it used to merely clear), which keeps
      // the plural items honest: whatever they name is what the user can still see highlighted.
      // BLANK SPACE is not a row and never touches it (YAZ-1337): its menu is about the vault
      // root, and a right-click into the empty space below the tree must not throw a selection away.
      // Nor is a SHORTCUT row a pick (YAZ-2290 D2): the selection is what ⌘C / ⌘X act on.
      if (!outside && node !== null && node.shortcutIn === undefined && !selectedPaths.has(node.path)) dispatchSelection({ type: 'set', path: node.path })
      // On a search row the highlight follows the right-click too, as it follows a click (YAZ-803; S26 on YAZ-2620).
      if (!outside && searching && node !== null) searchCursor.set(node.path)
      // The plural gesture exists only when the right-clicked row — file or folder (YAZ-1578) — is
      // ITSELF in a selection of two or more (🔒 D5): a selection of one already IS the singular
      // menu, and a row outside the selection just ended it above. Read once, here, like every
      // other target this menu pins.
      const plural = !outside && node !== null && selectedPaths.has(node.path) && selectedPaths.size >= 2 ? orderedSelectedPaths() : null
      // A VAULT row (YAZ-2602 D3) is its own kind: a folder that is a vault, with that vault's root.
      // It creates and pastes like a folder; it is not opened, clipped, renamed, deleted, favorited,
      // reviewed or put in the focus list (S13, A2). A selection that holds one has no plural item (A3).
      const vaultRow = node !== null && vaultRows.has(node.path) ? rootOf(node.path) : null
      const holdsVault = plural !== null && plural.some((path) => vaultRows.has(path))
      const pluralRows = holdsVault ? null : plural
      const home = node === null ? vaultsRef.current[0] : vaultOf(node.path)
      // Blank space is the vault ROOT (GRO-2273) — of a window with one vault. With two or more it is no one vault's (S10).
      const blank = multi ? null : root.replace(/\/+$/, '')
      // App's answer for the row (YAZ-2322), asked ONCE here like every other target this menu pins.
      const inReview = filePath === null ? null : reviewState(filePath)
      // Only a ROW opens a menu on the Search tab (blank space there offers none), and a search row is a disk row.
      const asSearch = searching || outside
      const menuLens: SidebarLens = asSearch ? 'files' : lens
      // A shortcut row (YAZ-2290 E5): `node.path` is the note where it LIVES, this the folder the row stands in.
      const shortcutIn = node?.shortcutIn ?? null
      setMenu({
        x,
        y,
        lens: menuLens,
        leaveSearchTo: asSearch ? (node?.path ?? null) : null,
        // Any row that is not the Files tree's own (YAZ-2638 D1, D3): Search, Focus, Favorites. One row, never a selection.
        showPath: (outside || lens !== 'files') && plural === null ? (node?.path ?? null) : null,
        targetDir: node === null && multi ? null : targetDirFor(node, root),
        rowKind: node?.type ?? null,
        // ONE field per item, each resolved on its own (GRO-2296). Several are the same
        // expression TODAY and must stay independent anyway — `copyPath`'s root fallback
        // below is exactly the divergence the split exists for.
        //
        // Blank space copies the vault ROOT (GRO-2273): the blank area already means "the
        // root" everywhere else here (`targetDirFor` sends "New note" there), and VS Code's
        // empty-Explorer menu does the same. Trailing separators are stripped so the copied
        // bytes match the root the rest of the app uses.
        copyPath: node?.path ?? blank,
        openPath: plural === null && node?.type === 'dir' && vaultRow === null ? node.path : null,
        // Both plural fields read the ONE ordered list above and stay separate fields, as the
        // doctrine asks. A folder is a tab too (YAZ-2290 D3), so the open item counts every row.
        copyPaths: pluralRows,
        openTabPaths: pluralRows,
        clipPaths: shortcutIn !== null || vaultRow !== null || holdsVault ? null : plural ?? (node === null ? null : [node.path]),
        newWindowPath: filePath,
        renamePath: shortcutIn !== null || vaultRow !== null ? null : node?.path ?? null,
        deletePath: shortcutIn !== null || vaultRow !== null ? null : node?.path ?? null,
        revealPath: node?.path ?? blank,
        openVsCodePath: node?.path ?? blank,
        openDefaultPath: vaultRow !== null ? null : node?.path ?? blank,
        // Focus (YAZ-2619 D3): the row or its ordered selection, any kind, any lens, any vault of the
        // window — the favorites rule below. A vault row is no item of the list (YAZ-2602 A2, A3).
        focusPaths: node === null || vaultRow !== null || holdsVault ? null : plural ?? [node.path],
        focusIsOn: node !== null && (plural ?? [node.path]).every((p) => focusList.includes(p)),
        // Favorites (YAZ-1766 D3): the row or its ordered selection, any kind, any lens; blank space has nothing to pin.
        favoritePaths: node === null || vaultRow !== null || holdsVault ? null : plural ?? [node.path],
        // Each row by the list of the vault that holds it (YAZ-2631 D1).
        favoriteIsOn: node !== null && (plural ?? [node.path]).every((p) => favoritesByRoot[rootOf(p)]?.includes(p) === true),
        // By the upkeep of the vault that holds the folder (R5).
        reviewDir: home.upkeep && node?.type === 'dir' && vaultRow === null ? node.path : null,
        reviewPath: inReview === null ? null : filePath,
        reviewIsOn: inReview === true,
        // A shortcut is a folder's ID on a note: offered only where the vault uses IDs (YAZ-2523 🔒 V5).
        shortcutDir: home.index.ids && plural === null && node?.type === 'dir' && vaultRow === null ? node.path : null,
        removeShortcut: node === null || shortcutIn === null ? null : { path: node.path, dir: shortcutIn },
        // The known vaults that are not in this window (YAZ-2602 D2), in the order of the ⌘O list, read as the menu opens.
        addVaults: node !== null ? null : storage.listVaults().flatMap(({ path, name }) => (roots.includes(path) ? [] : [{ path, name }])),
        removeVault: vaultRow,
      })
    },
    [root, roots, multi, vaultRows, rootOf, vaultOf, selectedPaths, orderedSelectedPaths, lens, searching, searchCursor, focusList, favoritesByRoot, reviewState],
  )
  const openMenu = useCallback(
    (node: MenuRow | null, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      openMenuAt(node, e.clientX, e.clientY)
    },
    [openMenuAt],
  )
  // A menu request (YAZ-2663 D6) is acted on one time, when the panel can say what the path is: a
  // request that is set when the panel mounts waits for the tree of its vault, and for the
  // favorites of that vault, which the menu reads as it opens (S31). A path the tree does not hold
  // opens nothing.
  const seenMenuId = useRef<number | null>(null)
  useEffect(() => {
    if (menuRequest === null || seenMenuId.current === menuRequest.id) return
    const vault = rootOf(menuRequest.path)
    if (forest === null || !trees.has(vault) || favoritesByRoot[vault] === undefined) return
    seenMenuId.current = menuRequest.id
    onMenuConsumed(menuRequest.id)
    const node = findNode(forest, menuRequest.path)
    if (node !== null) openMenuAt(node, menuRequest.x, menuRequest.y, true)
  }, [menuRequest, forest, trees, favoritesByRoot, rootOf, onMenuConsumed, openMenuAt])

  const { clip, clipTo, pasteInto, pendingPaste, confirmPaste, cancelPaste } = useFileClipboard(root, vaultOf, vaultRows, menu, selectedPaths, orderedSelectedPaths, dirs, refresh, openTo, clipboardRef, onNotice)

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

  /** Context menu "Open in new window" (D2, GRO-2168): a fresh window on {root, file} — the vault that holds the file, alone (YAZ-2602 S33); this one untouched. (⌘-click opens a background tab instead since I3.) */
  const openFileNewWindow = useCallback(
    (path: string) => {
      api.window.open({ root: rootOf(path), file: path }).catch((err: unknown) => console.error('[sidebar] window.open failed:', err))
    },
    [rootOf],
  )

  const { setRenamingEntry, startCreate, renaming, pending } = useInlineEdits(multi ? null : root, vaultOf, menu, setMenu, favoriteNodes, focusNodes, onLensChange, refresh, onOpenFile, onRenameFile, onRetitle, openTo)

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
      if (kind === 'dir') target.children = countChildren(forest ?? [], path)
      setConfirmingDelete(target)
      // The index is only needed for the count, so it rides in asynchronously and the sheet
      // opens immediately. Failure leaves the line out; it never blocks or spins. It is the index
      // of the vault that holds the row: links stay inside a vault (YAZ-2602 R1).
      const vault = rootOf(path)
      api.index(vault).then(
        ({ records, folders, ids }) => {
          const n = countLinkReferences({ ids, root: vault, oldPath: path, kind, records, folders, dirs: dirsOf(vault) })
          setConfirmingDelete((current) => (current !== null && current.path === path ? { ...current, backlinks: n } : current))
        },
        () => undefined,
      )
    },
    [menu, rootOf, forest, dirsOf, settings.confirmDelete, onDeleteFile],
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
    void removeShortcut(dir, path, vaultOf(dir).index.folders, rootOf(dir)).catch((err: unknown) => onNotice(`Can't remove the shortcut: ${err instanceof Error ? err.message : String(err)}`, 'error'))

  // The one list the shown tab's top rows reorder, and its writer (YAZ-2631 D3): every favorite of the
  // window in the tab's order (D1), the focus list, or the vault rows of Files (D5).
  const orderRef = useRef<readonly string[]>([])
  orderRef.current = lens === 'favorites' ? favoritePaths : lens === 'focus' ? focusList : roots.map(stripSlash)
  const saveOrder = lens === 'favorites' ? saveFavoriteOrder : lens === 'focus' ? reorderFocus : onReorderVaults
  const { dragging, dropDir, setDropDir, dropOnDir, fileMove, reorder } = useTreeDrag(onRenameFile, orderRef, saveOrder, rootOf, onNotice)

  /**
   * The Files, Focus and Favorites trees are memoised per level (YAZ-2194), so what they get must keep
   * its identity across renders that change nothing for them. The context menu handler reads the
   * selection and the tree, so it changes on every click; the rows call it through this stable door.
   */
  const openMenuRef = useRef(openMenu)
  openMenuRef.current = openMenu
  const openRowMenu = useCallback((node: MenuRow, e: React.MouseEvent) => openMenuRef.current(node, e), [])
  // What the trees share; each tab adds only what differs (`nodes`, `move`, `reorder`), and the
  // search tree puts its own folds, highlight and marks over it (YAZ-2620). It is SPREAD into each
  // `<Tree>`, so the memo above compares the values, never this object.
  const treeProps = {
    // Above the vault rows no one directory stands (YAZ-2602 D3).
    dirPath: multi ? '' : root,
    vaultRows,
    expanded: expandedSet,
    activeFile,
    onToggle: toggleDir,
    onOpenFile,
    onKeepFile,
    onOpenFileBackground,
    onOpenDefault: openDefault,
    onNodeContextMenu: openRowMenu,
    pending,
    renaming,
    selection,
    shortcuts,
    titles,
    onLeaveToPage,
  }
  // A search tree's own (YAZ-2620): its folds, its highlight and its marks; nothing in it creates, renames or drags.
  const searchTreeProps = { ...treeProps, expanded: searchOpen, onToggle: toggleSearchDir, pending: null, renaming: null, move: INERT_MOVE, selection: searchSelection, shortcuts: NO_SHORTCUTS, marks }

  // A vault that could not be read says so on every tab: one line per vault, its own (YAZ-2602).
  const errorLines = errors.map((message, at) => (
    <p key={at} className="sidebar__msg sidebar__msg--error">
      {message}
    </p>
  ))

  // A search row's tree-drawing items leave the search first (🔒 D2, YAZ-2050) through
  // `onRevealInFiles`: App flips to Files; the reveal expands and flashes the row — and the item's
  // input lands beside the row it names. The query stays in the Search tab (YAZ-2638 D2).
  const viaTree =
    <A extends unknown[]>(run: (...args: A) => void) =>
    (...args: A): void => {
      const leaveTo = menu?.leaveSearchTo ?? null
      if (leaveTo !== null) onRevealInFiles(leaveTo)
      run(...args)
    }

  return (
    <aside ref={asideRef} className="sidebar" style={{ width }}>
      {/* The root header doubles as the "move to the vault root" drop target (E1b) — of a window
          with one vault. With two or more each vault's own row is that target (YAZ-2602 S14). */}
      <div
        className={`sidebar__header${!multi && dropDir === root ? ' sidebar__header--drop' : ''}`}
        onDragOver={(e) => {
          if (dragging === null || multi) return
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
          if (dropDir !== root) setDropDir(root)
        }}
        onDragLeave={() => {
          if (!multi && dropDir === root) setDropDir(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          if (!multi) dropOnDir(root)
        }}
      >
        {/* The vault switcher (YAZ-1767): the trigger is the header's top-left button (name + chevron,
            D6); its panel hangs off this header's rect (D5). "Open folder…" is its last row (D4). */}
        <VaultSwitcher
          roots={roots}
          onPickFolder={onPickFolder}
          pickDisabled={pickDisabled}
          openRequest={switcherOpenRequest}
          // The right-click menu (YAZ-1798): the file menu's own OS verbs and notice, App's in-place switch — and its add (YAZ-2602 S8).
          onOpenHere={onOpenVaultHere}
          onAddHere={onAddVault}
          onReveal={reveal}
          onOpenVsCode={openVsCode}
          onNotice={onNotice}
        />
        <button type="button" className="sidebar__collapse" onClick={onCollapse} title="Hide sidebar" aria-label="Hide sidebar">
          <SidebarPanelIcon />
        </button>
      </div>
      {/* The Inbox (YAZ-2322), with upkeep on: above the tabs, so it shows on every tab — the Search tab too.
          One row per vault that has upkeep on (YAZ-2602 R5), in vault order; two or more say whose each is. */}
      {inboxes.map((vault) => {
        const label = inboxes.length > 1 ? `Inbox · ${vault.name}` : 'Inbox'
        return (
          <button
            key={vault.root}
            type="button"
            className={`sidebar__inbox${vault.reviewing ? ' sidebar__inbox--active' : ''}`}
            aria-pressed={vault.reviewing}
            aria-label={vault.dueCount > 0 ? `${label}, ${vault.dueCount} due` : label}
            onClick={() => onInbox(vault.root)}
          >
            {label}
            {vault.dueCount > 0 && <span className="tree__count">{vault.dueCount}</span>}
          </button>
        )
      })}
      {/* The tabs (🔒 D4, YAZ-847; YAZ-2638 D2) — chrome v2 ROW 1: Files (the file explorer), Search,
          Focus, Favorites. Search is a tab of its own, and switching tabs never touches its query.
          `role="tab"` + `aria-selected` only — no `aria-controls`/`tabpanel`: the one body below is
          every tab's. */}
      <div className="sidebar__lenses" role="tablist" aria-label="Sidebar lens">
        {SIDEBAR_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={lens === id}
            className={`sidebar__lens${id !== 'files' ? ' sidebar__lens--glyph' : ''}${lens === id ? ' sidebar__lens--active' : ''}`}
            onClick={() => onLensChange(id)}
            // Search, Focus and Favorites are glyphs, not words (YAZ-2638 D2, YAZ-2619 D4, YAZ-1766 D1): the label lives in `title` + `aria-label`.
            title={id !== 'files' ? LENS_LABEL[id] : undefined}
            aria-label={id !== 'files' ? LENS_LABEL[id] : undefined}
          >
            {id === 'favorites' ? <HeartIcon /> : id === 'focus' ? <EyeIcon /> : id === 'search' ? <SearchIcon /> : LENS_LABEL[id]}
          </button>
        ))}
        {/* One button for both directions AND every lens (⚡ YAZ-862, ⚡ YAZ-873): anything open
            collapses everything, and only a fully closed tree expands it. It acts on whichever
            lens is ACTIVE. Gone — not disabled — on the Search tab (YAZ-2638 D2: its folds are
            the search's own) and whenever the active reading has nothing to
            unfold: no folder, and no vault row. */}
        {!searching && (bodyDirs.length > 0 || foldVaults) && (
          <button
            type="button"
            className="sidebar__expand-all"
            aria-label={allLabel}
            title={allLabel}
            onClick={() => {
              if (foldVaults) for (const vault of roots) onSetVaultOpen(vault, !anyExpanded)
              // Only the active lens' dirs move (YAZ-1605): a fold the tab does not show is exactly as it was.
              dispatch({ type: 'setAll', dirs: anyExpanded ? expanded.filter((d) => !bodyDirs.includes(d)) : [...new Set([...expanded, ...bodyDirs])] })
            }}
          >
            <ChevronsIcon />
          </button>
        )}
      </div>
      {/* The search bar (YAZ-739 A-, chrome v2 row 2), on the Search tab only (YAZ-2638 D2): the
          tab carries the magnifier, so the bar has none. With text typed the body below is the
          results (YAZ-803); the text stays while a different tab shows. */}
      {searching && (
        <div className="sidebar__search">
          <input
            ref={searchInput}
            className="sidebar__search-input"
            type="text"
            placeholder="Search"
            title="Search (⌘K)"
            aria-label="Search notes"
            value={query}
            onChange={changeQuery}
            // With no text → and ↓ have nothing to do in the bar: they go to the first row of the
            // new tab page, when it shows and has one (YAZ-2663 D7, S33). With text, and with no
            // such row, every key is the search's as before (S34).
            onKeyDown={(e) => {
              const out = query === '' && (e.key === 'ArrowRight' || e.key === 'ArrowDown') && !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)
              if (out && onLeaveToPage?.() === true) e.preventDefault()
              else searchKeyDown(e)
            }}
          />
          {/* The way out, in sight (YAZ-2638 D2): Esc goes back to the lens the window last showed,
              keeps the text and puts the caret in the open page (YAZ-2662 D9), and this keycap —
              always in the bar — says so and IS the key on a click (S58): with the preview panel on
              show it closes the panel only. No Tab stop: the key it names is the keyboard's way.
              A press on it takes no focus, so the caret is still in the bar after such a click. */}
          <button type="button" className="sidebar__search-back" title="Back (Esc)" aria-label="Leave search" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={searchEsc}>
            esc
          </button>
        </div>
      )}
      {/* The blank-space menu is the TREE's ("New note" here creates in the vault root); the
          Search tab has no such target, so right-clicking its blank space offers nothing (YAZ-803)
          — not even Electron's text menu, which leaked through until YAZ-2050. Its ROWS get the
          full menu. Blank space means the same thing in every lens: the vault ROOT. */}
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
        {searching && !typed ? (
          // The Search tab with an empty bar (YAZ-2638 D2): one line, the keys of the search below it
          // (YAZ-2662 D10), and no tree.
          <>
            <p className="sidebar__msg">Type to search every note and folder.</p>
            <dl className="sidebar__keys">
              {SEARCH_KEYS.map(([keys, does]) => (
                <Fragment key={does}>
                  <dt>
                    {keys.map((cap) => (
                      <kbd key={cap}>{cap}</kbd>
                    ))}
                  </dt>
                  <dd>{does}</dd>
                </Fragment>
              ))}
            </dl>
          </>
        ) : searching ? (
          // The Search tab with text typed (YAZ-2638 D2): its body is the Files tree cut down to
          // the matches and their parents (YAZ-2620 🔒 D1): full tree rows,
          // each with its own menu. The folds and the highlight are the search's own; nothing here
          // creates, renames or drags, and a note shows once, where it lives (S7). Only this tree
          // gets `marks` (🔒 D5): the typed text bold in a match, every other row dim. With two or
          // more vaults each match stands under its vault's row, a parent like any folder (YAZ-2602 A9).
          // The matches of the pinned items are a group of their own, first and under its label
          // (YAZ-2662 D2): its top rows are the pinned items, each named for its vault where the
          // window has two or more, as on the Favorites tab (S26). A line and a label then head the
          // other matches. With no pinned match there is neither (S21); with no other match, no line (S20).
          found.top.length > 0 || found.rest.length > 0 ? (
            <>
              {found.top.length > 0 && (
                <>
                  <p className="sidebar__group">Favorites and focus</p>
                  <Tree {...searchTreeProps} nodes={found.top} />
                  {found.rest.length > 0 && <p className="sidebar__group">Everything else</p>}
                </>
              )}
              {found.rest.length > 0 && <Tree {...searchTreeProps} nodes={found.rest} />}
              {/* The limit (🔒 D6): the ranking keeps the best `SEARCH_CAP` candidate rows — of every vault together — and a line says so once it is reached. */}
              {results.length === SEARCH_CAP && <p className="sidebar__msg">Showing {SEARCH_CAP} matches. Type more to narrow.</p>}
            </>
          ) : (
            <p className="sidebar__msg">No matches</p>
          )
        ) : lens === 'favorites' ? (
          // The Favorites tab (YAZ-1766): the pinned rows in the user's order, each a full tree row —
          // a favorited folder unfolds in place through the SAME `expanded` set as Files (D7) and
          // every row carries the same menu plus "Show in sidebar" first (YAZ-2638 D3). A top row drags to reorder the list, and a file inside a
          // favorited folder drags to move on disk (YAZ-2631 D3). With two or more vaults the favorites
          // of every vault stand in the one list, and each top row names its vault (YAZ-2631 D1, D4).
          <>
            {errorLines}
            {!loaded && favoriteNodes.length === 0 && errors.length === 0 && <p className="sidebar__msg">Loading…</p>}
            {loaded && favoriteNodes.length === 0 && <p className="sidebar__msg">No favorites yet. Right-click a file or folder → Add to favorites.</p>}
            {favoriteNodes.length > 0 && <Tree {...treeProps} nodes={favoriteNodes} move={fileMove} reorder={reorder} />}
          </>
        ) : lens === 'focus' ? (
          // The Focus tab (YAZ-2619 D2, D4): the window's focus list in its own order, each a full
          // tree row with the same menu plus "Show in sidebar" first (YAZ-2638 D3), under a line that counts the top rows (R11) and clears the
          // list. A top row drags to reorder the list, and a file inside a focused folder drags to move
          // on disk (YAZ-2631 D3). With two or more vaults the items of every vault stand in the one
          // list, and each top row names its vault (YAZ-2602 A4).
          <>
            {errorLines}
            {!loaded && focusNodes.length === 0 && errors.length === 0 && <p className="sidebar__msg">Loading…</p>}
            {loaded && focusNodes.length === 0 && <p className="sidebar__msg">Nothing in focus. Right-click a file or folder → Add to focus.</p>}
            {focusNodes.length > 0 && (
              <>
                <div className="sidebar__focus-bar">
                  <span>{focusNodes.length} in focus</span>
                  <button type="button" className="sidebar__focus-clear" onClick={clearFocus}>
                    Clear
                  </button>
                </div>
                <Tree {...treeProps} nodes={focusNodes} move={fileMove} reorder={reorder} />
              </>
            )}
          </>
        ) : (
          <>
            {errorLines}
            {forest === null && errors.length === 0 && <p className="sidebar__msg">Loading…</p>}
            {forest !== null && forest.length === 0 && pending === null && (
              <p className="sidebar__msg">No notes here.</p>
            )}
            {/* One vault → its tree. Two or more → one row per vault (YAZ-2602 D3), and a vault row drags to reorder (YAZ-2631 D5). */}
            {forest !== null && <Tree {...treeProps} nodes={forest} move={fileMove} reorder={multi ? reorder : undefined} />}
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
              onOpen: onKeepFile,
              onOpenInNewTabs: openFilesInTabs,
              onShowInSidebar: onRevealInFiles,
              onOpenNewWindow: openFileNewWindow,
              onOpenVsCode: openVsCode,
              onOpenDefault: openDefault,
              onReveal: reveal,
              // An add shows the Focus tab (YAZ-2619 D3) — not from the Search tab, which stays
              // (YAZ-2638 D2); a remove keeps the tab (R5). This is not a `viaTree` item.
              onToggleFocus: (paths, isOn) => {
                toggleFocus(paths, isOn)
                if (!isOn && !searching && lens !== 'focus') onLensChange('focus')
              },
              onCut: (paths) => clipTo(paths, 'cut'),
              onCopy: (paths) => clipTo(paths, 'copy'),
              onPaste: () => menu.targetDir !== null && pasteInto(menu.targetDir),
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
                const { index } = vaultOf(dir)
                const lost = valuesLeftByShortcut(dir, path, index.records, index.folders)
                if (lost.folders.length === 0) removeShortcutRow(path, dir)
                else setConfirmingShortcut({ path, dir, lost })
              },
              onRename: viaTree((path) => setRenamingEntry({ path, kind: menu.rowKind === 'file' ? 'file' : 'dir' })),
              onDelete: askDelete,
              onAddVault: (path) => void onAddVault(path),
              onPickVault,
              onRemoveVault,
            },
          )}
          onClose={() => setMenu(null)}
        />
      )}
      {confirmingDelete !== null && <ConfirmDelete target={confirmingDelete} titles={titles} onConfirm={confirmDelete} onCancel={() => setConfirmingDelete(null)} />}
      {pendingPaste !== null && <ConfirmMove moves={pendingPaste.moves} copy={pendingPaste.copy} lost={pendingPaste.lost} titles={titles} onConfirm={confirmPaste} onCancel={cancelPaste} />}
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
          folder={relTo(rootOf(pickingShortcut), pickingShortcut)}
          source={vaultOf(pickingShortcut).index}
          onPick={(path) => {
            setPickingShortcut(null)
            // The row follows the index, as every other write's do; only a refusal is said.
            addShortcut(pickingShortcut, path).catch((err: unknown) => onNotice(`Can't add the shortcut: ${err instanceof Error ? err.message : String(err)}`, 'error'))
          }}
          onClose={() => setPickingShortcut(null)}
        />
      )}
    </aside>
  )
}
