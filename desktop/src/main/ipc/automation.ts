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
  const findWindow = (id: string) => BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && windows.idFor(win.webContents) === id)
  const liveWindow = (id: string) => {
    const window = findWindow(id)
    if (!window) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window is not live.')
    return window
  }
  return {
    state: () => store.get(), windows: () => windows.automationWindows(),
    open: options => windows.openAutomationWindow(options),
    raise: id => { windows.showWindow(id) },
    apply: async (id, target) => requests.navigate(liveWindow(id).webContents, target),
    inspect: async (id, target) => requests.inspect(liveWindow(id).webContents, target),
    operate: async (id, target) => requests.operate(liveWindow(id).webContents, target),
    closeStartWindow: async id => {
      const window = findWindow(id)
      if (!window) return false
      // A start window holds nothing to save. Wait until it is gone, so the caller's next read sees one window (YAZ-4565).
      const closed = new Promise<void>(done => { window.once('closed', () => done()); setTimeout(done, 5000).unref() })
      windows.closeWindow(id)
      await closed
      return true
    },
    manage: async (id, action, name) => {
      liveWindow(id)
      if (action === 'show') { windows.showWindow(id); return { window: id, shown: true } }
      if (action === 'rename') {
        if (!windows.setName(id, name ?? null)) throw new AutomationFailure('INVALID_INPUT', 'The window name could not be set.')
        await store.flush()
        return { window: id, name: store.get().windows.find(item => item.id === id)?.name ?? null, diskSaved: true }
      }
      // Unsaved edits that cannot save (a conflict bar, a failed write) refuse the close, as ⌘R does. Nothing closes.
      if (await windows.flushWindow(id) === 'dirty') throw new AutomationFailure('SAVE_INCOMPLETE', 'The window holds edits that could not be saved, such as a conflict. Resolve them, then close it again.', { window: id })
      // Closing the final window also stops this socket. Acknowledge before the normal close/flush path starts.
      setTimeout(() => windows.closeWindow(id), 100).unref()
      return { window: id, accepted: true, outcome: 'close-requested' }
    },
    usedWorkspace: async id => { store.touchVaultSet(id); await store.flush() },
  }
}
