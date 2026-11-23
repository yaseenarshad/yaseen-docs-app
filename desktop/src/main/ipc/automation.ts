import { BrowserWindow } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { AutomationFailure } from '@shared/automation'
import type { Store } from '../store'
import type { WindowManager } from '../windows'
import { RendererRequests } from '../automation/renderer'
import type { NavigationHost } from '../automation/navigation'
import { handleWithEvent } from './envelope'

/** The renderer handshake of CLI navigation (YAZ-4502): each window says it is ready, and replies once it shows a target. */
export function registerAutomationIpc(store: Store, windows: Pick<WindowManager, 'idFor' | 'automationWindows' | 'openAutomationWindow' | 'showWindow' | 'closeWindow'>): NavigationHost {
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
  return {
    state: () => store.get(), windows: () => windows.automationWindows(),
    open: options => windows.openAutomationWindow(options),
    raise: id => { windows.showWindow(id) },
    apply: async (id, target) => {
      const window = windowOf(id)
      if (!window) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window closed.')
      return requests.navigate(window.webContents, target)
    },
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
