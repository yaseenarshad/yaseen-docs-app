import { rendererUrlFor } from './rendererUrl'
import { startAutomationServer, type AutomationServer } from '../automation/server'
import { prepareAutomation } from './automation'
import { registerAutomationIpc } from './ipc/automation'
import { app, BrowserWindow, clipboard, ClipboardItem, dialog, Menu, nativeTheme, net, powerMonitor, protocol, screen, shell, systemPreferences, webContents } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { enableCompileCache } from 'node:module'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileLink, isAppLink, parseFileLink, parseWorkspaceLink } from '@shared/links'
import { FILES_PREVIEW_FRAME, GITHUB_TOKEN_SECRET, MEMORY_SAMPLE_MS, placeVaults, type ClipboardPasteRequest, type FileKind, type WindowEntry } from '@shared/types'
import { DRAWIO_HOST } from '@shared/drawio'
import { CONTRACT, SPECIAL } from '@shared/ipc'
import { createSpellWait } from '@shared/spelling'
import { APP_SCHEME } from './appScheme'
import { resolveDrawioDir, serveDrawio } from './drawio/assets'
import { excalidrawFontsDir, viewerAssetsDir } from './ipc/share'
import type { GitSyncManager } from './git/manager'
import { isGithubAuthCallback, type GithubAuthManager } from './githubAuth'
import { registerIpc } from './ipc'
import { cancelHelperInstall } from './ipc/lsp'
import { ensureLibraryFolder } from './library/folder'
import { broadcastAll, excludeFromBroadcast, rootsOf } from './ipc/broadcast'
import { registerClipboardIpc } from './ipc/clipboard'
import { registerFriendsIpc } from './ipc/friends'
import { createPendingInviteHandler, type PendingInviteHandler } from './friends/pendingInvite'
import { onRendererSecretSet } from './ipc/secrets'
import { FRIENDS_ENABLED } from '@shared/features'
import { registerSpellerIpc } from './ipc/speller'
import { registerUpdateIpc } from './ipc/update'
import { askHeap, askTabs, askViews, registerMemoryIpc } from './ipc/memory'
import { createMemoryMeter, createReloadWatch, helperRss, type MemoryMeter, type ReloadWatch } from './memory'
import { claimDeepLinkScheme } from './deepLinkScheme'
import { createLinkQueue } from './linkQueue'
import { openLink } from './fs/openLink'
import { cleanupTreeWatcherProbes } from './fs/treeWatcher'
import { watchDailyPages } from './dailyPagesVaultFile'
import { buildContextMenuTemplate, buildMenuTemplate, createMenuHandlers, gateOnBoardKind, menuKeyedVaults, menuKindsInFront, pickMenuTargetWindow, subscribeMenuRebuild, subscribeMenuRebuildOnActiveFile } from './menu'
import { revealItem } from './fs/reveal'
import { revealVaultImage, serveVaultImage } from './vaultProtocol'
import { COURSE_VOICE_HOST, type CourseAudio } from './courseAudio/courseAudio'
import { registerCourseAudioIpc } from './ipc/courseAudio'
import { followSettingsFolder } from './settingsFolder'
import { drawingInFront, hotkeyRecording, noPageInFront } from './hotkeyRecording'
import { createStore } from './store'
import { moveLegacyHeadingStyles } from './textFormattingMove'
import { runQuitSequence } from './quitSequence'
import { createSpeller, nativeMenuAsker, spellerPath } from './speller'
import { cardSkillStamp, ensureCardSkill, shippedCardSkill } from './cardSkill'
import { setCardSkillVault } from '@shared/appVaults'
import { stopAllLanguageServers } from './lsp/server'
import { subscribeNativeTheme, windowBackgroundColor } from './theme'
import { watchSelectionColour } from './selectionColour'
import { registerSelectionColourIpc } from './ipc/selectionColour'
import { appZoomFactor, subscribeAppZoom } from './appZoom'
import { APP_NAME, STATE_FILE, applyUserDataOverride } from './userData'
import { flushDiaries, flushIndexCache, initIndexCache } from './vaultIndex'
import { initMint, macId } from './vaultIndex/mint'
import { createWindowManager, type RestoreTarget } from './windows'
import { focusSingleWindow } from './singleWindowFocus'
import { createAppShimController, isAppShimHostLaunch, type AppShimController } from './appShims'
import { appShimLoaderPath, hostBundlePathFromExecPath, installVaultLauncher, readLauncherPlist, refreshOutdatedLaunchers, removeOrphanLauncher, removeVaultLauncher } from './vaultLauncher'
import { dropLanded } from './dragLanding'
import { blockFileNavigation, createWindowOpenHandler } from './windowOpenPolicy'
import { createUpdater, runFile, shortVersion, spawnDetached } from './updater'

// Before anything reads app.getPath('userData'): the workspace is named "desktop", the app is not.
app.setName(APP_NAME)
applyUserDataOverride(app, process.env.YASEEN_DOCS_USER_DATA_DIR)
// Cache main-process V8 bytecode across warm launches (Node 22+, YAZ-6008 🔒 D10).
try {
  enableCompileCache?.(join(app.getPath('userData'), 'v8-compile-cache'))
} catch {
  // best-effort accelerator; never blocks launch
}

/** One running instance (GRO-2160): a second launch focuses the first; a link in its argv routes (E1). */
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.quit()
app.on('second-instance', (_event, argv) => {
  // Windows/Linux deliver a clicked yaseendocs:// (or Draw's yaseendraw://, YAZ-3028 D7) link as an argv entry of the second launch.
  const urls = argv.filter(isAppLink)
  if (urls.length > 0) {
    for (const url of urls) links.push(url)
    return // routing focuses (or opens) the right window itself
  }
  // An App Shim launching while the host is already running passes `--app-shim-host` and connects over the shim server.
  if (isAppShimHostLaunch(argv)) return
  const win = BrowserWindow.getAllWindows().find((w) => {
    if (w.isDestroyed() || previewPopups.has(w)) return false
    const id = manager.idFor(w.webContents)
    return id === undefined || !(manager.isShimWindow?.(id) ?? false)
  })
  if (win === undefined) {
    if (!quitting && !hiddenE2E) manager.openWindow({ root: null, file: null })
    return
  }
  if (win.isMinimized()) win.restore()
  win.focus()
})

claimDeepLinkScheme(app, process.env)

