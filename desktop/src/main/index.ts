import { app, BrowserWindow, clipboard, Menu, nativeTheme, net, powerMonitor, protocol, screen, shell } from 'electron'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileLink, parseFileLink } from '@shared/links'
import type { ClipboardPasteRequest, WindowEntry } from '@shared/types'
import { SPECIAL } from '@shared/ipc'
import { APP_SCHEME } from './appScheme'
import type { GitSyncManager } from './git/manager'
import { registerIpc } from './ipc'
import { registerClipboardIpc } from './ipc/clipboard'
import { claimDeepLinkScheme } from './deepLinkScheme'
import { createLinkQueue } from './linkQueue'
import { openLink } from './fs/openLink'
import { buildContextMenuTemplate, buildMenuTemplate, createMenuHandlers, menuKeyedVaults, pickMenuTargetWindow, subscribeMenuRebuild } from './menu'
import { revealItem } from './fs/reveal'
import { revealVaultImage, serveVaultImage } from './vaultProtocol'
import { createStore } from './store'
import { runQuitSequence } from './quitSequence'
import { subscribeNativeTheme, windowBackgroundColor } from './theme'
import { APP_NAME, STATE_FILE, applyUserDataOverride } from './userData'
import { flushIndexCache, initIndexCache } from './vaultIndex'
import { createWindowManager } from './windows'
import { createWindowOpenHandler } from './windowOpenPolicy'

// Before anything reads app.getPath('userData'): the workspace is named "desktop", the app is not.
app.setName(APP_NAME)
applyUserDataOverride(app, process.env.YASEEN_DOCS_USER_DATA_DIR)

