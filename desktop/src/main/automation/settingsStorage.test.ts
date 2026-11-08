import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../store'
import { settingsFolderCommand } from './settingsFolder'
import { storageCommand } from './storage'
import type { AutomationServices } from './services'

let root: string, store: ReturnType<typeof createStore>
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'docs-cli-settings-storage-')); store = createStore(join(root, '.profile/state.json')) })
afterEach(async () => { await store.flush(); await rm(root, { recursive: true, force: true }) })
it('persists a shared settings folder, reports settlement, and rejects a file without changing it', async () => {
  const folder = join(root, 'Shared'); await mkdir(folder)
  const services = { settingsFolder: { missing: () => false, hasOtherMacs: vi.fn(async () => true), settled: vi.fn(async () => {}) } } as unknown as AutomationServices
  expect(await settingsFolderCommand(store, services, 'settingsFolder.set', { folder })).toEqual({ folder, missing: false, syncSettled: true, diskSaved: true })
  expect(JSON.parse(await readFile(join(root, '.profile/state.json'), 'utf8')).settingsFolder).toBe(folder)
  const file = join(root, 'File'); await writeFile(file, '')
  await expect(settingsFolderCommand(store, services, 'settingsFolder.set', { folder: file })).rejects.toMatchObject({ code: 'NOT_A_DIRECTORY' })
  expect(store.get().settingsFolder).toBe(folder)
  expect(await settingsFolderCommand(store, services, 'settingsFolder.set', { folder: null })).toMatchObject({ folder: null, diskSaved: true })
})
it('pages large storage rows while retaining whole-vault totals and validates the shrink scope', async () => {
  const large = Array.from({ length: 201 }, (_, i) => ({ path: join(root, `Board${i}.excalidraw`), size: i }))
  const stats = vi.fn(async () => ({ root, boards: { count: 201, bytes: 123 }, large })), shrink = vi.fn(async () => ({ shrunk: 2, skipped: 1, bytesMoved: 123 }))
  const services = { storage: { stats, shrink } } as unknown as AutomationServices
  expect(await storageCommand(services, store.get(), 'storage.stats', { root, offset: 200, limit: 50 })).toMatchObject({ boards: { count: 201 }, large: { items: [large[200]], total: 201, nextOffset: null } })
  await expect(storageCommand(services, store.get(), 'storage.shrink', { root, skip: ['/outside/Board.excalidraw'] })).rejects.toMatchObject({ code: 'OUTSIDE_SCOPE' })
  expect(shrink).not.toHaveBeenCalled()
  expect(await storageCommand(services, store.get(), 'storage.shrink', { root, skip: [large[0].path] })).toMatchObject({ shrunk: 2, skipped: 1, diskSaved: true, rendererMerged: false })
})
