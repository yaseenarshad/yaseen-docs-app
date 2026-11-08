import { stat } from 'node:fs/promises'
import { AutomationFailure } from '@shared/automation'
import { rootOfPath } from '@shared/types'
import type { TabOperation } from '@shared/automationTabs'
import type { Store } from '../store'
import { navigate, type NavigationHost } from './navigation'
import { resolveTarget, scopeRoots, unique } from './resources'

export async function tabsCommand(host: NavigationHost, store: Store, command: string, args: Record<string, unknown>): Promise<unknown> {
  if (command === 'session.restore') {
    const sessions = store.get().sessions
    const session = sessions.find(item => item.id === args.session) ?? unique(sessions.filter(item => item.name.toLowerCase() === String(args.session).toLowerCase()), 'Session')
    const resolved = await scopeRoots(store.get(), { roots: session.roots }, args.allowPartial === true)
    const present = await Promise.all(session.tabs.map(tab => stat(tab.path).then(info => info.isFile() || info.isDirectory(), () => false)))
    const tabs = session.tabs.filter((tab, index) => present[index] && rootOfPath(resolved.roots, tab.path) !== null)
    const missing = session.tabs.filter(tab => !tabs.includes(tab)).map(tab => tab.path)
    if (missing.length && !args.allowPartial) throw new AutomationFailure('MISSING_TARGET', 'Some saved session tabs are unavailable. Use allowPartial to open the remaining tabs.', { missing })
    if (!tabs.length) throw new AutomationFailure('NOT_FOUND', 'This session has no available tabs.')
    const opened = await navigate(host, { roots: resolved.roots, window: args.window as string | undefined, mode: args.mode as 'new' | 'reuse' | undefined })
    const applied = await host.operate(opened.window, { command: 'session.apply', tabs })
    store.touchSession(session.id); await store.flush()
    return { session: session.id, window: opened.window, roots: resolved.roots, missing: [...resolved.missing, ...missing], applied, diskSaved: true }
  }
  const window = host.windows().find(window => window.id === args.window)
  if (!window) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window is not live.')
  let target: TabOperation
  if (command === 'tab.open') target = { command, path: await resolveTarget(window.roots, args), background: args.background === true, copy: args.copy === true }
  else if (command === 'tab.blank') target = { command }
  else if (command === 'sidebar.setCollapsed') target = { command, collapsed: args.collapsed as boolean }
  else if (command === 'tab.rename') target = { command, tab: args.tab as string, name: args.name as string | null }
  else if (command === 'tab.reorder') target = { command, tab: args.tab as string, index: args.index as number }
  else if (['tab.close', 'tab.duplicate', 'tab.keep', 'tab.sleep', 'tab.wake'].includes(command)) target = { command, tab: args.tab as string } as TabOperation
  else throw new AutomationFailure('UNKNOWN_COMMAND', 'Unknown tab operation.')
  const result = await host.operate(window.id, target)
  await store.flush()
  return { window: window.id, applied: result, diskSaved: true }
}
