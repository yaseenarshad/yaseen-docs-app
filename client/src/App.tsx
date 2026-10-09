import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react'
import { isViewOnly } from '@shared/fileKind'
import { MAIN_WORKSPACE_MIN_W, MAX_WINDOW_ROOTS, SIDEBAR_MAX_W, SIDEBAR_MIN_W, rootOfPath, sameVaults, stripSlash, type CommentsOrder, type SettingsState, type SidebarTab, type TreeNode } from '@shared/types'
import { api, BridgeRequestError } from './api'
import { applyCrepeTheme } from './editor/crepeTheme'
import { Editor } from './editor/Editor'
import { newNoteBase } from './editor/wikilink/createFromLink'
import { WikilinkIndexBridge } from './editor/wikilink/WikilinkIndexBridge'
import { useLinkEvents } from './hooks/useLinkEvents'
import { useMenuEvents } from './hooks/useMenuEvents'
import { requestZoom } from './editor/zoomRequest'
import { usePickFolder } from './hooks/usePickFolder'
import { vaultDirs } from './links/folderLinks'
import { countLinkReferences, renameNotice, updateLinksAfterRename } from './links/renameLinks'
import { dropFolderValuesAfterMove, valuesLeftBehind, type LeftBehind } from './links/shortcuts'
import { buildViewOnlyCatalog, type ViewOnlyCatalog } from './links/viewOnlyCatalog'
import { ownsCopyPathHotkey } from './lib/copyPathHotkey'
import { fileClipboardVerb } from './lib/fileClipboardHotkey'
import { focusOpenDocument } from './lib/focusHandoff'
import { LINK_NOTICE_MS, type Notice, type NoticeKind } from './lib/notice'
import { ConfirmIds } from './components/ConfirmIds'
import { NoticeIcon } from './components/NoticeIcon'
import { dirname, relTo } from './lib/paths'
import { carryEditorAcrossRename, carryEditorsAcrossDirRename, flushRenamedDir, flushRenamedPath, retireDeletedDir, retireDeletedPath } from './lib/renameContinuity'
import { EMPTY_SELECTION, orderedSelection } from './lib/selection'
import { storage } from './lib/storage'
import { ownsSidebarHotkey } from './lib/sidebarHotkey'
import { buildSetupPrompt } from './lib/syncAttention'
import { resolveTheme, useSystemPrefersDark } from './lib/theme'
import { fileHash } from './lib/urlHash'
import { windowTitle } from './lib/windowTitle'
import { isFolderPath, pageName, pathTitles, useAllPathTitles } from './lib/pageLabel'
import { fetchTree, onTree } from './lib/treeFeed'
import { flushWindow } from './lib/windowFlush'
import { ConfirmMove } from './sidebar/ConfirmMove'
import { ConfirmRename, isNameChange, type RenameTo } from './sidebar/ConfirmRename'
import { ReviewAnswers, ReviewBar, ReviewMessage } from './review/ReviewBar'
import { SettingsDialog } from './settings/SettingsDialog'
import { plainEntryName } from './sidebar/createEntry'
import { type SidebarClipboard, Sidebar } from './sidebar/Sidebar'
import type { SidebarRevealRequest } from './sidebar/revealRow'
import { TabBar } from './tabs/TabBar'
import { TabOverview } from './tabs/TabOverview'
import { RightPanel } from './right-panel/RightPanel'
import { EMPTY_SLOTS, assignSlots, movedRoot, renameSlots } from './vault/slots'
import { useVaultScope, type VaultScope } from './vault/useVaultScope'
import type { PageDrag } from './workspace/pageDrag'
import { useWorkspace } from './workspace/useWorkspace'
import { Welcome } from './Welcome'

/** Reflect the open file in the URL (GRO-2069); replaceState keeps Back sane. */
function syncHash(path: string | null): void {
  history.replaceState(null, '', fileHash(path) || location.pathname + location.search)
}


/** No tab board (YAZ-2648): one object, so closing a board that is closed is no state change. */
const OVERVIEW_CLOSED = { phase: 'closed', from: null } as const

// A workspace state change still re-renders App, but unchanged retained editors must not render
// with it: a folder's Board runs layout animation after every render, so an unrelated right
// header click would otherwise remeasure and visibly nudge its cards.
const RetainedEditor = memo(Editor)

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

