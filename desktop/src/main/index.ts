import { app, BrowserWindow, Menu, net, protocol } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { WindowEntry } from '@shared/types'
import { registerIpc } from './ipc'
import { createStore } from './store'
import * as windows from './windows'

// Before anything reads app.getPath('userData'): the workspace is named "desktop", the app is not.
app.setName('Yaseen Docs')

// Privileged scheme: `standard` gives a real origin (history API, relative URLs), `secure` treats it
// like https. VS Code (vscode-file://) and Obsidian (app://obsidian.md) do the same.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const RENDERER_DIR = join(__dirname, '../renderer')

/** One user-global state file (D9, GRO-2159): `~/Library/Application Support/Yaseen Docs/yaseendocs.json`. */
const store = createStore(join(app.getPath('userData'), 'yaseendocs.json'))

/** Set by `before-quit`: windows closing as part of a quit keep their state entry so relaunch restores them. */
let quitting = false

/** Loads `<renderer>?win=<id>` so the renderer can ask `window.identity()` who it is. */
function createWindow(entry: WindowEntry): BrowserWindow {
  const win = new BrowserWindow({
    ...entry.bounds,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  const unregister = windows.register(win, entry.id)
  win.on('closed', () => {
    unregister()
    // The last window closing quits the app (`window-all-closed` below), so that is a quit too.
    if (!quitting && BrowserWindow.getAllWindows().length > 0) store.removeWindow(entry.id)
  })
  const url = new URL(process.env.ELECTRON_RENDERER_URL ?? 'app://yaseen/index.html')
  url.searchParams.set('win', entry.id)
  void win.loadURL(url.toString())
  return win
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url)
    const file = join(RENDERER_DIR, pathname === '/' ? 'index.html' : pathname)
    return net.fetch(pathToFileURL(file).toString())
  })
  // Role-only menu until GRO-2161 (B3) builds the real one; the Edit roles are what make ⌘C/⌘V/⌘Z work.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]),
  )
  registerIpc(store)
  // First launch: one window on the Welcome screen. Otherwise every window from the last session (GRO-2160 adds bounds clamping / restore polish).
  let entries = store.get().windows
  if (entries.length === 0) {
    entries = [{ id: randomUUID(), root: null, file: null, bounds: { x: 100, y: 100, width: 1200, height: 800 } }]
    store.upsertWindow(entries[0])
  }
  entries.forEach(createWindow)
})

app.on('before-quit', () => {
  quitting = true
})

// The debounced write may still be pending: hold the quit until the state is on disk, then exit for real.
let flushed = false
app.on('will-quit', (event) => {
  if (flushed) return
  event.preventDefault()
  void store.flush().finally(() => {
    flushed = true
    app.exit(0)
  })
})

// Obsidian quits when its last window closes (its main.js `window-all-closed` handler); so do we.
app.on('window-all-closed', () => app.quit())
