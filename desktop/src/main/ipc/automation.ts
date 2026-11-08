import { BrowserWindow } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { AutomationFailure } from '@shared/automation'
import type { Store } from '../store'
import type { WindowManager } from '../windows'
import { RendererRequests } from '../automation/renderer'
import type { NavigationHost } from '../automation/navigation'
import { handleWithEvent } from './envelope'

export function registerAutomationIpc(store: Store, windows: WindowManager): NavigationHost {
  const requests = new RendererRequests(CONTRACT.automation.onRequest.channel)
  const observed = new WeakSet<Electron.WebContents>()
  handleWithEvent(CONTRACT.automation.ready, async (event, ready) => {
    if (typeof ready !== 'boolean' || windows.idFor(event.sender) === undefined) return
    if (!observed.has(event.sender)) {
      observed.add(event.sender)
      const id = event.sender.id
      event.sender.once('destroyed', () => requests.closed(id))
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
      const window = BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && windows.idFor(win.webContents) === id)
      if (!window) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window closed.')
      return requests.navigate(window.webContents, target)
    },
    inspect: async (id, target) => {
      const window = BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && windows.idFor(win.webContents) === id)
      if (!window) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window closed.')
      return requests.inspect(window.webContents, target)
    },
    operate: async (id, target) => {
      const window = BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && windows.idFor(win.webContents) === id)
      if (!window) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window closed.')
      return requests.operate(window.webContents, target)
    },
    usedWorkspace: async id => { store.touchVaultSet(id); await store.flush() },
  }
}