export function App() {
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
  // (a pasted `#/abs/path.md` URL wins as the active tab — bootTabs). The ACTIVE tab is this
  // window's `file`: title, URL hash and the sidebar highlight all follow it.
  const {
    tabs, active: file, mounted, preview, blank, openCurrent, navigate, openKept, keep, newTab: openBlank, closeBlank, openBackground, activate, close: closeTab, closeMany: closeTabs, move: moveTab,
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
  const [resizing, setResizing] = useState(false)
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth)
  const [settings, setSettings] = useState(storage.getSettings)
  // Deep links (E1, GRO-2171): a routed link behaves like a sidebar click (Tabs rule 10) —
  // it activates the file's tab when already open, else opens it in the PREVIEW tab (YAZ-2648 D1);
  // a link that could not open shows a transient notice — unobtrusive, never a dialog.
  const [notice, setNotice] = useState<Notice | null>(null)
  // The one door every surface uses (D10 amended, YAZ-1674): text plus an optional glyph kind,
  // `'info'` unless the caller names one — so nothing that already said `onNotice(text)` changed.
  const notify = useCallback((text: string, icon: NoticeKind = 'info') => setNotice({ text, icon }), [])
  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), LINK_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])
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
  const searchFocusHandled = useCallback(() => setPendingSearchFocus(false), [])

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
  // Bullet threading and content width are CSS gates too — no editor remount.
  const settingsVars = {
    '--edit-line-height': settings.lineSpacing,
    '--edit-block-gap': `${settings.blockGap}px`,
    '--thread-width': `${settings.threadWidth}px`,
    // Absent → bulletThreading.css falls back to the app accent.
    ...(settings.threadColor !== null ? { '--thread-color': settings.threadColor } : {}),
  } as CSSProperties

  // The URL hash mirrors the ACTIVE tab (GRO-2069; rule 17: on boot the hash already won as
  // the active tab in bootTabs, so this first run is a no-op re-write of the same hash).
  useEffect(() => syncHash(file), [file])

  // The OS window title mirrors what is open (C3, GRO-2165) under the display name (YAZ-1974 D4) of the ACTIVE tab's vault (YAZ-2602 S36); Electron follows document.title.
  // Under the blank tab no page is open, and the title is the vault's alone (YAZ-2655 R20).
  const { name: activeName, root: activeRoot, wikilinks: activeLinks } = active
  // Whether the active tab is a FOLDER is the Files tree's to say (YAZ-2290), and the page's title
  // the index's (YAZ-2420 🔒 D14), so the title follows both.
  useEffect(() => {
    const sync = (): void => {
      document.title = windowTitle(activeName, pageOnShow, pathTitles(activeLinks.records, activeLinks.folders), pageOnShow !== null && isFolderPath(activeRoot, pageOnShow))
    }
    sync()
    const offIndex = activeLinks.subscribe(sync)
    const offTree = activeRoot === null ? undefined : onTree(activeRoot, sync)
    return () => {
      offIndex()
      offTree?.()
    }
  }, [activeName, pageOnShow, activeRoot, activeLinks])

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
    // The folder's remembered file becomes the sole restored tab (D6); reset mirrors it down.
    resetTabs(path, storage.getLastFile(path))
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
    if (root === null) {
      void openRoot(path)
      return
    }
    void api.window.openRecent(path).catch((err: unknown) => console.error('[open-vault] openRecent failed:', err))
  }, [root, openRoot])

  const { pick, picking } = usePickFolder({ onPicked: openVault })

  /**
   * "Add vault to this window" (YAZ-2602 D2): `path` becomes the window's last vault, with its row
   * open, and goes to the top of the recents (S2). The tabs, the lens and the focus list stay: the
   * list of vaults is the only identity write. A folder the window cannot take is refused with a
   * notice and nothing changes — one that is in the window (S4), one inside a vault of the window
   * or around one (R8, by path segment), one that is gone on disk, which also leaves the recents
   * (S6), and the ninth (R7). The probe is the tree feed's read, so the sidebar's first tree of the
   * vault is that walk's. Resolves whether the vault was added.
   */
  const addVault = useCallback(async (folder: string): Promise<boolean> => {
    const path = stripSlash(folder)
    const name = storage.vaultName(path)
    /** Why the window as it stands cannot take the folder; asked again after the probe, which waits. */
    const refusal = (): string | null => {
      const now = live.current.roots
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
      refused ??= refusal() ?? (live.current.roots.length >= MAX_WINDOW_ROOTS ? `A window holds ${MAX_WINDOW_ROOTS} vaults at most` : null)
    }
    if (refused !== null) {
      notify(refused)
      return false
    }
    storage.setRoots([...live.current.roots, path])
    storage.pushRecentRoot(path)
    setRoots(storage.getRoots())
    setVaultOpen(path, true)
    return true
  }, [notify, setVaultOpen])
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

  const consumeSidebarReveal = useCallback((id: number) => {
    setSidebarRevealRequest((request) => request?.id === id ? null : request)
  }, [])

  // The settings dialog (YAZ-1679) is App's so the sidebar cog, ⌘, and the app menu's Settings…
  // open the ONE dialog — and it can open with the sidebar collapsed. `open`/`close` are stable
  // because `useMenuEvents` resubscribes whenever a callback identity changes.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

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
  const closeReview = useCallback(() => live.current.vaults.forEach((vault) => vault.review.close()), [])
  useEffect(() => closeReview(), [file, closeReview])

  // The tab board (YAZ-2648 D5): every open tab as a small page, in the tab stack's place. Whether
  // it shows is this window's, for the session, like the settings dialog: nothing is stored. The
  // grid button and ⌘⇧M both open it and close it. A review is not a tab and stands in the same
  // place, so the board does not open over one, and a review that starts closes it. The Welcome
  // window has no tabs and no board.
  //
  // `open` remembers the page it opened from (`from`): that tab's layer is the one that zooms out
  // under the board. `leaving` is the zoom back in — the chosen tab is active already and its
  // layer grows from its page of the board, which says when it is done (`leftOverview`). Where no
  // motion is asked for (and where there is no `matchMedia`) there is no way out to wait for.
  const [overview, setOverview] = useState<{ phase: 'closed' | 'open' | 'leaving'; from: string | null }>(OVERVIEW_CLOSED)
  const overviewOpen = overview.phase === 'open'
  /** What the doors below read at the moment they are used; they keep their identity under the board. */
  const now = useRef({ file, tabs, phase: overview.phase, right: rightPanel.items.length })
  now.current = { file, tabs, phase: overview.phase, right: rightPanel.items.length }
  // Going to a page — a sidebar click, ⌃Tab, a deep link — closes the board at once, by the review's
  // rule above: the page asked for must not open unseen under it. A change of the active tab the
  // board made ITSELF is no such trip, and says so here first: the page it zooms into, and the
  // heir of an active tab it closed or sent to the right panel, after which it stays open.
  const ownChange = useRef(false)
  const inReview = reviewer !== null
  useEffect(() => {
    if (ownChange.current) ownChange.current = false
    else setOverview(OVERVIEW_CLOSED)
  }, [file, inReview])
  /** Leave the board for `path`'s page — a page of the board, a tab of the strip — or, with null, for the page that is open (Esc, the button, ⌘⇧M). */
  const leaveOverview = useCallback((path: string | null) => {
    const { file: open, tabs: all } = now.current
    if (path !== null && path !== open && all.includes(path)) {
      ownChange.current = true
      activate(path)
    }
    const zoom = (path ?? open) !== null && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === false
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
  useLinkEvents({ onOpenFile: openPage, onNotice: notify })
  const leftOverview = useCallback(() => setOverview((at) => (at.phase === 'leaving' ? OVERVIEW_CLOSED : at)), [])
  const toggleOverview = useCallback(() => {
    const { phase, file: open } = now.current
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
  }, [openBlank, openSearch])
  /**
   * A page's ✕, an island's ✕, a tab's ✕ under the board: the tabs close as ⌘W closes each, in ONE
   * change of the workspace, and the board stays — until its last tab goes: then it closes, and
   * the window shows the empty state (R18).
   */
  const closeUnderOverview = useCallback((paths: string[]) => {
    const { file: open, tabs: all } = now.current
    if (all.every((path) => paths.includes(path))) setOverview(OVERVIEW_CLOSED)
    ownChange.current = open !== null && paths.includes(open)
    closeTabs(paths)
  }, [closeTabs])
  const closeOneUnderOverview = useCallback((path: string) => closeUnderOverview([path]), [closeUnderOverview])
  /** "Move to right panel", on a page of the board and on a tab of the strip: the page goes to the end of that panel, and an open board stays (R30). */
  const movePageToRight = useCallback((path: string) => {
    ownChange.current = path === now.current.file
    transferMainToRight(path, now.current.right)
  }, [transferMainToRight])
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
  useMenuEvents({ onOpenFolder: pick, onOpenRoot: openVault, onSearch: openSearch, onSwitchVault: openVaultSwitcher, onSettings: openSettings, onToggleSidebar: toggleSidebar, onCloseTab: reviewer === null ? closeTabOrWindow : closeReview, onNextTab: toNextTab, onPrevTab: toPrevTab, onTabOverview: toggleOverview, onNewTab: newTab, onZoom: requestZoom })

  /**
   * ⌘⇧C copies paths (🔒 D4, YAZ-1338) — the multi-selection when one is standing, else the file
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
      const text = selected.size > 0 ? orderedSelection(selected, document.querySelector('.sidebar__body')).join('\n') : pageOnShow
      if (text === null) return
      event.preventDefault()
      // BOTH outcomes speak through the window's one passive notice (YAZ-1341): the user cannot
      // see a clipboard land, so a copy needs its yes as much as its no.
      const copied = text.split('\n').length
      void navigator.clipboard.writeText(text).then(
        () => notify(copied === 1 ? 'Copied path' : `Copied ${copied} paths`),
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
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const verb = fileClipboardVerb(event)
      if (verb === null) return
      const clipboard = sidebarClipboard.current
      if (clipboard === null) return
      const acted = verb === 'paste' ? clipboard.paste() : clipboard.cutOrCopy(verb)
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
  const renameFile = useCallback(
    async (oldPath: string, to: RenameTo, viewOnlyCatalog: ViewOnlyCatalog | null): Promise<void> => {
      // The index, the folders and the links are the ones of the vault that holds the path (YAZ-2602 S30).
      const r = scopeOf(oldPath).root
      if (r === null) return
      // (a) our own unsaved buffers travel WITH the file(s). The kind is unknown until the
      // rename answers, so both run — each is a no-op for the other kind.
      await flushRenamedPath(oldPath)
      await flushRenamedDir(oldPath)
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
      } catch (err) {
        const exists = err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS'
        const cannot = to.title === undefined ? "Can't rename" : "Can't change the title"
        notify(exists ? `${cannot}: "${to.title ?? nameOf(to.newPath)}" already exists` : `${cannot}: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      // A note that left a folder leaves that folder's values behind (D20).
      await dropFolderValuesAfterMove({ root: r, oldPath, newPath, kind, records, folders })
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
      if (summary.updated > 0 || summary.skipped > 0) notify(renameNotice(summary))
    },
    [scopeOf, nameOf, notify],
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
  const [pendingRename, setPendingRename] = useState<({ root: string; oldPath: string; kind: 'file' | 'dir'; viewOnlyCatalog: ViewOnlyCatalog | null } & ({ to: RenameTo; count: number } | { to: { newPath: string }; lost: LeftBehind })) | null>(null)
  const renameRootGeneration = useRef(0)
  const vaultList = roots.join('\n')
  useLayoutEffect(() => {
    renameRootGeneration.current++
    setPendingRename(null)
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

  const requestRename = useCallback(
    async (oldPath: string, to: RenameTo, kind: TreeNode['type']): Promise<void> => {
      const { root, wikilinks } = scopeOf(oldPath)
      if (root === null) return
      const catalog = await catalogForRename(oldPath, kind)
      if (catalog === undefined) return
      if (to.title === undefined && !isNameChange(oldPath, to.newPath)) {
        const lost = valuesLeftBehind({ root, moves: [{ oldPath, newPath: to.newPath, kind }], records: wikilinks.records, folders: wikilinks.folders })
        if (lost.folders.length === 0) return renameFile(oldPath, to, catalog)
        setPendingRename({ root, oldPath, to, kind, lost, viewOnlyCatalog: catalog })
        return
      }
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
    [scopeOf, catalogForRename, renameFile, settings.confirmRename],
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

  const confirmRename = useCallback(() => {
    if (pendingRename === null) return
    if (pendingRename.root !== scopeOf(pendingRename.oldPath).root) {
      setPendingRename(null)
      return
    }
    const { oldPath, to, viewOnlyCatalog } = pendingRename
    setPendingRename(null)
    void renameFile(oldPath, to, viewOnlyCatalog)
  }, [scopeOf, pendingRename, renameFile])

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
   */
  const deleteFile = useCallback(async (path: string): Promise<void> => {
    try {
      await api.file.delete({ path })
    } catch (err) {
      const name = nameOf(path)
      // A failed trash means NOTHING was deleted — say so, rather than a bare error string.
      notify(
        err instanceof BridgeRequestError && err.code === 'IO_ERROR'
          ? `Can't move "${name}" to the Trash — nothing was deleted`
          : `Can't delete "${name}": ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }, [nameOf])

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
   * (YAZ-2602 S30); the empty page (`null`) stands on the active vault. Each value is the scope's
   * own stable one, so a change in one vault renders no editor of another: `RetainedEditor` is memo.
   */
  const editorPropsFor = (path: string | null) => {
    const scope = path === null ? active : scopeOf(path)
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
      // Upkeep off (🔒 D7): no settings, so no Reviews section.
      reviewSettings: scope.reviewSettings.settings.enabled ? scope.reviewSettings.settings : undefined,
    }
  }

  // While a review is open (YAZ-2322) the main pane shows ITS note, not the active tab's page.
  // The tabs, their history and the right panel are not touched: closing the review uncovers them.
  const session = review.session
  /** The vault whose IDs question is on show (YAZ-2602 S40): one box at a time, the first vault's that must answer. */
  const asking = vaults.find((vault) => vault.idsAsk !== null)
  /** The first vault whose sync needs attention: one banner at a time. */
  const unsynced = vaults.find((vault) => vault.syncBanner !== null)
  const syncCopy = unsynced?.syncBanner ?? null
  const shown = session === null ? pageOnShow : session.path

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
    <div className="app" style={settingsVars} data-threading={settings.bulletThreading ? 'on' : 'off'} data-content-width={settings.contentWidth}>
      {notice !== null && (
        // `data-icon` is a test / observability hook — nothing in the CSS selects it; the glyph is the SVG.
        <div className="link-notice" role="status" data-icon={notice.icon}>
          <NoticeIcon icon={notice.icon} />
          <span className="link-notice__text">{notice.text}</span>
        </div>
      )}
      {/* YAZ-1679: unmounted when closed, never hidden. ONE useGithubSync per vault (its scope): the
          dialog's Sync page and the editor's chip read the same status, so they can never
          disagree about what this vault is doing. The pages for one vault are the ACTIVE vault's (YAZ-2602 R10). */}
      {settingsOpen && <SettingsDialog ctx={{ settings, onChange: changeSettings, sync: { status: active.sync.status, setEnabled: active.sync.setEnabled }, review: root === null ? undefined : active.reviewSettings, ids: active.ids, vaultName: roots.length > 1 ? (active.name ?? undefined) : undefined }} onClose={closeSettings} />}
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
          <button type="button" onClick={unsynced.dismissSync}>
            Dismiss
          </button>
        </div>
      )}
      {root !== null && !sidebarCollapsed && (
        <Sidebar
          // Keyed on one vault of the window (YAZ-2631 D5): a vault that joins, leaves behind it or moves does not remount the panel.
          key={sidebarKey.current}
          // The folders' shortcut rows (YAZ-2290 D2) read the SAME index source of each vault
          // its WikilinkIndexBridge already feeds below — read-only, and no second feed.
          vaults={vaults.map((vault, i) => ({ root: roots[i], name: vault.name ?? '', watch: vault.watch, index: vault.wikilinks, upkeep: vault.reviewSettings.settings.enabled, dueCount: vault.review.dueCount, reviewing: vault.review.session !== null }))}
          closedVaults={closedVaults}
          onSetVaultOpen={setVaultOpen}
          onAddVault={addVault}
          onPickVault={pickVault}
          onRemoveVault={removeVault}
          onReorderVaults={reorderVaults}
          // Under the blank tab no row is the open one (YAZ-2655): every row opens, the one of the tab that was active too.
          activeFile={pageOnShow}
          onOpenFile={openPage}
          onKeepFile={openKeptPage}
          onOpenFileBackground={openBackground}
          onRevealInFiles={revealInFiles}
          onPickFolder={pick}
          pickDisabled={picking}
          onCollapse={toggleSidebar}
          // The lens tabs (YAZ-847): App owns the value, the sidebar only renders the row.
          lens={sidebarLens}
          revealRequest={sidebarRevealRequest}
          onRevealConsumed={consumeSidebarReveal}
          onLensChange={changeLens}
          settings={settings}
          onChangeSettings={changeSettings}
          onOpenSettings={openSettings}
          onRootMissing={dropVault}
          onFileMissing={onFileMissing}
          onRenameFile={requestPathRename}
          onRetitle={requestRetitle}
          onDeleteFile={deleteFile}
          onNotice={notify}
          // ⌘⇧C's box (🔒 D4, YAZ-1338): the panel keeps it current, the chord above reads it.
          selectionRef={sidebarSelection}
          // ⌘C / ⌘X / ⌘V's handle (D6 amended, YAZ-1674): the panel fills it, the listener above asks it.
          clipboardRef={sidebarClipboard}
          pendingSearchFocus={pendingSearchFocus}
          onSearchFocusHandled={searchFocusHandled}
          // ⌘O (YAZ-1767 D8): only a request made on THIS sidebar counts; any other reads as none.
          switcherOpenRequest={switcherRequest.key === sidebarKey.current ? switcherRequest.seq : 0}
          // The vault menu's "Open in this window" (YAZ-1798 D8/D11): the one deliberate in-place switch.
          onOpenVaultHere={openRoot}
          // On the sidebar itself (YAZ-2194): stamped on .app as an inherited variable, every resize
          // move restyled the whole window, every mounted tab included.
          width={sidebarWidth}
          asideRef={sidebarRef}
          // The menu names the folder by its absolute path; a session takes it relative to the vault that holds it.
          onReviewFolder={(dir) => startReview(scopeOf(dir), relLabel(dir))}
          reviewState={reviewState}
          onSetReview={setReview}
          // An Inbox row (YAZ-2322), one per vault with upkeep on (YAZ-2602 R5): it opens ITS vault's review, and closes it when it is the one open.
          onInbox={toggleInbox}
        />
      )}
      {root !== null && !sidebarCollapsed && <div className={`sidebar-resize${resizing ? ' sidebar-resize--active' : ''}`} aria-hidden onMouseDown={startSidebarResize} />}
      {root === null ? (
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
              active={file}
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
              canBack={canBack}
              canForward={canForward}
              onBack={back}
              onForward={forward}
              onShowSidebar={sidebarCollapsed ? toggleSidebar : undefined}
              onShowInSidebar={showInSidebar}
              onToggleOverview={toggleOverview}
              overviewOpen={overviewOpen}
              onNotice={notify}
              titles={titles}
              reviewState={reviewState}
              onSetReview={setReview}
            />
          )}
          <div className="tabstack">
            {/* The empty page: of a window with no tabs, and of the blank tab (YAZ-2655 D10), under which every visited tab's layer stays mounted, hidden. */}
            {(mounted.length === 0 || blank) && session === null && <RetainedEditor {...editorPropsFor(null)} path={null} onOpenFile={openCurrent} onOpenFileBackground={openBackground} />}
            {mounted.map((path) => (
              // Every VISITED tab keeps its editor mounted so scroll/cursor/undo/unsaved buffer
              // survive a switch (rule 6); inactive layers hide via visibility + content-visibility — see tabs.css
              // for why display:none would lose scroll positions.
              // Under the tab board (YAZ-2648 D5) the active layer hides the same way: still mounted.
              // The layer the board opened from zooms out as it hides, and the one that is chosen
              // zooms in (tabs.css): a class each, so no editor renders for it.
              <div
                key={path}
                className={
                  path !== shown || (overviewOpen && path !== overview.from)
                    ? 'tabstack__layer tabstack__layer--hidden'
                    : overviewOpen
                      ? 'tabstack__layer tabstack__layer--hidden tabstack__layer--zoom-out'
                      : overview.phase === 'leaving'
                        ? 'tabstack__layer tabstack__layer--zoom-in'
                        : 'tabstack__layer'
                }
              >
                {/* Wiki-link clicks (Links C, GRO-2192) ride the tabs API: plain → navigate, in the tab's own slot (openBackground during a review), ⌘ → openBackground; create failures land in the link-notice. The note's first edit keeps a preview tab (YAZ-2648 D2). */}
                <RetainedEditor {...editorPropsFor(path)} path={path} onOpenFile={openFromPage} onOpenFileBackground={openBackground} onUserEdit={keep} />
              </div>
            ))}
            {/* A review's note (YAZ-2322) shows through its own tab's layer, above, when it has
                one. Open in the side panel it is reviewed THERE. Otherwise it gets the one extra
                layer, whose links open in background tabs so the review stays in front. Two editors
                on one path would run two autosaves, so there is never a second. */}
            {session !== null &&
              (session.path === null || (rightPanel.open && rightPanel.items.includes(session.path)) ? (
                <ReviewMessage session={session} onClose={review.close} />
              ) : (
                !mounted.includes(session.path) && (
                  <div key={session.path} className="tabstack__layer">
                    <RetainedEditor {...editorPropsFor(session.path)} path={session.path} onOpenFile={openBackground} onOpenFileBackground={openBackground} />
                  </div>
                )
              ))}
            {/* The tab board (YAZ-2648 D5) covers the stack while it shows; a review never has one over it. */}
            {overview.phase !== 'closed' && session === null && (
              <TabOverview
                roots={roots}
                vaultNames={vaults.map((vault, i) => vault.name ?? storage.vaultName(roots[i]))}
                tabs={tabs}
                active={file}
                preview={preview}
                titles={titles}
                leaving={overview.phase === 'leaving'}
                onLeft={leftOverview}
                onOpen={leaveOverview}
                onCloseTabs={closeUnderOverview}
                onDismiss={leaveOverviewForOpenPage}
                // A page's menu is a tab's menu: the strip's own doors. A reveal in the sidebar leaves the board open beside it.
                onMoveToRight={movePageToRight}
                onShowInSidebar={showInSidebar}
                onNotice={notify}
                reviewState={reviewState}
                onSetReview={setReview}
              />
            )}
          </div>
          {session !== null && session.path !== null && <ReviewAnswers onKeep={review.keep} onSkip={review.skip} />}
        </div>
      )}
      {root !== null && rightPanel.open && (
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
      {root !== null && !rightPanel.open && (
        <button type="button" className="right-panel-reopen" aria-label="Show right panel" title="Show right panel" onClick={() => setRightOpen(true)}>
          ‹
        </button>
      )}
      {/* The name-change confirm (⚡ YAZ-888): App's, not the sidebar's, because the door is
          App's — the title and the tree both reach it, and one sheet answers for both. A move
          that would clear a folder's values asks through its own sheet (D21). */}
      {pendingRename !== null &&
        ('lost' in pendingRename ? (
          <ConfirmMove moves={[{ oldPath: pendingRename.oldPath, newPath: pendingRename.to.newPath, kind: pendingRename.kind }]} lost={pendingRename.lost} titles={titles} onConfirm={confirmRename} onCancel={() => setPendingRename(null)} />
        ) : (
          <ConfirmRename
            oldPath={pendingRename.oldPath}
            {...pendingRename.to}
            kind={pendingRename.kind}
            count={pendingRename.count}
            titles={titles}
            onConfirm={confirmRename}
            onCancel={() => setPendingRename(null)}
          />
        ))}
      {/* The box that asks whether a vault's notes get IDs (YAZ-2523 🔒 V2). Keyed apart from the sidebar, which the
          first vault keys too; with two or more vaults it names the one it asks about (YAZ-2602 S40). */}
      {asking !== undefined && asking.idsAsk !== null && <ConfirmIds key={`ids:${asking.root}`} ask={asking.idsAsk} vault={roots.length > 1 ? (asking.name ?? undefined) : undefined} onAnswer={asking.saveIds} onDismiss={asking.closeIdsAsk} />}
    </div>
  )
}