/** Matches `yaseendocs://friend#<code>` and `yaseendocs://group#<code>` invite deep links (YAZ-6219). */
function parseFriendsInviteDeepLink(rawUrl: string): { kind: 'friend' | 'group'; code: string } | null {
  const m = /^yaseendocs:\/\/\/?(friend|group)[#/?](?:code=)?([a-z0-9]{6,32})$/i.exec(rawUrl.trim())
  if (!m) return null
  return { kind: m[1].toLowerCase() as 'friend' | 'group', code: m[2].toLowerCase() }
}

let pendingInviteHandler: PendingInviteHandler | null = null
const headlessShimHost = isAppShimHostLaunch(process.argv)

/** A parsed link routes to the best window; a bad one gets the unobtrusive notice, never a dialog. */
function handleLink(url: string): void {
  if (isGithubAuthCallback(url)) {
    void githubAuth?.handleCallback(url)
    return
  }
  if (FRIENDS_ENABLED) {
    const invite = parseFriendsInviteDeepLink(url)
    if (invite !== null) {
      if (pendingInviteHandler !== null) void pendingInviteHandler.onInviteLink(invite)
      else broadcastAll(CONTRACT.friends.onInviteLink.channel, invite)
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !previewPopups.has(w))
      if (win !== undefined) {
        if (win.isMinimized()) win.restore()
        win.focus()
      }
      return
    }
  }
  const wsId = parseWorkspaceLink(url)
  if (wsId !== null) {
    if (process.platform === 'darwin' && !hiddenE2E && shims !== undefined) {
      const route = shims.resolveShimForWorkspace(wsId)
      if (route.mode === 'connected') {
        const res = manager.openVaultSet(wsId, undefined, route.shimKey)
        if (!res.opened) manager.linkNotice(`Can't open workspace: ${wsId}`)
        return
      }
      if (route.mode === 'launch') {
        void shims.launchApp(route.appPath)
        return
      }
    }
    const res = manager.openVaultSet(wsId)
    if (!res.opened) manager.linkNotice(`Can't open workspace: ${wsId}`)
    return
  }
  const parsed = parseFileLink(url)
  if (parsed === null) {
    manager.linkNotice(`Can't open link: ${url}`)
    return
  }
  if (process.platform === 'darwin' && !hiddenE2E && shims !== undefined) {
    const isDir = manager.isDir(parsed.path)
    // Directory links match only exact vault shims so opening a subfolder does not hijack into an ancestor vault's shim.
    const route = isDir
      ? shims.resolveShimForVault(parsed.path, parsed.open)
      : shims.resolveShimForPath(parsed.path, parsed.root, parsed.open)
    if (route.mode === 'connected') {
      if (parsed.open !== undefined) manager.routeToFile(parsed.path, parsed.root, parsed.open, route.shimKey)
      else manager.routeToFile(parsed.path, parsed.root, undefined, route.shimKey)
      return
    }
    if (route.mode === 'launch' && (isDir || existsSync(parsed.path))) {
      shims.queuePendingOpen(
        route.shimKey,
        isDir
          ? { ...(parsed.open !== undefined ? { openTarget: parsed.open } : {}) }
          : { filePath: parsed.path, rootOverride: parsed.root, ...(parsed.open !== undefined ? { openTarget: parsed.open } : {}) },
      )
      void shims.launchApp(route.appPath)
      return
    }
  }
  if (parsed.open !== undefined) manager.routeToFile(parsed.path, parsed.root, parsed.open)
  else manager.routeToFile(parsed.path, parsed.root)
}

/** macOS fires `open-url` before `ready` on cold start; Linux/Windows pass protocol URLs in `process.argv`. */
const links = createLinkQueue(handleLink)
for (const url of process.argv.slice(1).filter(isAppLink)) links.push(url)
app.on('open-url', (event, url) => {
  event.preventDefault()
  links.push(url)
})

// Finder "Open With" (E2, GRO-2172) hands a plain absolute path — also before `ready` on cold
// start. Encoding it as a yaseendocs:// link reuses the whole E1 pipeline (queue, parse, routing,
// markdown/exists guards); fileLink ↔ parseFileLink is lossless (links.test.ts round trips). The
// packaged bundle's `fileAssociations` (role Alternate) declaration is F1's job. A FOLDER comes the
// same way (`open -a "Yaseen Docs" <folder>`) and `routeToFile` opens it as a vault (YAZ-2556 D1).
app.on('open-file', (event, path) => {
  event.preventDefault()
  links.push(fileLink(path))
})

protocol.registerSchemesAsPrivileged([APP_SCHEME])

const RENDERER_DIR = join(__dirname, '../renderer')
// The macOS spell checker's guesses for both right-click menus (YAZ-4464): one helper, started at the first ask.
const speller = createSpeller(spellerPath({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, mainDir: __dirname }))
/** The native menu's wait for its guesses, as the page menu's (S2): 1 s until the helper first answers, then 400 ms. */
const nativeSpellWait = createSpellWait()
/** The draw.io webapp (YAZ-3028 D5, Draw's 🔒 YAZ-1802 D4/D5): the pack cache in dev, `out/drawio` in a build. */
const DRAWIO_DIR = resolveDrawioDir({ mainDir: __dirname, appPath: app.getAppPath(), isPackaged: app.isPackaged, exists: existsSync })

/** One user-global state file (D9, GRO-2159): `~/Library/Application Support/Yaseen Docs/yaseendocs.json`. */
const store = createStore(join(app.getPath('userData'), STATE_FILE))

/** Persistent vault-index cache (GRO-2223 D1): one JSON per vault under userData, never in the vault. */
initIndexCache(join(app.getPath('userData'), 'index-cache'))
/** This Mac's ID for the count files (YAZ-2677 R13) is kept in userData, never in a vault. */
initMint(app.getPath('userData'))
/** The settings folder (YAZ-3276 D4): after `initMint`, because this Mac's file is named by its Mac ID. Idle while `settingsFolder` is null, the default. */
const settingsFolder = followSettingsFolder(store, { macId: () => macId(), host: hostname() })

/** Window lifecycle (GRO-2160) lives in windows.ts; this host is its Electron-only half. */
/**
 * The e2e harness's out-of-sight mode (YAZ-3028): `YASEEN_DOCS_E2E_HIDDEN=1` keeps every window
 * hidden and unthrottled, so the suite runs while the person keeps using the Mac. Never set in a real run.
 */
const hiddenE2E = process.env.YASEEN_DOCS_E2E_HIDDEN === '1'

/**
 * The floating preview popup of each Files window (YAZ-3357 D9), by the Files window's `webContents.id`: made by its
 * page with `window.open`, the one popup `createWindowOpenHandler` allows, kept until that window closes. A popup is
 * no window of the app's own: the menu, a second launch and the manager never pick it.
 */
const previewByOwner = new Map<number, BrowserWindow>()
const previewPopups = new WeakSet<BrowserWindow>()

