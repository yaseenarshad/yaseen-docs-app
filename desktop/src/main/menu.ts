/**
 * The application menu (B3, GRO-2161). `buildMenuTemplate` is a pure function of its inputs
 * (recents, isDev, handlers) so structure, accelerators and roles unit-test without Electron;
 * `createMenuHandlers` needs only the injected `MenuHost` for the Electron bits (focused
 * window, external links). The `Menu.buildFromTemplate`/`setApplicationMenu` apply layer
 * lives in `main/index.ts`.
 */
import type { MenuItemConstructorOptions } from 'electron'
import type { RecentRoots } from '@shared/types'
import { CH } from '../channels'
import type { Store } from './store'
import type { WindowManager } from './windows'

/** Help › Yaseen Docs on GitHub: the repo README (origin URL of this repo). */
export const HELP_URL = 'https://github.com/yaseenarshad/yaseen-milkdown#readme'

export interface MenuHandlers {
  /** File › New Window (⌘⇧N, D6): duplicate the focused window — same folder, same file. */
  newWindow(): void
  /** File › Open Folder… (⌘⇧O): the focused window's renderer runs its pick-folder flow. */
  openFolder(): void
  /** File › Open Recent › item: in place in the focused window; `beside` (⌥-click) in a new one. */
  openRecent(path: string, beside: boolean): void
  /** View › Toggle Sidebar: global setting (D9); `state:changed` re-renders every window. */
  toggleSidebar(): void
  openHelp(): void
}

export interface MenuInputs {
  /** MRU order, straight from `AppState.recents`. */
  recents: RecentRoots
  /** Dev builds get View › Toggle Developer Tools. */
  isDev: boolean
}

/**
 * The whole menu bar as a template. Item `id`s are stable so a live check (Playwright) can
 * drive items through `Menu.getApplicationMenu().getMenuItemById(...)`.
 */
export function buildMenuTemplate({ recents, isDev }: MenuInputs, handlers: MenuHandlers): MenuItemConstructorOptions[] {
  const recentItems: MenuItemConstructorOptions[] =
    recents.length === 0
      ? [{ label: 'No Recent Folders', enabled: false }]
      : recents.map((r, i) => ({
          id: `menu.file.open-recent.${i}`,
          label: r.path,
          // Electron hands the modifier state of the triggering gesture to click; ⌥ = open beside.
          // A programmatic `menuItem.click()` passes NO event at all — that opens in place.
          click: (_item, _win, event) => handlers.openRecent(r.path, event?.altKey === true),
        }))
  return [
    // macOS titles the first menu with the running app's name; the label only matters off-mac.
    {
      label: 'Yaseen Docs',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { id: 'menu.file.new-window', label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => handlers.newWindow() },
        { type: 'separator' },
        { id: 'menu.file.open-folder', label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: () => handlers.openFolder() },
        { id: 'menu.file.open-recent', label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        { role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+W' },
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: 'View',
      submenu: [
        { id: 'menu.view.toggle-sidebar', label: 'Toggle Sidebar', click: () => handlers.toggleSidebar() },
        { type: 'separator' },
        { role: 'reload' },
        ...(isDev ? [{ role: 'toggleDevTools' } satisfies MenuItemConstructorOptions] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
    // Top-level role `window` marks this submenu as macOS's Windows menu, so the OS appends the window list.
    { label: 'Window', role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
    { label: 'Help', role: 'help', submenu: [{ id: 'menu.help.github', label: 'Yaseen Docs on GitHub', click: () => handlers.openHelp() }] },
  ]
}

/** The Electron-only half, injected by `main/index.ts` (like windows.ts's `WindowHost`). */
export interface MenuHost {
  /** The focused window's webContents; undefined when no app window has focus. */
  focusedWebContents(): { id: number; send(channel: string, ...args: unknown[]): void } | undefined
  openExternal(url: string): void
  /** Whether `path` exists as a directory — open-beside probes before touching the MRU (GRO-2211). */
  dirExists(path: string): boolean
}

type MenuWindows = Pick<WindowManager, 'idFor' | 'openWindow' | 'duplicateWindow'>

export function createMenuHandlers(store: Store, windows: MenuWindows, host: MenuHost): MenuHandlers {
  /** The focused window's `AppState.windows` entry (registry: `webContents.id` → entry id). */
  const focusedEntry = () => {
    const wc = host.focusedWebContents()
    const id = wc === undefined ? undefined : windows.idFor(wc)
    return id === undefined ? undefined : store.get().windows.find((w) => w.id === id)
  }
  return {
    newWindow() {
      const entry = focusedEntry()
      if (entry !== undefined) windows.duplicateWindow(entry)
    },
    openFolder() {
      host.focusedWebContents()?.send(CH.menuOpenFolder)
    },
    openRecent(path, beside) {
      if (beside) {
        // Beside never passes through the renderer's validating openRoot, so probe here too:
        // a dead folder is pruned from the MRU (mirrors the Welcome/in-place path) and opens nothing.
        if (!host.dirExists(path)) {
          store.removeRecent(path)
          return
        }
        // The renderer bumps the MRU when it opens in place; opening beside never lands there, so bump here.
        store.pushRecent(path)
        windows.openWindow({ root: path, file: null })
        return
      }
      host.focusedWebContents()?.send(CH.menuOpenRoot, path)
    },
    toggleSidebar() {
      store.setSidebarCollapsed(!store.get().sidebarCollapsed)
    },
    openHelp() {
      host.openExternal(HELP_URL)
    },
  }
}

/**
 * Rebuild only when `recents` actually changed: store snapshots reuse untouched sub-objects,
 * so reference identity of `state.recents` skips every settings/window/folder write for free.
 */
export function subscribeMenuRebuild(store: Store, rebuild: () => void): () => void {
  let last = store.get().recents
  return store.onChange((state) => {
    if (state.recents === last) return
    last = state.recents
    rebuild()
  })
}
