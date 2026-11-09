import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  // The window's vaults, not every vault's documents (YAZ-4527 P2).
  expect(operation.writes).toEqual(['navigation', 'window:w1', 'documents:/v'])
  const value = await operation.run()
  expect(navigation.operate).toHaveBeenCalledExactlyOnceWith('w1', { command })
  validateOutput(command, value)
  await expect(run(navigation, command, { window: 'gone' }).run()).rejects.toMatchObject({ code: 'WINDOW_NOT_FOUND' })
  expect(() => run(navigation, command, { window: 'w1', steps: 2 })).toThrow(/unknown field steps/)
  expect(() => run(navigation, command, {})).toThrow(/missing window/)
  expect(navigation.operate).toHaveBeenCalledOnce()
})

it('file.move sends the window’s move door each item with its own name, and file.rename takes a name in the same folder (YAZ-4566)', async () => {
  const vault = realpathSync(mkdtempSync(join(tmpdir(), 'yaz4566-'))).replace(/\\/g, '/')
  try {
    mkdirSync(`${vault}/Projects`); mkdirSync(`${vault}/Archive`)
    writeFileSync(`${vault}/Projects/task.md`, 'x')
    const navigation = { ...host(), windows: () => [{ ...entry, root: vault, roots: [vault] }], operate: vi.fn(async (_window: string, target: { command: string }) => {
      const after = { cleared: [], links: { updated: 0, skipped: 0 }, history: { undo: 1, redo: 0 }, diskSaved: true }
      return target.command === 'file.move' ? { moved: [], failed: [], betweenVaults: false, ...after } : { move: { oldPath: 'a', newPath: 'b', kind: 'file' }, ...after }
    }) }
    const value = await run(navigation, 'file.move', { window: 'w1', paths: [`${vault}/Projects/task.md`, `${vault}/Projects`], targetDir: `${vault}/Archive`, dropValues: true }).run()
    validateOutput('file.move', value)
    expect(navigation.operate).toHaveBeenLastCalledWith('w1', { command: 'file.move', targetDir: `${vault}/Archive`, moves: [{ oldPath: `${vault}/Projects/task.md`, newPath: `${vault}/Archive/task.md`, kind: 'file' }, { oldPath: `${vault}/Projects`, newPath: `${vault}/Archive/Projects`, kind: 'dir' }], dropValues: true })
    await run(navigation, 'file.move', { window: 'w1', paths: [`${vault}/Projects/task.md`], targetDir: `${vault}/Archive` }).run()
    expect(navigation.operate).toHaveBeenLastCalledWith('w1', expect.objectContaining({ dropValues: false })) // the D21 answer is never assumed
    await expect(run(navigation, 'file.move', { window: 'w1', paths: [`${vault}/Projects/task.md`], targetDir: `${vault}/Projects/task.md` }).run()).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(run(navigation, 'file.move', { window: 'w1', paths: [vault], targetDir: `${vault}/Archive` }).run()).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    validateOutput('file.rename', await run(navigation, 'file.rename', { window: 'w1', path: `${vault}/Projects/task.md`, name: 'done.md' }).run())
    expect(navigation.operate).toHaveBeenLastCalledWith('w1', { command: 'file.rename', path: `${vault}/Projects/task.md`, newPath: `${vault}/Projects/done.md`, kind: 'file' })
    const calls = navigation.operate.mock.calls.length
    for (const name of ['../Archive/task.md', 'Archive/task.md', 'a\\b.md', '..', '']) await expect(run(navigation, 'file.rename', { window: 'w1', path: `${vault}/Projects/task.md`, name }).run()).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(() => run(navigation, 'file.rename', { window: 'w1', path: `${vault}/Projects/task.md`, newPath: `${vault}/Archive/task.md` })).toThrow(/missing name|unknown field newPath/)
    expect(navigation.operate).toHaveBeenCalledTimes(calls)
  } finally { rmSync(vault, { recursive: true, force: true }) }
})