const manager = createWindowManager(store, {
  create(entry: WindowEntry, opts?: { hidden?: true; inactive?: true; shimKey?: string }) {
    const hidden = opts?.hidden === true
    const inactive = opts?.inactive === true
    // Files windows MUST stay host-owned (`child.setParentWindow` throws on shim windows; YAZ-6625 D4).
    const shimKey = entry.kind === 'files' ? undefined : opts?.shimKey
    const appShim = shimKey !== undefined ? (shims?.getShim(shimKey) as Electron.AppShimHost | undefined) : undefined
    // Under macOS Cmd+H, construct a newly requested host window hidden so `focusWindow` can hide siblings before unhiding (YAZ-6595 D2).
    const startHiddenForCmdH = !hiddenE2E && !hidden && !inactive && appShim === undefined && process.platform === 'darwin' && app.isHidden()
    const win = new BrowserWindow({
      ...entry.bounds,
      ...(appShim !== undefined ? { appShim } : {}),
      // A window the tab board made (YAZ-3343) is built HIDDEN; an inactive automation window (YAZ-6539) reveals via showInactive() on ready-to-show.
      ...((hiddenE2E || hidden || inactive || startHiddenForCmdH) && { show: false }),
      // The backing store matches the theme (K, GRO-2218): no white flash on dark launches.
      backgroundColor: windowBackgroundColor(store.get().settings.theme, nativeTheme.shouldUseDarkColors),
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, plugins: true, zoomFactor: appZoomFactor(store.get().settings), ...((hiddenE2E || hidden || inactive) && { backgroundThrottling: false }) },
    })
    // A hidden e2e window must never surface: `focus()`, `show()`, `showInactive()`, and `moveTop()` would order it front.
    if (hiddenE2E) win.show = win.focus = win.showInactive = win.moveTop = () => {}
    if (inactive && !hidden && !hiddenE2E) {
      win.once('ready-to-show', () => {
        if (!win.isDestroyed()) win.showInactive()
      })
    }
    win.webContents.setWindowOpenHandler(createWindowOpenHandler(openLink, entry.kind === 'files'))
    // The Files window's preview popup (YAZ-3357 D9): parented to it, so it moves and closes with it; deaf to the
    // mouse, so the pointer stays on the rows; and it makes no popup of its own.
    const ownerId = win.webContents.id
    win.webContents.on('did-create-window', (child, details) => {
      if (details.frameName !== FILES_PREVIEW_FRAME || entry.kind !== 'files') return void child.destroy()
      previewByOwner.get(ownerId)?.destroy()
      previewByOwner.set(ownerId, child)
      previewPopups.add(child)
      excludeFromBroadcast(child)
      child.setParentWindow(win)
      child.setIgnoreMouseEvents(true)
      child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      child.on('closed', () => {
        if (previewByOwner.get(ownerId) === child) previewByOwner.delete(ownerId)
      })
    })
    win.on('closed', () => {
      meter?.forget(entry.id)
      reloadWatch?.forget(entry.id)
      const popup = previewByOwner.get(ownerId)
      previewByOwner.delete(ownerId)
      if (popup !== undefined && !popup.isDestroyed()) popup.destroy()
    })
    // A file dropped where nothing takes it never opens in the window (YAZ-3253 S21). When it is the
    // drag out of another window, that window asks nothing (YAZ-3263): this drop fires no `drop` event.
    win.webContents.on('will-navigate', (event, url) => {
      const file = blockFileNavigation(event, url)
      if (file !== null) dropLanded(win.webContents, [file])
    })
    // Electron ships no default context menu (YAZ-672), so the spellchecker's squiggles would
    // otherwise be unactionable; the template itself is pure and lives in menu.ts.
    // On macOS Chromium marks the word but gives no guesses (YAZ-4464 D3): ask the macOS checker. Past the
    // wait the menu opens with none; a newer right-click while it waits opens only its own menu (S6).
    const menuGuesses = nativeMenuAsker(process.platform, (word) => nativeSpellWait(speller.guesses(word)))
    win.webContents.on('context-menu', async (_event, params) => {
      // A click or a key during the wait: the person moved on, so that menu opens nothing. The two
      // listeners live only during the wait (at most 1 s), so none sits on every keystroke.
      const movedOn = (_e: Electron.Event, input: { type: string }) => {
        if (input.type === 'mouseDown' || input.type === 'keyDown' || input.type === 'rawKeyDown') menuGuesses.movedOn()
      }
      win.webContents.on('before-mouse-event', movedOn)
      win.webContents.on('before-input-event', movedOn)
      const dictionarySuggestions = await menuGuesses(params).finally(() => {
        if (win.isDestroyed()) return
        win.webContents.off('before-mouse-event', movedOn)
        win.webContents.off('before-input-event', movedOn)
      })
      if (dictionarySuggestions === null || win.isDestroyed()) return
      Menu.buildFromTemplate(buildContextMenuTemplate({ ...params, dictionarySuggestions }, {
        copyAs: (mode) => win.webContents.send(SPECIAL.menuCopyAs, mode),
        pasteAs: (mode) => {
          void Promise.all([clipboard.readText(), mode === 'cells' ? readClipboardHtml() : Promise.resolve(undefined)])
            .then(([text, html]) => {
              if (win.isDestroyed()) return
              win.webContents.send(SPECIAL.menuPasteAs, { mode, text, ...(html !== undefined ? { html } : {}) } satisfies ClipboardPasteRequest)
            })
            .catch(() => undefined)
        },
        replace: (s) => win.webContents.replaceMisspelling(s),
        addToDictionary: (w) => win.webContents.session.addWordToSpellCheckerDictionary(w),
        // Image rows (YAZ-1666): Chromium copies the decoded pixels at the click point; reveal
        // resolves the `<img src>` through vaultProtocol.ts, so a non-vault source is a no-op there.
        copyImage: () => win.webContents.copyImageAt(params.x, params.y),
        revealImage: (src) => void revealVaultImage(src, (file) => revealItem({ path: file })),
      })).popup({ window: win })
    })
    // The window's own zoom is the App size and nothing else (YAZ-3432; ⌘+ zooms a page or the sidebar, YAZ-3389), a
    // Files window too. Chromium keeps a zoom per origin, so each load sets it again: a zoom from an older build goes.
    win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(appZoomFactor(store.get().settings)))
    // `<renderer>?win=<id>` so the renderer can ask `window.identity()` who it is.
    // A Files window loads from an origin of its own (YAZ-3357).
    const files = entry.kind === 'files'
    const url = rendererUrlFor(process.env.ELECTRON_RENDERER_URL ?? 'app://yaseen/index.html', files)
    url.searchParams.set('win', entry.id)
    // The perf harness's short sleep clock (YAZ-3737 5A, long-day-open), in seconds: e2e runs only, never a real one.
    if (process.env.YASEEN_DOCS_E2E === '1' && process.env.YASEEN_DOCS_TAB_SLEEP_SECONDS) url.searchParams.set('sleepSeconds', process.env.YASEEN_DOCS_TAB_SLEEP_SECONDS)
    void win.loadURL(url.toString())
    return win
  },
  // Primary first: clampBounds keeps the earliest work area when a window is fully off-screen.
  workAreas() {
    const primary = screen.getPrimaryDisplay()
    return [primary, ...screen.getAllDisplays().filter((d) => d.id !== primary.id)].map((d) => d.workArea)
  },
  // Where a tab was let go when its drag ended with no point (YAZ-3637 D1).
  cursorPoint: () => screen.getCursorScreenPoint(),
  exists(path) {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  },
  // The open-recent door's probe (YAZ-1767 D1; was the menu host's until the switcher shared the path),
  // and `routeToFile`'s first question: a folder from outside goes to that door (YAZ-2556 D1).
  dirExists(path) {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  },
  // A Files window's preview (YAZ-3357 D9): moved, then shown INACTIVE — the Files window keeps the keyboard. Hidden, never closed.
  showPreview(win, bounds) {
    const popup = previewByOwner.get(win.webContents.id)
    if (popup === undefined || popup.isDestroyed()) return
    if (bounds === null) return void popup.hide()
    // The popup's page is drawn at the App size, as its Files window (YAZ-3432); `bounds` already counts it.
    popup.webContents.setZoomFactor(appZoomFactor(store.get().settings))
    popup.setBounds(bounds)
    if (!hiddenE2E && !popup.isVisible()) popup.showInactive()
  },
  onWindowOpened(id, shimKey) {
    shims?.onWindowOpened(id, shimKey)
  },
  onWindowClosed(id, shimKey) {
    shims?.onWindowClosed(id, shimKey)
  },
  isShimConnected(shimKey) {
    return shims?.getShim(shimKey) !== undefined
  },
  keepAliveOnLastWindowClosed() {
    return (shims?.connectedCount() ?? 0) > 0 || (shims?.isWaitingForFirstShim() ?? false)
  },
  // Single-window focus (YAZ-6595 D1/D2): raises only the target window without activating unrelated windows.
  // Shim windows live in their own macOS app process and bypass host `focusSingleWindow` (YAZ-6625 D6).
  focusWindow(win, hooks) {
    if (hiddenE2E) return
    const id = manager.idFor(win.webContents)
    if (id !== undefined && manager.isShimWindow?.(id)) {
      if (win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      return
    }
    focusSingleWindow(win as BrowserWindow, {
      isMac: process.platform === 'darwin',
      isAppHidden: () => app.isHidden(),
      showApp: () => app.show(),
      stealAppFocus: () => app.focus({ steal: true }),
      siblingWindows: () =>
        BrowserWindow.getAllWindows().filter((w) => {
          if (previewPopups.has(w)) return false
          const wId = manager.idFor(w.webContents)
          return wId === undefined || !(manager.isShimWindow?.(wId) ?? false)
        }),
      onSiblingHidden: (sibling) => hooks?.onSiblingHidden?.(sibling as unknown as BrowserWindow),
      onTargetShown: (target) => hooks?.onTargetShown?.(target as unknown as BrowserWindow),
    })
  },
})

