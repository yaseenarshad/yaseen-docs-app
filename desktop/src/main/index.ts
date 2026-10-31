import { rendererUrlFor } from './rendererUrl'
import { app, BrowserWindow, clipboard, Menu, nativeTheme, net, powerMonitor, protocol, screen, shell, webContents } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileKind } from '@shared/fileKind'
import { fileLink, isAppLink, parseFileLink } from '@shared/links'
import { FILES_PREVIEW_FRAME, MEMORY_SAMPLE_MS, type ClipboardPasteRequest, type FileKind, type WindowEntry } from '@shared/types'
import { DRAWIO_HOST } from '@shared/drawio'
import { CONTRACT, SPECIAL } from '@shared/ipc'
import { APP_SCHEME } from './appScheme'
import { resolveDrawioDir, serveDrawio } from './drawio/assets'
import { excalidrawFontsDir, viewerAssetsDir } from './ipc/share'
import type { GitSyncManager } from './git/manager'
import { registerIpc } from './ipc'
import { cancelHelperInstall } from './ipc/lsp'
import { ensureLibraryFolder } from './library/folder'
import { broadcastAll, rootsOf } from './ipc/broadcast'
import { registerClipboardIpc } from './ipc/clipboard'
import { registerUpdateIpc } from './ipc/update'
import { askHeap, askViews, registerMemoryIpc } from './ipc/memory'
import { createMemoryMeter, createReloadWatch, helperRss, type MemoryMeter, type ReloadWatch } from './memory'
import { claimDeepLinkScheme } from './deepLinkScheme'
import { DRAW_APP_NAME, shouldImportDrawAppData, startDrawImport } from './drawImport'
import { createLinkQueue } from './linkQueue'
import { openLink } from './fs/openLink'
import { buildContextMenuTemplate, buildMenuTemplate, createMenuHandlers, gateOnBoardKind, menuKeyedVaults, pickMenuTargetWindow, subscribeMenuRebuild, subscribeMenuRebuildOnActiveFile } from './menu'
import { revealItem } from './fs/reveal'
import { revealVaultImage, serveVaultImage } from './vaultProtocol'
import { followSettingsFolder } from './settingsFolder'
import { drawingInFront, hotkeyRecording } from './hotkeyRecording'
import { createStore } from './store'
import { moveLegacyHeadingStyles } from './textFormattingMove'
import { runQuitSequence } from './quitSequence'
import { stopAllLanguageServers } from './lsp/server'
import { subscribeNativeTheme, windowBackgroundColor } from './theme'
import { appZoomFactor, subscribeAppZoom } from './appZoom'
import { APP_NAME, STATE_FILE, applyUserDataOverride } from './userData'
import { flushDiaries, flushIndexCache, initIndexCache } from './vaultIndex'
import { initMint, macId } from './vaultIndex/mint'
import { createWindowManager } from './windows'
import { dropLanded } from './dragLanding'
import { blockFileNavigation, createWindowOpenHandler } from './windowOpenPolicy'
import { createUpdater, runFile, shortVersion, spawnDetached } from './updater'

// Before anything reads app.getPath('userData'): the workspace is named "desktop", the app is not.
app.setName(APP_NAME)
applyUserDataOverride(app, process.env.YASEEN_DOCS_USER_DATA_DIR)

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
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !previewPopups.has(w))
  if (win === undefined) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

claimDeepLinkScheme(app, process.env)

/** A parsed link routes to the best window; a bad one gets the unobtrusive notice, never a dialog. */
function handleLink(url: string): void {
  const parsed = parseFileLink(url)
  if (parsed === null) {
    manager.linkNotice(`Can't open link: ${url}`)
    return
  }
  manager.routeToFile(parsed.path, parsed.root)
}

