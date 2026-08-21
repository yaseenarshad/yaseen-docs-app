import { app, BrowserWindow, Menu, net, protocol } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerIpc } from './ipc'

// Before anything reads app.getPath('userData'): the workspace is named "desktop", the app is not.
app.setName('Yaseen Docs')

// Privileged scheme: `standard` gives a real origin (history API, relative URLs), `secure` treats it
// like https. VS Code (vscode-file://) and Obsidian (app://obsidian.md) do the same.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const RENDERER_DIR = join(__dirname, '../renderer')

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  const url = process.env.ELECTRON_RENDERER_URL ?? 'app://yaseen/index.html'
  void win.loadURL(url)
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
  registerIpc()
  createWindow()
})

// Obsidian quits when its last window closes (its main.js `window-all-closed` handler); so do we.
app.on('window-all-closed', () => app.quit())
