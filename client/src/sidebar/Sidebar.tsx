import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import { fileKind } from '@shared/fileKind'
import { SIDEBAR_LENSES, type GithubSyncStatus, type SettingsState, type SidebarLens, type TreeNode, type TreeResponse } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import type { IndexRecord } from '@shared/types'
import { folderPageSettings } from '../views/folderPageSettings'
import { restoreFolderBody } from '../views/migrateFolderBody'
import { createNewNote } from '../views/newNote'
import { memberFolder, newPageFromFolderPage } from '../views/scaffold'
import { ChevronsIcon, SearchIcon } from '../views/view/icons'
import { transformFile, writeProperty } from '../views/writeProperty'
import type { ResolveLink, WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { WatchSource } from '../hooks/useWatch'
import { focusOpenDocument } from '../lib/focusHandoff'
import { basename, stripExt } from '../lib/paths'
import { storage } from '../lib/storage'
import { linkNames } from '../links/completion'
import { FOLDER_PAGE_KEY, FOLDER_PAGES_KEY, folderPagesLookup, isFolderPage } from '../links/folderPages'
import { countLinkReferences } from '../links/renameLinks'
import { allDirs, ancestorDirs, treeHasFile, treeReducer } from '../lib/treeState'
import { SearchResults } from '../search/SearchResults'
import { useSearchResults } from '../search/useSearchResults'
import { ConfirmDelete, type DeleteTarget } from './ConfirmDelete'
import { ConfirmTurnBack } from './ConfirmTurnBack'
import { ContextMenu } from './ContextMenu'
import { entryPath, renamedPath, targetDirFor, type EntryKind, type MenuRow } from './createEntry'
import { HotkeysButton } from './HotkeysPanel'
import { SettingsCog } from './SettingsPanel'
import { TopicsTree, allExpandableTopics, type PendingTopicCreate } from './TopicsTree'
import { Tree, type PendingCreate, type PendingRename, type TreeFileMove } from './Tree'
import { flashTreeRows, revealMissingMessage, type SidebarRevealRequest } from './revealRow'

interface SidebarProps {
  root: string
  activeFile: string | null
  watch: WatchSource
  onOpenFile: (path: string) => void
  /** ⌘-click on a file row (I3 LOCKED ruling, GRO-2235): open in a background tab; App passes `useTabs`' openBackground. */
  onOpenFileBackground: (path: string) => void
  onPickFolder: () => void
  /** True while the native folder dialog is open; the "change" button is disabled meanwhile. */
  pickDisabled: boolean
  /** Hide the sidebar (GRO-2023); App renders the floating reopen button while hidden. */
  onCollapse: () => void
  /**
   * Which lens the tabs row shows (🔒 D4, YAZ-847). App-owned and globally persisted
   * (`AppState.sidebarLens`), never Sidebar-local: this component is mounted `key={root}` and
   * only while the sidebar is open, so local state would forget the choice on every
   * collapse/reopen and every root switch.
   */
  lens: SidebarLens
  /** A lens tab was clicked; App writes it through to the global state and passes the new value back down. */
  onLensChange: (lens: SidebarLens) => void
  /** One tab-menu reveal, pinned to the lens selected when it was requested. */
  revealRequest: SidebarRevealRequest | null
  /** The request has been accepted into Sidebar-local work and must not replay after a remount. */
  onRevealConsumed: (id: number) => void
  /** Editor spacing preferences shown in the footer cog (GRO-2024); App owns and applies them. */
  settings: SettingsState
  onChangeSettings: (next: SettingsState) => void
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
  onRenameFile: (oldPath: string, newPath: string) => Promise<void>
  /**
   * Context-menu "Delete" confirmed (GRO-2272): App moves the entry to the system Trash and
   * routes ANY failure to the passive notice — this promise never rejects, so the sheet just
   * closes. No link rewriting happens downstream (LOCKED decision C).
   */
  onDeleteFile: (path: string) => Promise<void>
  /** Show a transient, unobtrusive message — never a dialog (E1, GRO-2171). App owns the banner. */
  onNotice: (message: string) => void
  /**
   * The window's index snapshot, for the folder-page toggle's LABEL (🔒 D2, YAZ-817). This is
   * deliberately the SAME object `WikilinkIndexBridge` already feeds — App's one always-on
   * per-window index source — read, never written: the sidebar needs one boolean about one
   * right-clicked row, which is not worth a second feed (F1 finding 1, YAZ-808 says so about
   * search) and certainly not new IPC. It is read in the context-menu handler, so the menu never
   * re-renders on index churn and the flag can never disagree with the row it was read for.
   *
   * `records` is `[]` until the first index lands. That reads as "not a folder page", so a
   * right-click in that first moment offers "Turn into folder page" on a page that already is
   * one — and the write is then a no-op, because `writeProperty` never touches disk when the
   * bytes would not change. Report-don't-block: nothing is lost, and the next right-click is right.
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
   * 6C's offer (YAZ-849), threaded straight through to the Topics lens: this folder has no
   * `.yaseendocs/`, so Home was NOT created for it and the lens offers to make one. App owns
   * both — the fact is established once per vault ON OPEN (`useEnsureHome`), which the sidebar
   * cannot do: it is unmounted while collapsed and would let a whole session pass without a Home.
   */
  unadopted: boolean
  /** The offer card's button; App creates Home and opens it. */
  onCreateHome: () => void
  /**
   * GitHub sync (YAZ-1081 3B), straight through to the settings cog: App owns the ONE
   * `useGithubSync` this window has, because the chip in the editor reads the same one.
   * Absent → the cog renders without a GitHub Sync section.
   */
  sync?: { status: GithubSyncStatus | null; setEnabled: (enabled: boolean) => void }
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
interface MenuTargets {
  x: number
  y: number
  /** Where "New …" creates: a dir row → itself, a file row → its parent, blank space → the root. */
  targetDir: string
  /** The right-clicked row's kind; null for blank space. Drives the Rename input's mode. */
  rowKind: 'file' | 'dir' | null
  /** "Copy path" — the right-clicked row (file or folder), or the vault ROOT for blank space (GRO-2273). */
  copyPath: string | null
  /** "Copy link" — the FILE row's own `[[wikilink]]`, resolved when the menu opens (E3 GRO-2173, YAZ-957). */
  copyLinkText: string | null
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
  /**
   * "Turn into folder page" / "Turn back into normal page" — MARKDOWN FILE rows only (🔒 D2,
   * YAZ-817). Its OWN field, not `newWindowPath` reused: that one is every file row, and a
   * folder row can no more carry the flag than blank space can.
   */
  folderPagePath: string | null
  /** That row's flag when the menu opened, off the window's index snapshot; picks the label. */
  folderPageIsOn: boolean
  /**
   * The TOPICS row this menu was opened from (8G-, YAZ-865; YAZ-1080), or null for every
   * file-tree row and blank space. The create group uses it only to place the one inline input:
   * beneath a page or Uncategorized disk-folder row. `targetDir` still decides where the entry
   * lands through the file tree's own rule.
   */
  topicsAnchor: string | null
}

/**
 * The name "Copy link" wraps in `[[…]]` (YAZ-957): this note's SHORTEST unambiguous link name,
 * through `linkNames` — the ONE lookup sync-from-folder reads too, so the menu and the sync can
 * never spell one note two ways. A note the snapshot has not indexed yet (created seconds ago,
 * between the tree refresh and the index refetch) keeps its bare basename: the name that same
 * rule gives an uncontested note, and the one it will have once the index catches up.
 */
const linkNameFor = (records: readonly IndexRecord[], path: string): string =>
  linkNames(records).get(path) ?? stripExt(basename(path))

/**
 * Notes and subfolders inside `dir`, counted RECURSIVELY from the already-loaded tree
 * (GRO-2272 `C3-`) — a delete takes the whole subtree, so a shallow count would understate
 * what the user is about to lose. No fetch: the sidebar already holds this tree.
 */
export function countChildren(nodes: readonly TreeNode[], dir: string): { notes: number; folders: number } {
  const found = findDir(nodes, dir)
  if (found === null) return { notes: 0, folders: 0 }
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
  walk(found)
  return { notes, folders }
}

function findDir(nodes: readonly TreeNode[], dir: string): readonly TreeNode[] | null {
  for (const node of nodes) {
    if (node.type !== 'dir') continue
    if (node.path === dir) return node.children
    if (dir.startsWith(`${node.path}/`)) {
      const hit = findDir(node.children, dir)
      if (hit !== null) return hit
    }
  }
  return null
}

/**
 * Birth from a FLAGGED folder-page row in Topics (8H, ⚡ YAZ-869 — Yasin's dogfooding ruling).
 *
 * THE RULING: a right-click that says "New note" ON a topic means "a note IN this topic". Anything
 * else is the file tree leaking through a lens that is not about files — the page would be born
 * beside the folder page and belong to NOTHING, and the user would have to go and tag it by hand
 * to see the thing they just made appear where they made it.
 *
 * So "New note" travels the folder page's OWN declaration path — the SAME `newPageFromFolderPage`
 * the contents block's New and the outline's create row use (scaffold ← template ← seed, with
 * `folder_pages` forced LAST) — and parks through the SAME `memberFolder`. One rule, three
 * doorways. "New folder page" is the SUB-TOPIC case and stays 🔒 D1 of YAZ-841's birth exactly:
 * the flag and nothing else, never a template and never a settings block, with the belonging
 * stamped beside it so the new topic shows up nested under the one it was made from.
 *
 * Leaf Topics rows and every Files row keep today's create-beside behaviour untouched: there is no
 * folder page to belong to, so there is nothing to declare.
 */
async function createInTopic(root: string, folderPage: IndexRecord, kind: 'file' | 'folderPage', name: string): Promise<string> {
  const settings = folderPageSettings(folderPage)
  const target = entryPath(await memberFolder(root, folderPage.path, settings), name, kind)
  // The belonging is spelled the way the click rule reads it back — exactly a wikilink on the
  // basename — and both keys go through the ONE source of truth, never a local literal.
  if (kind === 'folderPage') {
    await createNewNote(target, { [FOLDER_PAGE_KEY]: true, [FOLDER_PAGES_KEY]: [`[[${folderPage.basename}]]`] })
    return target
  }
  const parts = await newPageFromFolderPage(root, folderPage.basename, settings)
  await createNewNote(target, parts.properties, parts.body)
  return target
}

/** The lens tabs' copy; the ORDER is `SIDEBAR_LENSES`', so the default lens leads (YAZ-847). */
const LENS_LABEL: Record<SidebarLens, string> = { topics: 'Topics', files: 'Files' }

/** Stands in while the index has not landed; only ever paired with an empty snapshot (TopicsTree's twin). */
const NEVER: ResolveLink = () => null

/** Panel-left pictogram shared by the collapse and reopen buttons (GRO-2023). */
export function SidebarPanelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="5.75" y1="2.5" x2="5.75" y2="13.5" />
    </svg>
  )
}