/** macOS fires `open-url` before `ready` on cold start: queue until `restore()` ran, then flush. */
const links = createLinkQueue(handleLink)
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
  create(entry: WindowEntry, opts?: { hidden: true }) {
    const hidden = opts?.hidden === true
    const win = new BrowserWindow({
      ...entry.bounds,
      // A window the tab board made (YAZ-3343) is built HIDDEN: it shows when the board shows it.
      ...((hiddenE2E || hidden) && { show: false }),
      // The backing store matches the theme (K, GRO-2218): no white flash on dark launches.
      backgroundColor: windowBackgroundColor(store.get().settings.theme, nativeTheme.shouldUseDarkColors),
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, plugins: true, zoomFactor: appZoomFactor(store.get().settings), ...((hiddenE2E || hidden) && { backgroundThrottling: false }) },
    })
    // A hidden e2e window must never surface: `focus()` and `show()` would order it front.
    if (hiddenE2E) win.show = win.focus = () => {}
    win.webContents.setWindowOpenHandler(createWindowOpenHandler(openLink, entry.kind === 'files'))
    // The Files window's preview popup (YAZ-3357 D9): parented to it, so it moves and closes with it; deaf to the
    // mouse, so the pointer stays on the rows; and it makes no popup of its own.
    const ownerId = win.webContents.id
    win.webContents.on('did-create-window', (child, details) => {
      if (details.frameName !== FILES_PREVIEW_FRAME || entry.kind !== 'files') return void child.destroy()
      previewByOwner.get(ownerId)?.destroy()
      previewByOwner.set(ownerId, child)
      previewPopups.add(child)
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
    win.webContents.on('context-menu', (_event, params) =>
      Menu.buildFromTemplate(buildContextMenuTemplate(params, {
        copyAs: (mode) => win.webContents.send(SPECIAL.menuCopyAs, mode),
        pasteAs: (mode) => win.webContents.send(SPECIAL.menuPasteAs, { mode, text: clipboard.readText() } satisfies ClipboardPasteRequest),
        replace: (s) => win.webContents.replaceMisspelling(s),
        addToDictionary: (w) => win.webContents.session.addWordToSpellCheckerDictionary(w),
        // Image rows (YAZ-1666): Chromium copies the decoded pixels at the click point; reveal
        // resolves the `<img src>` through vaultProtocol.ts, so a non-vault source is a no-op there.
        copyImage: () => win.webContents.copyImageAt(params.x, params.y),
        revealImage: (src) => void revealVaultImage(src, (file) => revealItem({ path: file })),
      })).popup({ window: win }))
    // The window's own zoom is the App size and nothing else (YAZ-3432; ⌘+ zooms a note or the sidebar, YAZ-3389), a
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
})

