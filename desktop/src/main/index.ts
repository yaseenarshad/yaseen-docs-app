import { app, BrowserWindow, Menu, net, protocol, screen, shell } from 'electron'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileLink, parseFileLink } from '@shared/links'
import type { WindowEntry } from '@shared/types'
import { registerIpc } from './ipc'
import { createLinkQueue } from './linkQueue'
import { buildMenuTemplate, createMenuHandlers, subscribeMenuRebuild } from './menu'
import { createStore } from './store'
import { createWindowManager } from './windows'

// Before anything reads app.getPath('userData'): the workspace is named "desktop", the app is not.
app.setName('Yaseen Docs')

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

// Deep links (E1, GRO-2171): the packaged bundle's `protocols` Info.plist entry is F1's job.
app.setAsDefaultProtocolClient('yaseendocs')

/** A parsed link routes to the best window; a bad one gets the unobtrusive notice, never a dialog. */
function handleLink(url: string): void {
  const parsed = parseFileLink(url)
  if (parsed === null) {
    manager.linkNotice(`Can't open link: ${url}`)
    return
  }
  manager.routeToFile(parsed.path, parsed.root)
}

/** macOS fires `open-url` before `ready` on cold start: queue until `restoreAll()` ran, then flush. */
const links = createLinkQueue(handleLink)
app.on('open-url', (event, url) => {
  event.preventDefault()
  links.push(url)
})

// Finder "Open With" (E2, GRO-2172) hands a plain absolute path — also before `ready` on cold
// start. Encoding it as a yaseendocs:// link reuses the whole E1 pipeline (queue, parse, routing,
// markdown/exists guards); fileLink ↔ parseFileLink is lossless (links.test.ts round trips). The
// packaged bundle's `fileAssociations` (role Alternate) declaration is F1's job.
app.on('open-file', (event, path) => {
  event.preventDefault()
  links.push(fileLink(path))
})

// Privileged scheme: `standard` gives a real origin (history API, relative URLs), `secure` treats it
// like https. VS Code (vscode-file://) and Obsidian (app://obsidian.md) do the same.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const RENDERER_DIR = join(__dirname, '../renderer')

/** One user-global state file (D9, GRO-2159): `~/Library/Application Support/Yaseen Docs/yaseendocs.json`. */
const store = createStore(join(app.getPath('userData'), 'yaseendocs.json'))

/** Window lifecycle (GRO-2160) lives in windows.ts; this host is its Electron-only half. */
const manager = createWindowManager(store, {
  create(entry: WindowEntry) {
    const win = new BrowserWindow({
      ...entry.bounds,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
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
})

app.whenReady().then(() => {
  if (!isPrimaryInstance) return
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url)
    const file = join(RENDERER_DIR, pathname === '/' ? 'index.html' : pathname)
    return net.fetch(pathToFileURL(file).toString())
  })
  // Menu bar (B3, GRO-2161): the template is pure (menu.ts); only this apply layer touches Menu.
  const handlers = createMenuHandlers(store, manager, {
    focusedWebContents: () => BrowserWindow.getFocusedWindow()?.webContents,
    openExternal: (url) => void shell.openExternal(url),
    dirExists: (path) => {
      try {
        return statSync(path).isDirectory()
      } catch {
        return false
      }
    },
  })
  const applyMenu = (): void =>
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate({ recents: store.get().recents, isDev: !app.isPackaged }, handlers)))
  applyMenu()
  subscribeMenuRebuild(store, applyMenu)
  registerIpc(store, manager)
  manager.restoreAll()
  links.flush()
})

// Quit: flush every renderer sequentially (5s cap each, `windows[]` kept so relaunch restores them),
// write the pending state, then exit for real — `app.exit` re-runs no quit events.
let quitting = false
app.on('before-quit', (event) => {
  event.preventDefault()
  if (quitting) return
  quitting = true
  void manager
    .flushAllForQuit()
    .then(() => store.flush())
    .finally(() => app.exit(0))
})

// Obsidian quits when its last window closes (its main.js `window-all-closed` handler); so do we.
app.on('window-all-closed', () => app.quit())
