import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { isBoard, isViewOnly } from '@shared/fileKind'
import type { TextFormatting } from '@shared/textFormatting'
import { BETWEEN_VAULTS, MAIN_WORKSPACE_MIN_W, MAX_SESSIONS, MAX_SESSION_TABS, MAX_WINDOW_ROOTS, SIDEBAR_MAX_W, SIDEBAR_MIN_W, rootOfPath, sameVaults, stripSlash, type CanvasPanelState, type CanvasPrefs, type CommentsOrder, type DeleteResponse, type MovedTab, type PageView, type PopOutCarry, type SettingsState, type SidebarTab, type TableOfContents, type TabAction, type TabRef, type TreeNode, type FilesAction } from '@shared/types'
import { api, BridgeRequestError } from './api'
import { applyCrepeTheme } from './editor/crepeTheme'
import { Editor } from './editor/Editor'
import { newNoteBase } from './editor/wikilink/createFromLink'
import { WikilinkIndexBridge } from './editor/wikilink/WikilinkIndexBridge'
import { useLinkEvents } from './hooks/useLinkEvents'
import { useMenuEvents } from './hooks/useMenuEvents'
import { useVaultStorage } from './hooks/useVaultStorage'
import { requestZoom } from './editor/zoomRequest'
import { requestBoardCommand } from './documents/boardCommand'
import { usePickFolder } from './hooks/usePickFolder'
import { vaultDirs } from './links/folderLinks'
import { countLinkReferences, linkingNotes, renameNotice, updateLinksAfterRename, type RenameRewriteSummary } from './links/renameLinks'
import { dropFolderValuesAfterMove, restoreFolderValues, valuesLeftBehind, type ClearedValues, type LeftBehind, type Move } from './links/shortcuts'
import { createMoveHistory, invertMoves, isMoveStep, type DeleteStep, type MovedGesture, type RenameStep } from './lib/moveHistory'
import { playGestureSound } from './lib/gestureSound'
import { transformFile } from './views/writeProperty'
import { buildViewOnlyCatalog, movedCatalog, type ViewOnlyCatalog } from './links/viewOnlyCatalog'
import { ownsCopyPathHotkey } from './lib/copyPathHotkey'
import { fileClipboardVerb } from './lib/fileClipboardHotkey'
import { focusOpenDocument } from './lib/focusHandoff'
import { dragOutText, gestureNotice, namedItems, noticeMs, onDisk, shows, unlessFailed, type DragOutAsk, type NamedItem, type Notice, type NoticeKind, type NoticeType } from './lib/notice'
import { treeHasPath } from './lib/treeState'
import { NoticeToast } from './components/NoticeToast'
import { absFrom, dirname, relTo } from './lib/paths'
import { carryEditorAcrossRename, carryEditorsAcrossDirRename, flushRenamedDir, flushRenamedPath, retireDeletedDir, retireDeletedPath } from './lib/renameContinuity'
import { EMPTY_SELECTION, orderedSelection } from './lib/selection'
import { storage } from './lib/storage'
import { readPageView } from './lib/pageView'
import { ownsSidebarHotkey } from './lib/sidebarHotkey'
import { buildSetupPrompt } from './lib/syncAttention'
import { mergeNotice } from './history/mergeNotice'
import { noteBoardRenamed, noteBoardSaved } from './share/liveShare'
import { useSharing } from './share/useSharing'
import { resolveTheme, useSystemPrefersDark } from './lib/theme'
import { fileHash } from './lib/urlHash'
import { filesWindowTitle, windowTitle } from './lib/windowTitle'
import { askFromFiles, filesClickHow } from './lib/filesWindow'
import { FloatingPreview } from './sidebar/HoverPreviewHost'
import { filesPreviewPopup } from './sidebar/previewPopup'
import { isFolderPath, pageName, pathTitles, useAllPathTitles } from './lib/pageLabel'
import { fetchTree, onTree } from './lib/treeFeed'
import { flushWindow } from './lib/windowFlush'
import { ConfirmSheet } from './components/ConfirmSheet'
import { ConfirmMove } from './sidebar/ConfirmMove'
import { ConfirmRename, isNameChange, type RenameTo } from './sidebar/ConfirmRename'
import { ReviewAnswers, ReviewBar, ReviewMessage } from './review/ReviewBar'
import { QuickLook } from './search/QuickLook'
import { SettingsDialog } from './settings/SettingsDialog'
import { textVars } from './settings/headingStyles'
import { plainEntryName } from './sidebar/createEntry'
import { type SidebarClipboard, type SidebarMenuRequest, Sidebar } from './sidebar/Sidebar'
import type { SidebarRevealRequest } from './sidebar/revealRow'
import { TabBar } from './tabs/TabBar'
import type { MoveTarget } from './tabs/TabMenu'
import { setBoardHighlight } from './tabs/boardHighlight'
import { tabOfRef, windowLabel } from './tabs/windowLabel'
import { useUpdate } from './update/useUpdate'
import { RightPanel } from './right-panel/RightPanel'
import { EMPTY_SLOTS, assignSlots, movedRoot, renameSlots } from './vault/slots'
import { useVaultScope, type VaultScope } from './vault/useVaultScope'
import type { PageDrag } from './workspace/pageDrag'
import { StartPage } from './workspace/StartPage'
import { tabById, tabOf, useWorkspace } from './workspace/useWorkspace'
import { restoreSession } from './workspace/restoreSession'
import { Welcome } from './Welcome'

/** The "What's new" sheet (YAZ-2976 D5) is its own chunk: launch never parses it, and the first open fetches it. */
const WhatsNewSheet = lazy(() => import('./update/WhatsNewSheet'))
/** The Share dialog (YAZ-3040): lazy too. Settings › Sharing is the registry's, eager with the dialog. */
const ShareDialog = lazy(() => import('./share/ShareDialog').then((m) => ({ default: m.ShareDialog })))
/** Version history (YAZ-1897 D4, YAZ-3039): lazy, so a window that never opens it loads none of it. */
const VersionHistory = lazy(() => import('./history/VersionHistory').then((m) => ({ default: m.VersionHistory })))

/**
 * The tab board (YAZ-3343 D4): its own chunk — the canvas, its layout and its cards — loaded on idle after the
 * window mounts (`preloadTabBoard`), so the first ⌘⇧M finds it ready and launch parses none of it. Nothing of
 * `tabs/TabOverview` is imported statically here; its prop types are only types.
 */
type BoardModule = typeof import('./tabs/TabOverview')
let boardModule: BoardModule | null = null
/** Load the board's chunk; once it has landed the board renders with no Suspense step. */
export const preloadTabBoard = (): Promise<BoardModule> =>
  import('./tabs/TabOverview').then((m) => {
    boardModule = m
    return m
  })
const LazyTabOverview = lazy(() => preloadTabBoard().then((m) => ({ default: m.TabOverview })))
/** The board the first open renders: the module itself when it landed before, else the lazy one — which then stays, so a board never remounts for it. */
let boardOf: BoardModule['TabOverview'] | typeof LazyTabOverview | null = null
function TabBoard(props: ComponentProps<BoardModule['TabOverview']>) {
  boardOf ??= boardModule?.TabOverview ?? LazyTabOverview
  const Board = boardOf
  return (
    <Suspense fallback={null}>
      <Board {...props} />
    </Suspense>
  )
}

/** Reflect the open file in the URL (GRO-2069); replaceState keeps Back sane. */
/** Runs `then` once the window has its new size (YAZ-3357 D3): on its next resize, or after 150 ms when none comes (a size that did not change). */
function afterResize(then: () => void): void {
  let done = false
  const go = (): void => {
    if (done) return
    done = true
    window.removeEventListener('resize', go)
    then()
  }
  window.addEventListener('resize', go)
  setTimeout(go, 150)
}

function syncHash(path: string | null): void {
  history.replaceState(null, '', fileHash(path) || location.pathname + location.search)
}


/** No tab board (YAZ-2648): one object, so closing a board that is closed is no state change. */
const OVERVIEW_CLOSED = { phase: 'closed', from: null } as const
/** The longest a window glows with no word from main (YAZ-3091 D8): only a lost "off" ever reaches it. */
export const GLOW_MAX_MS = 10_000

/** One rename through the pipeline (`applyRename`): what it did, or why main refused it. */
type RenameOutcome = { move: Move; cleared: ClearedValues[]; links: RenameRewriteSummary } | { error: unknown }

/** Why one move of a list did not run (S11): a name that is taken, else main's own words. */
const moveFailure = (name: string, err: unknown): string =>
  err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS' ? `${name} already exists` : `${name} — ${err instanceof Error ? err.message : String(err)}`

/**
 * What `runMoves` did: the gesture, and what it says (S11). `again`: how many of `failed` moved again (S36).
 * `names`: each item that moved, by its kind and its name on disk (YAZ-3293 D23), in the order of `moves`.
 */
type MovesRun = MovedGesture & { failed: string[]; again: number; links: RenameRewriteSummary; names: NamedItem[] }

/** The item of an undo or a redo is gone, or its place is taken (YAZ-3255 S36): it changed again since. */
const movedAgain = (err: unknown): boolean => err instanceof BridgeRequestError && (err.code === 'NOT_FOUND' || err.code === 'ALREADY_EXISTS')

/** Why one move of an undo or a redo did not run (S36): it moved again, else main's own words. */
const againFailure = (name: string, err: unknown): string => (movedAgain(err) ? `${name} moved again` : `${name} — ${err instanceof Error ? err.message : String(err)}`)

/**
 * A move over a vault's edge (YAZ-3255): it leaves the vault that holds it, or comes from no vault —
 * an undo or a redo of a move in from Finder (S40), or of a Paste of a Cut between vaults.
 */
const overEdge = (roots: readonly string[], oldPath: string, newPath: string): boolean => {
  const home = rootOfPath(roots, oldPath)
  return home === null || rootOfPath(roots, newPath) !== home
}

/**
 * The toast of an undo or a redo (YAZ-3255 D11): "Moved back 2 files (Todo.md, Plan.md)" (undo) or
 * "Moved 2 files (Todo.md, Plan.md)" (redo), by the kinds and the names on disk of what moved (YAZ-3293 D23), then the first item that did
 * not move — "Can't undo: Plan moved again" (S36). Only the failure when nothing moved. The links that followed
 * are said after what moved, as the move's own toast says them (YAZ-3337): a note skipped there is never silent.
 */
export function replayNotice(verb: 'undo' | 'redo', moved: readonly NamedItem[], failed: readonly string[], links: RenameRewriteSummary = { updated: 0, skipped: 0 }): string {
  const head = moved.length === 0 ? null : renamedNotice(verb === 'undo' ? `Moved back ${namedItems(moved)}` : `Moved ${namedItems(moved)}`, links)
  return stepNotice(verb, head, failed)
}

/**
 * The toast of an undo or a redo of any step (YAZ-3268 D18): what it did (`head`, null when nothing
 * ran), then the first item that did not go — "Put back 1 file (Todo.md). Can't undo: a file named Plan
 * is there now" (S60). Only the failure when nothing ran.
 */
function stepNotice(verb: 'undo' | 'redo', head: string | null, failed: readonly string[]): string {
  const cannot = gestureNotice(null, failed, `Can't ${verb}`)
  if (head === null) return cannot ?? ''
  return cannot === null ? head : `${head}. ${cannot}`
}

/**
 * Why the undo or the redo of a rename did not run (YAZ-3268 nit 2): the name it goes to is taken now
 * (`ALREADY_EXISTS`) — "a file named Draft is there now", as a delete's undo says it (S60); else as a
 * move says it — "Plan moved again" (`NOT_FOUND`, S64), or main's own words.
 */
const renameReplayFailure = (name: string, taken: string, type: 'file' | 'dir', err: unknown): string =>
  err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS' ? `a ${type === 'dir' ? 'folder' : 'file'} named ${taken} is there now` : againFailure(name, err)

/** A rename's toast (YAZ-3268 D18): `Renamed to "Plan v2"` or `Renamed back to "Plan"`, then the links that followed, as a rename says them. */
const renamedNotice = (head: string, links: RenameRewriteSummary): string => (links.updated > 0 || links.skipped > 0 ? `${head}. ${renameNotice(links)}` : head)

