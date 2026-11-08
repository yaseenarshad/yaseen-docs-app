import { expect, it, vi } from 'vitest'
import { defaultAppState, defaultRightPanelIdentity, type WindowEntry } from '@shared/types'
import { validateOutput } from '@shared/automationCommands'
import { prepareAutomation } from '../automation'
import type { NavigationHost } from './navigation'

const entry: WindowEntry = { id: 'w1', root: '/v', roots: ['/v'], tabs: [], file: null, rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: true, sidebarLens: 'files', bounds: { x: 0, y: 0, width: 1000, height: 800 } }
const outcome = { step: 'rename', done: 1, failed: [], links: { updated: 1, skipped: 0 }, history: { undo: 0, redo: 1 }, diskSaved: true }
const host = (): NavigationHost => ({ state: defaultAppState, windows: () => [entry], open: vi.fn(() => 'new'), raise: vi.fn(), apply: vi.fn(), inspect: vi.fn(), operate: vi.fn(async () => outcome), usedWorkspace: vi.fn(async () => {}) })
const run = (navigation: NavigationHost, command: string, args: Record<string, unknown>) =>
  prepareAutomation({ profile: '/p', version: 'test', navigation }, { version: 1, session: 'test', token: 'test', id: 'r', issuedAt: Date.now(), command, args }, Buffer.alloc(0))

it.each(['file.undo', 'file.redo'])('%s runs the window’s organization history step and declares its result', async command => {
  const navigation = host()
  const operation = run(navigation, command, { window: 'w1' })
  expect(operation.writes).toEqual(['documents', 'navigation'])
  const value = await operation.run()
  expect(navigation.operate).toHaveBeenCalledExactlyOnceWith('w1', { command })
  validateOutput(command, value)
  await expect(run(navigation, command, { window: 'gone' }).run()).rejects.toMatchObject({ code: 'WINDOW_NOT_FOUND' })
  expect(() => run(navigation, command, { window: 'w1', steps: 2 })).toThrow(/unknown field steps/)
  expect(() => run(navigation, command, {})).toThrow(/missing window/)
  expect(navigation.operate).toHaveBeenCalledOnce()
})