/** The updater (YAZ-2976 D2): one per app, so every window gets the same state (S20). `start()` runs on `ready`. */
const updater = createUpdater(
  {
    fetch: (url, init) => net.fetch(url, init),
    run: runFile,
    spawnDetached,
    userData: app.getPath('userData'),
    // `<bundle>/Contents/Resources/app.asar` in a packaged app; a dev run is `manual` before it matters.
    bundle: join(app.getAppPath(), '..', '..', '..'),
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

/**
 * The most recently focused window's `webContents.id` — pickMenuTargetWindow's fallback key
 * (GRO-2197). Never cleared on blur: macOS reporting "no focused window" (app not frontmost)
 * is exactly the state the fallback exists for, so the last id must survive it.
 */
let lastFocusedWcId: number | undefined

/** The per-vault GitHub sync manager (YAZ-1081), created with the rest of the IPC once `ready` fires. */
let gitSync: GitSyncManager | undefined

/** The memory meter (YAZ-3737 D1), made on `ready`: a window that closes drops its history. */
let meter: MemoryMeter | undefined
/** The memory reload's watch (YAZ-3737 D6), made with the meter: a window that closes drops its last reload time. */
let reloadWatch: ReloadWatch | undefined

/** The menu's apply step, once `ready` made it: a focus change moves which window the board items ask about (YAZ-3037). */
let rebuildMenuOnFocus: (() => void) | undefined

app.on('browser-window-focus', (_event, win) => {
  lastFocusedWcId = win.webContents.id
  rebuildMenuOnFocus?.()
  // YAZ-1081 D2: focusing a vault's window is a PULL trigger — alt-tabbing back from another
  // machine should converge without waiting out a timer. The manager's own cooldown throttles it.
  // Every vault the window shows (YAZ-2602 S43).
  for (const root of store.get().windows.find((w) => w.id === manager.idFor(win.webContents))?.roots ?? []) gitSync?.notifyFocus(root)
})

app.whenReady().then(() => {
  if (!isPrimaryInstance) return
  // A dev run wears the app's own Dock icon instead of Electron's; a packaged build gets it from the bundle.
  if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  if (hiddenE2E) app.dock?.hide()
  // Appearance (K, GRO-2218): the setting IS the themeSource vocabulary. Applied from the loaded
  // store BEFORE any window is created (`restore` below), re-applied whenever it changes — so
  // `prefers-color-scheme` in every renderer and the OS chrome follow the setting.
  subscribeNativeTheme(store, (theme) => {
    nativeTheme.themeSource = theme
  })
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
  // `focusedWebContents` resolves through pickMenuTargetWindow (GRO-2197): macOS reports no
  // focused window while the app is not frontmost, and a menu action must never silently no-op
  // — so the last-focused live window (tracked below) is the documented fallback target.
  const menuTarget = () => pickMenuTargetWindow(BrowserWindow.getFocusedWindow(), BrowserWindow.getAllWindows().filter((w) => !previewPopups.has(w)), lastFocusedWcId)?.webContents
  registerClipboardIpc(manager, {
    target: menuTarget,
    writeText: (text) => clipboard.writeText(text),
    write: (data) => clipboard.write(data),
    readText: () => clipboard.readText(),
    rendererUrl: process.env.ELECTRON_RENDERER_URL ?? 'app://yaseen/index.html',
  })
  const handlers = createMenuHandlers(manager, {
    focusedWebContents: menuTarget,
    readClipboardText: () => clipboard.readText(),
    openExternal: (url) => void shell.openExternal(url),
    // S4–S6: the answer shows in the window in front, with or without a sidebar (the Welcome screen,
    // a collapsed one): a notice, or for a staged or manual update the "What's new" sheet and its button.
    checkForUpdates: () =>
      void updater.check().then(
        (s) => {
          if (s.kind === 'ready' || s.kind === 'manual') handlers.whatsNew()
          else manager.linkNotice(s.kind === 'downloading' ? `Downloading Yaseen Docs ${s.version}…` : `Yaseen Docs ${shortVersion(app.getVersion())} is the newest version`)
        },
        () => manager.linkNotice("Can't check for updates. Try again later"),
      ),
    // Dev only (YAZ-3737 D9): into the temp folder, never the vault or the profile. Loaded on the first use, so the
    // packaged app never parses it at start.
    saveHeapSnapshot: async (target, windowId) => {
      const wc = webContents.fromId(target.id)
      if (wc === undefined) return true
      const { saveHeapSnapshot } = await import('./heapSnapshot')
      const file = await saveHeapSnapshot(wc.debugger, join(app.getPath('temp'), 'yaseen-docs-heap'), windowId, new Date())
      if (file !== null) shell.showItemInFolder(file)
      return file !== null
    },
  })
  // The board items (YAZ-3037, YAZ-3028 D10; Draw's 🔒 YAZ-1775 D10) are enabled only while the window a
  // menu action would target has a board of the right kind in front. Read at build time from the same
  // window `menuTarget` names, so the answer and the send target can never disagree.
  const activeFileKind = () => {
    const wc = menuTarget()
    const id = wc === undefined ? undefined : manager.idFor(wc)
    const file = id === undefined ? null : (store.get().windows.find((w) => w.id === id)?.file ?? null)
    return file === null ? null : fileKind(file)
  }
  // What the keys follow (YAZ-3564 K9): a drawing open over the note is in front of it; the board items stay the tab's.
  const frontKind = (): FileKind | null => {
    const wc = menuTarget()
    return wc !== undefined && drawingInFront.has(wc.id) ? 'drawing' : activeFileKind()
  }
  const { apply: applyMenu, applyIfMoved } = gateOnBoardKind(activeFileKind, () =>
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        buildMenuTemplate(
          // The user's keys (YAZ-3397 D2), and none at all while a key recorder listens (D6).
          { recents: store.get().recents, keyedVaults: menuKeyedVaults(store.get()), isDev: !app.isPackaged, activeKind: activeFileKind(), frontKind: frontKind(), hotkeys: store.get().settings.hotkeys, hotkeysAside: store.get().settings.hotkeysAside, suspendKeys: hotkeyRecording.active(), dailyNotes: store.get().settings.dailyNotes },
          handlers,
        ),
      ),
    ),
    frontKind,
  )
  applyMenu()
  subscribeMenuRebuild(store, applyMenu)
  hotkeyRecording.onChange(applyMenu)
  drawingInFront.onChange(() => applyIfMoved())
  // A tab switch changes which file is in front; a focus change changes which window is asked. Either
  // rebuilds only when the board items' answer moves (YAZ-3044 A32).
  subscribeMenuRebuildOnActiveFile(store, applyIfMoved)
  rebuildMenuOnFocus = applyIfMoved
  const { sync, secrets, lsp } = registerIpc(store, manager, {
    userData: app.getPath('userData'),
    // YAZ-3040: the share viewer's build, draw.io's webapp and Excalidraw's fonts, which share setup uploads.
    viewerAssetsDir: viewerAssetsDir({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath(), mainDir: __dirname, exists: existsSync }),
    drawioDir: DRAWIO_DIR,
    fontsDir: excalidrawFontsDir({ isPackaged: app.isPackaged, mainDir: __dirname, appPath: app.getAppPath(), exists: existsSync }),
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
  }, settingsFolder)
  // The one library folder every vault shares (YAZ-3038; Draw's 🔒 YAZ-1775 D5). Made at startup, detached: a
  // launch must not wait on a disk, and a path that cannot be made is still what the Settings row names.
  void ensureLibraryFolder(store.get().settings.libraryFolder, app.getPath('userData'))
  gitSync = sync
  registerUpdateIpc(updater, {
    openExternal: (url) => void shell.openExternal(url),
    restartToUpdate: () => {
      reopenAfterQuit = true
      app.quit()
    },
  })
  updater.start()
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
  // Draw's data, copied one time into the gaps (YAZ-3028 D6): the app-data half now, each vault's half when it opens.
  startDrawImport({
    drawDir: join(app.getPath('appData'), DRAW_APP_NAME),
    userData: app.getPath('userData'),
    store,
    secrets,
    appData: shouldImportDrawAppData(process.env),
    rootsOf,
  })
  // The 1.0.15 heading styles move once into the vaults (YAZ-3066 D11). Before `restore`, which
  // drops the windows a launch does not bring back: every vault of the last session gets its copy.
  // It never holds up a window: a renderer that read no file yet hears the write as a change.
  void moveLegacyHeadingStyles(store).catch((err: unknown) => console.error(`[textFormatting] the move failed: ${String(err)}`))
  // A launch that was asked for something opens only that (YAZ-2589 D1): the windows of the vault
  // each waiting link belongs to. A plain launch follows the setting (D2), and a request that cannot
  // open is not a request (A6): a link that cannot be read, or a path `rootFor` has no vault for.
  const asked = links.pending().flatMap((url) => {
    const link = parseFileLink(url)
    return (link === null ? null : manager.rootFor(link.path, link.root)) ?? []
  })
  // The first window waits for the settings folder's first read (YAZ-3276 D4), so a theme that the other Mac
  // changed shows no flash. At most 500 ms: a slow or lost folder never holds up a launch. No folder: at once.
  void Promise.race([settingsFolder.ready, new Promise((done) => setTimeout(done, 500))]).then(() => {
    manager.restore(asked.length > 0 ? asked : store.get().settings.startupWindows)
    links.flush()
  })
})