const HOST_BUNDLE_PATH = app.isPackaged ? join(app.getAppPath(), '..', '..', '..') : hostBundlePathFromExecPath(process.execPath)

/** The updater (YAZ-2976 D2): one per app, so every window gets the same state (S20). `start()` runs on `ready`. */
const updater = createUpdater(
  {
    fetch: (url, init) => net.fetch(url, init),
    run: runFile,
    spawnDetached,
    userData: app.getPath('userData'),
    bundle: HOST_BUNDLE_PATH,
    version: shortVersion(app.getVersion()),
    platform: process.platform,
    isPackaged: app.isPackaged,
    feed: process.env.YASEEN_DOCS_UPDATE_FEED,
    pid: process.pid,
  },
  (state) => broadcastAll(CONTRACT.update.onState.channel, state),
)
/** "Restart to update" (S21) sets this; a plain quit with an update staged swaps and stays closed (S22). */
let reopenAfterQuit = false
/** True when "Quit All Yaseen Docs" (⌘⌥Q) or "Restart to update" requests exiting host + all App Shims (YAZ-6640 Option B). */
let forceQuitAll = false
/** True when the app is exiting automatically (e.g. last window closed or updater restart), bypassing the Cmd+Q confirmation popup (YAZ-6641). */
let skipQuitConfirm = false

/**
 * The most recently focused window's `webContents.id` (all windows, for clipboard IPC)
 * and the most recently focused host-owned window's `webContents.id` (for host menu bar).
 * Never cleared on blur: macOS reporting "no focused window" (app not frontmost)
 * is exactly the state the fallback exists for, so the last id must survive it (GRO-2197).
 */
let lastFocusedWcId: number | undefined
let lastFocusedHostWcId: number | undefined

/** The per-vault GitHub sync manager (YAZ-1081), created with the rest of the IPC once `ready` fires. */
let gitSync: GitSyncManager | undefined
/** Mac GitHub App sign-in manager (YAZ-6190), created in `registerIpc` once `ready` fires. */
let githubAuth: GithubAuthManager | undefined
/** The course sound (YAZ-5159): made with the other doors; `app://course-voice` answers 404 before. */
let courseAudio: CourseAudio | null = null

/** The memory meter (YAZ-3737 D1), made on `ready`: a window that closes drops its history. */
let meter: MemoryMeter | undefined
/** The memory reload's watch (YAZ-3737 D6), made with the meter: a window that closes drops its last reload time. */
let reloadWatch: ReloadWatch | undefined

/** The menu's apply step, once `ready` made it: a focus change moves which window the board items ask about (YAZ-3037). */
let rebuildMenuOnFocus: (() => void) | undefined
/** macOS App Shim controller (YAZ-6625), created on `ready` when on macOS and not hiddenE2E. */
let shims: AppShimController<Electron.Menu> | undefined

app.on('browser-window-focus', (_event, win) => {
  lastFocusedWcId = win.webContents.id
  const focusedId = manager.idFor(win.webContents)
  if (focusedId === undefined || !(manager.isShimWindow?.(focusedId) ?? false)) lastFocusedHostWcId = win.webContents.id
  rebuildMenuOnFocus?.()
  // YAZ-1081 D2: focusing a vault's window is a PULL trigger — alt-tabbing back from another
  // machine should converge without waiting out a timer. The manager's own cooldown throttles it.
  // Every vault the window shows (YAZ-2602 S43).
  // A folder of a vault (YAZ-4922 D3) pulls its vault.
  for (const root of placeVaults(store.get().folders, store.get().windows.find((w) => w.id === focusedId)?.roots ?? [])) gitSync?.notifyFocus(root)
})

// macOS activate (Finder/Spotlight/`open -a "Yaseen Docs"` while running headlessly with 0 regular windows; YAZ-6626).
app.on('activate', () => {
  if (!app.isReady() || quitting || hiddenE2E) return
  if ((manager.regularWindowCount?.() ?? 0) === 0) {
    manager.openWindow({ root: null, file: null })
  }
})

/** The CLI's local connection (YAZ-4502). Quit closes it first, waiting at most 3 s for accepted work. */
let automationServer: Promise<AutomationServer> | undefined

