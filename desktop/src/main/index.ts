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
    const { pathname, search } = new URL(req.url)
    // Until GRO-2157 (A5) the client still talks HTTP: forward /api to the Hono server in prod mode
    // (dev mode goes through the electron-vite proxy). Deleted with the server.
    if (pathname.startsWith('/api/')) {
      return net.fetch(`http://127.0.0.1:3737${pathname}${search}`, { method: req.method, headers: req.headers, body: req.body, duplex: 'half' } as RequestInit)
    }
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