// Quit: `runQuitSequence` owns the order (renderers first, YAZ-1081 D2) and `windows[]` is kept, so
// the next launch can bring them back (YAZ-2589); then exit for real — `app.exit` re-runs no quit events.
let quitting = false
app.on('before-quit', (event) => {
  event.preventDefault()
  if (quitting) return
  quitting = true
  void runQuitSequence({
    flushWindows: () => manager.flushAllForQuit(),
    // The settings folder's pending write (YAZ-3276 D4) goes with the state file's.
    flushStore: () => Promise.all([store.flush(), settingsFolder.flush()]).then(() => undefined),
    // The index cache's pending persist, and each vault's diary of links to the IDs this Mac made (YAZ-2677 R27): neither flush throws.
    flushIndex: () => Promise.all([flushIndexCache(), flushDiaries()]).then(() => undefined),
    flushSync: () => gitSync?.flushForQuit(),
    // No language server outlives the app (YAZ-3453). Each also ends by itself when its stdin closes.
    // A helper download under way stops, and leaves no half folder (YAZ-3500).
    stopHelpers: () => Promise.all([stopAllLanguageServers(), cancelHelperInstall()]).then(() => undefined),
    // The swap waits for this process to end (S21, S22): start it last, then exit.
    exit: () => {
      updater.installOnExit(reopenAfterQuit)
      app.exit(0)
    },
  })
})

// Obsidian quits when its last window closes (its main.js `window-all-closed` handler); so do we.
app.on('window-all-closed', () => app.quit())
