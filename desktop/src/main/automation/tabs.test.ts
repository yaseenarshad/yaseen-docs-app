import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultRightPanelIdentity, type WindowEntry } from '@shared/types'
import { createStore } from '../store'
import type { NavigationHost } from './navigation'
import { tabsCommand } from './tabs'
import { AutomationFailure } from '@shared/automation'
import { commandDefinition, validateInput } from '@shared/automationCommands'

let base: string, root: string, store: ReturnType<typeof createStore>, host: NavigationHost
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'docs-cli-tabs-')); root = join(base, 'Vault'); await mkdir(root)
  await writeFile(join(root, 'A.md'), 'A')
  store = createStore(join(base, 'profile/state.json'))
  const entry: WindowEntry = { id: 'w1', root, roots: [root], tabs: [], file: null, rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: true, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 1000, height: 800 } }
  host = { state: () => store.get(), windows: () => [entry], open: vi.fn(() => 'new'), raise: vi.fn(), apply: vi.fn(async () => ({})), inspect: vi.fn(async () => ({})), operate: vi.fn(async () => ({ rendererApplied: true })), usedWorkspace: vi.fn(async () => {}) }
})
afterEach(async () => { await store.flush(); await rm(base, { recursive: true, force: true }) })
it('restores saved copies and labels through the exact-window renderer action and persists last use', async () => {
  const path = join(root, 'A.md'), tabs = [{ path }, { path, name: 'Second', active: true as const }]
  const saved = store.saveSession('Morning', tabs, [root], undefined, 1)!
  const result = await tabsCommand(host, store, 'session.restore', { session: saved.id })
  expect(result).toMatchObject({ window: 'w1', missing: [], diskSaved: true })
  expect(host.operate).toHaveBeenCalledExactlyOnceWith('w1', { command: 'session.apply', tabs })
  expect(host.open).not.toHaveBeenCalled()
  expect(JSON.parse(await readFile(join(base, 'profile/state.json'), 'utf8')).sessions[0].lastUsed).toBeGreaterThan(1)
})
it('requires explicit partial restore before touching a window', async () => {
  const missing = join(root, 'Gone.md'), path = join(root, 'A.md')
  store.saveSession('Partial', [{ path }, { path: missing }], [root])
  await expect(tabsCommand(host, store, 'session.restore', { session: 'Partial' })).rejects.toMatchObject({ code: 'MISSING_TARGET', details: { missing: [missing] } })
  expect(host.apply).not.toHaveBeenCalled(); expect(host.operate).not.toHaveBeenCalled()
  expect(await tabsCommand(host, store, 'session.restore', { session: 'Partial', allowPartial: true })).toMatchObject({ missing: [missing] })
  expect(host.operate).toHaveBeenCalledWith('w1', { command: 'session.apply', tabs: [{ path }] })
})
it('scopes a new tab to its window and sends explicit copy/background flags', async () => {
  const path = join(root, 'A.md')
  await tabsCommand(host, store, 'tab.open', { window: 'w1', path, copy: true, background: true })
  expect(host.operate).toHaveBeenCalledExactlyOnceWith('w1', { command: 'tab.open', path, copy: true, background: true })
  await expect(tabsCommand(host, store, 'tab.open', { window: 'w1', path: '/outside/A.md' })).rejects.toMatchObject({ code: 'OUTSIDE_SCOPE' })
})
it('captures the live strip with duplicate copies and refuses a changed window context', async () => {
  const path = join(root, 'A.md'), storedTabs = [{ path }, { path, name: 'Copy', active: true as const }]
  vi.mocked(host.inspect).mockResolvedValue({ roots: [root], storedTabs })
  expect(await tabsCommand(host, store, 'session.capture', { window: 'w1', name: 'Captured' })).toMatchObject({ diskSaved: true })
  expect(store.get().sessions[0].tabs).toEqual(storedTabs)
  vi.mocked(host.inspect).mockResolvedValue({ roots: ['/changed'], storedTabs })
  await expect(tabsCommand(host, store, 'session.capture', { window: 'w1', name: 'Wrong context' })).rejects.toMatchObject({ code: 'CONTEXT_CHANGED' })
  expect(store.get().sessions).toHaveLength(1)
})
it('shows or hides the right panel through the window’s own action and reports what it shows', async () => {
  const rightPanel = { open: true, width: 320, items: [join(root, 'A.md')], expanded: join(root, 'A.md') }
  vi.mocked(host.operate).mockResolvedValue({ tabs: [], rightPanel, rendererApplied: true })
  const result = await tabsCommand(host, store, 'rightPanel.setOpen', { window: 'w1', open: true })
  expect(host.operate).toHaveBeenCalledExactlyOnceWith('w1', { command: 'rightPanel.setOpen', open: true })
  expect(result).toEqual({ window: 'w1', rightPanel, diskSaved: true })
  validateInput(commandDefinition('rightPanel.setOpen').output, result)
  await expect(tabsCommand(host, store, 'rightPanel.setOpen', { window: 'gone', open: false })).rejects.toMatchObject({ code: 'WINDOW_NOT_FOUND' })
})
describe('cross-window tab moves', () => {
  const path = () => join(root, 'A.md')
  const window = (id: string, roots: string[], tabs: string[] = []): WindowEntry => ({ id, root: roots[0], roots, tabs, file: null, rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: true, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 1000, height: 800 } })
  const live = (windows: WindowEntry[]) => {
    host.windows = () => windows
    host.inspect = vi.fn(async (id: string) => ({ tabs: id === 'w1' ? [{ id: 't1', path: path() }] : [{ id: 'old-copy', path: path() }] }))
  }
  it('sends through the source, then waits for the target to show the tab', async () => {
    live([window('w1', [root]), window('w2', [root])])
    vi.mocked(host.operate).mockImplementation(async (id: string) => id === 'w1' ? { sourceClosed: false } : { tab: 't9' })
    const result = await tabsCommand(host, store, 'tab.move', { window: 'w1', tab: 't1', to: 'w2', index: 1, background: true })
    expect(vi.mocked(host.operate).mock.calls).toEqual([
      ['w1', { command: 'tab.move', tab: 't1', to: 'w2', at: 1, background: true }],
      ['w2', { command: 'tab.received', path: path(), except: ['old-copy'] }],
    ])
    expect(result).toEqual({ window: 'w1', target: 'w2', created: false, path: path(), tab: 't9', sourceClosed: false, diskSaved: true })
    validateInput(commandDefinition('tab.move').output, result)
  })
  it('finds the new window that the pop-out door opened and waits for it', async () => {
    const windows = [window('w1', [root])]
    live(windows)
    vi.mocked(host.operate).mockImplementation(async (id: string) => {
      if (id === 'w1') { windows.push(window('w3', [root], [path()])); return { sourceClosed: false } }
      return { tab: 'n1' }
    })
    expect(await tabsCommand(host, store, 'tab.move', { window: 'w1', tab: 't1', newWindow: true })).toMatchObject({ target: 'w3', created: true, tab: 'n1' })
    expect(host.operate).toHaveBeenLastCalledWith('w3', { command: 'tab.received', path: path(), except: [] })
  })
  it('refuses closed, unrelated, and ambiguous targets before the source acts', async () => {
    live([window('w1', [root]), window('other', ['/elsewhere'])])
    await expect(tabsCommand(host, store, 'tab.move', { window: 'w1', tab: 't1', to: 'gone' })).rejects.toMatchObject({ code: 'WINDOW_NOT_FOUND' })
    await expect(tabsCommand(host, store, 'tab.move', { window: 'w1', tab: 't1', to: 'other' })).rejects.toMatchObject({ code: 'TARGET_UNAVAILABLE' })
    await expect(tabsCommand(host, store, 'tab.move', { window: 'w1', tab: 't1', to: 'other', newWindow: true })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(tabsCommand(host, store, 'tab.move', { window: 'w1', tab: 't1', newWindow: true, background: true })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(tabsCommand(host, store, 'tab.move', { window: 'w1', tab: 'missing', newWindow: true })).rejects.toMatchObject({ code: 'TAB_NOT_FOUND' })
    expect(host.operate).not.toHaveBeenCalled()
  })
  it('never reports success when either window closes during the move', async () => {
    live([window('w1', [root]), window('w2', [root])])
    vi.mocked(host.operate).mockRejectedValueOnce(new AutomationFailure('WINDOW_CLOSED', 'closed'))
    await expect(tabsCommand(host, store, 'tab.move', { window: 'w1', tab: 't1', to: 'w2' })).rejects.toMatchObject({ code: 'SOURCE_CLOSED' })
    vi.mocked(host.operate).mockReset().mockImplementation(async (id: string) => {
      if (id === 'w1') return { sourceClosed: true }
      throw new AutomationFailure('WINDOW_CLOSED', 'closed')
    })
    await expect(tabsCommand(host, store, 'tab.move', { window: 'w1', tab: 't1', to: 'w2' })).rejects.toMatchObject({ code: 'TARGET_UNACKNOWLEDGED', details: { path: path(), window: 'w1', target: 'w2', sourceClosed: true, cause: 'WINDOW_CLOSED' } })
    vi.mocked(host.operate).mockReset().mockRejectedValueOnce(new AutomationFailure('TARGET_UNAVAILABLE', 'refused'))
    await expect(tabsCommand(host, store, 'tab.move', { window: 'w1', tab: 't1', to: 'w2' })).rejects.toMatchObject({ code: 'TARGET_UNAVAILABLE' })
    expect(host.operate).toHaveBeenCalledOnce()
  })
})
