import { stat } from 'node:fs/promises'
import { AutomationFailure } from '@shared/automation'
import { rootOfPath, sameVaults, type StoredTab, type WindowEntry } from '@shared/types'
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
  if (command === 'session.capture') {
    const snapshot = await host.inspect(window.id, { kind: 'window' }) as { roots: string[]; storedTabs?: StoredTab[] }
    const current = host.windows().find(item => item.id === window.id)
    if (!current || !sameVaults(current.roots, window.roots) || !sameVaults(snapshot.roots, window.roots)) throw new AutomationFailure('CONTEXT_CHANGED', 'The window’s vaults changed while its tabs were inspected. Read the window again.')
    if (!snapshot.storedTabs?.length) throw new AutomationFailure('NO_TABS', 'The live window has no tabs to save.')
    const saved = store.saveSession(args.name as string, snapshot.storedTabs, window.roots, args.id as string | undefined)
    if (!saved) throw new AutomationFailure('INVALID_INPUT', 'The session could not be saved. Check its name, replacement ID, and the session limit.')
    await store.flush()
    return { window: window.id, session: saved, diskSaved: true }
  }
  if (command === 'tab.move') return moveTab(host, store, window, args)
  let target: TabOperation
  if (command === 'tab.open') target = { command, path: await resolveTarget(window.roots, args), background: args.background === true, copy: args.copy === true }
  else if (command === 'tab.blank') target = { command }
  else if (command === 'sidebar.setCollapsed') target = { command, collapsed: args.collapsed as boolean }
  else if (command === 'rightPanel.setOpen') target = { command, open: args.open as boolean }
  else if (command === 'tab.rename') target = { command, tab: args.tab as string, name: args.name as string | null }
  else if (command === 'tab.reorder') target = { command, tab: args.tab as string, index: args.index as number }
  else if (['tab.close', 'tab.duplicate', 'tab.keep', 'tab.sleep', 'tab.wake'].includes(command)) target = { command, tab: args.tab as string } as TabOperation
  else throw new AutomationFailure('UNKNOWN_COMMAND', 'Unknown tab operation.')
  const result = await host.operate(window.id, target)
  await store.flush()
  if (command === 'rightPanel.setOpen') return { window: window.id, rightPanel: (result as { rightPanel: unknown }).rightPanel, diskSaved: true }
  return { window: window.id, applied: result, diskSaved: true }
}

type LiveTabs = { tabs?: { id: string; path: string }[] }

/**
 * A tab to another live window, or to a new one, through the GUI's send path (YAZ-3091, YAZ-3637): the source saves
 * the tab, main's move door hands it over, and the source closes it. The reply waits for the target to show it too.
 */
async function moveTab(host: NavigationHost, store: Store, source: WindowEntry, args: Record<string, unknown>) {
  const to = args.to as string | undefined, fresh = args.newWindow === true
  if ((to === undefined) === !fresh) throw new AutomationFailure('INVALID_INPUT', 'Name exactly one target: to or newWindow.')
  if (fresh && (args.background !== undefined || args.index !== undefined)) throw new AutomationFailure('INVALID_INPUT', 'A new window takes no index or background flag.')
  if (to === source.id) throw new AutomationFailure('INVALID_INPUT', 'A tab cannot move to its own window.')
  const target = to === undefined ? undefined : host.windows().find(window => window.id === to)
  if (to !== undefined && !target) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The target window is not live.')
  const tab = (await host.inspect(source.id, { kind: 'window' }) as LiveTabs).tabs?.find(tab => tab.id === args.tab)
  if (!tab) throw new AutomationFailure('TAB_NOT_FOUND', 'The requested tab is not in this window.')
  if (target && rootOfPath(target.roots, tab.path) === null) throw new AutomationFailure('TARGET_UNAVAILABLE', 'The target window shows no vault of this page. The tab stayed.')
  const except = target ? ((await host.inspect(target.id, { kind: 'window' }) as LiveTabs).tabs ?? []).filter(other => other.path === tab.path).map(other => other.id) : []
  const before = new Set(host.windows().map(window => window.id))
  let sent: { sourceClosed?: boolean }
  try {
    sent = await host.operate(source.id, { command: 'tab.move', tab: tab.id, to: to ?? null, ...(args.index === undefined ? {} : { at: args.index as number }), background: args.background === true }) as { sourceClosed?: boolean }
  } catch (error) {
    if (error instanceof AutomationFailure && error.code === 'WINDOW_CLOSED') throw new AutomationFailure('SOURCE_CLOSED', 'The source window closed before it acknowledged. Inspect both windows before another move.', { path: tab.path, window: source.id, target: to ?? null })
    throw error
  }
  // `window:pop-out` names no window: the new one is the live window that was not there before and holds the page.
  const receiver = target?.id ?? host.windows().find(window => !before.has(window.id) && window.tabs.includes(tab.path))?.id
  let received: { tab?: string } | undefined
  try {
    if (receiver === undefined) throw new AutomationFailure('WINDOW_NOT_FOUND', 'The new window is not live.')
    received = await host.operate(receiver, { command: 'tab.received', path: tab.path, except }) as { tab?: string }
  } catch (error) {
    throw new AutomationFailure('TARGET_UNACKNOWLEDGED', 'The tab left the source window, but the target did not acknowledge it. Inspect both windows before another move.', { path: tab.path, window: source.id, target: receiver ?? null, sourceClosed: sent.sourceClosed === true, cause: error instanceof AutomationFailure ? error.code : 'UNKNOWN' })
  }
  await store.flush()
  return { window: source.id, target: receiver, created: fresh, path: tab.path, tab: received!.tab!, sourceClosed: sent.sourceClosed === true, diskSaved: true }
}