app.whenReady().then(() => {
  if (!isPrimaryInstance) return
  // A dev run wears the app's own Dock icon instead of Electron's; a packaged build gets it from the bundle.
  if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  if (hiddenE2E || headlessShimHost) app.dock?.hide()
  // Appearance (K, GRO-2218): the setting IS the themeSource vocabulary. Applied from the loaded
  // store BEFORE any window is created (`restore` below), re-applied whenever it changes — so
  // `prefers-color-scheme` in every renderer and the OS chrome follow the setting.
  subscribeNativeTheme(store, (theme) => {
    nativeTheme.themeSource = theme
  })
  // The Mac's selection colour for the editor in dark (YAZ-5941): read now, and again when the Highlight colour changes
  // (`AppleColorPreferencesChangedNotification`) or the appearance does (`updated`, the app's setting too); every
  // window hears a change. `getColor` follows the Mac's appearance only: see selectionColour.ts.
  const selection = watchSelectionColour(
    {
      read: () => systemPreferences.getColor('selected-text-background'),
      subscribe: (changed) => {
        nativeTheme.on('updated', changed)
        // Read again a moment later too, in case AppKit's colour lags the notification; a read that finds no change sends nothing.
        const later = () => {
          changed()
          setTimeout(changed, 500)
        }
        const id = process.platform === 'darwin' ? systemPreferences.subscribeNotification('AppleColorPreferencesChangedNotification', later) : undefined
        return () => {
          nativeTheme.off('updated', changed)
          if (id !== undefined) systemPreferences.unsubscribeNotification(id)
        }
      },
    },
    (colour) => broadcastAll(CONTRACT.app.onSelectionColour.channel, colour),
  )
  registerSelectionColourIpc(selection.current)
  // The App size (YAZ-3432): every window at once, the Files windows (an origin of their own) and their popups too.
  // First each Files window takes its new width, so its page keeps its width (YAZ-3441).
  subscribeAppZoom(store, (factor, before) => {
    manager.appZoomChanged(before, factor)
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.setZoomFactor(factor)
  })
  protocol.handle('app', (req) => {
    const { host, pathname } = new URL(req.url)
    // `app://vault/…` (YAZ-1658): vault images for `<img src>`, resolved by vaultProtocol.ts;
    // `app://drawio/…` (YAZ-3028 D5, Draw's 🔒 YAZ-1802 D4): the diagram editor's OWN origin, every
    // answer under its no-network CSP; every other host is the renderer bundle, exactly as before.
    if (host === 'vault') return serveVaultImage(req, (u) => net.fetch(u))
    // `app://course-voice/<chapter>/<clip>.m4a` (YAZ-5159): a clip of a course chapter whose downloaded file was checked.
    if (host === COURSE_VOICE_HOST) return courseAudio?.serve(req) ?? new Response(null, { status: 404 })
    if (host === DRAWIO_HOST) {
      return serveDrawio(DRAWIO_DIR, pathname, {
        fetchFile: (url) => net.fetch(url),
        noStore: !app.isPackaged,
        onNotFound: app.isPackaged ? undefined : (missing) => console.warn(`[drawio] 404 app://drawio${missing} — not in the pruned pack (tools/lib/drawioPack.mjs)`),
      })
    }
    const file = join(RENDERER_DIR, pathname === '/' ? 'index.html' : pathname)
    return net.fetch(pathToFileURL(file).toString())
  })
  // Menu bar (B3, GRO-2161): the template is pure (menu.ts); only this apply layer touches Menu.
  // Split `clipboardTarget` (all windows, incl. shims) from `hostMenuTarget` (host-owned windows only, YAZ-6626).
  const clipboardTarget = () => pickMenuTargetWindow(BrowserWindow.getFocusedWindow(), BrowserWindow.getAllWindows().filter((w) => !previewPopups.has(w)), lastFocusedWcId)?.webContents
  const hostMenuTarget = () => {
    const hostWindows = BrowserWindow.getAllWindows().filter((w) => {
      if (w.isDestroyed() || previewPopups.has(w)) return false
      const id = manager.idFor(w.webContents)
      return id === undefined || !(manager.isShimWindow?.(id) ?? false)
    })
    const focused = BrowserWindow.getFocusedWindow()
    const focusedHost = focused !== null && !focused.isDestroyed() && hostWindows.includes(focused) ? focused : null
    return pickMenuTargetWindow(focusedHost, hostWindows, lastFocusedHostWcId)?.webContents
  }
  registerSpellerIpc(speller)
  registerClipboardIpc(manager, {
    target: clipboardTarget,
    writeText: (text) => clipboard.writeText(text),
    write: (data) => writeClipboardRich(data),
    readText: () => clipboard.readText(),
    readHTML: () => readClipboardHtml(),
    revealImage: (src) => revealVaultImage(src, (file) => revealItem({ path: file })),
    rendererUrl: process.env.ELECTRON_RENDERER_URL ?? 'app://yaseen/index.html',
  })
  const routeVaultToShim = (vaultPath: string): boolean => {
    if (process.platform !== 'darwin' || hiddenE2E || shims === undefined) return false
    if (!manager.isDir(vaultPath)) return false
    const route = shims.resolveShimForVault(vaultPath)
    if (route.mode === 'connected') {
      manager.openAlone(vaultPath, undefined, route.shimKey)
      return true
    }
    if (route.mode === 'launch') {
      void shims.launchApp(route.appPath)
      return true
    }
    return false
  }
  const routeWorkspaceToShim = (workspaceId: string) => {
    if (process.platform !== 'darwin' || hiddenE2E || shims === undefined) return null
    const route = shims.resolveShimForWorkspace(workspaceId)
    if (route.mode === 'connected') {
      return manager.openVaultSet(workspaceId, undefined, route.shimKey)
    }
    if (route.mode === 'launch') {
      void shims.launchApp(route.appPath)
      return { opened: true, missing: [] }
    }
    return null
  }
  const shouldConfirmQuit = (): boolean =>
    !hiddenE2E && process.env.YASEEN_DOCS_E2E !== '1' && store.get().settings.confirmBeforeQuit
  const showQuitConfirmDialog = async (opts: { message: string; detail: string; confirmLabel: string; windowId?: string }): Promise<boolean> => {
    const parent =
      opts.windowId !== undefined
        ? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !previewPopups.has(w) && manager.idFor(w.webContents) === opts.windowId)
        : undefined
    const boxOpts: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: [opts.confirmLabel, 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: opts.message,
      detail: opts.detail,
    }
    try {
      const res = parent !== undefined ? await dialog.showMessageBox(parent, boxOpts) : await dialog.showMessageBox(boxOpts)
      return res.response === 0
    } catch {
      const res = await dialog.showMessageBox(boxOpts)
      return res.response === 0
    }
  }
  let confirmingQuitAll = false
  const confirmQuitAllIfNeeded = async (): Promise<boolean> => {
    if (!shouldConfirmQuit()) return true
    if (confirmingQuitAll) return false
    confirmingQuitAll = true
    try {
      return await showQuitConfirmDialog({
        message: 'Do you want to quit all Yaseen Docs apps?',
        detail: 'This closes every open Vault App and Yaseen Docs window. Click Cancel to keep them open.',
        confirmLabel: 'Quit All',
        windowId: manager.lastFocused?.(),
      })
    } finally {
      confirmingQuitAll = false
    }
  }
  const createSharedMenuHost = (targetWc: () => Electron.WebContents | undefined, onWhatsNew: () => void) => ({
    focusedWebContents: targetWc,
    readClipboardText: () => clipboard.readText(),
    readClipboardHTML: () => readClipboardHtml(),
    openExternal: (url: string) => void shell.openExternal(url),
    // S4–S6: the answer shows in the window in front, with or without a sidebar (the Welcome screen,
    // a collapsed one): a notice, or for a staged or manual update the "What's new" sheet and its button.
    checkForUpdates: () =>
      void updater.check().then(
        (s) => {
          if (s.kind === 'ready' || s.kind === 'manual') onWhatsNew()
          else manager.linkNotice(s.kind === 'downloading' ? `Downloading Yaseen Docs ${s.version}…` : `Yaseen Docs ${shortVersion(app.getVersion())} is the newest version`)
        },
        () => manager.linkNotice("Can't check for updates. Try again later"),
      ),
    // Dev only (YAZ-3737 D9): into the temp folder, never the vault or the profile. Loaded on the first use, so the
    // packaged app never parses it at start.
    saveHeapSnapshot: async (target: { id: number }, windowId: string) => {
      const wc = webContents.fromId(target.id)
      if (wc === undefined) return true
      const { saveHeapSnapshot } = await import('./heapSnapshot')
      const file = await saveHeapSnapshot(wc.debugger, join(app.getPath('temp'), 'yaseen-docs-heap'), windowId, new Date())
      if (file !== null) shell.showItemInFolder(file)
      return file !== null
    },
    quitAll: () => {
      void confirmQuitAllIfNeeded().then((ok) => {
        if (!ok) return
        forceQuitAll = true
        skipQuitConfirm = true
        app.quit()
      })
    },
    routeVaultToShim,
  })
  const handlers = createMenuHandlers(manager, createSharedMenuHost(hostMenuTarget, () => handlers.whatsNew()))
  // The board items (YAZ-3037, YAZ-3028 D10; Draw's 🔒 YAZ-1775 D10) are enabled only while the window a
  // menu action would target has a board of the right kind in front. Read at build time from the same
  // window `hostMenuTarget` names, so the answer and the send target can never disagree.
  // What the keys follow (YAZ-3564 K9): a drawing open over the page is in front of it; the board items stay the tab's.
  // With no page on show (YAZ-5041: the Inbox tab, the blank tab), neither follows the tab stored under it.
  const kindsInFrontFor = (wc: Electron.WebContents | undefined) => {
    const id = wc === undefined ? undefined : manager.idFor(wc)
    const file = id === undefined ? null : (store.get().windows.find((w) => w.id === id)?.file ?? null)
    return menuKindsInFront(file, { drawingOver: wc !== undefined && drawingInFront.has(wc.id), noPage: wc !== undefined && noPageInFront.has(wc.id) })
  }
  const activeFileKind = (): FileKind | null => kindsInFrontFor(hostMenuTarget()).activeKind
  const frontKind = (): FileKind | null => kindsInFrontFor(hostMenuTarget()).frontKind
  // File › Open Today's Daily Page (YAZ-5491): shown while Daily pages are on for the window a menu action targets, by
  // its vaults' daily-pages.json (the one source), else the app value. A file that changes rebuilds the menu.
  let dailyMoved: () => void = () => undefined
  const dailyFiles = watchDailyPages(store, () => dailyMoved())
  const dailyInFrontFor = (wc: Electron.WebContents | undefined): boolean => {
    const id = wc === undefined ? undefined : manager.idFor(wc)
    const state = store.get()
    const win = id === undefined ? undefined : state.windows.find((w) => w.id === id)
    return win === undefined ? state.settings.dailyPages : dailyFiles.on(placeVaults(state.folders, win.roots), state.settings)
  }
  const dailyInFront = (): boolean => dailyInFrontFor(hostMenuTarget())
  const buildMenuForTarget = (isShim: boolean, targetWc: () => Electron.WebContents | undefined, menuHandlers: ReturnType<typeof createMenuHandlers>): Electron.Menu => {
    const wc = targetWc()
    const kinds = kindsInFrontFor(wc)
    const state = store.get()
    return Menu.buildFromTemplate(
      buildMenuTemplate(
        // The user's keys (YAZ-3397 D2), and none at all while a key recorder listens (D6).
        {
          recents: state.recents,
          keyedVaults: menuKeyedVaults(state),
          isDev: !app.isPackaged,
          activeKind: kinds.activeKind,
          frontKind: kinds.frontKind,
          hotkeys: state.settings.hotkeys,
          hotkeysAside: state.settings.hotkeysAside,
          suspendKeys: hotkeyRecording.active(),
          dailyPages: dailyInFrontFor(wc),
          isShim,
          showQuitAll: !isShim && (shims?.connectedCount() ?? 0) > 0,
        },
        menuHandlers,
      ),
    )
  }
  const shimMenuTarget = (shimKey: string): Electron.WebContents | undefined => {
    const shimIds = manager.windowsForShim?.(shimKey) ?? []
    const shimIdSet = new Set(shimIds)
    const shimWindows = BrowserWindow.getAllWindows().filter((w) => {
      if (w.isDestroyed() || previewPopups.has(w)) return false
      const wId = manager.idFor(w.webContents)
      return wId !== undefined && shimIdSet.has(wId)
    })
    const focused = BrowserWindow.getFocusedWindow()
    const focusedInShim = focused !== null && !focused.isDestroyed() && shimWindows.includes(focused) ? focused : null
    const preferredId = shimIds[0]
    const preferredWin = preferredId === undefined ? undefined : shimWindows.find((w) => manager.idFor(w.webContents) === preferredId)
    return pickMenuTargetWindow(focusedInShim, shimWindows, preferredWin?.webContents.id)?.webContents
  }
  const shimMenuHandlers = new Map<string, ReturnType<typeof createMenuHandlers>>()
  const shimMenuKeys = new Map<string, string>()
  const shimMenuKey = (shimKey: string): string => {
    const wc = shimMenuTarget(shimKey)
    const kinds = kindsInFrontFor(wc)
    return `${String(kinds.activeKind)}\0${String(kinds.frontKind)}\0${String(dailyInFrontFor(wc))}`
  }
  const buildMenuForShim = (shimKey: string): Electron.Menu => {
    let shimHandlers = shimMenuHandlers.get(shimKey)
    if (shimHandlers === undefined) {
      const target = () => shimMenuTarget(shimKey)
      shimHandlers = createMenuHandlers(manager, createSharedMenuHost(target, () => shimHandlers?.whatsNew()))
      shimMenuHandlers.set(shimKey, shimHandlers)
    }
    shimMenuKeys.set(shimKey, shimMenuKey(shimKey))
    return buildMenuForTarget(true, () => shimMenuTarget(shimKey), shimHandlers)
  }
  const refreshShimsIfMoved = (): void => {
    if (shims === undefined) return
    for (const [shimKey, prevKey] of shimMenuKeys) {
      const shim = shims.getShim(shimKey)
      if (shim === undefined) continue
      const nextKey = shimMenuKey(shimKey)
      if (nextKey === prevKey) continue
      shim.setApplicationMenu(buildMenuForShim(shimKey))
    }
  }
  const { apply: applyMenu, applyIfMoved } = gateOnBoardKind(
    activeFileKind,
    () => {
      Menu.setApplicationMenu(buildMenuForTarget(false, hostMenuTarget, handlers))
      shims?.refreshMenus()
    },
    frontKind,
    () => String(dailyInFront()),
  )
  const applyIfAnyMoved = (): void => {
    applyIfMoved()
    refreshShimsIfMoved()
  }
  dailyMoved = applyMenu
  applyMenu()
  subscribeMenuRebuild(store, applyMenu)
  hotkeyRecording.onChange(applyMenu)
  drawingInFront.onChange(applyIfAnyMoved)
  noPageInFront.onChange(applyIfAnyMoved)
  // A tab switch changes which file is in front; a focus change changes which window is asked. Either
  // rebuilds only when the board items' answer moves (YAZ-3044 A32).
  subscribeMenuRebuildOnActiveFile(store, applyIfAnyMoved)
  rebuildMenuOnFocus = applyIfAnyMoved
  const shimServerName = process.env.YASEEN_DOCS_APP_SHIM_SERVER_NAME?.trim() || undefined
  const hostBundlePath = HOST_BUNDLE_PATH
  const hostBundleId = process.env.YASEEN_DOCS_APP_SHIM_HOST_BUNDLE_ID?.trim() || (app.isPackaged ? undefined : 'com.github.Electron')
  if (process.platform === 'darwin' && !hiddenE2E) {
    shims = createAppShimController<Electron.Menu>({
      store,
      windows: manager,
      readPlist: readLauncherPlist,
      buildMenuForShim: (shimKey) => buildMenuForShim(shimKey),
      handleLink,
      exists: existsSync,
      launchApp: async (appPath) => {
        const err = await shell.openPath(appPath)
        if (err !== '') console.warn(`[appShims] launch failed for "${appPath}": ${err}`)
      },
      showHostDock: () => {
        void app.dock?.show()
      },
      hideHostDock: () => {
        app.dock?.hide()
      },
      quitHost: () => {
        skipQuitConfirm = true
        app.quit()
      },
      headlessStart: headlessShimHost,
      onShimsChanged: () => applyMenu(),
      onShimDisconnected: (shimKey) => {
        shimMenuHandlers.delete(shimKey)
        shimMenuKeys.delete(shimKey)
      },
      confirmShimQuit: async ({ name, windowId }) => {
        if (!shouldConfirmQuit()) return true
        return showQuitConfirmDialog({
          message: `Do you want to close ${name}?`,
          detail: `Click Cancel to keep ${name} open. You can turn off this prompt in Settings › General.`,
          confirmLabel: `Close ${name}`,
          windowId,
        })
      },
    })
    if (typeof app.startAppShimServer === 'function') {
      try {
        // Electron 45's C++ binding rejects an explicit `undefined` argument with TypeError.
        if (shimServerName) app.startAppShimServer({ name: shimServerName })
        else app.startAppShimServer()
      } catch (err) {
        console.warn(`[appShims] startAppShimServer failed: ${String(err)}`)
      }
      app.on('app-shim-connected', (_event, shim) => {
        void shims?.handleConnected(shim)
      })
      app.on('app-shim-version-mismatch', (_event, bundlePath) => {
        shims?.handleVersionMismatch(bundlePath)
      })
    }
  }
  let friendsTokenChanged: (() => void) | undefined
  const { sync, githubAuth: auth, secrets, lsp } = registerIpc(store, manager, {
    userData: app.getPath('userData'),
    // YAZ-3040: the share viewer's build, draw.io's webapp and Excalidraw's fonts, which share setup uploads.
    viewerAssetsDir: viewerAssetsDir({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath(), mainDir: __dirname, exists: existsSync }),
    drawioDir: DRAWIO_DIR,
    fontsDir: excalidrawFontsDir({ isPackaged: app.isPackaged, mainDir: __dirname, appPath: app.getAppPath(), exists: existsSync }),
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    macId: () => macId(),
    openExternal: (url) => shell.openExternal(url),
    openPath: (appPath) => shell.openPath(appPath),
    onGithubAuthChange: () => friendsTokenChanged?.(),
    onOpenVaultShim: routeVaultToShim,
    onOpenWorkspaceShim: routeWorkspaceToShim,
    vaultLauncher: process.platform === 'darwin'
      ? {
          supported: true,
          install: async (params) => {
            const binaryPath = appShimLoaderPath(process.execPath)
            const res = await installVaultLauncher(
              {
                name: params.name,
                vaultPath: params.root,
                vaultUrl: params.vaultUrl,
                iconPng: params.png,
                openTarget: params.target === 'inbox' || params.target === 'today' ? params.target : undefined,
                appId: params.appId,
                previousAppPath: params.previousAppPath,
                binaryPath,
                hostBundlePath,
                hostBundleId,
                serverName: shimServerName,
              },
              { trashItem: (p) => shell.trashItem(p) },
            )
            return { appPath: res.appPath, name: res.name }
          },
          remove: async (appPath, root) => {
            await removeVaultLauncher(appPath, root, { trashItem: (p) => shell.trashItem(p) })
          },
          removeOrphan: async (appPath) => {
            await removeOrphanLauncher(appPath, { trashItem: (p) => shell.trashItem(p) })
          },
          reveal: (appPath) => shell.showItemInFolder(appPath),
          launch: async (appPath) => {
            const err = await shell.openPath(appPath)
            if (err !== '') throw new Error(err)
          },
          exists: existsSync,
        }
      : undefined,
  }, settingsFolder)
  githubAuth = auth
  // Friends backend (YAZ-6219): D1 API service + background stats sender, reusing GitHub App auth (`githubAuth.getValidAuth()`).
  // YAZ-5652: only with Friends on (`shared/features.ts`). Off, nothing starts and the build drops the `./friends` chunk.
  if (FRIENDS_ENABLED) {
    const friendsSend = import('./friends').then((m) => m.startFriendsSend(store, { githubAuth: auth, secrets }, app.getPath('userData')))
    pendingInviteHandler = createPendingInviteHandler({
      isSignedIn: async () => (await auth.getValidAuth().catch(() => null)) !== null,
      acceptInvite: async (code) => (await friendsSend).service.acceptInvite(code),
      notifyRenderer: (payload) => broadcastAll(CONTRACT.friends.onInviteLink.channel, payload),
    })
    friendsTokenChanged = () => {
      void friendsSend.then((f) => f.tokenChanged())
      void pendingInviteHandler?.onAuthChanged()
    }
    registerFriendsIpc(() => friendsSend)
    onRendererSecretSet((name) => {
      if (name === GITHUB_TOKEN_SECRET) friendsTokenChanged?.()
    })
  }
  // The one library folder every vault shares (YAZ-3038; Draw's 🔒 YAZ-1775 D5). Made at startup, detached: a
  // launch must not wait on a disk, and a path that cannot be made is still what the Settings row names.
  void ensureLibraryFolder(store.get().settings.libraryFolder, app.getPath('userData'), store.get().settingsFolder)
  gitSync = sync
  // The course sound (YAZ-5159): downloaded per chapter while the course is open. At start only the clean-up runs, at
  // most once a day: the folder goes 30 days after the course was last open. Defer past first window restore (YAZ-6008 D4).
  courseAudio = registerCourseAudioIpc({ userData: app.getPath('userData'), isPackaged: app.isPackaged })
  const sweepCourseAudio = courseAudio
  setTimeout(() => void sweepCourseAudio.sweep().catch((err: unknown) => console.warn(`[course-audio] the clean-up failed: ${String(err)}`)), 5000).unref()
  registerUpdateIpc(updater, {
    openExternal: (url) => void shell.openExternal(url),
    restartToUpdate: () => {
      reopenAfterQuit = true
      forceQuitAll = true
      skipQuitConfirm = true
      app.quit()
    },
  })
  updater.start()
  const navigation = registerAutomationIpc(store, manager, (id) => manager.isShimWindow?.(id) ?? false)
  automationServer = startAutomationServer(app.getPath('userData'), (request) =>
    prepareAutomation({ profile: app.getPath('userData'), version: app.getVersion(), packaged: app.isPackaged, state: () => store.get(), navigation }, request))
  void automationServer.catch(() => console.error('[cli] Could not start the local connection. Check profile permissions.'))
  // The memory meter (YAZ-3737 D1): one `getAppMetrics` each 30 s, in memory only. The rest is read only for a report.
  meter = createMemoryMeter({
    metrics: () => app.getAppMetrics(),
    windows: () => BrowserWindow.getAllWindows(),
    isPreview: (win) => previewPopups.has(win),
    entryOf: (win) => {
      const id = manager.idFor(win.webContents)
      return id === undefined ? undefined : store.get().windows.find((w) => w.id === id)
    },
    jsHeap: (win) => askHeap(win.webContents),
    tabs: (win) => askTabs(win.webContents),
    mtime: (path) => stat(path).then((s) => s.mtimeMs, () => null),
    helperPids: () => lsp.running().map((h) => h.pid),
    rss: helperRss,
  })
  registerMemoryIpc(meter)
  // The memory reload (YAZ-3737 D4, D6): after each sample, a window too big while nobody uses it reloads, its views kept.
  const sampled = meter
  reloadWatch = createReloadWatch({
    on: () => store.get().settings.memoryReload,
    history: (id) => sampled.history(id),
    blurredAt: (id) => manager.blurredAt(id),
    lastFocused: () => manager.lastFocused(),
    busy: (id) => manager.busy(id),
    views: async (id) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && manager.idFor(w.webContents) === id)
      return win === undefined ? null : askViews(win.webContents)
    },
    reload: (id, views, mb) => manager.memoryReload(id, views, mb),
  })
  setInterval(() => reloadWatch?.check(meter?.sample() ?? []), MEMORY_SAMPLE_MS).unref()
  // YAZ-1081 D3: a lid that just opened is the other "the world moved on while you were away"
  // moment, and the machine that edited the vault meanwhile is usually the other one. Wired here
  // rather than at module scope because powerMonitor is only safe to touch after `ready`.
  powerMonitor.on('resume', () => sync.notifyWake())
  powerMonitor.on('unlock-screen', () => sync.notifyWake())
  // The 1.0.15 heading styles move once into the vaults (YAZ-3066 D11). Before `restore`, which
  // drops the windows a launch does not bring back: every vault of the last session gets its copy.
  // It never holds up a window: a renderer that read no file yet hears the write as a change.
  void moveLegacyHeadingStyles(store).catch((err: unknown) => console.error(`[textFormatting] the move failed: ${String(err)}`))
  // A launch that was asked for something opens only that (YAZ-2589 D1): the windows of the vault
  // each waiting link belongs to. A plain launch follows the setting (D2), and a request that cannot
  // open is not a request (A6): a link that cannot be read, or a path `rootFor` has no vault for.
  const pendingLinks = links.pending()
  let shimRoutedCount = 0
  const asked = pendingLinks.flatMap<RestoreTarget>((url) => {
    const wsId = parseWorkspaceLink(url)
    if (wsId !== null) {
      if (process.platform === 'darwin' && !hiddenE2E && shims !== undefined && shims.resolveShimForWorkspace(wsId).mode !== 'host') {
        shimRoutedCount++
        return []
      }
      const set = store.get().vaultSets.find((s) => s.id === wsId)
      return set !== undefined ? [{ exact: set.roots }] : []
    }
    const link = parseFileLink(url)
    if (link === null) return []
    const isDir = manager.isDir(link.path)
    if (process.platform === 'darwin' && !hiddenE2E && shims !== undefined) {
      const route = isDir ? shims.resolveShimForVault(link.path, link.open) : shims.resolveShimForPath(link.path, link.root, link.open)
      if (route.mode !== 'host') {
        shimRoutedCount++
        return []
      }
    }
    const root = manager.rootFor(link.path, link.root)
    if (root === null) return []
    return isDir ? [{ exact: [root] }] : [root]
  })
  // The card skill's copy in the profile (YAZ-5107): made before the first window, never while the app runs. A
  // checkout stamps its version with the shipped files' hash, so an edit of `skills/card-skill` reaches the copy.
  // A failed copy is logged and never stops the start.
  const shippedSkill = shippedCardSkill({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, mainDir: __dirname })
  const cardSkillReady = (app.isPackaged ? Promise.resolve(app.getVersion()) : cardSkillStamp(shippedSkill, app.getVersion()))
    .then((version) => ensureCardSkill(app.getPath('userData'), shippedSkill, version))
    // The copy is the app's own vault from now on (YAZ-5108): each window's identity names it, and no list of the person takes it.
    .then((copy) => setCardSkillVault(copy))
    .catch((err: unknown) => console.error(`[cardSkill] the copy failed: ${String(err)}`))
  // The first window waits for the settings folder's first read (YAZ-3276 D4), so a theme that the other Mac
  // changed shows no flash. At most 500 ms: a slow or lost folder never holds up a launch. No folder: at once.
  void Promise.all([Promise.race([settingsFolder.ready, new Promise((done) => setTimeout(done, 500))]), cardSkillReady]).then(() => {
    const allLinksRoutedToShims = shimRoutedCount > 0 && asked.length === 0
    if (!headlessShimHost && !allLinksRoutedToShims) {
      manager.restore(asked.length > 0 ? asked : store.get().settings.startupWindows)
    } else if (asked.length > 0) {
      manager.restore(asked)
    } else {
      manager.pruneStaleWindows?.()
    }
    links.flush()
    if (process.platform === 'darwin' && app.isPackaged && !hiddenE2E && process.env.YASEEN_DOCS_E2E !== '1') {
      const binaryPath = appShimLoaderPath(process.execPath)
      void refreshOutdatedLaunchers(binaryPath, { hostBundlePath, hostBundleId, serverName: shimServerName }).catch((err: unknown) => console.warn(`[vaultLauncher] refresh failed: ${String(err)}`))
    }
  })
})