/** Mounted with `key={root}` by App, so all state below is per root. */
export function Sidebar({
  root,
  activeFile,
  watch,
  onOpenFile,
  onOpenFileBackground,
  onPickFolder,
  pickDisabled,
  onCollapse,
  lens,
  onLensChange,
  revealRequest,
  onRevealConsumed,
  settings,
  onChangeSettings,
  onRootMissing,
  onFileMissing,
  onRenameFile,
  onDeleteFile,
  onNotice,
  indexSource,
  pendingSearchFocus,
  onSearchFocusHandled,
  unadopted,
  onCreateHome,
  sync,
}: SidebarProps) {
  const [tree, setTree] = useState<TreeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, dispatch] = useReducer(treeReducer, root, storage.getExpanded)
  // The TOPICS tree's open pages (🔒 D4), lifted here by ⚡ YAZ-873 so the lens row's one button
  // can read and replace them; the tree itself is controlled. PAGE PATHS, restored from the
  // main-owned per-vault bucket, so it opens where it was left — across a lens switch, a window
  // and a restart alike. A lens switch never touches it: this state outlives the tree's mount.
  const [topicsExpanded, setTopicsExpanded] = useState<ReadonlySet<string>>(() => new Set(storage.getTopicsExpanded(root)))
  const [menu, setMenu] = useState<MenuTargets | null>(null)
  // `anchor` is the TOPICS page or disk-folder row the create was asked from; null on the file
  // tree, where the input nests inside `parentDir`'s own children instead. `intoFolderPage` is
  // that same row only WHEN it is a flagged PAGE (8H, YAZ-869) — a disk folder has no record and
  // therefore keeps plain filesystem creation. Pinned when the menu opens (GRO-2296).
  const [creating, setCreating] = useState<{ kind: EntryKind; parentDir: string; anchor: string | null; intoFolderPage: string | null } | null>(null)
  const [renamingEntry, setRenamingEntry] = useState<{ path: string; kind: 'file' | 'dir' } | null>(null)
  // The delete confirm sheet's target (GRO-2272 `C3-`); null when the sheet is closed.
  const [confirmingDelete, setConfirmingDelete] = useState<DeleteTarget | null>(null)
  // The turn-BACK sheet's target (🔒 D5, YAZ-817); null when closed. Only the reverse has one —
  // turning INTO a folder page never opens a sheet at all (🔒 D1).
  const [confirmingTurnBack, setConfirmingTurnBack] = useState<string | null>(null)
  // File drag-to-move (E1b, GRO-2241): the dragged file row + the highlighted drop target.
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropDir, setDropDir] = useState<string | null>(null)
  // The persistent search bar's query (YAZ-801). It lives HERE rather than in the bar because
  // YAZ-803 swaps the BODY while it is non-empty; Sidebar is mounted `key={root}`, so it resets
  // on unmount and on a root switch without any clearing code.
  const [query, setQuery] = useState('')
  const seenRevealId = useRef<number | null>(null)
  const handledFilesRevealId = useRef<number | null>(null)
  const [pendingReveal, setPendingReveal] = useState<SidebarRevealRequest | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // The highlighted result row (YAZ-803); the keyboard owns it, so it lives with the query.
  const [selected, setSelected] = useState(0)

  const results = useSearchResults(root, watch, query)
  // 🔒 flat-list ruling on YAZ-739: while a query is typed the body shows a FLAT ranked list
  // instead of the tree. A conditional render, not a teardown — every bit of tree state (data,
  // expansion, pending create/rename, drag) lives here and is waiting untouched when it clears.
  const searching = query.trim() !== ''
  // An index refresh can shrink the list under the keyboard's index (F1 finding 2, YAZ-808), so
  // every reader of the selection clamps: the highlight lands on the last row, not on nowhere.
  const sel = Math.min(selected, results.length - 1)

  useEffect(() => {
    if (revealRequest === null || seenRevealId.current === revealRequest.id) return
    seenRevealId.current = revealRequest.id
    onRevealConsumed(revealRequest.id)
    if (revealRequest.lens !== lens) {
      setPendingReveal(null)
      return
    }
    setQuery('')
    setPendingReveal(revealRequest)
  }, [lens, onRevealConsumed, revealRequest])

  useEffect(() => {
    if (pendingReveal !== null && pendingReveal.lens !== lens) setPendingReveal(null)
  }, [lens, pendingReveal])

  // Expand / collapse the whole tree (⚡ YAZ-862, BOTH lenses since ⚡ YAZ-873). "Any open" is
  // measured against what the CURRENT tree can actually unfold, never the raw persisted list:
  // that one can still name paths an external change took away, which would leave the button
  // offering to collapse nothing.
  const dirs = useMemo(() => (tree === null ? [] : allDirs(tree.tree)), [tree])
  // Topics' half of the same question, over the window's ONE index feed — the very source the
  // tree reads, so the two can never disagree; `folderPagesLookup` is memoized per records
  // identity, so this shares the tree's lookup rather than building a second one. Before the
  // first index lands the snapshot is empty, the answer is nothing, and the button is gone.
  const topicRecords = useSyncExternalStore(indexSource.subscribe, () => indexSource.records)
  const topics = useMemo(() => {
    const resolve = indexSource.resolve
    return allExpandableTopics(topicRecords, folderPagesLookup(topicRecords, resolve ?? NEVER), resolve)
  }, [indexSource, topicRecords])
  // One button, the ACTIVE lens' store — never a set shared between the two readings of the vault.
  const foldable = lens === 'topics' ? topics : dirs
  const anyExpanded = lens === 'topics' ? topics.some((page) => topicsExpanded.has(page)) : dirs.some((d) => expanded.includes(d))
  const allLabel = anyExpanded ? 'Collapse all' : 'Expand all'

  const refresh = useCallback(() => {
    api.tree(root).then(
      (res) => {
        setTree(res)
        setError(null)
      },
      (err: unknown) => {
        if (err instanceof BridgeRequestError && (err.code === 'NOT_FOUND' || err.code === 'NOT_A_DIRECTORY')) onRootMissing()
        else setError(err instanceof BridgeRequestError ? err.message : 'Failed to load folder')
      },
    )
  }, [root, onRootMissing])

  useEffect(() => refresh(), [refresh])

  // Refresh on structural changes; `ready` also fires on every watch (re)subscription, covering missed events.
  useEffect(
    () =>
      watch.subscribe((ev) => {
        if (ev.type === 'error') setError(ev.message)
        else if (ev.type !== 'change') refresh()
      }),
    [watch, refresh],
  )

  useEffect(() => {
    // Idempotent like its Topics twin below (⚡ YAZ-874): the first render holds exactly what was
    // just read, and re-sending it would make the main process commit, write and broadcast for nothing.
    const stored = storage.getExpanded(root)
    if (stored.length === expanded.length && stored.every((dir, i) => dir === expanded[i])) return
    storage.setExpanded(root, expanded)
  }, [root, expanded])

  // The Topics bucket's write-back, `expanded`'s twin (🔒 D4) — it came up from the tree with the
  // state in ⚡ YAZ-873, unchanged. Idempotent: the first render after a mount holds exactly what
  // was just read, and re-sending it would make the main process commit, write and broadcast for
  // nothing — including on every Files-lens mount, where the tree is not even on screen.
  useEffect(() => {
    const next = [...topicsExpanded]
    const stored = storage.getTopicsExpanded(root)
    if (stored.length === next.length && stored.every((path, i) => path === next[i])) return
    storage.setTopicsExpanded(root, next)
  }, [root, topicsExpanded])

  useEffect(() => {
    if (activeFile !== null) dispatch({ type: 'expandTo', root, file: activeFile })
  }, [root, activeFile])

  useEffect(() => {
    if (tree === null || pendingReveal?.lens !== 'files' || handledFilesRevealId.current === pendingReveal.id) return
    handledFilesRevealId.current = pendingReveal.id
    if (!treeHasFile(tree.tree, pendingReveal.path)) {
      onNotice(revealMissingMessage(pendingReveal.path, 'files'))
      return
    }
    dispatch({ type: 'expandTo', root, file: pendingReveal.path })
  }, [onNotice, pendingReveal, root, tree])

  const filesRevealReady =
    pendingReveal?.lens === 'files' &&
    tree !== null &&
    treeHasFile(tree.tree, pendingReveal.path) &&
    ancestorDirs(root, pendingReveal.path).every((dir) => expanded.includes(dir))

  useEffect(() => {
    if (!filesRevealReady || pendingReveal === null || bodyRef.current === null) return
    return flashTreeRows(bodyRef.current, pendingReveal.path) ?? undefined
  }, [filesRevealReady, pendingReveal])

  // ⌘K's focus handshake (YAZ-801). Firing on MOUNT is deliberate, not a side effect to guard
  // against: ⌘K with the sidebar collapsed un-collapses it, so the sidebar mounts with the flag
  // already true (0- re-scope on YAZ-800). A plain remount with the flag false focuses nothing.
  useEffect(() => {
    if (!pendingSearchFocus) return
    searchInput.current?.focus()
    onSearchFocusHandled()
  }, [pendingSearchFocus, onSearchFocusHandled])

  // Stored lastFile that no longer exists → drop it (first tree only, so a file deleted on disk
  // EXTERNALLY while it is being edited stays open and is recreated by the next save — an
  // IN-APP delete never reaches here, it closes tabs through the `file:deleted` broadcast
  // which retires the editor first (GRO-2272); do not unify the two. Files OUTSIDE the
  // root (opened via a pasted `#/abs/path.md` URL, GRO-2069) are never in the tree — skip them.
  const validated = useRef(false)
  useEffect(() => {
    if (tree === null || validated.current) return
    validated.current = true
    if (activeFile !== null && activeFile.startsWith(`${root.replace(/\/+$/, '')}/`) && !treeHasFile(tree.tree, activeFile))
      onFileMissing()
  }, [tree, activeFile, root, onFileMissing])

  // A stale tab ACTIVATED after its file vanished on disk (I3, GRO-2235): when the activation
  // CHANGES to an in-root file the cached tree does not show, confirm against a FRESH tree —
  // the inline-create flow activates a just-created file before `refresh()` lands, so the
  // cached tree can be behind — and close it through the same onFileMissing path. A file
  // deleted EXTERNALLY while it is the active editor stays open (no activation change —
  // recreated by the next save); an IN-APP delete never routes through here, it closes tabs
  // via the `file:deleted` broadcast, which also retires the editor first (GRO-2272). Do not
  // unify the two. Background tabs are never probed (out of scope, noted in GRO-2235).
  const lastActive = useRef(activeFile)
  const treeRef = useRef(tree)
  treeRef.current = tree
  useEffect(() => {
    if (activeFile === lastActive.current) return
    lastActive.current = activeFile
    if (activeFile === null || !activeFile.startsWith(`${root.replace(/\/+$/, '')}/`)) return
    if (treeRef.current !== null && treeHasFile(treeRef.current.tree, activeFile)) return
    let cancelled = false // the activation moved on (or the sidebar unmounted): the probe's verdict is stale
    api.tree(root).then(
      (res) => {
        if (!cancelled && !treeHasFile(res.tree, activeFile)) onFileMissing()
      },
      () => undefined, // a root-level failure is refresh()'s problem, not this probe's
    )
    return () => {
      cancelled = true
    }
  }, [activeFile, root, onFileMissing])

  // ---- New note / new folder page / new folder (GRO-2022, YAZ-841): right-click menu → inline name input ----

  const openMenu = useCallback(
    (node: MenuRow | null, e: React.MouseEvent, topicsAnchor: string | null = null) => {
      e.preventDefault()
      e.stopPropagation()
      const filePath = node?.type === 'file' ? node.path : null
      // The toggle's own target (🔒 D2): a NOTE — `fileKind` is the
      // same classifier the tree and the index use, never a local `.md` test. The flag is read
      // HERE, once, off the window's snapshot: the menu that opens is about the row that was
      // right-clicked, and pinning the boolean into the menu's state is what keeps it that way.
      const notePath = filePath !== null && fileKind(filePath) === 'markdown' ? filePath : null
      setMenu({
        x: e.clientX,
        y: e.clientY,
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
        // "Copy link" copies the note's `[[wikilink]]` (YAZ-957), resolved HERE off the same
        // snapshot `folderPageIsOn` reads and pinned into the menu's state: the menu that opens
        // is about the row that was right-clicked, whatever the index does next.
        copyLinkText: filePath === null ? null : `[[${linkNameFor(indexSource.records, filePath)}]]`,
        newWindowPath: filePath,
        renamePath: node?.path ?? null,
        deletePath: node?.path ?? null,
        revealPath: node?.path ?? root.replace(/\/+$/, ''),
        openVsCodePath: node?.path ?? root.replace(/\/+$/, ''),
        folderPagePath: notePath,
        folderPageIsOn: notePath !== null && indexSource.records.some((r) => r.path === notePath && isFolderPage(r)),
        topicsAnchor,
      })
    },
    [root, indexSource],
  )

  /**
   * A Topics row's right-click: the SAME menu, opened on the page FILE (YAZ-865) or projected
   * disk DIRECTORY (YAZ-1080). Every item resolves its own target from that shared `MenuRow`;
   * the anchor rides along so the create group knows where to draw its inline input.
   */
  const openTopicsMenu = useCallback((row: MenuRow, e: React.MouseEvent) => openMenu(row, e, row.path), [openMenu])

  /** Context menu "Open in new window" (D2, GRO-2168): a fresh window on {root, file}; this one untouched. (⌘-click opens a background tab instead since I3.) */
  const openFileNewWindow = useCallback(
    (path: string) => {
      window.yaseenDocs.window.open({ root, file: path }).catch((err: unknown) => console.error('[sidebar] window.open failed:', err))
    },
    [root],
  )

  const startCreate = useCallback(
    (kind: EntryKind) => {
      if (menu === null) return
      // The input renders inside the target dir's children, so that dir must be open;
      // expandTo opens every dir ABOVE the given path, so a synthetic child opens targetDir itself.
      if (menu.targetDir !== root) dispatch({ type: 'expandTo', root, file: `${menu.targetDir}/x` })
      setCreating({
        kind,
        parentDir: menu.targetDir,
        anchor: menu.topicsAnchor,
        // TOPICS only, and only on a row that IS a folder page (8H, YAZ-869): `topicsAnchor` is
        // null for every Files row and for blank space, so that lens is untouched by construction,
        // and a leaf topic has nothing to belong to. Both facts were read when the menu opened.
        intoFolderPage: menu.topicsAnchor !== null && menu.folderPageIsOn ? menu.topicsAnchor : null,
      })
      setMenu(null)
    },
    [menu, root],
  )

  const submitCreate = useCallback(
    async (name: string) => {
      if (creating === null) return
      // A folder is never a member — belonging is a page's word about itself — so "New folder"
      // keeps the file tree's rule even here. The record is re-read off the window's snapshot: if
      // it has vanished since the menu opened, this falls through to the plain create rather than
      // failing, which is the standing report-don't-block rule.
      const topic = creating.kind === 'dir' || creating.intoFolderPage === null ? undefined : indexSource.records.find((r) => r.path === creating.intoFolderPage)
      if (topic !== undefined) {
        const born = await createInTopic(root, topic, creating.kind === 'folderPage' ? 'folderPage' : 'file', name)
        setCreating(null)
        refresh()
        onOpenFile(born)
        return
      }
      const p = entryPath(creating.parentDir, name, creating.kind)
      if (creating.kind === 'dir') await api.createDir(p)
      // Born a folder page (🔒 D4 + D1, YAZ-841): the SAME atomic content-at-create call the 5D
      // seed uses, carrying exactly `folder_page: true` and nothing else — no settings block
      // (4C's panel writes those when the user picks some), no body, no `folder_pages`. The key
      // is `FOLDER_PAGE_KEY`, the one `isFolderPage` reads back, never a local literal.
      else if (creating.kind === 'folderPage') await createNewNote(p, { [FOLDER_PAGE_KEY]: true })
      else await api.createFile(p)
      setCreating(null)
      refresh()
      if (creating.kind !== 'dir') onOpenFile(p)
    },
    [creating, refresh, onOpenFile, root, indexSource],
  )

  const cancelCreate = useCallback(() => setCreating(null), [])

  /**
   * Reveal in Finder (GRO-2274). Read-only, so there is no confirm and nothing to repair —
   * but a STALE row (deleted or moved externally) rejects `NOT_FOUND`, and that has to be
   * visible: `showItemInFolder` is silent on a missing path, so without a notice the menu
   * item would just look broken.
   */
  const reveal = useCallback(
    (path: string) => {
      api.reveal({ path }).catch((err: unknown) => {
        onNotice(err instanceof BridgeRequestError && err.code === 'NOT_FOUND' ? `Can't reveal "${basename(path)}" — it is no longer there` : `Can't reveal: ${err instanceof Error ? err.message : String(err)}`)
      })
    },
    [onNotice],
  )

  /**
   * Open in VS Code (YAZ-963): `reveal`'s twin, notice included. A dead `vscode://` URL opens
   * an empty editor rather than reporting anything, so the stale-row `NOT_FOUND` is exactly as
   * load-bearing here as it is above.
   */
  const openVsCode = useCallback(
    (path: string) => {
      api.openVsCode({ path }).catch((err: unknown) => {
        onNotice(err instanceof BridgeRequestError && err.code === 'NOT_FOUND' ? `Can't open "${basename(path)}" in VS Code — it is no longer there` : `Can't open in VS Code: ${err instanceof Error ? err.message : String(err)}`)
      })
    },
    [onNotice],
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
        ({ records }) => {
          const n = countLinkReferences({ root, oldPath: path, kind, records })
          setConfirmingDelete((current) => (current !== null && current.path === path ? { ...current, backlinks: n } : current))
        },
        () => undefined,
      )
    },
    [menu, root, tree, settings.confirmDelete, onDeleteFile],
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

  // ---- Turn into / turn back (YAZ-840 / YAZ-1022): one conflict-safe file operation ----

  /**
   * Forward writes exactly `folder_page: true` and NOTHING else. Reverse must also restore the
   * Markdown body that YAZ-919 moved into the first outline, so `restoreFolderBody` removes that
   * active outline value and the flag together while preserving every other setting and every
   * member's own `folder_pages` entry. `transformFile` gives both changes one write and one
   * retry-from-fresh-bytes boundary.
   *
   * An editor open on this file absorbs the write silently — the existing GRO-2186 behaviour,
   * nothing extra here. Failures take the sidebar's standing route for file-op failures: the
   * passive notice (`reveal`'s idiom above), never a dialog.
   */
  const setFolderPageFlag = useCallback(
    (path: string, on: boolean) => {
      const write = on
        ? writeProperty(path, FOLDER_PAGE_KEY, true)
        : transformFile(path, (content) => restoreFolderBody(content).content)
      write.catch((err: unknown) => {
        const what = on ? `turn "${basename(path)}" into a folder page` : `turn "${basename(path)}" back into a normal page`
        onNotice(`Can't ${what}: ${err instanceof Error ? err.message : String(err)}`)
      })
    },
    [onNotice],
  )

  /**
   * The menu item's click (🔒 D5): forward goes straight to disk, reverse opens the sheet first.
   * `isOn` — the flag as the menu found it — arrives WITH the path (GRO-2296) rather than being
   * re-read here: the menu is closed by now, and re-deriving it would let the two disagree.
   */
  const toggleFolderPage = useCallback(
    (path: string, isOn: boolean) => {
      if (isOn) setConfirmingTurnBack(path)
      else setFolderPageFlag(path, true)
    },
    [setFolderPageFlag],
  )

  const confirmTurnBack = useCallback(() => {
    const path = confirmingTurnBack
    setConfirmingTurnBack(null)
    if (path !== null) setFolderPageFlag(path, false)
  }, [confirmingTurnBack, setFolderPageFlag])

  // ---- Rename (files E1 GRO-2194, folders E1b GRO-2241): context menu "Rename" → inline input over the row ----

  const submitRename = useCallback(
    async (name: string) => {
      if (renamingEntry === null) return
      const target = renamedPath(renamingEntry.path, name, renamingEntry.kind)
      setRenamingEntry(null)
      if (target === renamingEntry.path) return // same name = no-op
      // App owns the whole flow (and routes failures to the passive notice — never a dialog);
      // the tree row follows via the watcher's unlink+add refresh.
      await onRenameFile(renamingEntry.path, target)
    },
    [renamingEntry, onRenameFile],
  )

  const renaming: PendingRename | null =
    renamingEntry === null ? null : { path: renamingEntry.path, onSubmit: submitRename, onCancel: () => setRenamingEntry(null) }

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
      // passive notice come with it; link updates and the tab remap ride the same pipeline.
      void onRenameFile(path, target)
    },
    [dragging, onRenameFile],
  )

  const fileMove: TreeFileMove = {
    dragging,
    dropDir,
    start: setDragging,
    end: () => {
      setDragging(null)
      setDropDir(null)
    },
    hover: setDropDir,
    drop: dropOnDir,
  }

  const pending: PendingCreate | null =
    creating === null
      ? null
      : {
          kind: creating.kind,
          parentDir: creating.parentDir,
          onSubmit: submitCreate,
          onCancel: cancelCreate,
        }

  /**
   * The SAME pending create, addressed the way the Topics tree can draw it: by the anchor row
   * (YAZ-865) — or by NO row (YAZ-948), which is what a blank-space create has. A null anchor
   * used to drop the create on the floor here: the menu item ran, the input had nowhere to
   * render, and the gesture silently did nothing. Null now travels through and means the ROOT,
   * which is where `targetDirFor` was sending the file all along.
   */
  const topicsPending: PendingTopicCreate | null =
    creating === null ? null : { kind: creating.kind, anchorPath: creating.anchor, onSubmit: submitCreate, onCancel: cancelCreate }

  return (
    <aside className="sidebar">
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
        <button type="button" className="sidebar__root" onClick={onPickFolder} disabled={pickDisabled} title={root}>
          <span className="sidebar__root-name">{basename(root)}</span>
          <span className="sidebar__root-hint">change</span>
        </button>
        <button type="button" className="sidebar__collapse" onClick={onCollapse} title="Hide sidebar" aria-label="Hide sidebar">
          <SidebarPanelIcon />
        </button>
      </div>
      {/* Lens tabs (🔒 D4/D5, YAZ-847) — chrome v2 ROW 1, above the search bar: Topics (the
          folder-page tree, an empty shell until YAZ-848) ⇄ Files (today's file explorer,
          unchanged, now behind a tab). The row stays VISIBLE and clickable during a search,
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
            className={`sidebar__lens${lens === id ? ' sidebar__lens--active' : ''}`}
            onClick={() => onLensChange(id)}
          >
            {LENS_LABEL[id]}
          </button>
        ))}
        {/* One button for both directions AND both lenses (⚡ YAZ-862, ⚡ YAZ-873): anything open
            collapses everything, and only a fully closed tree expands it. It acts on whichever
            lens is ACTIVE, through that lens' own store. Gone — not disabled — while a query is
            typed (the tree is not the body then) and whenever the active reading has nothing to
            unfold: a vault with no folders, a Topics tree of leaves, or the empty snapshot before
            the first index lands. */}
        {!searching && foldable.length > 0 && (
          <button
            type="button"
            className="sidebar__expand-all"
            aria-label={allLabel}
            title={allLabel}
            onClick={() =>
              lens === 'topics'
                ? setTopicsExpanded(new Set(anyExpanded ? [] : topics))
                : dispatch({ type: 'setAll', dirs: anyExpanded ? [] : dirs })
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
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0) // a new query is a new ranking: the top row is the selection again
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              // Esc empties a typed query first and only gives up focus on the second press.
              if (query !== '') setQuery('')
              else e.currentTarget.blur()
              return
            }
            // The bar keeps focus while the list is driven from it (YAZ-803). Clamped at both
            // ends, never wrapping — the `[[` picker's rule. Opening leaves the list up.
            if (results.length === 0) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelected(Math.min(sel + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected(Math.max(sel - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const hit = results[sel]
              if (hit === undefined) return
              // The tree rows' rule on the list (YAZ-961): the first Enter PREVIEWS — focus stays
              // in the bar, so ↑/↓ carry on — and a second Enter on the page already open is the
              // deliberate "take me in", handing the caret to the document (Esc brings it back).
              if (e.metaKey) onOpenFileBackground(hit.path)
              else if (hit.path === activeFile) focusOpenDocument()
              else onOpenFile(hit.path)
            }
          }}
        />
      </div>
      {/* The blank-space menu is the TREE's ("New note" here creates in the vault root); the
          results list has no such target, so right-clicking it offers nothing (YAZ-803).
          BOTH lenses offer it since YAZ-948 — 🔒 YAZ-847 withheld it from Topics only until
          that tree had a menu of its own to be consistent with, which YAZ-865 gave its rows.
          Blank space means the same thing in either lens: the vault ROOT. */}
      <div ref={bodyRef} className="sidebar__body" onContextMenu={(e) => (searching ? undefined : openMenu(null, e))}>
        {searching ? (
          // A typed query replaces the ACTIVE TAB's body, whichever lens that is (🔒 D5).
          results.length > 0 ? (
            <SearchResults results={results} selected={sel} onSelect={setSelected} onOpen={onOpenFile} onOpenBackground={onOpenFileBackground} />
          ) : (
            <p className="sidebar__msg">No matches</p>
          )
        ) : lens === 'topics' ? (
          // The folder-page tree (YAZ-848), fed by the window's index snapshot — the SAME
          // `indexSource` the folder-page toggle reads, so the two can never disagree. A
          // conditional render, like the search swap above: the Files tree's state (data,
          // expansion, pending create/rename, drag) lives in this component and is waiting
          // untouched below.
          <TopicsTree
            root={root}
            expanded={topicsExpanded}
            onExpandedChange={setTopicsExpanded}
            revealRequest={pendingReveal}
            source={indexSource}
            activeFile={activeFile}
            onOpenFile={onOpenFile}
            onOpenFileBackground={onOpenFileBackground}
            unadopted={unadopted}
            onCreateHome={onCreateHome}
            onRowContextMenu={openTopicsMenu}
            renaming={renaming}
            creating={topicsPending}
            onNotice={onNotice}
          />
        ) : (
          <>
            {error !== null && <p className="sidebar__msg sidebar__msg--error">{error}</p>}
            {tree === null && error === null && <p className="sidebar__msg">Loading…</p>}
            {tree !== null && tree.tree.length === 0 && pending === null && (
              <p className="sidebar__msg">No notes here.</p>
            )}
            {tree !== null && (
              <Tree
                nodes={tree.tree}
                dirPath={root}
                expanded={new Set(expanded)}
                activeFile={activeFile}
                onToggle={(dir) => dispatch({ type: 'toggle', dir })}
                onOpenFile={onOpenFile}
                onOpenFileBackground={onOpenFileBackground}
                onNodeContextMenu={openMenu}
                pending={pending}
                renaming={renaming}
                move={fileMove}
              />
            )}
          </>
        )}
      </div>
      <div className="sidebar__footer">
        <SettingsCog settings={settings} onChange={onChangeSettings} sync={sync} />
        <HotkeysButton />
      </div>
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          copyPath={menu.copyPath}
          copyLinkText={menu.copyLinkText}
          newWindowPath={menu.newWindowPath}
          onOpenNewWindow={openFileNewWindow}
          renamePath={menu.renamePath}
          onRename={(path) => setRenamingEntry({ path, kind: menu.rowKind === 'file' ? 'file' : 'dir' })}
          deletePath={menu.deletePath}
          onDelete={askDelete}
          revealPath={menu.revealPath}
          onReveal={reveal}
          openVsCodePath={menu.openVsCodePath}
          onOpenVsCode={openVsCode}
          onNewNote={() => startCreate('file')}
          onNewFolderPage={() => startCreate('folderPage')}
          // Topics PAGE rows and blank space still browse by meaning and offer no disk-folder
          // birth (YAZ-948). YAZ-1080's explicit disk-folder rows are the honest exception.
          onNewFolder={lens === 'topics' && menu.rowKind !== 'dir' ? null : () => startCreate('dir')}
          folderPagePath={menu.folderPagePath}
          folderPageIsOn={menu.folderPageIsOn}
          onToggleFolderPage={toggleFolderPage}
          onClose={() => setMenu(null)}
        />
      )}
      {confirmingDelete !== null && <ConfirmDelete target={confirmingDelete} onConfirm={confirmDelete} onCancel={() => setConfirmingDelete(null)} />}
      {confirmingTurnBack !== null && <ConfirmTurnBack path={confirmingTurnBack} onConfirm={confirmTurnBack} onCancel={() => setConfirmingTurnBack(null)} />}
    </aside>
  )
}
