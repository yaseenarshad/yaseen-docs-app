import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import type { WindowEntry } from '@shared/types'
import { CH, type Envelope } from '../../channels'
import { createStore, type Store } from '../store'
import * as windows from '../windows'
import { registerWindowIpc } from './window'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>

function registered(channel: string): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`no handler registered for ${channel}`)
  return call[1] as unknown as Handler
}

const ok = (value: unknown) => ({ ok: true, value })
const bad = (code: string) => expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) })
const bounds = { x: 10, y: 20, width: 800, height: 600 }
const entry: WindowEntry = { id: 'w1', root: '/v', file: '/v/a.md', bounds }

let dir: string
let store: Store
let unregister: () => void
/** `event.sender` stand-ins: webContents 1 is registered as window w1, webContents 9 is unknown. */
const sender = { id: 1 }
const stranger = { id: 9 }
beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  dir = await mkdtemp(path.join(tmpdir(), 'yd-window-ipc-'))
  store = createStore(path.join(dir, 'yaseendocs.json'))
  store.upsertWindow(entry)
  unregister = windows.register({ webContents: sender }, 'w1')
  registerWindowIpc(store, windows)
})
afterEach(async () => {
  unregister()
  await store.flush()
  await rm(dir, { recursive: true, force: true })
})

describe('windows registry', () => {
  it('maps a webContents id to its window id until unregistered', () => {
    expect(windows.idFor(sender)).toBe('w1')
    expect(windows.idFor(stranger)).toBeUndefined()
    unregister()
    expect(windows.idFor(sender)).toBeUndefined()
    unregister = windows.register({ webContents: sender }, 'w1')
  })
})

describe('registerWindowIpc', () => {
  it('registers every window channel the preload invokes (and nothing else)', () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()
    expect(channels).toEqual([CH.windowIdentity, CH.windowSetIdentity, CH.windowOpen, CH.windowDuplicate].sort())
  })

  it('window:identity answers { id, root, file } for a registered sender', async () => {
    expect(await registered(CH.windowIdentity)({ sender })).toEqual(ok({ id: 'w1', root: '/v', file: '/v/a.md' }))
  })

  it('window:identity rejects an unregistered sender (BAD_REQUEST) and a window the state no longer has (NOT_FOUND)', async () => {
    expect(await registered(CH.windowIdentity)({ sender: stranger })).toEqual(bad('BAD_REQUEST'))
    store.removeWindow('w1')
    expect(await registered(CH.windowIdentity)({ sender })).toEqual(bad('NOT_FOUND'))
  })

  it('window:set-identity merges root / file into the entry, keeping id and bounds', async () => {
    expect(await registered(CH.windowSetIdentity)({ sender }, { root: '/other', file: null })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ id: 'w1', root: '/other', file: null, bounds }])
    expect(await registered(CH.windowSetIdentity)({ sender }, { file: '/other/b.md' })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ id: 'w1', root: '/other', file: '/other/b.md', bounds }])
    // Unknown keys cannot touch id / bounds.
    expect(await registered(CH.windowSetIdentity)({ sender }, { id: 'hijack', bounds: { x: 0, y: 0, width: 1, height: 1 } })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ id: 'w1', root: '/other', file: '/other/b.md', bounds }])
  })

  it('window:set-identity validates the patch', async () => {
    expect(await registered(CH.windowSetIdentity)({ sender }, 'nope')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.windowSetIdentity)({ sender }, { root: 5 })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.windowSetIdentity)({ sender }, { root: 'rel' })).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CH.windowSetIdentity)({ sender }, { file: 'a.md' })).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CH.windowSetIdentity)({ sender: stranger }, { root: '/v' })).toEqual(bad('BAD_REQUEST'))
    store.removeWindow('w1')
    expect(await registered(CH.windowSetIdentity)({ sender }, { root: '/v' })).toEqual(bad('NOT_FOUND'))
  })

  it('window:open and window:duplicate reject IO_ERROR until GRO-2160/2167', async () => {
    expect(await registered(CH.windowOpen)({ sender }, { root: '/v', file: null })).toEqual({
      ok: false,
      error: { code: 'IO_ERROR', message: 'not implemented until GRO-2160/2167' },
    })
    expect(await registered(CH.windowDuplicate)({ sender })).toEqual({
      ok: false,
      error: { code: 'IO_ERROR', message: 'not implemented until GRO-2160/2167' },
    })
  })
})
