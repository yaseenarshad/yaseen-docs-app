import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultRightPanelIdentity, type WindowEntry } from '@shared/types'
import { createStore } from '../store'
import type { NavigationHost } from './navigation'
import { tabsCommand } from './tabs'

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