// Quit: `runQuitSequence` owns the order (renderers first, YAZ-1081 D2) and `windows[]` is kept, so
// the next launch can bring them back (YAZ-2589); then exit for real — `app.exit` re-runs no quit events.
// Option B (YAZ-6640): plain Cmd+Q on the host while Vault Apps are open closes only regular host windows
// and hides the host Dock icon, leaving Vault Apps running. Cmd+Opt+Q ("Quit All") or updater sets `forceQuitAll`.
let quitting = false
let closingHostOnly = false
let confirmingHostQuit = false
const readClipboardHtml = async (): Promise<string> => {
  try {
    const items = await clipboard.read()
    for (const item of items) {
      if (item.types.includes('text/html')) {
        const blob = await item.getType('text/html')
        return await blob.text()
      }
    }
  } catch {
    // Clipboard unavailable or no HTML payload.
  }
  return ''
}

const writeClipboardRich = async (data: { text: string; html: string }): Promise<void> => {
  await clipboard.write([
    new ClipboardItem({
      'text/plain': data.text,
      'text/html': data.html,
    }),
  ])
}

const runHostQuitSequence = (): void => {
  if (quitting) return
  quitting = true
  const activeShimBundles = shims?.activeBundlePaths() ?? []
  const hadRegularWindows = (manager.regularWindowCount?.() ?? 0) > 0
  // Launch the host app first when regular windows were open so it boots normally before shims connect (YAZ-6626).
  const reopenTargets = activeShimBundles.length > 0 ? [...(hadRegularWindows ? [HOST_BUNDLE_PATH] : []), ...activeShimBundles] : undefined
  void runQuitSequence({
    flushWindows: async () => {
      await automationServer?.then((server) => server.close(), () => undefined)
      await manager.flushAllForQuit()
      shims?.quitAll()
      try {
        app.stopAppShimServer?.()
      } catch {
        // ignore stop errors during shutdown
      }
    },
    // The settings folder's pending write (YAZ-3276 D4) goes with the state file's.
    flushStore: () => Promise.all([store.flush(), settingsFolder.flush()]).then(() => undefined),
    // The index cache's pending persist, and each vault's diary of links to the IDs this Mac made (YAZ-2677 R27): neither flush throws.
    flushIndex: () => Promise.all([flushIndexCache(), flushDiaries()]).then(() => undefined),
    flushSync: () => gitSync?.flushForQuit(),
    // No language server outlives the app (YAZ-3453). Each also ends by itself when its stdin closes.
    // A helper download under way stops, and leaves no half folder (YAZ-3500).
    // The spell checker helper too (YAZ-4464).
    stopHelpers: () => Promise.all([stopAllLanguageServers(), cancelHelperInstall(), speller.stop()]).then(() => undefined),
    // The swap waits for this process to end (S21, S22): start it last, then exit.
    exit: () => {
      cleanupTreeWatcherProbes()
      updater.installOnExit(reopenAfterQuit, reopenTargets)
      app.exit(0)
    },
  })
}
app.on('before-quit', (event) => {
  event.preventDefault()
  if (quitting) return
  const needConfirm = !skipQuitConfirm && !hiddenE2E && process.env.YASEEN_DOCS_E2E !== '1' && store.get().settings.confirmBeforeQuit
  if (!forceQuitAll && (shims?.connectedCount() ?? 0) > 0) {
    if (closingHostOnly || confirmingHostQuit) return
    const regularIds = manager.regularWindowIds?.() ?? []
    const doCloseHost = () => {
      closingHostOnly = true
      void (regularIds.length > 0 ? manager.flushAndCloseWindows(regularIds) : Promise.resolve())
        .catch(() => undefined)
        .finally(() => {
          closingHostOnly = false
          if ((manager.regularWindowCount?.() ?? 0) === 0 && (shims?.connectedCount() ?? 0) > 0) {
            app.dock?.hide()
          }
        })
    }
    if (!needConfirm || regularIds.length === 0) {
      doCloseHost()
      return
    }
    confirmingHostQuit = true
    const parent = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !previewPopups.has(w) && manager.idFor(w.webContents) === regularIds[0])
    const boxOpts: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: ['Close Windows', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: 'Do you want to close Yaseen Docs windows?',
      detail: 'Your open Vault Apps will stay running. Click Cancel to keep these windows open.',
    }
    void (parent !== undefined ? dialog.showMessageBox(parent, boxOpts) : dialog.showMessageBox(boxOpts))
      .catch(() => ({ response: 1 }))
      .then((res) => {
        confirmingHostQuit = false
        if (res.response === 0) doCloseHost()
      })
    return
  }
  if (needConfirm && !reopenAfterQuit) {
    if (confirmingHostQuit) return
    confirmingHostQuit = true
    const hostWin = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !previewPopups.has(w))
    const boxOpts: Electron.MessageBoxOptions = {
      type: 'question',
      buttons: ['Quit Yaseen Docs', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: 'Do you want to quit Yaseen Docs?',
      detail: 'Click Cancel to keep Yaseen Docs open. You can turn off this prompt in Settings › General.',
    }
    void (hostWin !== undefined ? dialog.showMessageBox(hostWin, boxOpts) : dialog.showMessageBox(boxOpts))
      .catch(() => ({ response: 1 }))
      .then((res) => {
        confirmingHostQuit = false
        if (res.response === 0) runHostQuitSequence()
      })
    return
  }
  runHostQuitSequence()
})

// Obsidian quits when its last window closes (its main.js `window-all-closed` handler); so do we —
// except while macOS App Shims are connected or a `--app-shim-host` launch awaits its initial shim (YAZ-6625 D2).
app.on('window-all-closed', () => {
  if ((shims?.connectedCount() ?? 0) > 0 || shims?.isWaitingForFirstShim()) return
  skipQuitConfirm = true
  app.quit()
})
