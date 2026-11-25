import { app, BrowserWindow, screen } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { AutomationFailure } from '@shared/automation'
import type { DisplayInfo } from '@shared/automationNavigation'
import type { Store } from '../store'
import type { WindowManager } from '../windows'
import { RendererRequests } from '../automation/renderer'
import type { NavigationHost } from '../automation/navigation'
import { handleWithEvent } from './envelope'

/** Maximum wait for macOS native fullscreen exit before `window.move` proceeds (YAZ-6539 Decision 6). */
const FULLSCREEN_EXIT_TIMEOUT_MS = 3_000

const roundBounds = (b: { x: number; y: number; width: number; height: number }) => ({
  x: Math.round(b.x),
  y: Math.round(b.y),
  width: Math.max(1, Math.round(b.width)),
  height: Math.max(1, Math.round(b.height)),
})

/** The renderer handshake of CLI navigation & window control (YAZ-4502, YAZ-6539): each window says it is ready, and replies once it finishes a command. */
export function registerAutomationIpc(
  store: Store,
  windows: Pick<WindowManager, 'idFor' | 'automationWindows' | 'openAutomationWindow' | 'showWindow' | 'closeWindow' | 'closeAutomationWindow'>,
): NavigationHost {
  const requests = new RendererRequests(CONTRACT.automation.onRequest.channel)
  const observed = new WeakSet<Electron.WebContents>()
  const windowOf = (id: string) => BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && windows.idFor(win.webContents) === id)
  handleWithEvent(CONTRACT.automation.ready, async (event, ready) => {
    if (typeof ready !== 'boolean' || windows.idFor(event.sender) === undefined) return
    if (!observed.has(event.sender)) {
      observed.add(event.sender)
      const id = event.sender.id
      event.sender.once('destroyed', () => requests.closed(id))
      // Only a new main document loses readiness; a subframe or in-page load keeps it (YAZ-4552).
      event.sender.on('did-start-navigation', details => {
        if (details.isMainFrame && !details.isSameDocument) requests.setReady(event.sender, false)
      })
    }
    requests.setReady(event.sender, ready)
  })
  handleWithEvent(CONTRACT.automation.reply, async (event, reply) => {
    if (!reply || typeof reply.id !== 'string' || typeof reply.ok !== 'boolean') return
    if (!reply.ok && (!reply.error || typeof reply.error.code !== 'string' || typeof reply.error.message !== 'string')) return
    requests.reply(event.sender.id, reply)
  })

  const focusWin = (win: BrowserWindow): { focused: boolean; restored: boolean } => {
    const restored = win.isMinimized()
    if (restored) win.restore()
    if (process.platform === 'darwin') app?.focus?.({ steal: true })
    win.show()
    win.focus()
    return { focused: true, restored }
  }

  return {
    state: () => store.get(),
    windows: () => windows.automationWindows(),
    open: options => windows.openAutomationWindow(options),
    raise: id => { windows.showWindow(id) },
    apply: async (id, target) => {
      const window = windowOf(id)
      if (!window) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window closed.')
      return requests.navigate(window.webContents, target)
    },
    command: async (id, body, timeoutMs) => {
      const window = windowOf(id)
      if (!window) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window closed.')
      return requests.sendCommand(window.webContents, body, timeoutMs)
    },
    displays: (): DisplayInfo[] => {
      const primary = screen.getPrimaryDisplay()
      const ordered = [primary, ...screen.getAllDisplays().filter(d => d.id !== primary.id)]
      return ordered.map(d => ({
        id: d.id,
        label: d.label || (d.id === primary.id ? 'Primary' : `Display ${d.id}`),
        primary: d.id === primary.id,
        workArea: roundBounds(d.workArea),
        bounds: roundBounds(d.bounds),
      }))
    },
    cursorPoint: () => screen.getCursorScreenPoint(),
    windowInfo: id => {
      const win = windowOf(id)
      if (!win) return undefined
      const bounds = roundBounds(win.getBounds())
      const display = screen.getDisplayMatching(bounds)
      return {
        ready: requests.isReady(win.webContents.id),
        focused: win.isFocused(),
        minimized: win.isMinimized(),
        fullscreen: win.isFullScreen(),
        displayId: display.id,
        bounds,
      }
    },
    moveWindow: async (id, bounds, focus) => {
      const win = windowOf(id)
      if (!win) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window closed.')
      let exitedFullScreen = false
      if (win.isFullScreen()) {
        await new Promise<void>(resolve => {
          let done = false
          const finish = () => {
            if (done) return
            done = true
            clearTimeout(timer)
            win.removeListener('leave-full-screen', onLeave)
            win.removeListener('closed', finish)
            resolve()
          }
          const onLeave = () => {
            exitedFullScreen = true
            finish()
          }
          const timer = setTimeout(finish, FULLSCREEN_EXIT_TIMEOUT_MS)
          timer.unref?.()
          win.once('leave-full-screen', onLeave)
          win.once('closed', finish)
          win.setFullScreen(false)
        })
        if (win.isDestroyed()) throw new AutomationFailure('WINDOW_CLOSED', 'The target window closed while exiting fullscreen.')
        if (!win.isFullScreen()) exitedFullScreen = true
      }
      if (win.isMinimized()) win.restore()
      win.setBounds(bounds, false)
      if (focus) focusWin(win)
      const actual = roundBounds(win.getBounds())
      const display = screen.getDisplayMatching(actual)
      return {
        displayId: display.id,
        bounds: actual,
        focused: focus ? true : win.isFocused(),
        exitedFullScreen,
      }
    },
    focusWindow: id => {
      const win = windowOf(id)
      if (!win) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window closed.')
      return focusWin(win)
    },
    minimizeWindow: id => {
      const win = windowOf(id)
      if (!win) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window closed.')
      if (!win.isMinimized()) win.minimize()
      return true
    },
    closeWindow: (id, force) => windows.closeAutomationWindow(id, force),
    closeStartWindow: async id => {
      const window = windowOf(id)
      if (!window) return false
      // A start window holds nothing to save. Wait until it is gone, so the caller's next read sees one window (YAZ-4565).
      const closed = new Promise<void>(done => { window.once('closed', () => done()); setTimeout(done, 5000).unref() })
      windows.closeWindow(id)
      await closed
      return true
    },
    usedWorkspace: async id => { store.touchVaultSet(id); await store.flush() },
  }
}