/** One running instance (GRO-2160): a second launch focuses the first; a link in its argv routes (E1). */
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.quit()
app.on('second-instance', (_event, argv) => {
  // Windows/Linux deliver a clicked yaseendocs:// link as an argv entry of the second launch.
  const urls = argv.filter((arg) => arg.startsWith('yaseendocs://'))
  if (urls.length > 0) {
    for (const url of urls) links.push(url)
    return // routing focuses (or opens) the right window itself
  }
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
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

/** One user-global state file (D9, GRO-2159): `~/Library/Application Support/Yaseen Docs/yaseendocs.json`. */
const store = createStore(join(app.getPath('userData'), STATE_FILE))

/** Persistent vault-index cache (GRO-2223 D1): one JSON per vault under userData, never in the vault. */
initIndexCache(join(app.getPath('userData'), 'index-cache'))

/** Window lifecycle (GRO-2160) lives in windows.ts; this host is its Electron-only half. */
const manager = createWindowManager(store, {
  create(entry: WindowEntry) {
    const win = new BrowserWindow({
      ...entry.bounds,
      // The backing store matches the theme (K, GRO-2218): no white flash on dark launches.
      backgroundColor: windowBackgroundColor(store.get().settings.theme, nativeTheme.shouldUseDarkColors),
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, plugins: true },
    })
    win.webContents.setWindowOpenHandler(createWindowOpenHandler(openLink))
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
    // `<renderer>?win=<id>` so the renderer can ask `window.identity()` who it is.
    const url = new URL(process.env.ELECTRON_RENDERER_URL ?? 'app://yaseen/index.html')
    url.searchParams.set('win', entry.id)
    void win.loadURL(url.toString())
    return win
  },
  // Primary first: clampBounds keeps the earliest work area when a window is fully off-screen.
  workAreas() {
    const primary = screen.getPrimaryDisplay()
    return [primary, ...screen.getAllDisplays().filter((d) => d.id !== primary.id)].map((d) => d.workArea)
  },
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
})

/**
 * The most recently focused window's `webContents.id` — pickMenuTargetWindow's fallback key
 * (GRO-2197). Never cleared on blur: macOS reporting "no focused window" (app not frontmost)
 * is exactly the state the fallback exists for, so the last id must survive it.
 */
let lastFocusedWcId: number | undefined

/** The per-vault GitHub sync manager (YAZ-1081), created with the rest of the IPC once `ready` fires. */
let gitSync: GitSyncManager | undefined

app.on('browser-window-focus', (_event, win) => {
  lastFocusedWcId = win.webContents.id
  // YAZ-1081 D2: focusing a vault's window is a PULL trigger — alt-tabbing back from another
  // machine should converge without waiting out a timer. The manager's own cooldown throttles it.
  const root = store.get().windows.find((w) => w.id === manager.idFor(win.webContents))?.root ?? null
  if (root !== null) gitSync?.notifyFocus(root)
})

app.whenReady().then(() => {
  if (!isPrimaryInstance) return
  // A dev run wears the app's own Dock icon instead of Electron's; a packaged build gets it from the bundle.
  if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  // Appearance (K, GRO-2218): the setting IS the themeSource vocabulary. Applied from the loaded
  // store BEFORE any window is created (`restore` below), re-applied whenever it changes — so
  // `prefers-color-scheme` in every renderer and the OS chrome follow the setting.
  subscribeNativeTheme(store, (theme) => {
    nativeTheme.themeSource = theme
  })
  protocol.handle('app', (req) => {
    const { host, pathname } = new URL(req.url)
    // `app://vault/…` (YAZ-1658): vault images for `<img src>`, resolved by vaultProtocol.ts;
    // every other host is the renderer bundle, exactly as before.
    if (host === 'vault') return serveVaultImage(req, (u) => net.fetch(u))
    const file = join(RENDERER_DIR, pathname === '/' ? 'index.html' : pathname)
    return net.fetch(pathToFileURL(file).toString())
  })
  // Menu bar (B3, GRO-2161): the template is pure (menu.ts); only this apply layer touches Menu.
  // `focusedWebContents` resolves through pickMenuTargetWindow (GRO-2197): macOS reports no
  // focused window while the app is not frontmost, and a menu action must never silently no-op
  // — so the last-focused live window (tracked below) is the documented fallback target.
  const menuTarget = () => pickMenuTargetWindow(BrowserWindow.getFocusedWindow(), BrowserWindow.getAllWindows(), lastFocusedWcId)?.webContents
  registerClipboardIpc(manager, {
    target: menuTarget,
    writeText: (text) => clipboard.writeText(text),
    rendererUrl: process.env.ELECTRON_RENDERER_URL ?? 'app://yaseen/index.html',
  })
  const handlers = createMenuHandlers(store, manager, {
    focusedWebContents: menuTarget,
    readClipboardText: () => clipboard.readText(),
    openExternal: (url) => void shell.openExternal(url),
  })
  const applyMenu = (): void =>
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate({ recents: store.get().recents, keyedVaults: menuKeyedVaults(store.get()), isDev: !app.isPackaged }, handlers)))
  applyMenu()
  subscribeMenuRebuild(store, applyMenu)
  const sync = registerIpc(store, manager)
  gitSync = sync
  // YAZ-1081 D3: a lid that just opened is the other "the world moved on while you were away"
  // moment, and the machine that edited the vault meanwhile is usually the other one. Wired here
  // rather than at module scope because powerMonitor is only safe to touch after `ready`.
  powerMonitor.on('resume', () => sync.notifyWake())
  powerMonitor.on('unlock-screen', () => sync.notifyWake())
  // A launch that was asked for something opens only that (YAZ-2589 D1): the windows of the vault
  // each waiting link belongs to. A plain launch follows the setting (D2), and a request that cannot
  // open is not a request (A6): a link that cannot be read, or a path `rootFor` has no vault for.
  const asked = links.pending().flatMap((url) => {
    const link = parseFileLink(url)
    return (link === null ? null : manager.rootFor(link.path, link.root)) ?? []
  })
  manager.restore(asked.length > 0 ? asked : store.get().settings.startupWindows)
  links.flush()
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
    flushStore: () => store.flush(),
    flushIndex: flushIndexCache,
    flushSync: () => gitSync?.flushForQuit(),
    exit: () => app.exit(0),
  })
})

// Obsidian quits when its last window closes (its main.js `window-all-closed` handler); so do we.
app.on('window-all-closed', () => app.quit())
