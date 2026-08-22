import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import type { RegistryResponse } from '@shared/types'
import { CH, type Envelope } from '../../channels'
import { createStore, type Store } from '../store'
import { activeConfigWatcherRoots, VAULT_CONFIG_DIR } from '../vaultConfig'
import { registerRegistryIpc } from './registry'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>

function registered(channel: string): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`no handler registered for ${channel}`)
  return call[1] as unknown as Handler
}

const ok = (value: unknown) => ({ ok: true, value })
const bad = (code: string) => expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) })

const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** A `BrowserWindow` stand-in: only what the broadcaster touches. */
function fakeWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } }
}

const bounds = { x: 0, y: 0, width: 800, height: 600 }
const sender = { id: 1 }

let dir: string
let vault: string
let store: Store
beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  dir = await mkdtemp(path.join(tmpdir(), 'yd-registry-ipc-'))
  vault = path.join(dir, 'vault')
  await mkdir(vault) // the root exists (an open vault always does); its dotfolder does not
  store = createStore(path.join(dir, 'yaseendocs.json'))
  registerRegistryIpc(store)
})
afterEach(async () => {
  // Dropping every window releases this test's config watcher (the next register drops strays).
  for (const w of store.get().windows) store.removeWindow(w.id)
  await until(() => activeConfigWatcherRoots().length === 0)
  await store.flush()
  await rm(dir, { recursive: true, force: true })
})

describe('registerRegistryIpc', () => {
  it('registers exactly the registry channels the preload invokes', () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()
    expect(channels).toEqual([CH.registryGet, CH.registrySetType, CH.registryRemoveType, CH.registrySetProperty, CH.registryRemoveProperty].sort())
  })

  it('get and the mutators round-trip through the envelope; bad input answers error envelopes', async () => {
    expect(await registered(CH.registryGet)({ sender }, vault)).toEqual(ok({ root: vault, version: 1, types: {}, properties: {} }))
    expect(await registered(CH.registrySetType)({ sender }, vault, 'kpi', { displayName: 'KPI' })).toEqual(ok(undefined))
    expect(await registered(CH.registrySetProperty)({ sender }, vault, { type: 'kpi' }, 'unit', { kind: 'text' })).toEqual(ok(undefined))
    expect(await registered(CH.registrySetProperty)({ sender }, vault, 'vault', 'related', { kind: 'multi-link' })).toEqual(ok(undefined))
    const reg = (await registered(CH.registryGet)({ sender }, vault)) as { value: RegistryResponse }
    expect(reg.value.types.kpi).toEqual({ displayName: 'KPI', properties: { unit: { kind: 'text' } } })
    expect(reg.value.properties).toEqual({ related: { kind: 'multi-link' } })
    expect(await registered(CH.registryRemoveProperty)({ sender }, vault, 'vault', 'related')).toEqual(ok(undefined))
    expect(await registered(CH.registryRemoveType)({ sender }, vault, 'kpi')).toEqual(ok(undefined))

    expect(await registered(CH.registryGet)({ sender }, 'rel')).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CH.registrySetType)({ sender }, vault, 'Bad Name', {})).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.registrySetProperty)({ sender }, vault, 'vault', 'page_type', { kind: 'text' })).toEqual(bad('BAD_REQUEST'))
    await writeFile(path.join(vault, VAULT_CONFIG_DIR, 'types.json'), '{broken')
    expect(await registered(CH.registrySetType)({ sender }, vault, 'kpi', {})).toEqual(bad('INVALID_CONFIG'))
  })

  it('subscribes one config watcher per open-vault root and drops it when the last window leaves', async () => {
    expect(activeConfigWatcherRoots()).toEqual([])
    store.upsertWindow({ id: 'w1', root: vault, file: null, bounds })
    expect(activeConfigWatcherRoots()).toEqual([vault])
    store.upsertWindow({ id: 'w2', root: vault, file: null, bounds })
    expect(activeConfigWatcherRoots()).toEqual([vault]) // shared, not doubled
    store.upsertWindow({ id: 'w3', root: null, file: null, bounds }) // Welcome window: no root, no watcher
    expect(activeConfigWatcherRoots()).toEqual([vault])
    store.removeWindow('w1')
    expect(activeConfigWatcherRoots()).toEqual([vault])
    store.removeWindow('w2')
    await until(() => activeConfigWatcherRoots().length === 0)
  })

  it('broadcasts registry:changed { root, registry } to every live window on an own mutation and on an external edit', async () => {
    const a = fakeWindow()
    const b = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([a, b] as unknown as BrowserWindow[])
    store.upsertWindow({ id: 'w1', root: vault, file: null, bounds })
    a.webContents.send.mockClear()
    b.webContents.send.mockClear()

    await registered(CH.registrySetProperty)({ sender }, vault, 'vault', 'related', { kind: 'multi-link' })
    const got = (win: ReturnType<typeof fakeWindow>) =>
      win.webContents.send.mock.calls.find(([ch]) => ch === CH.registryChanged)?.[1] as { root: string; registry: RegistryResponse } | undefined
    await until(() => got(a) !== undefined && got(b) !== undefined)
    expect(got(a)?.root).toBe(vault)
    expect(got(a)?.registry.properties).toEqual({ related: { kind: 'multi-link' } })
    expect(got(b)?.registry.root).toBe(vault)

    a.webContents.send.mockClear()
    await new Promise((r) => setTimeout(r, 300)) // let the watcher settle on the just-created dotfolder
    await writeFile(path.join(vault, VAULT_CONFIG_DIR, 'types.json'), '{"version":1,"types":{"kpi":{"properties":{}}}}')
    await until(() => {
      const msg = got(a)
      return msg !== undefined && msg.registry.types.kpi !== undefined
    })
  })
})