/** Why one item of a delete's undo stayed in the Trash (S59, S60): it left the Trash, or its old name is taken; else main's own words. */
const putBackFailure = (name: string, item: DeleteStep['items'][number], err: unknown): string => {
  if (err instanceof BridgeRequestError && err.code === 'NOT_FOUND' && err.path === item.trashed) return `${name} is no longer in the Trash`
  if (err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS') return `a ${item.type === 'dir' ? 'folder' : 'file'} named ${name} is there now`
  return `${name} — ${err instanceof Error ? err.message : String(err)}`
}

/**
 * The ONE notice of a move gesture (YAZ-3250 D1, D11): what moved, by kind and by name on disk (YAZ-3293
 * D23), and the first that did not, as the paste says it — "Moved 2 files (Todo.md, Plan.md), skipped
 * 1: Plan already exists" (S11). The links that followed are said after it, as a rename says them. Null when nothing
 * ran at all.
 */
export function movedNotice(moved: readonly NamedItem[], failed: readonly string[], links: RenameRewriteSummary): string | null {
  const text = gestureNotice(moved.length === 0 ? null : `Moved ${namedItems(moved)}`, failed, "Can't move")
  return moved.length > 0 && (links.updated > 0 || links.skipped > 0) ? `${text}. ${renameNotice(links)}` : text
}

// A workspace state change still re-renders App, but unchanged retained editors must not render
// with it: a folder's Board runs layout animation after every render, so an unrelated right
// header click would otherwise remeasure and visibly nudge its cards.
const RetainedEditor = memo(Editor)

/**
 * A vault's text formatting as the style of its page layers (YAZ-3067 D12): `--text-size` and the
 * `--hN-*` variables. One object for each formatting object, so a layer that renders again with
 * the same formatting hands React the same style, and a change costs one style update on the
 * layers of that vault only.
 */
const layerStyles = new WeakMap<TextFormatting, CSSProperties>()
function layerStyleOf(formatting: TextFormatting): CSSProperties {
  let style = layerStyles.get(formatting)
  if (style === undefined) {
    style = textVars(formatting) as CSSProperties
    layerStyles.set(formatting, style)
  }
  return style
}

/**
 * Keeps the current-page navigation function stable for the lifetime of one retained right
 * editor. Crepe's lifecycle effect depends on this callback; creating it inside App's map would
 * destroy and rebuild every right-side editor whenever any header expanded or collapsed.
 */
function RightWorkspaceEditor({ path, navigate, ...props }: Omit<ComponentProps<typeof Editor>, 'onOpenFile'> & {
  path: string
  navigate: (from: string, to: string) => void
}) {
  const openFile = useCallback((to: string) => navigate(path, to), [navigate, path])
  return <RetainedEditor {...props} path={path} onOpenFile={openFile} />
}

/**
 * A new window's boot tab starts with the page view main gave it (YAZ-2951 D5), when that tab shows
 * the view's file: a link or a pasted URL that opened another page wins, and gets none.
 */
function bootStartView(tab: string | null, file: string | null): Map<string, PageView> {
  const start = storage.getStartView()
  return new Map(tab !== null && start !== undefined && start.path === file ? [[tab, start.view]] : [])
}

export function App() {
  /**
   * A Files window (YAZ-3357 D1): only the sidebar. Its clicks go to a normal window (`askFromFiles`), it has no tab
   * strip, no editor and no right panel, and Tabs Mission Control opens beside the sidebar. Fixed for the window's life.
   */
  const [filesWindow] = useState(storage.isFilesWindow)
  /** Its hover and Space preview (D9): the ONE floating popup, made once here; where it cannot be made, the panel over the window's lower part. */
  const [previewFloat] = useState(() => (!filesWindow ? undefined : filesPreviewPopup.open() ? filesPreviewPopup : ('overlay' as const)))
  // The vaults this window shows (YAZ-2602 D1), in the order they were added, or the order a drag
  // of a vault row gave them (YAZ-2631 D5). `root` is the FIRST: null is the Welcome window.
  const [roots, setRoots] = useState<string[]>(storage.getRoots)
  const root = roots[0] ?? null
  // The sidebar's key (YAZ-2631 R12): the vault that was first when it mounted, while that vault is
  // in the window — a vault that joins, leaves behind it or moves does not mount the panel again.
  const sidebarKey = useRef(root)
  if (sidebarKey.current === null || !roots.includes(sidebarKey.current)) sidebarKey.current = root
  // The vault rows the user closed (YAZ-2602 R9): for the session and for this window, so never in
  // the store — and App's, like the lens below: the sidebar unmounts while it is hidden.
  const [closedVaults, setClosedVaults] = useState<readonly string[]>([])
  const setVaultOpen = useCallback((vault: string, open: boolean) => setClosedVaults((closed) => (closed.includes(vault) === !open ? closed : open ? closed.filter((v) => v !== vault) : [...closed, vault])), [])
  // Workspace (Tabs I2 + YAZ-966): one renderer-owned model, seeded from the boot identity snapshot
  // (a pasted `#/abs/path.md` URL wins as the active tab — bootTabs). The ACTIVE tab's path is this
  // window's `file`: title, URL hash and the sidebar highlight all follow it. Each tab has its own
  // id (YAZ-2940 D1): `active`, `mounted` and `preview` are ids, and two tabs may show one file.
  const {
    tabs, active: activeTab, file, mounted, preview, blank, openCurrent, navigate, openKept, duplicate, take, keep, setName: setTabName, newTab: openBlank, closeBlank, openBackground, activate, close: closeTab, closeMany: closeTabs, openStored, move: moveTab,
    closeActive, next: nextTab, prev: prevTab, back, forward, canBack, canForward, reset: resetTabs,
    renamePath: renameWorkspacePath, renameDirPath: renameWorkspaceDir, deletePath: deleteWorkspacePath, deleteDirPath: deleteWorkspaceDir,
    rightPanel, rightMounted, openRight, openRightBackground, navigateRight, toggleRight, closeRight,
    moveRight, transferMainToRight, transferRightToMain,
    rightBack, rightForward, canRightBack, canRightForward, setRightOpen, setRightWidth,
  } = useWorkspace(root)
  /**
   * The page on show in the main pane: the active tab's — and none under the blank tab (YAZ-2655
   * D10), where `file` is still the last real active tab, the one the window stores. What the user
   * LOOKS at reads this: the title, the sidebar's highlight, ⌘⇧C. What is stored reads `file`.
   */
  const pageOnShow = blank ? null : file
  const [sidebarCollapsed, setSidebarCollapsed] = useState(storage.getSidebarCollapsed)
  const sidebarCollapsedRef = useRef(sidebarCollapsed)
  const [sidebarWidth, setSidebarWidth] = useState(storage.getSidebarWidth)
  /** The sidebar's aside: a resize drag writes its live width here, not to state (YAZ-2239). */
  const sidebarRef = useRef<HTMLElement>(null)
  // The sidebar's active LENS (🔒 D4, YAZ-847): App-owned and persisted because the Sidebar is
  // mounted on one vault (`sidebarKey`) and only while open; sidebar-local view state would reset on every
  // collapse/reopen and root switch. Window identity like visibility since YAZ-1628 — one
  // `WindowEntry.sidebarLens`; never a second flag.
  const [sidebarLens, setSidebarLens] = useState<SidebarTab>(storage.getSidebarLens)
  // ⌘⇧C's read-only window onto the sidebar's multi-selection (🔒 D4, YAZ-1338). App owns the
  // BOX and the chord; the Sidebar owns the selection (🔒 D1) and writes it in here, emptying it
  // when it unmounts. A ref rather than state on purpose: App needs the answer only at the
  // moment the key is pressed, and re-rendering this whole window on every shift+click would be
  // a real cost for a fact nothing on screen up here shows.
  const sidebarSelection = useRef<ReadonlySet<string>>(EMPTY_SELECTION)
  // ⌘C / ⌘X / ⌘V's handle (D6 amended, YAZ-1674): the mounted Sidebar's two verbs, null while collapsed.
  const sidebarClipboard = useRef<SidebarClipboard | null>(null)
  const sidebarRevealId = useRef(0)
  const [sidebarRevealRequest, setSidebarRevealRequest] = useState<SidebarRevealRequest | null>(null)
  // The row menu a row of the new tab page asked for (YAZ-2663 D6): the reveal request's idiom.
  const sidebarMenuId = useRef(0)
  const [sidebarMenuRequest, setSidebarMenuRequest] = useState<SidebarMenuRequest | null>(null)
  // The preview panel of the search (YAZ-2662 D5): the file that it draws over the page area, or
  // null with no panel on show. It is no tab — the preview TAB is the workspace's `preview` — and
  // nothing of it is stored. The sidebar names the file and reads it back; the panel's ✕ clears it.
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  // The same panel for a row of the new tab page (YAZ-2663 S39), on a path of its own: the search
  // follows its own highlight, and with one shared path it takes the panel back from the page.
  const [pagePreviewPath, setPagePreviewPath] = useState<string | null>(null)
  // The panel draws the file of the LAST one that asked: when the search names a file — ⌘K from a
  // row of the page, a word, Space — the path of the page goes, and the page reads that its panel is gone.
  useEffect(() => {
    if (previewPath !== null) setPagePreviewPath(null)
  }, [previewPath])
  const [resizing, setResizing] = useState(false)
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  const [settings, setSettings] = useState(storage.getSettings)
  // Deep links (E1, GRO-2171): a routed link behaves like a sidebar click (Tabs rule 10) —
  // it activates the file's tab when already open, else opens it in the PREVIEW tab (YAZ-2648 D1);
  // a link that could not open shows a transient notice — unobtrusive, never a dialog.
  const [notice, setNotice] = useState<Notice | null>(null)
  // A toast of a type that Settings turned off never shows, and the toast on screen stays (YAZ-3303 D2).
  const showNotice = useCallback((next: Notice) => {
    if (shows(next, storage.getSettings())) setNotice(next)
  }, [])
  // The one door every surface uses (D10 amended, YAZ-1674): text, an optional glyph kind (`'info'`
  // unless the caller names one) and an optional type (YAZ-3303 D2) — so `onNotice(text)` still works.
  const notify = useCallback((text: string, icon: NoticeKind = 'info', type?: NoticeType) => showNotice({ text, icon, type }), [showNotice])
  // The toast's clock is the toast's own (`NoticeToast`, YAZ-3303 D9): App only says how long and closes it.
  const closeNotice = useCallback(() => setNotice(null), [])
  // The box after a drag out to Finder (YAZ-3254 D9B): its own slot, so the toast above never hides it.
  // It asks about the items of this window's vaults: another set of vaults ends the question (the rename door's effect).
  const [dragOutAsk, setDragOutAsk] = useState<DragOutAsk | null>(null)
  // Esc closes it and keeps the items, as ✕ does (audit 20), unless something else took the key.
  useEffect(() => {
    if (dragOutAsk === null) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) setDragOutAsk(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dragOutAsk])
  // One scope per vault (YAZ-2602 D1): the watcher, the link sources, the properties, the sync,
  // the review and the IDs answer of EACH vault, all loaded at once. They live in slots, a fixed
  // number of hook calls on every render, because a scope must exist in the first render: an
  // editor that waited one frame for its vault would change the launch paint. A vault keeps its
  // slot while it is in the window (`vault/slots.ts`), and a slot with no vault is idle.
  const slots = useRef(EMPTY_SLOTS)
  slots.current = assignSlots(slots.current, roots)
  const scopes: VaultScope[] = []
  for (const slotRoot of slots.current) scopes.push(useVaultScope(slotRoot, notify))
  /** The scopes of the window's vaults, in the order of `roots`. */
  const vaults = roots.map((vault) => scopes[slots.current.indexOf(vault)])
  /** The first vault's scope; on the Welcome window an idle one, so every reader below has a scope. */
  const first = vaults[0] ?? scopes[0]
  const live = useRef({ roots, vaults, first })
  live.current = { roots, vaults, first }
  /**
   * The scope of the vault that holds `path`, the most specific one; a path in no vault of the
   * window (a pasted `#/abs/path` URL, S35) gets the first vault's. Ref-backed, so the callbacks
   * that ask it keep their identity under the mounted editors.
   */
  const scopeOf = useCallback((path: string): VaultScope => {
    const now = live.current
    const home = rootOfPath(now.roots, path)
    return home === null ? now.first : now.vaults[now.roots.indexOf(home)]
  }, [])
  /** The scope of the ACTIVE tab's vault (R3, R4, R10); with no tab open, the first vault's. */
  const active = file === null ? first : scopeOf(file)
  // The close/quit handshake for the writers below App — the outline's debounce and every in-flight
  // frontmatter write (YAZ-2174): the note editor's autosave registers with the bridge itself.
  useEffect(() => api.window.onFlush(flushWindow), [])
  // Every page of the window by its title (YAZ-2420 🔒 D14), off the index of each vault.
  const titleSources = useMemo(() => roots.map((vault) => scopes[slots.current.indexOf(vault)].wikilinks), [roots])
  const titles = useAllPathTitles(titleSources)
  /** A page as a notice names it — its title (YAZ-2420 🔒 D14) — off its vault's index snapshot as it stands. */
  const nameOf = useCallback((path: string) => {
    const { root: vault, wikilinks } = scopeOf(path)
    return pageName(vault, path, pathTitles(wikilinks.records, wikilinks.folders))
  }, [scopeOf])
  // App's half of the search-bar focus handshake (YAZ-801, wired in YAZ-804): `changeLens` sets it
  // whenever the Search tab is asked for — ⌘K, or a click on the tab (YAZ-2638 D2) — including the
  // collapsed case, which un-collapses and mounts the sidebar with the flag already true; the
  // sidebar focuses its input and clears it through the callback.
  const [pendingSearchFocus, setPendingSearchFocus] = useState(false)
  // With the flag: a new tab (⌘T) asks for a NEW search, so the bar is emptied (YAZ-2663 D10). ⌘K keeps its text.
  const [pendingSearchClear, setPendingSearchClear] = useState(false)
  const searchFocusHandled = useCallback(() => {
    setPendingSearchFocus(false)
    setPendingSearchClear(false)
  }, [])

  // Settings and sidebar width are global. Visibility (YAZ-1280) and the lens (YAZ-1628) are
  // window identity and never follow another renderer's `state:changed` broadcast.
  useEffect(
    () =>
      storage.subscribe(() => {
        setSettings(storage.getSettings())
        setSidebarWidth(storage.getSidebarWidth())
      }),
    [],
  )

  useEffect(() => {
    const resize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const visibleSidebarWidth = root !== null && !sidebarCollapsed ? sidebarWidth : 0
  /** Whether the right panel overlays the workspace beside a sidebar this wide; a resize drag asks it per move. */
  const overlayAt = (sideWidth: number) => rightPanel.open && windowWidth < sideWidth + rightPanel.width + MAIN_WORKSPACE_MIN_W
  const overlayAtRef = useRef(overlayAt)
  overlayAtRef.current = overlayAt
  const rightOverlay = overlayAt(visibleSidebarWidth)

  const toggleSidebar = useCallback(() => {
    // A Files window IS the sidebar (YAZ-3357 D8): ⌘B and View › Toggle Sidebar never hide it.
    if (filesWindow) return
    const next = !sidebarCollapsedRef.current
    sidebarCollapsedRef.current = next
    storage.setSidebarCollapsed(next)
    setSidebarCollapsed(next)
  }, [])

  // Renderer bubble phase is deliberate: Milkdown and other focused tools get first ownership.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!ownsSidebarHotkey(event)) return
      event.preventDefault()
      toggleSidebar()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleSidebar])

  // Dragging past 60% of the minimum reads as "close it" rather than "make it tiny" — the
  // sidebar collapses and the remembered width stays whatever it was before the drag.
  const startSidebarResize = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      const start = sidebarWidth
      const x0 = e.clientX
      let raw = start
      let width = start
      // The width in state, which the right panel's overlay decision reads.
      let rendered = start
      // Each move writes the width straight to the aside (YAZ-2239): state per move re-rendered the
      // whole app on every mouse move. State follows at the move that flips the right panel between
      // split and overlay, so that still happens live, and on mouseup.
      const move = (ev: MouseEvent) => {
        raw = start + ev.clientX - x0
        width = Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, raw))
        if (sidebarRef.current !== null) sidebarRef.current.style.width = `${width}px`
        if (overlayAtRef.current(width) !== overlayAtRef.current(rendered)) {
          rendered = width
          setSidebarWidth(width)
        }
      }
      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        document.body.style.cursor = ''
        setResizing(false)
        if (raw < SIDEBAR_MIN_W * 0.6) {
          setSidebarWidth(start)
          toggleSidebar()
          return
        }
        setSidebarWidth(width)
        if (width !== start) storage.setSidebarWidth(width)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
      document.body.style.cursor = 'col-resize'
      setResizing(true)
    },
    [sidebarWidth, toggleSidebar],
  )

  const changeSettings = useCallback((next: SettingsState) => {
    storage.setSettings(next)
    setSettings(next)
  }, [])

  /** A lens tab click (YAZ-847): write through to this window's identity, then mirror it locally. */
  const changeLens = useCallback((next: SidebarTab) => {
    // Search is never stored (YAZ-2638 D2): a window opens again on its last lens. Showing it — ⌘K
    // or a click on the tab, also while it shows — asks for the caret in its bar. A lens that is
    // the stored one already (Esc in the bar goes back to it) is not written again.
    if (next === 'search') setPendingSearchFocus(true)
    else if (next !== storage.getSidebarLens()) storage.setSidebarLens(next)
    setSidebarLens(next)
  }, [])

  // Files & Links (C2-, GRO-2240; YAZ-1643): where a bare unresolved [[link]] creates its page —
  // the "default location for new notes" setting resolved against the CALLING editor's own path
  // and the vault that holds it (YAZ-2602 S37) (`sourcePath`: the page the link was clicked or typed in, so a
  // right-panel editor or a folder's outline creates beside itself, never beside the main tab).
  // A ref-backed getter: the value recomputes at CLICK time from whatever settings are current
  // (settings changes broadcast via storage.subscribe land in `settings` above), while the
  // callback identity stays stable — it sits in CrepeHost's effect deps, and a new identity
  // would remount every open editor.
  const newNoteFolderInputs = useRef({ settings })
  newNoteFolderInputs.current = { settings }
  const newNoteFolderFor = useCallback((sourcePath: string) => {
    const vault = scopeOf(sourcePath).root
    return vault === null ? '' : newNoteBase(newNoteFolderInputs.current.settings, vault, sourcePath)
  }, [scopeOf])
  // The comment stream's order toggle (YAZ-1515) writes the setting through the same ref-backed,
  // stable door: `RetainedEditor` is `memo(Editor)`, and a fresh arrow per render would re-render
  // every retained editor tree on any App state change.
  const changeCommentsOrder = useCallback((order: CommentsOrder) => changeSettings({ ...newNoteFolderInputs.current.settings, commentsOrder: order }), [changeSettings])
  // The table of contents' "Pin" / "Unpin" (YAZ-2700): the same stable door.
  const changeTableOfContents = useCallback((mode: TableOfContents) => changeSettings({ ...newNoteFolderInputs.current.settings, tableOfContents: mode }), [changeSettings])
  // A drag of the names column's edge (YAZ-2752), on its release: the same stable door.
  const changeTableOfContentsWidth = useCallback((width: number) => changeSettings({ ...newNoteFolderInputs.current.settings, tableOfContentsWidth: width }), [changeSettings])
  // A drawing's engine moved a canvas pref (YAZ-3028, Draw's 🔒 YAZ-1775 D9): the same stable door.
  const changeCanvasPrefs = useCallback((canvas: CanvasPrefs) => changeSettings({ ...newNoteFolderInputs.current.settings, canvas }), [changeSettings])
  // The canvas panel's tab and dock choice (YAZ-3038): the same stable door; a choice that did not move is no write.
  const changeCanvasPanel = useCallback(
    (canvasPanel: CanvasPanelState) => {
      const current = newNoteFolderInputs.current.settings.canvasPanel
      if (current.tab !== canvasPanel.tab || current.docked !== canvasPanel.docked) changeSettings({ ...newNoteFolderInputs.current.settings, canvasPanel })
    },
    [changeSettings],
  )

  // Appearance (Desktop K, GRO-2218): `system` tracks the OS live; explicit values win.
  // `data-theme` goes on <html> so body / fixed overlays follow app.css's dark tokens, and
  // the Crepe frame vars swap in the same commit (CSS-only — the open editor never remounts).
  // storage.init() resolves before the first render, so the first paint is already themed.
  const prefersDark = useSystemPrefersDark()
  const theme = resolveTheme(settings.theme, prefersDark)
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    applyCrepeTheme(theme)
  }, [theme])

  // Editor spacing settings land as CSS custom properties; app.css consumes them (GRO-2024).
  // Bullet threading and content width are CSS gates too — no editor remount. So are section
  // indent's grey lines (YAZ-2709, `data-section-lines`).
  const settingsVars = {
    '--edit-line-height': settings.lineSpacing,
    '--edit-block-gap': `${settings.blockGap}px`,
    '--thread-width': `${settings.threadWidth}px`,
    // Section indent (YAZ-2709): a plain number, sectionIndent.css needs it as one (`border-image-slice`).
    '--section-step-setting': settings.sectionStep,
    // Absent → bulletThreading.css falls back to the app accent.
    ...(settings.threadColor !== null ? { '--thread-color': settings.threadColor } : {}),
    // Absent → app.css falls back to `--thread-color`, then the accent (YAZ-3309 D9).
    ...(settings.sidebarThreadColor !== null ? { '--sidebar-thread-color': settings.sidebarThreadColor } : {}),
  } as CSSProperties
  /**
   * The text formatting of the vault that holds `path` (YAZ-3067 D12), as the style of the layer
   * that shows it: two vaults in one window look different. Each variable is there only for a
   * changed field; app.css and bullets.css fall back to the app's look.
   */
  const textVarsFor = (path: string): CSSProperties => layerStyleOf(scopeOf(path).textFormatting.formatting)
  /**
   * Settings › Text formatting (YAZ-3068 D15): every vault of the window, in its order, and the active
   * tab's vault, where the "Vault" dropdown starts. None in the Welcome window, so the group is not there.
   */
  const settingsTextFormatting =
    root === null ? undefined : { vaults: vaults.map((vault, i) => ({ root: roots[i], name: vault.name ?? storage.vaultName(roots[i]), state: vault.textFormatting })), activeRoot: active.root ?? roots[0] }

  // The URL hash mirrors the ACTIVE tab (GRO-2069; rule 17: on boot the hash already won as
  // the active tab in bootTabs, so this first run is a no-op re-write of the same hash).
  useEffect(() => syncHash(file), [file])

  // The OS window title mirrors what is open (C3, GRO-2165) under the display name (YAZ-1974 D4) of the ACTIVE tab's vault (YAZ-2602 S36); Electron follows document.title.
  // Under the blank tab no page is open, and the title is the vault's alone (YAZ-2655 R20).
  const { name: activeName, root: activeRoot, wikilinks: activeLinks } = active
  // Whether the active tab is a FOLDER is the Files tree's to say (YAZ-2290), and the page's title
  // the index's (YAZ-2420 🔒 D14), so the title follows both.
  // A named window leads with its name (YAZ-3343 D14): any window can name this one, so the title follows the state too.
  useEffect(() => {
    const sync = (): void => {
      // A Files window is "Files — <vault>" (YAZ-3357 D4): it has no page on show.
      document.title = filesWindow
        ? filesWindowTitle(live.current.roots.map((vault) => storage.vaultName(vault)))
        : windowTitle(activeName, pageOnShow, pathTitles(activeLinks.records, activeLinks.folders), pageOnShow !== null && isFolderPath(activeRoot, pageOnShow), storage.windowName())
    }
    sync()
    const offIndex = activeLinks.subscribe(sync)
    const offTree = activeRoot === null ? undefined : onTree(activeRoot, sync)
    const offState = storage.subscribe(sync)
    return () => {
      offIndex()
      offTree?.()
      offState()
    }
  }, [activeName, pageOnShow, activeRoot, activeLinks, roots, filesWindow])

  /**
   * Switch this window to `path` in place (C3, GRO-2165) — the WELCOME window, and the vault menu's
   * explicit "Open in this window" (YAZ-1798 D11); every other open from a vault window goes beside
   * through `openVault` (YAZ-1914). Resolves false — and drops the dead
   * MRU entry — when the folder is gone on disk (C2), leaving the window as it is; any other
   * probe failure still switches, and the sidebar surfaces the error.
   */
  const openRoot = useCallback(async (path: string): Promise<boolean> => {
    try {
      await api.tree(path)
    } catch (err) {
      if (err instanceof BridgeRequestError && (err.code === 'NOT_FOUND' || err.code === 'NOT_A_DIRECTORY')) {
        storage.removeRecentRoot(path)
        return false
      }
    }
    storage.setRoot(path) // ONE identity write: { root, file: null, tabs: [] } (Tabs rule 13)
    storage.pushRecentRoot(path)
    setSidebarLens(storage.getSidebarLens()) // the vault lands on Files (🔒 D2, YAZ-1846)
    setSidebarRevealRequest(null)
    setRoots(storage.getRoots()) // that ONE vault: every other vault of the window leaves (YAZ-2602 S61)
    // The folder's remembered file becomes the sole restored tab (D6); reset mirrors it down. A Files window has no tab (YAZ-3357 D1).
    resetTabs(path, filesWindow ? null : storage.getLastFile(path))
    return true
  }, [resetTabs])

  /**
   * The ONE vault-open rule (YAZ-1914): a window that already shows a vault never changes vault —
   * the path goes to main's open-recent door (raise its windows, else a NEW window on its last
   * file — YAZ-1767 D1/D9). Only the Welcome window (root null) becomes the vault in place. The
   * one opt-in exception is the vault menu's "Open in this window" (YAZ-1798 D11), which says so
   * in its label and calls `openRoot` directly.
   */
  const openVault = useCallback((path: string): void => {
    // A Files window changes its own vault too (YAZ-3357, demo feedback): Open Folder… and Open Recent open no window.
    if (root === null || filesWindow) {
      void openRoot(path)
      return
    }
    void api.window.openRecent(path).catch((err: unknown) => console.error('[open-vault] openRecent failed:', err))
  }, [root, openRoot, filesWindow])
  /**
   * A workspace row in a Files window's vault switcher (YAZ-3357, demo feedback): THIS window takes the workspace's vaults,
   * the ones still on disk, in its order. Nothing opens or is raised. `false` = none is left (the row greys, as `openSet`'s).
   */
  const openSetHere = useCallback(async (id: string): Promise<boolean> => {
    const set = storage.getVaultSets().find((s) => s.id === id)
    if (set === undefined) return false
    const found: string[] = []
    for (const vault of set.roots) {
      try {
        await api.tree(vault)
        found.push(vault)
      } catch {
        // A folder that is gone is left out, and named below.
      }
    }
    if (found.length === 0) return false
    const gone = set.roots.filter((vault) => !found.includes(vault))
    if (gone.length > 0) notify(`Not found: ${gone.map(storage.vaultName).join(', ')}`)
    storage.setRoots(found)
    for (const vault of found) storage.pushRecentRoot(vault)
    setRoots(storage.getRoots())
    return true
  }, [notify])

  const { pick, picking } = usePickFolder({ onPicked: openVault })

  /**
   * "Add vault to this window" (YAZ-2602 D2): `path` becomes the window's last vault, with its row
   * open, and goes to the top of the recents (S2). The tabs and the lens stay: the
   * list of vaults is the only identity write. A folder the window cannot take is refused with a
   * notice and nothing changes — one that is in the window (S4), one inside a vault of the window
   * or around one (R8, by path segment), one that is gone on disk, which also leaves the recents
   * (S6), and the ninth (R7). The probe is the tree feed's read, so the sidebar's first tree of the
   * vault is that walk's. Resolves whether the vault was added.
   */
  const addVault = useCallback(async (folder: string, quiet = false): Promise<boolean> => {
    const path = stripSlash(folder)
    const name = storage.vaultName(path)
    /**
     * Why the window as it stands cannot take the folder; asked again after the probe, which waits.
     * It reads the identity, not the last render: a restore adds vaults one after the other, before
     * React renders again (YAZ-3147 D3).
     */
    const refusal = (): string | null => {
      const now = storage.getRoots()
      if (now.some((vault) => stripSlash(vault) === path)) return `${name} is already in this window`
      const holder = rootOfPath(now, path)
      if (holder !== null) return `Can't add ${name}: it is inside ${storage.vaultName(holder)}`
      const held = now.find((vault) => rootOfPath([path], stripSlash(vault)) !== null)
      return held === undefined ? null : `Can't add ${name}: it contains ${storage.vaultName(held)}`
    }
    let refused = refusal()
    if (refused === null) {
      try {
        await fetchTree(path)
      } catch (err) {
        // Any other probe failure still adds, and the sidebar shows the error (`openRoot`'s rule).
        if (err instanceof BridgeRequestError && (err.code === 'NOT_FOUND' || err.code === 'NOT_A_DIRECTORY')) {
          storage.removeRecentRoot(path)
          refused = `Can't add ${name}: folder not found`
        }
      }
      refused ??= refusal() ?? (storage.getRoots().length >= MAX_WINDOW_ROOTS ? `A window holds ${MAX_WINDOW_ROOTS} vaults at most` : null)
    }
    if (refused !== null) {
      // A restore says it in its own one notice (YAZ-3147 D3): the tabs of the vault stay closed.
      if (!quiet) notify(refused)
      return false
    }
    storage.setRoots([...storage.getRoots(), path])
    storage.pushRecentRoot(path)
    setRoots(storage.getRoots())
    setVaultOpen(path, true)
    return true
  }, [notify, setVaultOpen])
  /** "Restore session" (YAZ-3147 D3): the session's tabs join this window's strip; `workspace/restoreSession.ts` has the rules. */
  const restoreSavedSession = useCallback((id: string): void => {
    void restoreSession(id, { restore: api.window.restoreSession, roots: storage.getRoots, addVault: (root) => addVault(root, true), openStored, notify })
      .catch((err: unknown) => console.error('[sessions] restore failed:', err))
  }, [addVault, openStored, notify])
  // The flyout's "Open folder…" (S3): the system picker, and the picked folder is added. File ›
  // Open Folder… stays the picker above: its folder opens beside (S62).
  const { pick: pickVault } = usePickFolder({ onPicked: addVault })

  // ⌘W ladder (Tabs rule 7): close the active tab; with zero tabs open (incl. Welcome) close
  // the WINDOW through the real close path so the close/flush handshake runs.
  const closeTabOrWindow = useCallback(() => {
    if (!closeActive()) void api.window.closeSelf()
  }, [closeActive])

  // ⌘K (D4, YAZ-804): un-collapse this window through the one persisted toggle path, then show the
  // Search tab (YAZ-2638 D2), which asks the sidebar to focus its search bar (it mounts with the flag already true).
  const openSearch = useCallback(() => {
    if (sidebarCollapsed) toggleSidebar()
    changeLens('search')
  }, [sidebarCollapsed, toggleSidebar, changeLens])

  // ⌘O (YAZ-1767 D8): the ⌘K handshake for the vault switcher — un-collapse first, then bump a
  // request counter the sidebar header's panel consumes. The request is pinned to the sidebar it was
  // made on, by its key: the Sidebar mounts again on a new key, and a stale counter must not reopen
  // the panel after an in-place change (the vault folder moved, YAZ-1914; the vault menu's Open in this
  // window, YAZ-1798). Welcome (root null) has no switcher.
  const [switcherRequest, setSwitcherRequest] = useState<{ seq: number; key: string | null }>({ seq: 0, key: null })
  const openVaultSwitcher = useCallback(() => {
    if (root === null) return
    if (sidebarCollapsed) toggleSidebar()
    setSwitcherRequest((prev) => ({ seq: prev.seq + 1, key: sidebarKey.current }))
  }, [root, sidebarCollapsed, toggleSidebar])

  const showInSidebar = useCallback((path: string) => {
    if (sidebarCollapsed) toggleSidebar()
    // Favorites is a SUBSET of the vault (YAZ-1766 D1): a reveal there hops to Files, where every row exists.
    if (sidebarLens !== 'files') changeLens('files')
    setSidebarRevealRequest({ id: ++sidebarRevealId.current, path })
  }, [sidebarCollapsed, sidebarLens, toggleSidebar, changeLens])

  // A search row's menu item that draws into the tree (🔒 D2, YAZ-2050), and "Show in sidebar" on a
  // row of Search, Focus or Favorites (YAZ-2638 D1, D3): always the FILES lens, whichever tab was
  // showing. The sidebar is necessarily open (the row was clicked in it), so no un-collapse step here.
  // Enter on a folder of the search tree, and Shift+Enter on a row, ask with `focus` (YAZ-2662 D1, D8):
  // the row gets the keyboard focus too.
  const revealInFiles = useCallback((path: string, focus?: boolean) => {
    changeLens('files')
    setSidebarRevealRequest({ id: ++sidebarRevealId.current, path, focus })
  }, [changeLens])

  // A folder row of the new tab page (YAZ-2663 S22), and Shift+Enter on any of its rows (S38): the
  // row shows in Files — a folder open — with the keyboard focus on it, as Enter on a folder and
  // Shift+Enter do in the search tree (YAZ-2662 D1, D8). The page shows with the sidebar hidden too,
  // so the sidebar shows first.
  const showRowInFiles = useCallback((path: string) => {
    if (sidebarCollapsed) toggleSidebar()
    revealInFiles(path, true)
  }, [sidebarCollapsed, toggleSidebar, revealInFiles])
  // The way in to the new tab page from the sidebar (YAZ-2663 D7, S33): the page fills this box
  // with its door while it shows, so with no page the answer is no and the key stays the sidebar's.
  // The way back (D8) is to where the keyboard came from: a row of Files, Focus or Favorites is
  // kept for ONE trip back; from the search bar, and with that row gone, back is the search bar.
  const startPageFocus = useRef<(() => boolean) | null>(null)
  const startPageFrom = useRef<HTMLElement | null>(null)
  const leaveToPage = useCallback(() => {
    const from = document.activeElement
    const went = startPageFocus.current?.() ?? false
    if (went) startPageFrom.current = from instanceof HTMLElement && from.matches('.tree__row') ? from : null
    return went
  }, [])
  const backFromPage = useCallback(() => {
    const row = startPageFrom.current
    startPageFrom.current = null
    if (row?.isConnected === true) row.focus()
    else openSearch()
  }, [openSearch])

  const consumeSidebarReveal = useCallback((id: number) => {
    setSidebarRevealRequest((request) => request?.id === id ? null : request)
  }, [])

  // A right-click on a row of the new tab page (YAZ-2663 D6): the sidebar opens its OWN row menu
  // for that path at the mouse, so the page has no menu and no rule is written twice. With the
  // sidebar hidden it shows first, and it mounts with the request already set (S31).
  const showRowMenu = useCallback((path: string, x: number, y: number) => {
    if (sidebarCollapsed) toggleSidebar()
    setSidebarMenuRequest({ id: ++sidebarMenuId.current, path, x, y })
  }, [sidebarCollapsed, toggleSidebar])
  const consumeSidebarMenu = useCallback((id: number) => {
    setSidebarMenuRequest((request) => request?.id === id ? null : request)
  }, [])

  // The settings dialog (YAZ-1679) is App's so the sidebar cog, ⌘, and the app menu's Settings…
  // open the ONE dialog — and it can open with the sidebar collapsed. `open`/`close` are stable
  // because `useMenuEvents` resubscribes whenever a callback identity changes.
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Which page the dialog opens on: the first, or Sharing from the Share dialog's "Open Settings › Sharing" (YAZ-3040).
  const [settingsPage, setSettingsPage] = useState<'sharing' | undefined>(undefined)
  const openSettings = useCallback(() => {
    setSettingsPage(undefined)
    setSettingsOpen(true)
  }, [])
  const openSharingSettings = useCallback(() => {
    setSettingsPage('sharing')
    setSettingsOpen(true)
  }, [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  // The updater (YAZ-2976): the sidebar's pill (D4) and Help › What's New… (D8) open the ONE
  // "What's new" sheet, App's for the same reason as the settings dialog. Closing it leaves the
  // pill (S19): the pill follows the state, never the sheet.
  const update = useUpdate()
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)
  const openWhatsNew = useCallback(() => setWhatsNewOpen(true), [])
  const closeWhatsNew = useCallback(() => setWhatsNewOpen(false), [])

  // Upkeep review (YAZ-2322): each vault counts what is due and can hold a session, and the window
  // shows ONE (YAZ-2602 S41): a start in one vault closes the session of every other. App's,
  // because the sidebar that shows the count unmounts while collapsed.
  const reviewer = vaults.find((vault) => vault.review.session !== null) ?? null
  const review = (reviewer ?? first).review
  const startReview = useCallback((scope: VaultScope, folder?: string) => {
    for (const vault of live.current.vaults) if (vault !== scope) vault.review.close()
    scope.review.start(folder)
  }, [])
  const toggleInbox = useCallback((vault: string) => {
    const scope = live.current.vaults[live.current.roots.indexOf(vault)]
    if (scope.review.session === null) startReview(scope)
    else scope.review.close()
  }, [startReview])
  // The row menus ask and write by path: a note is in review by its own vault's settings (S42).
  const reviewState = useCallback((path: string) => scopeOf(path).review.inReview(path), [scopeOf])
  const setReview = useCallback((path: string, on: boolean) => scopeOf(path).review.setInReview(path, on), [scopeOf])
  // A link clicked in a tab's page opens in that tab (`navigate`, YAZ-2648 D3: the sidebar's click
  // goes to the preview tab, a page's own link does not). While a review is open it opens in a
  // background tab instead: the review stays in front and the active tab under it does not move.
  // Ref-backed, because a new `onOpenFile` identity would rebuild every mounted editor.
  const reviewing = useRef(false)
  reviewing.current = reviewer !== null
  const openFromPage = useCallback((path: string) => (reviewing.current ? openBackground : navigate)(path), [openBackground, navigate])
  // Going to a tab — a sidebar click, ⌃Tab — ends the review: the page asked for must not open unseen under it.
  // A trip to another copy of the same file (YAZ-2940) moves `activeTab` and not `file`, so both are watched.
  const closeReview = useCallback(() => live.current.vaults.forEach((vault) => vault.review.close()), [])
  useEffect(() => closeReview(), [activeTab, file, closeReview])

  // The tab board (YAZ-2648 D5): every open tab as a small page, in the tab stack's place. Whether
  // it shows is this window's, for the session, like the settings dialog: nothing is stored. The
  // grid button and ⌘⇧M both open it and close it. A review is not a tab and stands in the same
  // place, so the board does not open over one, and a review that starts closes it. The Welcome
  // window has no tabs and no board.
  //
  // `open` remembers the tab (by id) it opened from (`from`): that tab's layer is the one that zooms out
  // under the board. `leaving` is the zoom back in — the chosen tab is active already and its
  // layer grows from its page of the board, which says when it is done (`leftOverview`). Where no
  // motion is asked for (and where there is no `matchMedia`) there is no way out to wait for.
  const [overview, setOverview] = useState<{ phase: 'closed' | 'open' | 'leaving'; from: string | null }>(OVERVIEW_CLOSED)
  const overviewOpen = overview.phase === 'open'
  /** What the doors below read at the moment they are used; they keep their identity under the board. */
  const now = useRef({ file, active: activeTab, tabs, preview, blank, phase: overview.phase, right: rightPanel.items.length })
  now.current = { file, active: activeTab, tabs, preview, blank, phase: overview.phase, right: rightPanel.items.length }
  // The note's first edit keeps the preview tab that shows it (YAZ-2648 D2). An editor says its path;
  // `keep` takes the tab's id (YAZ-2940 D1). Through `now`, because a new `onUserEdit` identity would rebuild every mounted editor.
  const keepEdited = useCallback((path: string) => {
    const id = now.current.preview
    if (id !== null && tabById(now.current, id)?.path === path) keep(id)
  }, [keep])
  // Going to a page — a sidebar click, ⌃Tab, a deep link — closes the board at once, by the review's
  // rule above: the page asked for must not open unseen under it. A change of the active tab the
  // board made ITSELF is no such trip, and says so here first: the page it zooms into, and the
  // heir of an active tab it closed or sent to the right panel, after which it stays open.
  const ownChange = useRef(false)
  const inReview = reviewer !== null
  // A trip to another copy of the same file (YAZ-2940) moves `activeTab` and not `file`, so both are watched.
  useEffect(() => {
    if (ownChange.current) ownChange.current = false
    else setOverview(OVERVIEW_CLOSED)
  }, [activeTab, file, inReview])
  // The preview panel of the search gives way to the board and to a review (YAZ-2662 S67): each
  // stands in the page area, and the panel is a look at a file over a PAGE. `previewShown` is the
  // path that is drawn and that the sidebar reads. A path that is named while one of them shows is
  // dropped, so no panel comes back when it closes.
  const previewShown = overview.phase === 'closed' && !inReview ? previewPath : null
  useEffect(() => {
    if (previewShown === null) setPreviewPath(null)
  }, [previewShown, previewPath])
  // The panel's ✕, and Esc with the keyboard focus inside the panel (S66): the panel closes, and a
  // focus that was inside it goes back to the search bar, by the door of ⌘K.
  const closePreview = useCallback(() => {
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.quicklook') !== null) openSearch()
    setPreviewPath(null)
    setPagePreviewPath(null)
  }, [openSearch])
  // What the panel draws: the file of a row of the new tab page (YAZ-2663 S39), else the file of the search.
  const panelPath = pagePreviewPath ?? previewShown
  /** Leave the board for the tab `id` — a page of the board, a tab of the strip — or, with null, for the page that is open (Esc, the button, ⌘⇧M). */
  const leaveOverview = useCallback((id: string | null) => {
    const { active: open, tabs: all } = now.current
    if (id !== null && id !== open && all.some((t) => t.id === id)) {
      ownChange.current = true
      activate(id)
    }
    const zoom = (id ?? open) !== null && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === false
    setOverview((at) => (at.phase !== 'open' ? at : zoom ? { phase: 'leaving', from: null } : OVERVIEW_CLOSED))
  }, [activate])
  const leaveOverviewForOpenPage = useCallback(() => leaveOverview(null), [leaveOverview])
  // The doors of a trip from outside the board: the sidebar's click and its double click, a deep
  // link, ⌃Tab. The effect above knows a trip only when `file` moves, so each door closes the
  // board itself: the page ALREADY open is a trip too, and it must show (S46).
  const openPage = useCallback((path: string) => {
    setOverview(OVERVIEW_CLOSED)
    openCurrent(path)
  }, [openCurrent])
  const openKeptPage = useCallback((path: string) => {
    setOverview(OVERVIEW_CLOSED)
    openKept(path)
  }, [openKept])
  const toNextTab = useCallback(() => {
    setOverview(OVERVIEW_CLOSED)
    nextTab()
  }, [nextTab])
  const toPrevTab = useCallback(() => {
    setOverview(OVERVIEW_CLOSED)
    prevTab()
  }, [prevTab])

  // Settings › Storage (YAZ-1801 D1, 🔒 D13; YAZ-3039): the active tab's vault, measured only while
  // Settings is open — on its page's open, a sync pass finishing, and a shrink. A closed dialog hands the hook no sync state.
  const vaultStorage = useVaultStorage(active.root, settingsOpen ? (active.sync.status?.state ?? null) : null)

  // Settings › Sharing (YAZ-3040, Draw's YAZ-1799 D7): main's share status and the active tab's
  // vault's shared boards, read only while Settings is open.
  const sharing = useSharing(active.root, settingsOpen)
  // The ONE Share dialog (YAZ-3040, Draw's YAZ-1799 D6): a board row's "Share", and File › Share Link.
  const [share, setShare] = useState<{ root: string; path: string } | null>(null)
  const openShare = useCallback((path: string) => {
    const root = rootOfPath(live.current.roots, path)
    if (root !== null && isBoard(path)) setShare({ root, path })
  }, [])
  const closeShare = useCallback(() => setShare(null), [])
  const activeFile = useRef(file)
  activeFile.current = file
  /**
   * File › Share Link ⌘⇧L (YAZ-3037's menu item, YAZ-3040's dialog): the Share dialog on the ACTIVE tab's
   * board; nothing on a note or with no tab. Main also greys the item out off a board.
   */
  const shareActiveBoard = useCallback(() => {
    if (activeFile.current !== null) openShare(activeFile.current)
  }, [openShare])

  // Version history (YAZ-1897 D4, YAZ-3039): a board row's right-click, or "See changes" on a merge
  // notice (`fromMerge`). The board's own vault answers for it.
  const [history, setHistory] = useState<{ root: string; path: string; fromMerge: boolean } | null>(null)
  const openHistory = useCallback((path: string, fromMerge = false) => {
    const root = rootOfPath(live.current.roots, path)
    if (root !== null) setHistory({ root, path, fromMerge })
  }, [])
  const closeHistory = useCallback(() => setHistory(null), [])
  // A sync pass that merged says so ONCE (YAZ-1897 D4): `merged` rides only that pass's broadcast,
  // so each list is told once, whichever vault of the window it is of. A WeakSet: nothing to clean up.
  const toldMerges = useRef(new WeakSet<object>())
  useEffect(() => {
    for (const vault of vaults) {
      const merged = vault.sync.status?.merged
      if (vault.root === null || merged === undefined || merged.length === 0 || toldMerges.current.has(merged)) continue
      toldMerges.current.add(merged)
      const { text, firstBoard } = mergeNotice(merged)
      const board = firstBoard === null ? null : absFrom(vault.root, firstBoard)
      setNotice(board === null ? { text, icon: 'info' } : { text, icon: 'info', action: { label: 'See changes', run: () => openHistory(board, true) } })
      // A shared drawing the merge rewrote re-uploads its link, as a local save would (YAZ-3040).
      for (const m of merged) if (m.copy === undefined) noteBoardSaved(vault.root, absFrom(vault.root, m.path))
    }
  })
  const leftOverview = useCallback(() => setOverview((at) => (at.phase === 'leaving' ? OVERVIEW_CLOSED : at)), [])
  const toggleOverview = useCallback(() => {
    const { phase, active: open } = now.current
    if (phase === 'open') leaveOverview(null)
    else if (phase === 'closed' && !reviewing.current && live.current.roots.length > 0) {
      ownChange.current = false
      // The blank tab is no page of the board: one that was not used goes away (YAZ-2655 R19).
      closeBlank()
      setOverview({ phase: 'open', from: open })
    }
  }, [leaveOverview, closeBlank])
  // ⌘T and the strip's "+" (YAZ-2655 D10, D11): the one blank tab shows, last in the strip and
  // active, over the empty page — and the caret goes to the sidebar's search bar, by the door ⌘K
  // uses, because a new empty tab has one job: to pick a page. The next page opened fills it as a
  // kept tab (the workspace's rule). Again while it shows, it only takes the caret back to the bar.
  // A review is not a tab and stands in the strip's place, so ⌘T does nothing during one (R21);
  // the Welcome window has no strip. The board gives way to it at once: the blank tab is no page of it.
  const newTab = useCallback(() => {
    if (reviewing.current || live.current.roots.length === 0) return
    setOverview(OVERVIEW_CLOSED)
    openBlank()
    openSearch()
    setPendingSearchClear(true)
  }, [openBlank, openSearch])
  // A window opened with NO tab on purpose (⌘⇧N, the tab board's windows — YAZ-3343) starts as ⌘T leaves one: the
  // blank tab, the caret in the search. Once, at boot.
  const startedBlank = useRef(false)
  useEffect(() => {
    if (startedBlank.current || !storage.isEmptyByChoice()) return
    startedBlank.current = true
    newTab()
  }, [newTab])
  /**
   * A page's ✕, an island's ✕, a tab's ✕ under the board: the tabs close as ⌘W closes each, in ONE
   * change of the workspace, and the board stays — until its last tab goes: then it closes, and
   * the window shows the empty state (R18).
   */
  const closeUnderOverview = useCallback((ids: string[]) => {
    const { active: open, tabs: all } = now.current
    if (all.every((t) => ids.includes(t.id))) setOverview(OVERVIEW_CLOSED)
    ownChange.current = open !== null && ids.includes(open)
    closeTabs(ids)
  }, [closeTabs])
  const closeOneUnderOverview = useCallback((id: string) => closeUnderOverview([id]), [closeUnderOverview])
  /**
   * "Kill all tabs" (YAZ-2739): the board's button and the grid button's menu both ask HERE, so one
   * sheet answers for both. Yes closes each tab as ⌘W closes it, in ONE change of the workspace:
   * each editor saves its text on the way out. The blank tab goes too. An open board closes with
   * its last tab (R18). No tab comes back, which is why it asks. With "Show all windows" on the board
   * also hands the other windows' tabs (`others`, YAZ-3343 D10): the sheet counts them, and yes asks each
   * of those windows to close its own; a window left with no tab stays open.
   */
  const [killAsk, setKillAsk] = useState<{ others: readonly { win: string; refs: TabRef[] }[] } | null>(null)
  const killOthers = killAsk?.others.reduce((n, w) => n + w.refs.length, 0) ?? 0
  const killWindows = (killAsk?.others.length ?? 0) + (tabs.length > 0 ? 1 : 0)
  // With no tab there is nothing to ask about: a sheet whose last tab went under it (⌘W, a delete) closes.
  if (killAsk !== null && tabs.length === 0 && killOthers === 0) setKillAsk(null)
  // The grid button's menu asks with no argument; the board with the other windows it shows (D10).
  const askKillAll = useCallback((others?: readonly { win: string; refs: TabRef[] }[]) => setKillAsk({ others: Array.isArray(others) ? others.filter((w) => w.refs.length > 0) : [] }), [])
  const killAsked = useRef(killAsk)
  killAsked.current = killAsk
  const killAllTabs = useCallback(() => {
    const others = killAsked.current?.others ?? []
    setKillAsk(null)
    // A Files window has no tabs (YAZ-3357 D8): Kill all is the other windows', and its board stays open.
    if (!filesWindow) {
      closeBlank()
      closeUnderOverview(now.current.tabs.map((t) => t.id))
    }
    for (const { win, refs } of others) api.window.closeTabs(win, refs).catch(() => notify("Can't close the tabs of a window that closed"))
  }, [closeBlank, closeUnderOverview, notify])
  /**
   * A save of the open tabs as a session (YAZ-3147 D5, S1–S9): "Save open tabs" on the Sessions tab and the
   * grid menu's two items. Main saves THIS window's tabs under "New session" (the blank tab is no tab, and the
   * preview tab saves as a kept one). The sidebar then shows the Sessions tab, and the new row opens its name
   * field. "Save and close all tabs" closes every tab, the blank one too, with no sheet — the tabs are saved —
   * and only after the save. A refusal closes nothing. Past MAX_SESSION_TABS a notice says the first ones are saved.
   */
  const [sessionNameRequest, setSessionNameRequest] = useState<string | null>(null)
  const clearSessionNameRequest = useCallback(() => setSessionNameRequest(null), [])
  // One save at a time: a second press of "Save open tabs" (⏎ on the focused button) before main answers is no second session.
  const savingSession = useRef(false)
  const saveSession = useCallback(async (closeAll: boolean): Promise<void> => {
    const count = now.current.tabs.length
    if (count === 0) {
      notify('No open tabs to save')
      return
    }
    if (savingSession.current) return
    savingSession.current = true
    const id = await api.window.saveSession('New session').catch((err: unknown) => {
      console.error('[sessions] save failed:', err)
      return null
    }).finally(() => {
      savingSession.current = false
    })
    if (id === null) {
      notify(storage.getSessions().length >= MAX_SESSIONS ? `Can't save: ${MAX_SESSIONS} sessions at most` : "Can't save the tabs")
      return
    }
    if (sidebarCollapsedRef.current) toggleSidebar()
    changeLens('sessions')
    setSessionNameRequest(id)
    if (closeAll) {
      // Only the saved tabs close (S8): past MAX_SESSION_TABS the others stay open, so no tab goes unsaved.
      closeBlank()
      closeUnderOverview(now.current.tabs.slice(0, MAX_SESSION_TABS).map((t) => t.id))
    }
    if (count > MAX_SESSION_TABS) notify(closeAll ? `Saved and closed the first ${MAX_SESSION_TABS} tabs. ${count - MAX_SESSION_TABS} stay open` : `Saved the first ${MAX_SESSION_TABS} tabs`)
  }, [notify, toggleSidebar, changeLens, closeBlank, closeUnderOverview])
  const saveOpenTabs = useCallback(() => void saveSession(false), [saveSession])
  const saveFromGrid = useCallback((closeAll: boolean) => void saveSession(closeAll), [saveSession])
  /** "Update with open tabs" (S28, S29): the same door with the session's id — it keeps its id and its name. No tab: nothing changes. */
  const updateSession = useCallback((id: string) => {
    const count = now.current.tabs.length
    if (count === 0) {
      notify('No open tabs to save')
      return
    }
    void api.window.saveSession('', id)
      .then((saved) => {
        if (saved !== null && count > MAX_SESSION_TABS) notify(`Saved the first ${MAX_SESSION_TABS} tabs`)
      })
      .catch((err: unknown) => console.error('[sessions] update failed:', err))
  }, [notify])
  /** "Move to ▸ Right panel" (YAZ-3091 D3), on a page of the board and on a tab of the strip: the page goes to the end of that panel, and an open board stays (R30). */
  const movePageToRight = useCallback((path: string) => {
    ownChange.current = path === now.current.file
    transferMainToRight(path, now.current.right)
  }, [transferMainToRight])
  /**
   * A tab leaves for another window (YAZ-2933 D2, YAZ-3091 D1), from a page of the board or a tab of the strip.
   * The page saves first, so the other window reads what was typed; `send` gives main the page with its page
   * view and display name; only then does the tab leave, as ⌘W closes it — an open board stays until its last
   * tab goes (R18). A refusal or a failed save leaves the tab where it is, and the notice starts with `failed`.
   * Only this tab leaves: a copy's twins stay (YAZ-2940 S16).
   */
  const sendTabAway = useCallback((path: string, id: string, send: (carry: PopOutCarry) => Promise<void>, failed: string, closeEmptyWindow: boolean) => {
    // The page opens there as it looks here (YAZ-2951 D2): read before the save, while its editor is the one on show.
    const view = readPageView(id)
    // The tab's display name goes with it (YAZ-2949 D7, S19).
    const name = now.current.tabs.find((t) => t.id === id)?.name
    flushRenamedPath(path)
      .then(() => send({ view, name }))
      .then(() => {
        const { tabs: all, right, phase, blank: newTab } = now.current
        // YAZ-3091 D6: the only tab of a window whose right panel is empty takes the window with it, through its real close.
        // An open blank tab is a tab too (YAZ-3105): then the window is not empty, and it stays.
        if (closeEmptyWindow && all.length === 1 && all[0].id === id && right === 0 && !newTab) void api.window.closeSelf()
        else if (phase === 'open') closeUnderOverview([id])
        else closeTab(id)
      })
      .catch((err: unknown) => notify(`${failed}: ${err instanceof Error ? err.message : String(err)}`))
  }, [closeUnderOverview, closeTab, notify])
  /** "Move to new window" (YAZ-2933): main opens the window and stores the name with its one tab (YAZ-3057). A last tab leaves this window empty. */
  const movePageToNewWindow = useCallback((path: string, id: string) =>
    sendTabAway(path, id, (carry) => api.window.popOut(path, carry), "Can't move to a new window", false), [sendTabAway])
  /** The same from the tab board (YAZ-3343 D37): QUIET — the new window opens behind, the board keeps the focus. */
  const movePageToNewWindowQuietly = useCallback((path: string, id: string) =>
    sendTabAway(path, id, (carry) => api.window.popOut(path, { ...carry, background: true }), "Can't move to a new window", false), [sendTabAway])
  /** "Move to ▸ <window>" (YAZ-3091 D1, D6): main hands the tab to the open window `to`, or refuses when it closed (S19). */
  const movePageToWindow = useCallback((to: string, path: string, id: string) =>
    sendTabAway(path, id, (carry) => api.window.moveTo(to, path, carry), "Can't move to that window", true), [sendTabAway])
  /**
   * A card dropped in another window's frame on a tab board (YAZ-3343 D13): the same move, QUIET (D20) — main raises nothing and the tab joins that window in the background, so the user stays on the board.
   */
  const movePageToWindowQuietly = useCallback((to: string, path: string, id: string) =>
    sendTabAway(path, id, (carry) => api.window.moveTo(to, path, { ...carry, background: true }), "Can't move to that window", true), [sendTabAway])
  /**
   * "Move to ▸" (YAZ-3091 D2, D7 revised by D8): the other windows that show a vault of `path`, read from the state
   * cache only while a tab menu is open. Every one of them shows this vault, so a row names what that window SHOWS:
   * the page on show — its tab's display name first — and "+ N more tabs", copies counted (S6). The row lights its
   * window up (`highlightWindow`), so two rows that read alike are still told apart.
   */
  const moveTargets = useCallback((path: string): MoveTarget[] =>
    storage.getOtherWindows()
      .filter((w) => rootOfPath(w.roots, path) !== null)
      // A named window is called by its name (YAZ-3343 D14); the automatic label is the board's frames' too (`windowLabel`).
      .map((w) => ({ id: w.id, label: windowLabel(w, titles) })), [titles])
  /** The "Move to ▸" row under the pointer lights up its window (YAZ-3091 D8). A failed call only means no glow. */
  const highlightWindow = useCallback((to: string | null) => {
    api.window.highlight(to).catch(() => undefined)
  }, [])
  /**
   * "Duplicate tab" (YAZ-2940 D5–D7), on a tab of the strip and on a page of the board: a copy of the tab
   * opens right after it and shows — under the board it shows on the board beside its source, and the
   * board stays (S5: a menu action is no trip to a page, R30). The copy starts with its source's page view
   * (YAZ-2951 D1: drill-in, live folds, scroll spot, text size): read here, before its layer mounts, and
   * handed to its editor once (`startView`). A source with no open editor gives none (S8, S9).
   */
  // Built once, at mount (a lazy start: `bootStartView` reads storage and makes a Map). Changed in place: never a render trigger.
  const [startView] = useState(() => bootStartView(activeTab, file))
  const duplicateTab = useCallback((id: string) => {
    const view = readPageView(id)
    ownChange.current = now.current.phase === 'open'
    const copy = duplicate(id)
    if (copy !== null && view !== undefined) startView.set(copy, view)
  }, [duplicate, startView])
  /**
   * A tab another window moved here (YAZ-3091 D5, S8–S14): the board closes, the page is a NEW tab at the end
   * and shows — a copy when it is open, out of the right panel when it was there — with the moved name and
   * page view. The view goes to `startView` before the tab's layer mounts, as a duplicate's does. A QUIET move
   * (`background`, a card dropped on a tab board, YAZ-3343 D13) only adds the tab: the page on show and an open
   * board stay as they are.
   */
  const takeTab = useCallback(({ path, view, name, background }: MovedTab) => {
    if (background !== true) setOverview(OVERVIEW_CLOSED)
    const id = take(path, background === true)
    if (name !== undefined) setTabName(id, name)
    if (view !== undefined) startView.set(id, view)
  }, [take, setTabName, startView])
  /**
   * The tab board of ANOTHER window asks this one (YAZ-3343 D3, D10, D13), by refs — a path and which copy of it
   * in this strip, never a tab id. Each resolves its refs against the strip as it is now, all before acting.
   * A pick of a tab here closes this window's board, as a sidebar click does; a close leaves it open.
   */
  const focusTabHere = useCallback((ref: TabRef) => {
    const tab = tabOfRef(now.current.tabs, ref)
    if (tab === undefined) return
    setOverview(OVERVIEW_CLOSED)
    activate(tab.id)
  }, [activate])
  const closeTabsHere = useCallback((refs: TabRef[]) => {
    const ids = refs.flatMap((ref) => tabOfRef(now.current.tabs, ref)?.id ?? [])
    if (ids.length === 0) return
    if (now.current.phase === 'open') closeUnderOverview(ids)
    else closeTabs(ids)
  }, [closeUnderOverview, closeTabs])
  const sendTabHere = useCallback(({ to, ref }: { to: string; ref: TabRef }) => {
    const tab = tabOfRef(now.current.tabs, ref)
    // `link:send-tab` is only ever a board's drop (D13): the "Move to ▸" door made quiet — the page saves first, then leaves.
    if (tab !== undefined) movePageToWindowQuietly(to, tab.path, tab.id)
  }, [movePageToWindowQuietly])
  // Below `startView`: a moved tab's page view goes there (YAZ-3091 D5).
  /**
   * A tab board's vault chip picked this window's vaults (YAZ-3343 D22): only while it has NO tab — main
   * checked, and a tab that came since keeps the window as it is. A Welcome window opens the vault as File › Open does.
   */
  const setRootsHere = useCallback((next: string[]) => {
    if (now.current.tabs.length > 0 || next.length === 0) return
    if (live.current.roots.length === 0) return void openRoot(next[0])
    storage.setRoots(next)
    for (const root of next) storage.pushRecentRoot(root)
    setRoots(storage.getRoots())
  }, [openRoot])
  /** Another window's board: "Move to new window" on a card of THIS window (YAZ-3343) — moved quietly, its text saved first. */
  const popOutTabHere = useCallback((ref: TabRef) => {
    const tab = tabOfRef(now.current.tabs, ref)
    if (tab !== undefined) movePageToNewWindowQuietly(tab.path, tab.id)
  }, [movePageToNewWindowQuietly])
  /** Another window's board highlights a card of THIS window (YAZ-3343 D33): the strip lights that tab, as R45 does for this window's own board. */
  const highlightTabHere = useCallback((ref: TabRef | null) => {
    setBoardHighlight(ref === null ? null : (tabOfRef(now.current.tabs, ref)?.id ?? null))
  }, [])
  /** Another window's board asks a tab action of a tab of THIS window (YAZ-3343 D31: one card menu). */
  const tabActionHere = useCallback(({ ref, action }: { ref: TabRef; action: TabAction }) => {
    const tab = tabOfRef(now.current.tabs, ref)
    if (tab === undefined) return
    if (action.kind === 'duplicate') duplicateTab(tab.id)
    else if (action.kind === 'set-name') setTabName(tab.id, action.name)
    else if (action.kind === 'show-in-sidebar') showInSidebar(tab.path)
    else setReview(tab.path, action.on)
  }, [duplicateTab, setTabName, showInSidebar, setReview])
  /** A Files window's click, run here (YAZ-3357 D2): set further down, where every door it calls is made. Main holds the push until `link.ready`. */
  const fromFiles = useRef<(action: FilesAction) => void>(() => undefined)
  const openFromFiles = useCallback((action: FilesAction) => fromFiles.current(action), [])
  useLinkEvents({ onOpenFile: openPage, onNotice: notify, onTakeTab: takeTab, onFocusTab: focusTabHere, onCloseTabs: closeTabsHere, onSendTab: sendTabHere, onSetRoots: setRootsHere, onPopOutTab: popOutTabHere, onHighlightTab: highlightTabHere, onTabAction: tabActionHere, onOpenFromFiles: openFromFiles })
  /** Another window's card dropped in a frame on this board (YAZ-3343 D13): that window sends it, quietly (`sendTabHere` there). */
  const moveBoardTab = useCallback((from: string, to: string, ref: TabRef) => {
    api.window.moveTab(from, to, ref).catch((err: unknown) => notify(`Can't move that tab: ${err instanceof Error ? err.message : String(err)}`))
  }, [notify])
  /** What the board's preview panel needs of a page's vault (D18): the scope that holds it, or the first one. */
  const boardPreviewScope = useCallback((path: string) => {
    const scope = scopeOf(path)
    return { root: scope.root, wikilinks: scope.wikilinks, textVars: textVarsFor(path), watch: scope.watch }
  }, [scopeOf, textVarsFor])
  /** "New window" from the tab board's empty canvas (YAZ-3343 D22): on this window's vaults, behind it. */
  const openWindowBehind = useCallback(() => api.window.openBehind(), [])
  /**
   * A frame's "Close all tabs" / "Close window" on the tab board, clicked twice in its menu (YAZ-3343 D21: no
   * sheet). THIS window by its own doors (its tabs as Kill all closes them; the window by its real close, which saves
   * first); another by main's.
   */
  const closeBoardWindow = useCallback((ask: { win: string; mine: boolean; refs: TabRef[]; whole: boolean }) => {
    if (ask.mine) {
      if (ask.whole) return void api.window.closeSelf()
      closeBlank()
      closeUnderOverview(now.current.tabs.map((t) => t.id))
      return
    }
    const failed = (): void => notify("Can't close that window: it is closed already")
    if (ask.whole) api.window.closeOther(ask.win).catch(failed)
    else api.window.closeTabs(ask.win, ask.refs).catch(failed)
  }, [closeBlank, closeUnderOverview, notify])
  // The board's chunk loads while the window is idle (D4), so the first open has nothing to wait for.
  useEffect(() => {
    const load = (): void => void preloadTabBoard().catch(() => undefined)
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(load, { timeout: 4000 })
      return () => window.cancelIdleCallback(handle)
    }
    const timer = window.setTimeout(load, 1500)
    return () => window.clearTimeout(timer)
  }, [])
  // A "Move to ▸" row of another window points at this one (YAZ-3091 D8): a ring shows while it does. Main puts it
  // out when that row is left or either window closes; GLOW_MAX_MS only covers a lost "off".
  const [glow, setGlow] = useState(false)
  useEffect(() => api.window.onGlow(setGlow), [])
  useEffect(() => {
    if (!glow) return
    const timer = window.setTimeout(() => setGlow(false), GLOW_MAX_MS)
    return () => window.clearTimeout(timer)
  }, [glow])
  // The copy's `Editor` keeps its start in a ref when it mounts, so the entry goes once its layer is there.
  useEffect(() => {
    for (const id of startView.keys()) if (mounted.includes(id)) startView.delete(id)
  }, [mounted, startView])
  /**
   * ⌘⇧N (GRO-2167): a new window on this window's vaults with NO tab — it opens on the blank tab, the caret in the
   * search (YAZ-3343 D35, which replaced YAZ-2951 D5's copy of the tabs and the page view).
   */
  const newWindow = useCallback(() => {
    api.window.duplicate().catch((err: unknown) => notify(`Can't open a new window: ${err instanceof Error ? err.message : String(err)}`))
  }, [notify])
  /** A rename or a move of the page on show, or of a folder above it, changes `file` and is no trip to a page: an open board stays. */
  const renamedUnderOverview = useCallback((oldPath: string, newPath: string, dir: boolean) => {
    const { file: open, phase } = now.current
    if (phase === 'open' && open !== null && oldPath !== newPath && (open === oldPath || (dir && open.startsWith(`${oldPath}/`)))) ownChange.current = true
  }, [])
  // Off the board the keyboard goes back to the page, which shows again by now — unless the
  // sidebar has it: a click or Enter there previews, and the walk keeps its place (YAZ-921). A tab
  // that mounts for the first time takes the caret by itself, under the same rule.
  const lastPhase = useRef(overview.phase)
  useEffect(() => {
    const was = lastPhase.current
    lastPhase.current = overview.phase
    const inSidebar = document.activeElement instanceof HTMLElement && document.activeElement.closest('.sidebar') !== null
    if (was === 'open' && overview.phase !== 'open' && !inSidebar) focusOpenDocument()
  }, [overview.phase])

  // File › Open Folder… / Open Recent (GRO-2161) reuse the same flows as the in-app buttons;
  // File › Close Tab and Window › Next/Previous Tab (GRO-2232) drive the tab model — except that
  // with a review open ⌘W closes IT, never the tab hidden under it (YAZ-2322). ⌘W on the blank tab
  // closes it alone (YAZ-2655 S75): that is `closeActive`'s own rule.
  //
  // The board items (YAZ-3037, YAZ-3028 D10) act on the VISIBLE board layer, which `requestBoardCommand`
  // finds by DOM: several tabs are mounted at once and only one is in front. Main greys each item out
  // off a board it does not work for. ⌘⇧S is also the review's Skip, and the note keeps its key (D10):
  // with a review over a drawing tab the menu owns the key, so its gesture goes to Skip, as ⌘W goes to the review.
  const exportImage = useCallback(() => void requestBoardCommand({ kind: 'export-image' }), [])
  const exportDrawing = useCallback(() => void requestBoardCommand({ kind: 'export-drawing' }), [])
  const setCanvasBackground = useCallback((color: string) => void requestBoardCommand({ kind: 'canvas-background', color }), [])
  useMenuEvents({
    onOpenFolder: pick,
    onOpenRoot: openVault,
    onSearch: openSearch,
    onSwitchVault: openVaultSwitcher,
    onSettings: openSettings,
    onToggleSidebar: toggleSidebar,
    onCloseTab: reviewer === null ? closeTabOrWindow : closeReview,
    onNextTab: toNextTab,
    onPrevTab: toPrevTab,
    onTabOverview: toggleOverview,
    // ⌘T in a Files window (YAZ-3357 D8) opens a new normal window, as ⌘⇧N: there is no strip for a tab.
    onNewTab: filesWindow ? newWindow : newTab,
    onNewWindow: newWindow,
    onZoom: requestZoom,
    onWhatsNew: openWhatsNew,
    onExportImage: exportImage,
    onExportDrawing: reviewer === null ? exportDrawing : review.skip,
    onShareLink: shareActiveBoard,
    onCanvasBackground: setCanvasBackground,
  })

  /**
   * ⌘⇧C copies paths (🔒 D4, YAZ-1338) — the row of the new tab page that the keyboard is on
   * (YAZ-2663 D9), else the multi-selection when one is standing, else the file
   * you are looking at, so the chord answers with the sidebar collapsed too. The listener is
   * App's for the same reason ⌘B's is (YAZ-1280): the Sidebar unmounts while hidden, and a window
   * shortcut cannot live in a panel that comes and goes. It reads the selection through
   * `sidebarSelection`, the box the Sidebar keeps current and empties on its way out (🔒 D1: the
   * state itself never leaves that component) — read here, never written.
   *
   * ORDER is the panel's, through the one `orderedSelection` the context menu's plural items use,
   * so ⌘⇧C and "Copy N paths" can never spell one selection two ways. With the sidebar hidden
   * there is no `.sidebar__body` to read an order from, and the set's own order is the answer.
   *
   * With nothing selected AND nothing open the chord is NOT ours: no preventDefault, so whatever
   * else the platform does with it still happens.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!ownsCopyPathHotkey(event)) return
      const selected = sidebarSelection.current
      // A row of the new tab page that has the keyboard focus is what the user looks at (YAZ-2663 D9):
      // no page is on show there, and the page has no selection of its own, so that row is the answer first.
      const onPage = document.activeElement instanceof HTMLElement ? (document.activeElement.closest<HTMLElement>('.start__row')?.dataset.path ?? null) : null
      const text = onPage ?? (selected.size > 0 ? orderedSelection(selected, document.querySelector('.sidebar__body')).join('\n') : pageOnShow)
      if (text === null) return
      event.preventDefault()
      // BOTH outcomes speak through the window's one passive notice (YAZ-1341): the user cannot
      // see a clipboard land, so a copy needs its yes as much as its no.
      const copied = text.split('\n').length
      void navigator.clipboard.writeText(text).then(
        () => notify(copied === 1 ? 'Copied path' : `Copied ${copied} paths`, 'info', 'clipboard'),
        (error: unknown) => notify(`Can't copy path: ${error instanceof Error ? error.message : String(error)}`),
      )
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pageOnShow])

  /**
   * ⌘C / ⌘X / ⌘V for the sidebar's FILE clipboard (D6 amended, YAZ-1674) — ⌘⇧C's sibling in every
   * way: a window listener (a panel listener needs focus inside the panel, and after a click on
   * the open file focus sits in the editor — YAZ-961's handoff — while blank space is not
   * focusable at all), the same ownership boundary (`ownsWindowChord`: a field, the ProseMirror
   * editor or a modal keeps the key, so text copy/paste is untouched), and a handle the Sidebar
   * fills and empties. The RULES are the Sidebar's — target, order, the clipboard gate — so
   * this only asks, and swallows the key exactly when a verb says it acted.
   *
   * ⌘⌫ (YAZ-3272 D20) is the handle's `delete`: the sidebar asks its delete door for the ordered
   * selection. No selection, an open menu or a vault row in it: the key passes through (S72).
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const verb = fileClipboardVerb(event)
      if (verb === null) return
      // ⌘Z / ⌘⇧Z (YAZ-3255 D10): the window's undo list, with or without a sidebar. Nothing to undo: the key passes (S35).
      if (verb === 'undo' || verb === 'redo') {
        if (!moveReplay.current[verb]()) return
        event.preventDefault()
        event.stopPropagation()
        return
      }
      const clipboard = sidebarClipboard.current
      if (clipboard === null) return
      const acted = verb === 'paste' ? clipboard.paste() : verb === 'delete' ? clipboard.delete() : clipboard.cutOrCopy(verb)
      if (!acted) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // External rename/move resilience (Links E1c, GRO-2242 — locked: confirm-first, NEVER
  // automatic, never a dialog): ONE detector per vault (`useVaultScope`), fed by the cold-start
  // reconcile diff and by consecutive index snapshots, and ONE passive app-level banner at a time:
  // the first vault's that has one (YAZ-2602 S44). Update → repair the app (file:repair-rename,
  // whose file:renamed push drives the SAME tab/editor downstream as an in-app rename) + rewrite
  // the referencing notes; Dismiss → drop for this session. In-app renames are suppressed
  // through the file:renamed effect below, so their watcher echo never banners.
  const renamer = vaults.find((vault) => vault.renames.banner !== null)?.renames
  const renameBanner = renamer?.banner ?? null
  /** A path as a banner and a review name it: inside the vault that holds it. */
  const relLabel = useCallback((p: string) => {
    const vault = scopeOf(p).root
    return vault === null ? p : relTo(vault, p)
  }, [scopeOf])
  // What a Files window asks of THIS window (YAZ-3357 D2): the same doors its own sidebar uses. An Inbox opens its
  // review; one that is open already stays open (the Files window cannot see it, so a click must never close it).
  fromFiles.current = (action: FilesAction): void => {
    switch (action.kind) {
      case 'open':
        return (action.how === 'keep' ? openKeptPage : action.how === 'background' ? openBackground : openPage)(action.path)
      case 'history':
        return openHistory(action.path)
      case 'share':
        return openShare(action.path)
      case 'review':
        return startReview(scopeOf(action.dir), relLabel(action.dir))
      case 'session':
        return restoreSavedSession(action.id)
      case 'inbox': {
        const at = live.current.roots.indexOf(action.root)
        if (at !== -1 && live.current.vaults[at].review.session === null) startReview(live.current.vaults[at])
      }
    }
  }

  // In-app rename (Links E1 GRO-2194, folders E1b GRO-2241). `file:renamed` reaches EVERY
  // window (originator included): BEFORE the workspace remap unmounts the old-path editor(s), a
  // dirty buffer is carried into the new path and the old controller retired (no flush to
  // the old path — see lib/renameContinuity.ts); then its main/right owner follows in place,
  // and title/URL-hash track the active main tab through the existing effects above. A `dir`
  // event is a PREFIX remap: every open editor and workspace path under the folder follows, and a window
  // with a vault AT (or under) the folder — a subfolder opened as a vault — follows too, for every
  // such vault it shows (YAZ-2602 S48). Main's store repair already moved the WindowEntry's
  // `root` and `roots`; the state and the cache only mirror it, so no identity write that could
  // clobber the repaired file/tabs. A vault that moved keeps its slot, and its scope with it.
  useEffect(
    () =>
      api.file.onRenamed(({ oldPath, newPath, kind }) => {
        const now = live.current
        // A shared board's pending live-link upload follows it (YAZ-3040); by prefix, so a folder too.
        noteBoardRenamed(oldPath, newPath)
        // E1c: an in-app rename's watcher echo (unlink+add with preserved stats) must never
        // be re-offered as an "external rename" hypothesis, by any vault's detector.
        for (const vault of now.vaults) vault.renames.suppress(oldPath, newPath, kind)
        if (kind === 'dir') {
          carryEditorsAcrossDirRename(oldPath, newPath)
          const moved = now.roots.map((vault) => movedRoot(vault, oldPath, newPath))
          const vaultMoved = moved.some((vault, i) => vault !== now.roots[i])
          if (vaultMoved) {
            // The cache first: the workspace mirror below writes `lastFile` to the vault that holds the file.
            storage.mirrorRoots(moved)
            slots.current = renameSlots(slots.current, oldPath, newPath)
          }
          renamedUnderOverview(oldPath, newPath, true)
          renameWorkspaceDir(oldPath, newPath, moved[0] !== now.roots[0] ? moved[0] : undefined)
          if (vaultMoved) setRoots(moved)
          return
        }
        carryEditorAcrossRename(oldPath, newPath)
        renamedUnderOverview(oldPath, newPath, false)
        renameWorkspacePath(oldPath, newPath)
      }),
    [renameWorkspacePath, renameWorkspaceDir, renamedUnderOverview],
  )

  /**
   * The sidebar's Rename/move commit (files E1, folders + drag-moves E1b): flush our own
   * buffer(s) for the file — or every open editor under the folder — snapshot the index
   * BEFORE the rename (afterwards the old name no longer resolves), rename, then rewrite
   * every referencing note through the shared-resolver engine. All failures land in the
   * passive notice — never a dialog, never a rejection back into the inline input.
   *
   * A title edit (YAZ-2420 🔒 D16) is this same commit with two differences: `file.retitle` runs
   * in place of `file.rename`, and answers with the path it built; and the link rewrite is told
   * the new title, so a link that spelled the old one follows it.
   */
  const applyRename = useCallback(
    async (oldPath: string, to: RenameTo, viewOnlyCatalog: ViewOnlyCatalog | null): Promise<RenameOutcome | null> => {
      // The index, the folders and the links are the ones of the vault that holds the path (YAZ-2602 S30).
      const r = scopeOf(oldPath).root
      if (r === null) return null
      // (a) our own unsaved buffers travel WITH the file(s). The kind is unknown until the
      // rename answers, so both run — each is a no-op for the other kind.
      await flushRenamedPath(oldPath)
      await flushRenamedDir(oldPath)
      // A move over a vault's edge (YAZ-3255): an undo or redo of a move in from Finder (S40), or of a
      // Paste of a Cut between vaults. The index cannot speak for the far side, so no link and no value
      // is written there, as the paste and the import write none; main's rename still repairs the tabs.
      if (to.title === undefined && overEdge(live.current.roots, oldPath, to.newPath)) {
        try {
          const { newPath, kind } = await api.file.rename({ oldPath, newPath: to.newPath })
          return { move: { oldPath, newPath, kind }, cleared: [], links: { updated: 0, skipped: 0 } }
        } catch (error) {
          return { error }
        }
      }
      let records: Awaited<ReturnType<typeof api.index>>['records'] = []
      let folders: typeof records = []
      let ids = false
      try {
        ;({ records, folders, ids } = await api.index(r))
      } catch {
        records = [] // no index snapshot → the rename still runs, links just stay as they are
      }
      // The folders as they stand BEFORE the rename too: a link to a folder resolves over them (YAZ-2290 D10).
      const dirs = vaultDirs(r)
      let newPath: string
      let kind: 'file' | 'dir'
      try {
        ;({ newPath, kind } = to.title === undefined ? await api.file.rename({ oldPath, newPath: to.newPath }) : await api.file.retitle({ path: oldPath, title: to.title }))
      } catch (error) {
        return { error }
      }
      // A note that left a folder leaves that folder's values behind (D20).
      const cleared = await dropFolderValuesAfterMove({ root: r, oldPath, newPath, kind, records, folders })
      const hasMovedViewFile = viewOnlyCatalog?.entries.some((entry) =>
        kind === 'dir' ? entry.path.startsWith(`${oldPath}/`) : entry.path === oldPath,
      ) ?? false
      const summary = await updateLinksAfterRename({
        ids,
        root: r,
        oldPath,
        newPath,
        kind,
        records,
        folders,
        dirs,
        title: to.title,
        ...(hasMovedViewFile ? { viewOnlyCatalog } : {}),
      })
      return { move: { oldPath, newPath, kind }, cleared, links: summary }
    },
    [scopeOf],
  )

  // The window's undo list (YAZ-3255 D10; YAZ-3268 D17): moves, renames and deletes, per window, for the session only (S42).
  const moveHistory = useRef(createMoveHistory())
  const replaying = useRef(false)
  // ⌘Z, ⌘⇧Z and the toast's buttons reach the newest undo and redo through this box.
  const moveReplay = useRef<{ undo: () => boolean; redo: () => boolean }>({ undo: () => false, redo: () => false })
  /**
   * A toast of a step that ⌘Z or ⌘⇧Z can take back (YAZ-3268 D18): its Undo or Redo, and it fades (at least 6 s).
   * Its type is `undo` unless it `skipped` something — an item, or a note whose links could not be updated
   * (YAZ-3303 D2, YAZ-3335): a skip shows even with those toasts off.
   */
  const stepToast = useCallback((text: string, icon: NoticeKind, verb: 'undo' | 'redo', skipped = false): void => {
    showNotice({ text, icon, type: skipped ? undefined : 'undo', action: { label: verb === 'undo' ? 'Undo' : 'Redo', run: () => void moveReplay.current[verb](), fades: true } })
  }, [showNotice])

  /**
   * One rename or title edit, said: a refusal, or `Renamed to "Plan v2"` with Undo and the links that
   * followed. A move says itself (`runMoves`). Every rename through the door ends here — the sidebar,
   * the page title, a table's Name cell — so each goes on the undo list (YAZ-3268 D17, D19): the
   * door's input forward, and back (the old path, or the old title in a vault that uses IDs). No sound (D18).
   */
  const renameFile = useCallback(
    async (oldPath: string, to: RenameTo, viewOnlyCatalog: ViewOnlyCatalog | null): Promise<void> => {
      // The title before the edit, read while the index still has the page.
      const from: RenameTo = to.title === undefined ? { newPath: oldPath } : { title: nameOf(oldPath) }
      const out = await applyRename(oldPath, to, viewOnlyCatalog)
      if (out === null) return
      if ('error' in out) {
        const err = out.error
        const exists = err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS'
        const cannot = to.title === undefined ? "Can't rename" : "Can't change the title"
        notify(exists ? `${cannot}: "${to.title ?? nameOf(to.newPath)}" already exists` : `${cannot}: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      moveHistory.current.push({ step: 'rename', path: out.move.newPath, from, to, type: out.move.kind })
      stepToast(renamedNotice(`Renamed to "${to.title ?? nameOf(out.move.newPath)}"`, out.links), 'info', 'undo', out.links.skipped > 0)
    },
    [applyRename, nameOf, notify, stepToast],
  )

  /**
   * THE ONE DOOR (⚡ YAZ-888, amending decision E / GRO-2096 for NAME changes). Every rename
   * gesture in the app arrives here as (oldPath, to, kind) — the sidebar's inline rename, its
   * drag-move, the page title and a table's Name cell — so the rule is asked ONCE, here, and no
   * surface reimplements it: a changed NAME confirms first (the rename chains into the file on
   * disk and then into every note that links to it); a MOVE asks only when it would clear a
   * folder's values (D21, `valuesLeftBehind` over the window's own snapshot) and otherwise runs
   * silently (a confirm on every drag would be hostile, and bare links keep resolving across a
   * move anyway). A title edit (YAZ-2420 🔒 D16) changes the name and never the folder: it
   * confirms, and is never a move. With "Ask before renaming" off (YAZ-2420 3C1) a changed name
   * runs unasked, through the same pipeline; the move's question is not that setting's.
   *
   * Markdown-only renames still count synchronously. A ready lightweight catalog may prove a
   * view-only FILE; directories always read one fresh tree so newly arrived descendants count.
   * The chosen snapshot is pinned through confirmation, and a change to the window's vaults
   * cancels the request.
   */
  const [pendingRename, setPendingRename] = useState<{ root: string; oldPath: string; kind: 'file' | 'dir'; viewOnlyCatalog: ViewOnlyCatalog | null; to: RenameTo; count: number } | null>(null)
  // A move gesture waiting on its D21 sheet (YAZ-3250 D1): one sheet for the whole list, one row or many.
  const [pendingMoves, setPendingMoves] = useState<{ root: string; moves: Move[]; lost: LeftBehind } | null>(null)
  const renameRootGeneration = useRef(0)
  /**
   * A move gesture done (YAZ-3255 D10, D11): onto the undo list, and its toast with Undo — `runMoves`'s, a Paste of a Cut's, a move in from Finder's.
   * Every such gesture moved one item or more, so it plays the ONE land sound here (YAZ-3267 D15, S54).
   */
  const recordMoves = useCallback((gesture: MovedGesture, text: string, skipped: boolean): void => {
    moveHistory.current.push(gesture)
    playGestureSound('land')
    stepToast(text, 'paste', 'undo', skipped)
  }, [stepToast])
  const vaultList = roots.join('\n')
  useLayoutEffect(() => {
    renameRootGeneration.current++
    setPendingRename(null)
    setPendingMoves(null)
    setDragOutAsk(null)
    // The undo list speaks for the vaults it was made in (audit 2): a vault that left takes its moves along.
    moveHistory.current = createMoveHistory()
    // A toast's Undo or Redo would reach the emptied list and do nothing: the text stays, the button goes.
    setNotice((now) => (now?.action?.fades === true ? { text: now.text, icon: now.icon, type: now.type } : now))
  }, [vaultList])

  const catalogForRename = useCallback(async (oldPath: string, kind: TreeNode['type']): Promise<ViewOnlyCatalog | null | undefined> => {
    const { root: requestedRoot, viewOnlyLinks } = scopeOf(oldPath)
    if (requestedRoot === null || (kind === 'file' && !isViewOnly(oldPath))) return null
    const generation = renameRootGeneration.current
    const current = viewOnlyLinks.catalog
    if (kind === 'file' && current?.root === requestedRoot && current.entries.some((entry) => entry.path === oldPath)) return current
    try {
      const response = await api.tree(requestedRoot)
      if (generation !== renameRootGeneration.current) return undefined
      if (response.root !== requestedRoot) {
        notify("Can't rename: couldn't load the current file list")
        return undefined
      }
      const catalog = buildViewOnlyCatalog(requestedRoot, response.tree)
      if (kind === 'file' && !catalog.entries.some((entry) => entry.path === oldPath)) {
        notify(`Can't rename: "${nameOf(oldPath)}" is no longer in the current file list`)
        return undefined
      }
      return catalog
    } catch {
      if (generation !== renameRootGeneration.current) return undefined
      notify("Can't rename: couldn't load the current file list")
      return undefined
    }
  }, [scopeOf, nameOf, notify])

  /**
   * A list of moves through the pipeline one drag uses (YAZ-3250 D1), in the order given: each move
   * runs its own rename (`applyRename`), so links, folder values and open tabs follow each one. The
   * file list of each vault (`catalogForRename`) is read once for the gesture, and each move puts its
   * items at their new place in it (audit 6). A move over a vault's edge rewrites nothing and reads
   * none (S40). A move that fails leaves the rest to run, and ONE notice says the whole list (S11). A
   * change to the window's vaults stops what is left. It answers what moved and what D20 cleared.
   *
   * A move gesture goes on the window's undo list and says "Moved N items" with Undo (YAZ-3255 D10,
   * D11). An undo and a redo run through here too, with `record` off: they say their own toast, and
   * an item that changed since fails as "moved again" (S36).
   */
  const runMoves = useCallback(
    async (moves: readonly Move[], { record = true }: { record?: boolean } = {}): Promise<MovesRun> => {
      const generation = renameRootGeneration.current
      const done: MovedGesture = { moves: [], cleared: [] }
      const names: NamedItem[] = []
      const failed: string[] = []
      let again = 0
      const failure = record ? moveFailure : againFailure
      const links = { updated: 0, skipped: 0 }
      const catalogs = new Map<string, ViewOnlyCatalog>()
      for (const { oldPath, newPath, kind } of moves) {
        if (generation !== renameRootGeneration.current) break
        const home = overEdge(live.current.roots, oldPath, newPath) ? null : rootOfPath(live.current.roots, oldPath)
        const catalog = home === null ? null : catalogs.get(home) ?? (await catalogForRename(oldPath, kind))
        if (generation !== renameRootGeneration.current) break
        // The name before the move, while the index still has the item at its old place (YAZ-3274 D22).
        const name = nameOf(oldPath)
        if (catalog === undefined) {
          failed.push(`${name} — couldn't load the current file list`)
          continue
        }
        const out = await applyRename(oldPath, { newPath }, catalog)
        if (out === null) continue
        if ('error' in out) {
          if (!record && movedAgain(out.error)) again++
          failed.push(failure(name, out.error))
          continue
        }
        if (home !== null && catalog !== null) catalogs.set(home, movedCatalog(catalog, out.move.oldPath, out.move.newPath))
        done.moves.push(out.move)
        // By kind and by name on disk (YAZ-3293 D23): a move keeps the item's file name.
        names.push(onDisk(oldPath, kind))
        done.cleared.push(...out.cleared)
        links.updated += out.links.updated
        links.skipped += out.links.skipped
      }
      if (record) {
        const text = movedNotice(names, failed, links)
        if (done.moves.length > 0) recordMoves(done, text!, failed.length > 0 || links.skipped > 0)
        else if (text !== null) notify(text, 'error')
      }
      return { ...done, failed, again, links, names }
    },
    [catalogForRename, applyRename, nameOf, notify, recordMoves],
  )

  /**
   * The undo or the redo of a rename (YAZ-3268 D17): the door again, with the input back (`from`) or
   * forward (`to`), straight into `applyRename` — no sheet, and nothing new on the list — so links
   * follow back (S62) and a title comes back as a title (S63). An item that changed since fails
   * "Can't undo: Plan moved again" (S64), and one whose name a new file took "Can't undo: a file
   * named Draft is there now" (nit 2); either way the step goes. Any other failure keeps it on its list.
   */
  const replayRename = useCallback(async (entry: RenameStep, verb: 'undo' | 'redo'): Promise<void> => {
    const side = verb === 'undo' ? entry.from : entry.to
    const name = entry.to.title ?? nameOf(entry.path)
    const keep = (): void => (verb === 'undo' ? moveHistory.current.redone(entry) : moveHistory.current.undone(entry))
    const catalog = await catalogForRename(entry.path, entry.type)
    if (catalog === undefined) {
      keep()
      return notify(stepNotice(verb, null, [`${name} — couldn't load the current file list`]), 'error')
    }
    const out = await applyRename(entry.path, side, catalog)
    if (out === null) return // the window's vaults changed under it: the lists are empty now
    if ('error' in out) {
      if (!movedAgain(out.error)) keep()
      return notify(stepNotice(verb, null, [renameReplayFailure(name, side.title ?? nameOf(side.newPath), entry.type, out.error)]), 'error')
    }
    const now: RenameStep = { ...entry, path: out.move.newPath }
    if (verb === 'undo') moveHistory.current.undone(now)
    else moveHistory.current.redone(now)
    const shown = side.title ?? nameOf(out.move.newPath)
    stepToast(renamedNotice(verb === 'undo' ? `Renamed back to "${shown}"` : `Renamed to "${shown}"`, out.links), 'info', verb === 'undo' ? 'redo' : 'undo', out.links.skipped > 0)
  }, [nameOf, catalogForRename, applyRename, notify, stepToast])

  /**
   * The undo of a delete (YAZ-3268 D17, S58): each item from the Trash back to its old place
   * (`fs:put-back`), newest first. One that left the Trash (S59) or whose name is taken (S60) stays
   * there, and the rest come back. What came back goes on the redo list; "Put back 2 files (Todo.md, Plan.md)" with Redo
   * and the land sound (D18).
   */
  const putBackStep = useCallback(async (entry: DeleteStep): Promise<void> => {
    const back: DeleteStep['items'] = []
    const failed: string[] = []
    let gone = 0
    for (const item of [...entry.items].reverse()) {
      try {
        await api.file.putBack({ trashed: item.trashed, path: item.path })
        back.unshift(item)
      } catch (err) {
        if (movedAgain(err)) gone++
        failed.push(putBackFailure(nameOf(item.path), item, err))
      }
    }
    if (back.length > 0) moveHistory.current.undone({ step: 'delete', items: back })
    else if (failed.length > gone) moveHistory.current.redone(entry)
    const text = stepNotice('undo', back.length === 0 ? null : `Put back ${namedItems(back.map((item) => ({ name: item.name, kind: item.type })))}`, failed)
    if (back.length === 0) return notify(text, 'error')
    playGestureSound('land')
    stepToast(text, 'paste', 'redo', failed.length > 0)
  }, [nameOf, notify, stepToast])

  /**
   * The redo of a delete (YAZ-3268 D17): each item to the Trash again, through the delete door. The
   * new places in the Trash go on the undo list; an item that was not found there has no Undo again
   * (S61). The trash sound, as a delete plays it (D18).
   */
  const deleteAgain = useCallback(async (entry: DeleteStep): Promise<void> => {
    const items: DeleteStep['items'] = []
    const failed: string[] = []
    let went = 0
    let again = 0
    const names: NamedItem[] = []
    for (const item of entry.items) {
      // The name on disk the delete saw (YAZ-3274 D22, YAZ-3293 D23), with its kind.
      const { name } = item
      try {
        const res = await api.file.delete({ path: item.path })
        went++
        names.push({ name, kind: item.type })
        if (res.trashed != null) items.push({ path: res.path, trashed: res.trashed, type: res.kind, name })
      } catch (err) {
        if (movedAgain(err)) again++
        failed.push(againFailure(nameOf(item.path), err))
      }
    }
    if (items.length > 0) moveHistory.current.redone({ step: 'delete', items })
    else if (went === 0 && failed.length > again) moveHistory.current.undone(entry)
    const text = stepNotice('redo', went === 0 ? null : `Deleted ${namedItems(names)}`, failed)
    if (went === 0) return notify(text, 'error')
    playGestureSound('trash')
    if (items.length > 0) stepToast(text, 'info', 'undo', failed.length > 0)
    else notify(text, 'info', unlessFailed('undo', failed))
  }, [nameOf, notify, stepToast])

  /**
   * ⌘Z (YAZ-3255 D10, S33): the newest gesture moves back, all its items, newest first, through
   * `runMoves` — so links follow — and then the folder values its moves cleared come back on each
   * note's path before the move (`restoreFolderValues`). What moved back goes on the redo list. One
   * that moved nothing stays on the undo list, so the next ⌘Z tries again — unless every item moved
   * again (audit 21). One undo or redo runs at a time; a key during one is taken and does nothing.
   * False with nothing to undo.
   */
  const undoMove = useCallback((): boolean => {
    if (replaying.current) return true
    const entry = moveHistory.current.undo()
    if (entry === undefined) return false
    replaying.current = true
    void (async () => {
      try {
        // A rename or a delete (YAZ-3268 D17): the same list, newest first (S65).
        if (!isMoveStep(entry)) return await (entry.step === 'rename' ? replayRename(entry, 'undo') : putBackStep(entry))
        const back = await runMoves(invertMoves(entry.moves), { record: false })
        // Only a note whose move went back gets its blocks: its path is the move's own, or under a folder that went back.
        const returned = (path: string): boolean => back.moves.some((move) => move.newPath === path || (move.kind === 'dir' && path.startsWith(`${move.newPath}/`)))
        for (const { path, values } of entry.cleared) if (returned(path)) await transformFile(path, restoreFolderValues(values), true).catch(() => undefined) // quiet (YAZ-3235 D1)
        if (back.moves.length > 0) moveHistory.current.undone({ moves: invertMoves(back.moves), cleared: [] })
        else if (back.failed.length > back.again) moveHistory.current.redone(entry)
        // The names in the order of the gesture it undoes, as its own toast said them (YAZ-3274 D22): the moves ran newest first.
        const text = replayNotice('undo', [...back.names].reverse(), back.failed, back.links)
        // Nothing ran and nothing failed: the window's vaults changed under it, and there is nothing to say.
        if (back.moves.length === 0) {
          if (text !== '') notify(text, 'error')
        }
        else {
          // One land sound for the undo, however many items moved back (YAZ-3267 D15, S54).
          playGestureSound('land')
          stepToast(text, 'paste', 'redo', back.failed.length > 0 || back.links.skipped > 0)
        }
      } finally {
        replaying.current = false
      }
    })()
    return true
  }, [runMoves, notify, stepToast, replayRename, putBackStep])

  /**
   * ⌘⇧Z (YAZ-3255 D10 amended, S37): the newest undone gesture runs forward again through
   * `runMoves`, with no D21 sheet. Its moves clear the values again (D20), and the gesture goes back
   * on the undo list with what it cleared this time. One that moved nothing stays on the redo list,
   * as an undo does (audit 21). False with nothing to redo.
   */
  const redoMove = useCallback((): boolean => {
    if (replaying.current) return true
    const entry = moveHistory.current.redo()
    if (entry === undefined) return false
    replaying.current = true
    void (async () => {
      try {
        if (!isMoveStep(entry)) return await (entry.step === 'rename' ? replayRename(entry, 'redo') : deleteAgain(entry))
        const run = await runMoves(entry.moves, { record: false })
        if (run.moves.length > 0) moveHistory.current.redone({ moves: run.moves, cleared: run.cleared })
        else if (run.failed.length > run.again) moveHistory.current.undone(entry)
        const text = replayNotice('redo', run.names, run.failed, run.links)
        if (run.moves.length === 0) {
          if (text !== '') notify(text, 'error')
        }
        else {
          // One land sound for the redo (YAZ-3267 D15, S54).
          playGestureSound('land')
          stepToast(text, 'paste', 'undo', run.failed.length > 0 || run.links.skipped > 0)
        }
      } finally {
        replaying.current = false
      }
    })()
    return true
  }, [runMoves, notify, stepToast, replayRename, deleteAgain])
  moveReplay.current = { undo: undoMove, redo: redoMove }

  /**
   * The door for a list of moves (YAZ-3250 D1): a drop of two or more rows, and the pure move one
   * drag makes (`requestRename`). D21 asks ONCE for the whole list, judged on the window's own
   * snapshot (`valuesLeftBehind`); a list that clears nothing runs at once. A move into the folder
   * the item is already in is no move (S7). All moves stay in one vault (YAZ-2602 R11).
   */
  const requestMoves = useCallback(
    async (list: readonly Move[]): Promise<void> => {
      const moves = list.filter((move) => move.newPath !== move.oldPath)
      const first = moves[0]
      if (first === undefined) return
      const { root, wikilinks } = scopeOf(first.oldPath)
      if (root === null) return
      if (moves.some((move) => scopeOf(move.oldPath).root !== root || scopeOf(move.newPath).root !== root)) return notify(BETWEEN_VAULTS)
      const lost = valuesLeftBehind({ root, moves, records: wikilinks.records, folders: wikilinks.folders })
      if (lost.folders.length > 0) return setPendingMoves({ root, moves, lost })
      await runMoves(moves)
    },
    [scopeOf, runMoves, notify],
  )

  /** The move sheet's Move: the list runs as it does unasked, unless its vault left the window. Its Cancel moves nothing (S10). */
  const confirmMoves = useCallback(() => {
    if (pendingMoves === null) return
    setPendingMoves(null)
    if (pendingMoves.root === scopeOf(pendingMoves.moves[0].oldPath).root) void runMoves(pendingMoves.moves)
  }, [pendingMoves, scopeOf, runMoves])

  const requestRename = useCallback(
    async (oldPath: string, to: RenameTo, kind: TreeNode['type']): Promise<void> => {
      const { root, wikilinks } = scopeOf(oldPath)
      if (root === null) return
      // A MOVE keeps the name: it is the list door's, a list of one (YAZ-3250 D1).
      if (to.title === undefined && !isNameChange(oldPath, to.newPath)) return requestMoves([{ oldPath, newPath: to.newPath, kind }])
      const catalog = await catalogForRename(oldPath, kind)
      if (catalog === undefined) return
      if (!settings.confirmRename) return renameFile(oldPath, to, catalog)
      const records = wikilinks.records
      const hasMovedViewFile = catalog?.entries.some((entry) =>
        kind === 'file' ? entry.path === oldPath : entry.path.startsWith(`${oldPath}/`),
      ) ?? false
      // File-vs-directory comes from the concrete tree/editor gesture. Extension and semantic
      // membership cannot answer it: `Archive.json` may be a directory, while a JSON file has no IndexRecord.
      setPendingRename({
        root,
        oldPath,
        to,
        kind,
        count: countLinkReferences({ ids: wikilinks.ids, root, oldPath, kind, records, folders: wikilinks.folders, dirs: vaultDirs(root), title: to.title, ...(hasMovedViewFile ? { viewOnlyCatalog: catalog } : {}) }),
        viewOnlyCatalog: catalog,
      })
    },
    [scopeOf, catalogForRename, renameFile, requestMoves, settings.confirmRename],
  )
  // The door's two spellings, as the surfaces hold them: a path the gesture built, or a title typed.
  const requestPathRename = useCallback((oldPath: string, newPath: string, kind: TreeNode['type']) => requestRename(oldPath, { newPath }, kind), [requestRename])
  // Where the vault does not use IDs (YAZ-2523 🔒 V3) a title typed is the file's name: the door's other spelling.
  const requestRetitle = useCallback(
    async (path: string, title: string, kind: TreeNode['type']): Promise<void> => {
      // Until the index lands the vault's kind is not known (🔒 V5), and it decides which rename this is.
      const { wikilinks } = scopeOf(path)
      if (wikilinks.resolve === null) return notify("Can't rename: couldn't load the current file list")
      if (wikilinks.ids) return requestRename(path, { title }, kind)
      let name: string
      try {
        name = plainEntryName(title, kind, path.slice(path.lastIndexOf('.')))
      } catch (err) {
        return notify(`Can't rename: ${(err as Error).message}`)
      }
      const newPath = `${dirname(path)}/${name}`
      if (newPath !== path) return requestRename(path, { newPath }, kind)
    },
    [requestRename, scopeOf, notify],
  )

  // `dontAskAgain` is the box of the rename sheet (YAZ-2690 D2): the rename runs, and "Ask before
  // renaming" goes off. A move has its own sheet (`confirmMoves`).
  const confirmRename = useCallback((dontAskAgain = false) => {
    if (pendingRename === null) return
    if (pendingRename.root !== scopeOf(pendingRename.oldPath).root) {
      setPendingRename(null)
      return
    }
    const { oldPath, to, viewOnlyCatalog } = pendingRename
    setPendingRename(null)
    if (dontAskAgain) changeSettings({ ...settings, confirmRename: false })
    void renameFile(oldPath, to, viewOnlyCatalog)
  }, [scopeOf, pendingRename, renameFile, changeSettings, settings])

  /**
   * In-app delete landed (GRO-2272). Reaches EVERY window, originator included.
   *
   * ORDER IS NOT NEGOTIABLE: retire the editor, THEN remap the workspace. Removing a page owner unmounts its
   * editor, and `useAutosave`'s unmount cleanup flushes the live buffer to disk — which would
   * recreate the file that was just trashed. Retiring first makes that flush a no-op. Reverse
   * these two lines and the delete silently fails a second later.
   *
   * A window with a vault AT (or under) a deleted folder is deliberately not repaired here: the
   * sidebar's existing `onRootMissing` probe owns that, and it also drops the dead MRU entry.
   */
  useEffect(
    () =>
      api.file.onDeleted(({ path, kind }) => {
        if (kind === 'dir') {
          retireDeletedDir(path)
          deleteWorkspaceDir(path)
          return
        }
        retireDeletedPath(path)
        deleteWorkspacePath(path)
      }),
    [deleteWorkspacePath, deleteWorkspaceDir],
  )

  /**
   * The sidebar's Delete commit (GRO-2272). Deliberately NOT the mirror of `renameFile`, and
   * the two omissions are both load-bearing:
   *
   *  - NO pre-delete flush. `renameFile` flushes so the unsaved buffer travels with the file;
   *    a delete has nowhere to travel to, so flushing would write the file to disk moments
   *    before trashing it — pointless at best, racy at worst.
   *  - NO link rewriting. LOCKED decision C (GRO-2272): notes referencing the deleted page are
   *    left BYTE-IDENTICAL; their `[[links]]` simply go unresolved (the Links A decoration
   *    already renders that) and create-on-click restores the page. Deleting one note must
   *    never silently edit N others — a far bigger blast radius than the gesture, and
   *    un-trashing the file would not undo those edits. Do not "fix" this by adding cleanup.
   *
   * Every failure lands in the passive notice, never a dialog; this promise never rejects back
   * into the caller, matching `onRenameFile`.
   *
   * `trashOne` is the one item, with no sound; it answers what the Trash took, or why it did not. A delete is ONE
   * gesture, so it plays the trash sound once when an item went (YAZ-3267 D15, S55), never on a failure.
   *
   * A delete is ONE step of the undo list too (YAZ-3268 D17, D19): one item or many (`trashMany`),
   * each item with its place in the Trash. The toast says "Deleted 1 file (Plan.md)" or "Deleted 1 folder and 2 files (…)" with
   * Undo; an item main did not find in the Trash has no Undo (S61), and with none found the toast has no button.
   *
   * `trashMany` is the ONE list delete door (YAZ-3272 D21): the sidebar's Delete and ⌘⌫ of N rows, and
   * "Remove from vault". A failure on one item does not stop the rest, and ONE notice counts both:
   * "Deleted 2 files (A.md, C.md), skipped 1: B was not moved to the Trash", or "Can't delete 2 items: …" when
   * none went. One item that fails says main's reason, as before.
   */
  const trashOne = useCallback(async (path: string, name: string): Promise<DeleteResponse | string> => {
    try {
      return await api.file.delete({ path })
    } catch (err) {
      // A failed trash means NOTHING was deleted — say so, rather than a bare error string.
      return err instanceof BridgeRequestError && err.code === 'IO_ERROR'
        ? `Can't move "${name}" to the Trash — nothing was deleted`
        : `Can't delete "${name}": ${err instanceof Error ? err.message : String(err)}`
    }
  }, [])
  const trashMany = useCallback(async (paths: readonly string[]): Promise<void> => {
    // The names before the delete, while the index still has the pages.
    const names = new Map(paths.map((path) => [path, nameOf(path)]))
    const went: DeleteResponse[] = []
    const failed: string[] = []
    let reason = ''
    for (const path of paths) {
      const res = await trashOne(path, names.get(path)!)
      if (typeof res !== 'string') went.push(res)
      else {
        reason = res
        failed.push(`${names.get(path)} was not moved to the Trash`)
      }
    }
    if (went.length === 0) {
      if (failed.length > 0) notify(paths.length === 1 ? reason : gestureNotice(null, failed, "Can't delete")!)
      return
    }
    playGestureSound('trash')
    // By kind and by name on disk (YAZ-3293 D23), as Finder shows them.
    const text = gestureNotice(`Deleted ${namedItems(went.map((res) => onDisk(res.path, res.kind)))}`, failed, "Can't delete")!
    const items = went.flatMap((res) => (res.trashed == null ? [] : [{ path: res.path, trashed: res.trashed, type: res.kind, name: onDisk(res.path, res.kind).name }]))
    // No file ID from the Trash: no Undo, but still a delete's toast (YAZ-3303 D6).
    if (items.length === 0) return notify(text, 'info', unlessFailed('undo', failed))
    moveHistory.current.push({ step: 'delete', items })
    stepToast(text, 'info', 'undo', failed.length > 0)
  }, [nameOf, trashOne, notify, stepToast])

  /** The items still in their vault's tree, read fresh (S31): one another window moved or deleted is gone. */
  const stillThere = useCallback(async (paths: readonly string[]): Promise<string[]> => {
    const vaults = [...new Set(paths.flatMap((path) => scopeOf(path).root ?? []))]
    const trees = new Map(await Promise.all(vaults.map(async (vault) => [vault, await fetchTree(vault).then(({ tree }) => tree, () => null)] as const)))
    return paths.filter((path) => {
      const vault = scopeOf(path).root
      const tree = vault === null ? null : trees.get(vault)
      return tree != null && treeHasPath(tree, path)
    })
  }, [scopeOf])

  /**
   * Rows dragged out to Finder ended outside the window (YAZ-3254 D9B, S26): Finder took copies, and
   * the box asks whether the vault keeps them. An item that is gone by now (another window moved it)
   * is left out (`stillThere`); with none left there is no box (S31). The count is of the notes
   * outside the items whose links reach any of them, off the window's own index snapshot
   * (`linkingNotes`, the rename sheet's count). A second drag out replaces the box (S32), and a change
   * of the window's vaults during the read ends it. So does main's word that another window of the
   * app took the drag (`file:drag-landed`, YAZ-3263): nothing went to Finder.
   */
  const dragOuts = useRef(0)
  // The paths of the last drag out that main says landed in another window of the app (YAZ-3263).
  const landedInApp = useRef<readonly string[]>([])
  const askAfterDragOut = useCallback(async (paths: string[]): Promise<void> => {
    // The newest drag out speaks: an older one whose tree read answers later says nothing.
    const turn = ++dragOuts.current
    const generation = renameRootGeneration.current
    landedInApp.current = []
    const left = await stillThere(paths)
    if (left.length === 0 || turn !== dragOuts.current || generation !== renameRootGeneration.current) return
    if (left.every((path) => landedInApp.current.includes(path))) return
    const inside = (path: string) => left.some((item) => path === item || path.startsWith(`${item}/`))
    const linking = new Set<string>()
    const kinds: DragOutAsk['kinds'] = []
    for (const path of left) {
      const { root, wikilinks } = scopeOf(path)
      const dirs = root === null ? [] : vaultDirs(root)
      const kind = dirs.includes(path) ? 'dir' : 'file'
      kinds.push(kind)
      if (root === null) continue
      for (const note of linkingNotes({ ids: wikilinks.ids, root, oldPath: path, kind, records: wikilinks.records, folders: wikilinks.folders, dirs })) if (!inside(note)) linking.add(note)
    }
    setDragOutAsk({ paths: left, kinds, links: linking.size })
  }, [scopeOf, stillThere])
  /**
   * "Remove from vault": each item to the Trash through the delete door — the door AFTER the delete
   * sheet, since the box was the question (S27). The items are read again at the click, and one gone
   * since the box showed is skipped (audit 7). The click is ONE step of the undo list (YAZ-3268 D19),
   * and ONE gesture: one trash sound when one item or more went, none when none did (YAZ-3267 D15, S55).
   */
  /**
   * A drag out that ended in a window of the app is no copy to Finder (YAZ-3263). Each drop here tells
   * main its files' paths, at the capture phase, before any target takes or refuses it; main tells
   * the window whose drag out they are. That window's sidebar asks nothing; a box that asked already,
   * or whose read is under way, goes. A box of other items stays.
   */
  useEffect(() => {
    const dropped = (e: DragEvent) => {
      const files = e.dataTransfer?.files
      if (files == null || files.length === 0) return
      const paths = Array.from(files, (file) => api.file.pathFor(file)).filter((path) => path !== '')
      if (paths.length > 0) void api.file.droppedHere({ paths }).catch(() => undefined)
    }
    window.addEventListener('drop', dropped, true)
    const offLanded = api.file.onDragLanded(({ paths }) => {
      landedInApp.current = paths
      setDragOutAsk((now) => (now !== null && now.paths.every((path) => paths.includes(path)) ? null : now))
    })
    return () => {
      window.removeEventListener('drop', dropped, true)
      offLanded()
    }
  }, [])
  const removeDraggedOut = useCallback(async (): Promise<void> => {
    const ask = dragOutAsk
    setDragOutAsk(null)
    if (ask === null) return
    await trashMany(await stillThere(ask.paths))
  }, [dragOutAsk, trashMany, stillThere])

  /**
   * "Remove from this window" (YAZ-2602 D7): the vault leaves the window with its tabs and its
   * right-panel pages, each closed as its ✕ closes it — the editor unmounts, and its autosave saves
   * the buffer on the way out. Never the `retire…` helpers of a delete: they drop the buffer.
   * Nothing on disk changes. The vaults that stay keep their slots, so no scope of theirs loads
   * again, and the next vault is the root when the first one left (S52). The sidebar mounts again
   * only when the vault it is keyed on left (YAZ-2631 R12). Its focus items leave with it, in the
   * write that drops it (A5, `storage.setRoots`). The only vault of a window does not leave it this
   * way (S51).
   */
  const removeVault = useCallback((gone: string) => {
    const now = live.current.roots
    const rest = now.filter((vault) => vault !== gone)
    if (rest.length === 0 || rest.length === now.length) return
    setSidebarRevealRequest(null)
    // The pages close against the vaults that stay: with none left open, the empty window is the
    // new first vault's to remember, and the vault that left keeps its last file (S52).
    deleteWorkspaceDir(stripSlash(gone), rest[0])
    storage.setRoots(rest)
    setRoots(storage.getRoots())
    setVaultOpen(gone, true) // a vault that comes back starts open (R9)
  }, [deleteWorkspaceDir, setVaultOpen])

  /**
   * A drag of a vault row (YAZ-2631 D5): the window's vaults in the new order. Each vault keeps
   * its slot, so nothing loads again. A saved workspace of exactly these vaults takes the order too:
   * main saves this window's vaults under its name, after the identity write that holds them.
   */
  const reorderVaults = useCallback((next: string[]) => {
    storage.setRoots(next)
    setRoots(storage.getRoots())
    const set = storage.getVaultSets().find((one) => sameVaults(one.roots, next))
    if (set !== undefined) void api.window.saveSet(set.name).catch((err: unknown) => console.error('[reorder-vaults] saveSet failed:', err))
  }, [])

  /**
   * A vault's folder is gone on disk (YAZ-2602 S53, R6). The only vault of the window: the Welcome
   * screen. One of several: it leaves as a removed one does, the notice names it, and
   * the folder leaves the recents.
   */
  const dropVault = useCallback((gone: string) => {
    // A read that failed after its vault left the window has nothing to drop, and nothing to say.
    if (!live.current.roots.includes(gone)) return
    if (live.current.roots.length === 1) {
      setSidebarRevealRequest(null)
      storage.setRoot(null) // one identity write: { root: null, file: null, tabs: [] }
      setRoots([])
      resetTabs(null, null)
      return
    }
    removeVault(gone)
    storage.removeRecentRoot(gone)
    notify(`${storage.vaultName(gone)} is gone: its folder was not found`)
  }, [resetTabs, removeVault, notify])
  // The ACTIVE file vanished on disk: close its tab, ⌘W-style (a neighbour takes over).
  const onFileMissing = useCallback(() => void closeActive(), [closeActive])

  /**
   * What every editor of the window is handed, from the scope of the vault that holds its page
   * (YAZ-2602 S30). Each value is the scope's own stable one, so a change in one vault renders no
   * editor of another: `RetainedEditor` is memo.
   */
  const editorPropsFor = (path: string) => {
    const scope = scopeOf(path)
    return {
      root: scope.root ?? '',
      watch: scope.watch,
      onNotice: notify,
      newNoteFolderFor,
      wikilinks: scope.wikilinks,
      wikilinkCandidates: scope.wikilinkCandidates,
      viewOnlyLinks: scope.viewOnlyLinks,
      properties: scope.properties,
      onOpenFileRight: openRight,
      onRetitle: requestRetitle,
      sync: scope.sync.status,
      onSyncNow: scope.sync.syncNow,
      // YAZ-1515: the comment stream's order is a SETTING, threaded down like every other one.
      commentsOrder: settings.commentsOrder,
      onChangeCommentsOrder: changeCommentsOrder,
      // YAZ-2700: the table of contents is a SETTING too, and whether its names fit depends on the content width.
      tableOfContents: settings.tableOfContents,
      contentWidth: settings.contentWidth,
      onChangeTableOfContents: changeTableOfContents,
      // YAZ-2752: the width of its names column is a SETTING as well.
      tableOfContentsWidth: settings.tableOfContentsWidth,
      onChangeTableOfContentsWidth: changeTableOfContentsWidth,
      // YAZ-3028: every drawing tab shares the canvas prefs, a SETTING too.
      canvasPrefs: settings.canvas,
      onChangeCanvasPrefs: changeCanvasPrefs,
      canvasPanel: settings.canvasPanel,
      onChangeCanvasPanel: changeCanvasPanel,
      // A diagram tab's dark-mode colours, and ⌘B pressed inside its draw.io frame.
      diagramDarkColors: settings.diagramDarkColors,
      onToggleSidebar: toggleSidebar,
      // Upkeep off (🔒 D7): no settings, so no Reviews section.
      reviewSettings: scope.reviewSettings.settings.enabled ? scope.reviewSettings.settings : undefined,
    }
  }

  // While a review is open (YAZ-2322) the main pane shows ITS note, not the active tab's page.
  // The tabs, their history and the right panel are not touched: closing the review uncovers them.
  const session = review.session
  /** The first vault whose sync needs attention: one banner at a time. */
  const unsynced = vaults.find((vault) => vault.syncBanner !== null)
  const syncCopy = unsynced?.syncBanner ?? null
  // Each tab's page, by id: a layer is a tab's (YAZ-2940 D1), and its editor is that tab's page.
  const pathOf = new Map(tabs.map((t) => [t.id, t.path]))
  // The tab whose layer a review's note shows through (S9): the tab a trip to the note goes to,
  // else another of its copies that is mounted; null when no mounted tab shows it.
  const reviewPath = session?.path ?? null
  const reviewed = reviewPath === null ? null : tabOf({ tabs, active: activeTab }, reviewPath)
  const reviewLayer = reviewed !== null && mounted.includes(reviewed.id) ? reviewed.id : (mounted.find((id) => pathOf.get(id) === reviewPath) ?? null)
  /** The tab whose layer shows: the active one, none under the blank tab, and the reviewed note's during a review. */
  const shown = session === null ? (pageOnShow === null ? null : activeTab) : reviewLayer

  /**
   * A Files window's sidebar doors (YAZ-3357 D2, D7): each sends ONE message to main, which runs it in a normal window.
   * A click previews (Enter keeps, `filesClickHow`), a double click keeps, ⌘-click opens a background tab. Null in a normal window.
   */
  const filesDoors = useMemo(() => {
    if (!filesWindow) return null
    const ask = (action: FilesAction): void => askFromFiles(action, notify)
    return {
      open: (path: string) => ask({ kind: 'open', path, how: filesClickHow() }),
      keep: (path: string) => ask({ kind: 'open', path, how: 'keep' }),
      background: (path: string) => ask({ kind: 'open', path, how: 'background' }),
      history: (path: string) => ask({ kind: 'history', path }),
      share: (path: string) => ask({ kind: 'share', path }),
      review: (dir: string) => ask({ kind: 'review', dir }),
      inbox: (root: string) => ask({ kind: 'inbox', root }),
      session: (id: string) => ask({ kind: 'session', id }),
    }
  }, [filesWindow, notify])
  /**
   * Tabs Mission Control in a Files window (YAZ-3357 D3, D8): it stands right of the sidebar, and main makes the window wide
   * for it. The board shows only once the window IS wide, and stays until it is narrow again (demo feedback, "it flashes then
   * is slow"): it never lays out in the narrow window, and the sidebar never stretches across the wide one.
   */
  const filesWant = filesWindow && overview.phase !== 'closed'
  const [filesBoard, setFilesBoard] = useState(false)
  /** The sidebar's width while the window is wide (or on its way): the narrow width just before it grew. */
  const filesNarrowW = useRef(windowWidth)
  if (!filesBoard && !filesWant) filesNarrowW.current = windowWidth
  useEffect(() => {
    if (!filesWindow || filesWant === filesBoard) return
    let live = true
    const settle = (): void => {
      if (live) setFilesBoard(filesWant)
    }
    api.window.filesWide(filesWant).then(
      () => afterResize(settle),
      (err: unknown) => {
        console.error('[files-window] wide failed:', err)
        settle()
      },
    )
    return () => {
      live = false
    }
  }, [filesWindow, filesWant, filesBoard])

  /** The tab board (YAZ-2648 D5), in the tab stack's place — or, in a Files window, right of the sidebar (YAZ-3357 D8). */
  const tabBoard = () => (
    <TabBoard
      roots={roots}
      vaultNames={vaults.map((vault, i) => vault.name ?? storage.vaultName(roots[i]))}
      tabs={tabs}
      active={activeTab}
      preview={preview}
      titles={titles}
      windowId={storage.getWindowId()}
      darkColors={settings.diagramDarkColors}
      leaving={overview.phase === 'leaving'}
      onLeft={leftOverview}
      onOpen={leaveOverview}
      onCloseTabs={closeUnderOverview}
      onDismiss={leaveOverviewForOpenPage}
      onKillAll={askKillAll}
      onMoveTab={moveBoardTab}
      onCloseWindow={closeBoardWindow}
      onNewWindow={openWindowBehind}
      onOpenTabHere={openBackground}
      // A page's menu is a tab's menu: the strip's own doors. A reveal in the sidebar leaves the board open beside it.
      onMoveToRight={movePageToRight}
      onMoveTargets={moveTargets}
      onDropToWindow={movePageToWindowQuietly}
      onMoveToNewWindowQuietly={movePageToNewWindowQuietly}
      // The sidebar's own preview panel beside a card (D18): the setting gates the hover, never Space.
      hoverPreview={settings.hoverPreview}
      previewScope={boardPreviewScope}
      onHighlightWindow={highlightWindow}
      onDuplicate={duplicateTab}
      onSetName={setTabName}
      onShowInSidebar={showInSidebar}
      onNotice={notify}
      reviewState={reviewState}
      onSetReview={setReview}
      filesWindow={filesWindow}
    />
  )

  const dropOnMain = (page: PageDrag, at: number): void => {
    if (page.owner === 'right') transferRightToMain(page.path, at)
  }
  const dropOnRight = (page: PageDrag, at: number): void => {
    if (page.owner === 'main') {
      // A page dragged off the board (YAZ-2648): the board stays, as it does for its own menu's move.
      if (overviewOpen) ownChange.current = page.path === file
      transferMainToRight(page.path, at)
      return
    }
    const from = rightPanel.items.indexOf(page.path)
    if (from === -1) return
    moveRight(from, at > from ? at - 1 : at)
  }

  return (
    <div className={filesWindow ? `app app--files${filesBoard || filesWant ? ' app--files-board' : ''}` : 'app'} style={settingsVars} data-threading={settings.bulletThreading ? 'on' : 'off'} data-content-width={settings.contentWidth} data-section-lines={settings.sectionLines} data-toc-lines={settings.tocLines} data-sidebar-lines={settings.sidebarLines} data-sidebar-line-style={settings.sidebarLineStyle}>
      {glow && <div className="window-glow" aria-hidden="true" />}
      {(notice !== null || dragOutAsk !== null) && (
        // The bottom-left corner (YAZ-3262): ONE column, so the box after a drag out always stands
        // above the toast, however many lines the toast wraps to. The column places; each child styles.
        <div className="corner-notices">
          {dragOutAsk !== null && (
            // The box after a drag out to Finder (YAZ-3254 D9B): it stays until answered, and ✕ or Esc keeps everything (S28).
            <div className="drag-out-ask" role="alertdialog" aria-labelledby="drag-out-ask-text">
              <span id="drag-out-ask-text" className="drag-out-ask__text">{dragOutText(dragOutAsk)}</span>
              <button type="button" className="drag-out-ask__remove" onClick={() => void removeDraggedOut()}>
                Remove from vault
              </button>
              <button type="button" className="drag-out-ask__close" aria-label="Keep in vault" onClick={() => setDragOutAsk(null)}>
                ✕
              </button>
            </div>
          )}
          {notice !== null && <NoticeToast notice={notice} ms={noticeMs(notice, settings.noticeLength)} onClose={closeNotice} />}
        </div>
      )}
      {share !== null && (
        <Suspense fallback={null}>
          <ShareDialog key={share.path} root={share.root} path={share.path} onClose={closeShare} onOpenSettings={openSharingSettings} />
        </Suspense>
      )}
      {history !== null && (
        <Suspense fallback={null}>
          <VersionHistory key={history.path} root={history.root} path={history.path} fromMerge={history.fromMerge} darkColors={settings.diagramDarkColors} onClose={closeHistory} onNotice={notify} />
        </Suspense>
      )}
      {/* YAZ-1679: unmounted when closed, never hidden. ONE useGithubSync per vault (its scope): the
          dialog's Sync page and the editor's chip read the same status, so they can never
          disagree about what this vault is doing. The pages for one vault are the ACTIVE vault's (YAZ-2602 R10). */}
      {settingsOpen && <SettingsDialog ctx={{ settings, onChange: changeSettings, sync: { status: active.sync.status, setEnabled: active.sync.setEnabled }, review: root === null ? undefined : active.reviewSettings, ids: active.ids, vaultName: roots.length > 1 ? (active.name ?? undefined) : undefined, storage: active.root === null ? undefined : vaultStorage, sharing, textFormatting: settingsTextFormatting }} initialPage={settingsPage} onClose={closeSettings} />}
      {whatsNewOpen && (
        <Suspense fallback={null}>
          <WhatsNewSheet update={update} onClose={closeWhatsNew} />
        </Suspense>
      )}
      {/* E1c (GRO-2242): the passive external-rename confirmation banner — one hypothesis at a
          time, oldest first. Confirm-first, ALWAYS: no rewrite until Update; Dismiss drops it
          for this session. Passive: steals no focus, Esc is not bound, never a dialog. */}
      {renamer !== undefined && renameBanner !== null && (
        <div className="rename-banner" role="status">
          <span className="rename-banner__text">
            Looks like <code>{relLabel(renameBanner.oldPath)}</code> became <code>{relLabel(renameBanner.newPath)}</code> — update {renameBanner.count} link{renameBanner.count === 1 ? '' : 's'}?
          </span>
          <button type="button" onClick={renamer.update}>
            Update
          </button>
          <button type="button" onClick={renamer.dismiss}>
            Dismiss
          </button>
        </div>
      )}
      {/* 3B: sync needs attention. Two of the five reasons are things this app cannot fix from
          inside itself (git missing, credentials rejected), so the offer is a prompt to paste
          into any LLM — an assistant that CAN drive the terminal — rather than a wizard. */}
      {unsynced !== undefined && syncCopy !== null && unsynced.root !== null && (
        <div className="sync-banner" role="status">
          <span className="sync-banner__text">
            <strong>{syncCopy.title}</strong> {syncCopy.body}
          </span>
          {syncCopy.showSetupPrompt && (
            <button type="button" onClick={() => void navigator.clipboard.writeText(buildSetupPrompt(unsynced.root ?? '', unsynced.sync.status?.attention ?? 'error'))}>
              Copy setup prompt
            </button>
          )}
          {/* YAZ-1801 D3 (YAZ-3039): a file that is not backed up is not a banner to wave away — `too-large` has no Dismiss. */}
          {syncCopy.dismissible && (
            <button type="button" onClick={unsynced.dismissSync}>
              Dismiss
            </button>
          )}
        </div>
      )}
      {root !== null && (filesWindow || !sidebarCollapsed) && (
        <Sidebar
          // Keyed on one vault of the window (YAZ-2631 D5): a vault that joins, leaves behind it or moves does not remount the panel.
          key={sidebarKey.current}
          // The folders' shortcut rows (YAZ-2290 D2) read the SAME index source of each vault
          // its WikilinkIndexBridge already feeds below — read-only, and no second feed.
          vaults={vaults.map((vault, i) => ({ root: roots[i], name: vault.name ?? '', watch: vault.watch, index: vault.wikilinks, upkeep: vault.reviewSettings.settings.enabled, dueCount: vault.review.dueCount, reviewing: vault.review.session !== null, tooLarge: vault.sync.status?.tooLarge }))}
          closedVaults={closedVaults}
          onSetVaultOpen={setVaultOpen}
          onAddVault={addVault}
          onPickVault={pickVault}
          onRemoveVault={removeVault}
          onReorderVaults={reorderVaults}
          // Under the blank tab no row is the open one (YAZ-2655): every row opens, the one of the tab that was active too.
          activeFile={pageOnShow}
          // A Files window's rows open in a normal window (YAZ-3357 D2): its own doors, never this window's tabs.
          onOpenFile={filesDoors?.open ?? openPage}
          onKeepFile={filesDoors?.keep ?? openKeptPage}
          onOpenFileBackground={filesDoors?.background ?? openBackground}
          onRevealInFiles={revealInFiles}
          previewPath={previewShown}
          onPreview={setPreviewPath}
          // A note's hover preview wears its vault's text formatting, as its tab does (YAZ-3075 C20).
          textVarsFor={textVarsFor}
          onPickFolder={pick}
          pickDisabled={picking}
          onCollapse={toggleSidebar}
          // The lens tabs (YAZ-847): App owns the value, the sidebar only renders the row.
          lens={sidebarLens}
          revealRequest={sidebarRevealRequest}
          onRevealConsumed={consumeSidebarReveal}
          menuRequest={sidebarMenuRequest}
          onMenuConsumed={consumeSidebarMenu}
          onLensChange={changeLens}
          settings={settings}
          onChangeSettings={changeSettings}
          onOpenSettings={openSettings}
          update={update}
          onOpenWhatsNew={openWhatsNew}
          onRestoreSession={filesDoors?.session ?? restoreSavedSession}
          // A Files window has no tabs to save (YAZ-3357 D8).
          onSaveSession={filesWindow ? undefined : saveOpenTabs}
          onUpdateSession={filesWindow ? undefined : updateSession}
          onShowAllTabs={filesWindow ? toggleOverview : undefined}
          // While the board shows (wide), the hover preview stands beside the sidebar over the board, as in a normal window.
          previewFloat={filesBoard ? undefined : previewFloat}
          sessionNameRequest={sessionNameRequest}
          onSessionNameConsumed={clearSessionNameRequest}
          onRootMissing={dropVault}
          onFileMissing={onFileMissing}
          onRenameFile={requestPathRename}
          onMoveEntries={requestMoves}
          onMoved={recordMoves}
          onRetitle={requestRetitle}
          onDeleteEntries={trashMany}
          onDraggedOut={(paths) => void askAfterDragOut(paths)}
          onNotice={notify}
          // ⌘⇧C's box (🔒 D4, YAZ-1338): the panel keeps it current, the chord above reads it.
          selectionRef={sidebarSelection}
          // ⌘C / ⌘X / ⌘V's handle (D6 amended, YAZ-1674): the panel fills it, the listener above asks it.
          clipboardRef={sidebarClipboard}
          pendingSearchFocus={pendingSearchFocus}
          pendingSearchClear={pendingSearchClear}
          onSearchFocusHandled={searchFocusHandled}
          onLeaveToPage={leaveToPage}
          // ⌘O (YAZ-1767 D8): only a request made on THIS sidebar counts; any other reads as none.
          switcherOpenRequest={switcherRequest.key === sidebarKey.current ? switcherRequest.seq : 0}
          // The vault menu's "Open in this window" (YAZ-1798 D8/D11): the one deliberate in-place switch.
          onOpenVaultHere={openRoot}
          onOpenSetHere={filesWindow ? openSetHere : undefined}
          onToNormalWindow={filesWindow ? () => void api.window.filesToNormal().catch((err: unknown) => notify(`Can't make this a full window: ${err instanceof Error ? err.message : String(err)}`)) : undefined}
          // On the sidebar itself (YAZ-2194): stamped on .app as an inherited variable, every resize
          // move restyled the whole window, every mounted tab included.
          // A Files window's sidebar fills it (app.css); while its board shows, it keeps the narrow width (YAZ-3357 D3).
          width={filesWindow ? filesNarrowW.current : sidebarWidth}
          asideRef={sidebarRef}
          onHistoryFile={filesDoors?.history ?? openHistory}
          onShareFile={filesDoors?.share ?? openShare}
          // The menu names the folder by its absolute path; a session takes it relative to the vault that holds it.
          onReviewFolder={filesDoors?.review ?? ((dir) => startReview(scopeOf(dir), relLabel(dir)))}
          reviewState={reviewState}
          onSetReview={setReview}
          // An Inbox row (YAZ-2322), one per vault with upkeep on (YAZ-2602 R5): it opens ITS vault's review, and closes it when it is the one open.
          onInbox={filesDoors?.inbox ?? toggleInbox}
        />
      )}
      {root !== null && !sidebarCollapsed && !filesWindow && <div className={`sidebar-resize${resizing ? ' sidebar-resize--active' : ''}`} aria-hidden onMouseDown={startSidebarResize} />}
      {filesWindow && root !== null ? (
        // A Files window (YAZ-3357 D1, D8): the sidebar alone, and Tabs Mission Control right of it while it shows. The
        // index bridges stay: the sidebar's titles, search and shortcut rows read what they feed.
        <>
          {scopes.map((vault) => vault.root !== null && <WikilinkIndexBridge key={vault.root} root={vault.root} watch={vault.watch} source={vault.wikilinks} candidates={vault.wikilinkCandidates} viewOnly={vault.viewOnlyLinks} onSnapshot={vault.onSnapshot} />)}
          {filesBoard && (
            <div className="workspace">
              <div className="tabstack">{tabBoard()}</div>
            </div>
          )}
          {/* Space on a row (D9): the hover's panel, floating beside the window. */}
          {previewShown !== null && previewFloat !== undefined && (
            <FloatingPreview key={previewShown} aside={sidebarRef} float={previewFloat} path={previewShown} root={scopeOf(previewShown).root ?? ''} name={nameOf(previewShown)} wikilinks={scopeOf(previewShown).wikilinks} textVars={textVarsFor(previewShown)} watch={scopeOf(previewShown).watch} diagramDarkColors={settings.diagramDarkColors} />
          )}
        </>
      ) : root === null ? (
        <section className="editor">
          {/* No dialog opens by itself (C2, GRO-2164): the Welcome screen offers recents + Open folder…. */}
          <Welcome recents={storage.getRecentRoots()} onOpenRecent={openRoot} onPickFolder={pick} picking={picking} />
        </section>
      ) : (
        <div className="workspace">
          {/* One per vault (YAZ-2602 D1): each feeds its own vault's sources from that vault's index.
              In SLOT order: a new order of the vaults moves none, so none reads its index again (YAZ-2631 D5). */}
          {scopes.map((vault) => vault.root !== null && <WikilinkIndexBridge key={vault.root} root={vault.root} watch={vault.watch} source={vault.wikilinks} candidates={vault.wikilinkCandidates} viewOnly={vault.viewOnlyLinks} onSnapshot={vault.onSnapshot} />)}
          {/* Tabs rule 2: the strip shows whenever a folder is open — even with one (or zero) tabs.
              A review (YAZ-2322) is not a tab: its bar stands in the strip's place until it closes. */}
          {session !== null ? (
            <ReviewBar session={session} onKeep={review.keep} onSkip={review.skip} onUndo={review.undo} onClose={review.close} />
          ) : (
            <TabBar
              roots={roots}
              tabs={tabs}
              active={activeTab}
              preview={preview}
              blank={blank}
              onNewTab={newTab}
              onCloseBlank={closeBlank}
              // The "Show right panel" button floats over the row's end while that panel is closed (YAZ-2656 S93).
              reserveEnd={!rightPanel.open}
              // Under the board the strip acts as the pages do: a tab — the active one too — is zoomed
              // into, and a tab's ✕ leaves the board open.
              onActivate={overviewOpen ? leaveOverview : activate}
              onKeep={keep}
              onClose={overviewOpen ? closeOneUnderOverview : closeTab}
              onMove={moveTab}
              onDropPage={dropOnMain}
              onMoveToRight={movePageToRight}
              onMoveToNewWindow={movePageToNewWindow}
              onMoveTargets={moveTargets}
              onMoveToWindow={movePageToWindow}
              onHighlightWindow={highlightWindow}
              onDuplicate={duplicateTab}
              onSetName={setTabName}
              canBack={canBack}
              canForward={canForward}
              onBack={back}
              onForward={forward}
              onShowSidebar={sidebarCollapsed ? toggleSidebar : undefined}
              onShowInSidebar={showInSidebar}
              onToggleOverview={toggleOverview}
              overviewOpen={overviewOpen}
              onKillAll={askKillAll}
              onSaveSession={saveFromGrid}
              onNotice={notify}
              titles={titles}
              reviewState={reviewState}
              onSetReview={setReview}
            />
          )}
          <div className="tabstack">
            {/* The new tab page (YAZ-2663 D3): of a window with no tabs, and of the blank tab (YAZ-2655 D10), under which every visited tab's layer stays mounted, hidden. Mounted only while it shows (R1). */}
            {(mounted.length === 0 || blank) && session === null && <StartPage roots={roots} titles={titles} onOpen={openCurrent} onOpenBackground={openBackground} onShowInFiles={showRowInFiles} onRowMenu={showRowMenu} onBack={backFromPage} onBackToSearch={openSearch} focusRef={startPageFocus} previewPath={pagePreviewPath} onPreview={setPagePreviewPath} onNotice={notify} />}
            {mounted.map((id) => {
              const path = pathOf.get(id)
              if (path === undefined) return null
              // Every VISITED tab keeps its editor mounted so scroll/cursor/undo/unsaved buffer
              // survive a switch (rule 6); inactive layers hide via visibility + content-visibility — see tabs.css
              // for why display:none would lose scroll positions.
              // Under the tab board (YAZ-2648 D5) the active layer hides the same way: still mounted.
              // The layer the board opened from zooms out as it hides, and the one that is chosen
              // zooms in (tabs.css): a class each, so no editor renders for it.
              // The layer is the TAB's (YAZ-2940 D1): two copies of a file are two layers. Its editor
              // is keyed by the page, so a new page in the same tab (a link, Back, a rename) mounts a
              // new editor, and the old one flushes on its way out, as before tabs had ids.
              return (
                <div
                  key={id}
                  data-tab={id}
                  style={textVarsFor(path)}
                  className={
                    id !== shown || (overviewOpen && id !== overview.from)
                      ? 'tabstack__layer tabstack__layer--hidden'
                      : overviewOpen
                        ? 'tabstack__layer tabstack__layer--hidden tabstack__layer--zoom-out'
                        : overview.phase === 'leaving'
                          ? 'tabstack__layer tabstack__layer--zoom-in'
                          : 'tabstack__layer'
                  }
                >
                  {/* Wiki-link clicks (Links C, GRO-2192) ride the tabs API: plain → navigate, in the tab's own slot (openBackground during a review), ⌘ → openBackground; create failures land in the link-notice. The note's first edit keeps a preview tab (YAZ-2648 D2). */}
                  <RetainedEditor key={path} {...editorPropsFor(path)} path={path} onOpenFile={openFromPage} onOpenFileBackground={openBackground} onUserEdit={keepEdited} startView={startView.get(id)} />
                </div>
              )
            })}
            {/* A review's note (YAZ-2322) shows through its own tab's layer, above, when it has
                one. Open in the side panel it is reviewed THERE. Otherwise it gets the one extra
                layer, whose links open in background tabs so the review stays in front. Two editors
                on one path would run two autosaves, so there is never a second. */}
            {session !== null &&
              (session.path === null || (rightPanel.open && rightPanel.items.includes(session.path)) ? (
                <ReviewMessage session={session} onClose={review.close} />
              ) : (
                reviewLayer === null && (
                  <div key={session.path} className="tabstack__layer" style={textVarsFor(session.path)}>
                    <RetainedEditor {...editorPropsFor(session.path)} path={session.path} onOpenFile={openBackground} onOpenFileBackground={openBackground} />
                  </div>
                )
              ))}
            {/* The tab board (YAZ-2648 D5) covers the stack while it shows; a review never has one over it. */}
            {overview.phase !== 'closed' && session === null && tabBoard()}
            {/* The preview panel of the search (YAZ-2662 D5), over the page area — over the empty page of the blank tab too (S45). No layer of the stack: it is no tab and no page. */}
            {panelPath !== null && <QuickLook path={panelPath} title={nameOf(panelPath)} watch={scopeOf(panelPath).watch} wikilinks={scopeOf(panelPath).wikilinks} root={scopeOf(panelPath).root} darkColors={settings.diagramDarkColors} style={textVarsFor(panelPath)} onClose={closePreview} />}
          </div>
          {session !== null && session.path !== null && <ReviewAnswers onKeep={review.keep} onSkip={review.skip} />}
        </div>
      )}
      {root !== null && rightPanel.open && !filesWindow && (
        <RightPanel
          roots={roots}
          titles={titles}
          items={rightPanel.items}
          expanded={rightPanel.expanded}
          width={rightPanel.width}
          overlay={rightOverlay}
          canBack={canRightBack}
          canForward={canRightForward}
          onBack={rightBack}
          onForward={rightForward}
          onToggle={toggleRight}
          onClose={closeRight}
          onHide={() => setRightOpen(false)}
          onResizeCommit={setRightWidth}
          onDropPage={dropOnRight}
          onMoveToMain={(path) => transferRightToMain(path, tabs.length)}
        >
          <div className="right-panel__editor-stack">
            {rightMounted.map((path) => (
              <div
                key={path}
                data-testid={`right-layer-${path}`}
                style={textVarsFor(path)}
                className={path === rightPanel.expanded ? 'right-panel__editor-layer' : 'right-panel__editor-layer right-panel__editor-layer--hidden'}
              >
                <RightWorkspaceEditor
                  {...editorPropsFor(path)}
                  path={path}
                  navigate={navigateRight}
                  onOpenFileBackground={openRightBackground}
                />
              </div>
            ))}
          </div>
        </RightPanel>
      )}
      {root !== null && !rightPanel.open && !filesWindow && (
        <button type="button" className="right-panel-reopen" aria-label="Show right panel" title="Show right panel" onClick={() => setRightOpen(true)}>
          ‹
        </button>
      )}
      {/* The name-change confirm (⚡ YAZ-888): App's, not the sidebar's, because the door is
          App's — the title and the tree both reach it, and one sheet answers for both. A move
          that would clear a folder's values asks through its own sheet (D21). */}
      {pendingRename !== null && (
        <ConfirmRename
          oldPath={pendingRename.oldPath}
          {...pendingRename.to}
          kind={pendingRename.kind}
          count={pendingRename.count}
          titles={titles}
          onConfirm={confirmRename}
          onCancel={() => setPendingRename(null)}
        />
      )}
      {/* The move sheet (D21) asks once for a whole move gesture, one row or many (YAZ-3250 D1). */}
      {pendingMoves !== null && <ConfirmMove moves={pendingMoves.moves} lost={pendingMoves.lost} titles={titles} onConfirm={confirmMoves} onCancel={() => setPendingMoves(null)} />}
      {/* "Kill all tabs" asks first (YAZ-2739 D3): the focus starts on Cancel, as on every sheet that takes something away. */}
      {killAsk !== null && (
        <ConfirmSheet
          labelId="confirm-kill-tabs-text"
          // With other windows' tabs in it (YAZ-3343 D10) the sheet says how many windows lose tabs; a window with none is not counted.
          text={
            killOthers > 0
              ? `Close ${tabs.length + killOthers} tabs in ${killWindows} window${killWindows === 1 ? '' : 's'}? Your text is saved. The tabs do not come back.`
              : tabs.length === 1
                ? 'Kill the 1 open tab? Your text is saved. The tab does not come back.'
                : `Kill all ${tabs.length} tabs? Your text is saved. The tabs do not come back.`
          }
          confirmLabel={tabs.length + killOthers === 1 ? 'Kill 1 tab' : `Kill ${tabs.length + killOthers} tabs`}
          danger
          onConfirm={killAllTabs}
          onCancel={() => setKillAsk(null)}
        />
      )}
    </div>
  )
}
