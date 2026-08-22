import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import type { IndexResponse } from '@shared/types'
import { CH, type Envelope } from '../../channels'
import { makeFixture } from '../fs/testFixture'
import { createStore, type Store } from '../store'
import { _evictAll } from '../vaultIndex'
import { registerFsIpc } from './fs'

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

/** A `BrowserWindow` stand-in: only what the broadcaster touches. */
function fakeWindow() {
  return {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: vi.fn() },
  }
}

let root: string
let cleanup: () => Promise<void>
let storeDir: string
let store: Store
beforeAll(async () => {
  ;({ root, cleanup } = await makeFixture())
  storeDir = await mkdtemp(path.join(tmpdir(), 'yd-fs-ipc-'))
  store = createStore(path.join(storeDir, 'yaseendocs.json'))
})
afterAll(async () => {
  _evictAll()
  await store.flush()
  await cleanup()
  await rm(storeDir, { recursive: true, force: true })
})

/** Sender → window id registry fake (E1b root guard); tests point `senderWinId` at a store entry. */
let senderWinId: string | undefined
const registry = { idFor: () => senderWinId }

describe('registerFsIpc', () => {
  it('registers every fs channel the preload invokes (and nothing else)', () => {
    registerFsIpc(store, registry)
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()
    expect(channels).toEqual([CH.fsCreateDir, CH.fsCreateFile, CH.fsIndex, CH.fsRead, CH.fsReadAsset, CH.fsRename, CH.fsTree, CH.fsWrite].sort())
  })

  it('answers with an envelope: a tree on success, a BridgeError on failure', async () => {
    const ok = await registered(CH.fsTree)({ sender: {} }, root)
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    expect((ok.value as { root: string }).root).toBe(root)
    const missing = path.join(root, 'missing.md')
    expect(await registered(CH.fsRead)({ sender: {} }, missing)).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'path does not exist', path: missing },
    })
  })

  it('fs:read-asset answers a local image as base64 + mime, errors as a BridgeError envelope (GRO-2139)', async () => {
    const ok = await registered(CH.fsReadAsset)({ sender: {} }, root, 'img.png')
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    const value = ok.value as { path: string; mime: string; data: string; size: number }
    expect(value.path).toBe(path.join(root, 'assets-only', 'img.png'))
    expect(value.mime).toBe('image/png')
    expect(Buffer.from(value.data, 'base64').toString('utf8')).toBe('png')
    const missing = await registered(CH.fsReadAsset)({ sender: {} }, root, 'missing.png')
    expect(missing).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'no asset with this name under the root', path: 'missing.png' } })
  })

  it('fs:index answers the vault index for the root: markdown records only (GRO-2129)', async () => {
    const res = await registered(CH.fsIndex)({ sender: {} }, root)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    const value = res.value as IndexResponse
    expect(value.root).toBe(root)
    expect(value.records.length).toBeGreaterThan(0)
    expect(value.records.every((r) => r.ext === 'md' || r.ext === 'markdown')).toBe(true)
  })

  it('fs:rename renames on disk, repairs the store and broadcasts file:renamed to every window (Links E1, GRO-2194)', async () => {
    const oldPath = path.join(root, 'b.md')
    const newPath = path.join(root, 'bee.md')
    store.upsertWindow({ id: 'w1', root, file: oldPath, tabs: [oldPath], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    store.setFolder(root, { lastFile: oldPath })
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    const res = await registered(CH.fsRename)({ sender: {} }, { oldPath, newPath })
    expect(res).toEqual({ ok: true, value: { oldPath, newPath, kind: 'file' } })
    expect(await readFile(newPath, 'utf8')).toBe('# b\n')
    // Store repaired in the SAME handler: window file/tabs and the folder's lastFile follow.
    expect(store.get().windows.find((win) => win.id === 'w1')).toMatchObject({ file: newPath, tabs: [newPath] })
    expect(store.get().folders[root].lastFile).toBe(newPath)
    // Every live window got the push (kind included — a `dir` push remaps by prefix, E1b).
    expect(w.webContents.send).toHaveBeenCalledWith(CH.fileRenamed, { oldPath, newPath, kind: 'file' })
  })

  it('fs:rename refuses the calling window\'s own vault root (E1b, GRO-2241) but allows another window\'s subfolder root', async () => {
    const sub = path.join(root, 'Zeta')
    store.upsertWindow({ id: 'w-sub', root: sub, file: null, tabs: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    // The caller's OWN root: refused, nothing moves, nothing broadcast.
    senderWinId = 'w-sub'
    expect(await registered(CH.fsRename)({ sender: {} }, { oldPath: sub, newPath: path.join(root, 'Zeta2') })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'the vault root itself cannot be renamed', path: sub },
    })
    expect(w.webContents.send).not.toHaveBeenCalled()
    // The same dir renamed from a window rooted ABOVE it: allowed, and the sub-rooted
    // window's `WindowEntry.root` is repaired by the same handler.
    senderWinId = 'w1'
    const newPath = path.join(root, 'Zeta2')
    const res = await registered(CH.fsRename)({ sender: {} }, { oldPath: sub, newPath })
    expect(res).toEqual({ ok: true, value: { oldPath: sub, newPath, kind: 'dir' } })
    expect(store.get().windows.find((win) => win.id === 'w-sub')?.root).toBe(newPath)
    expect(w.webContents.send).toHaveBeenCalledWith(CH.fileRenamed, { oldPath: sub, newPath, kind: 'dir' })
  })

  it('fs:rename failure answers a BridgeError envelope, repairs nothing and broadcasts nothing', async () => {
    const oldPath = path.join(root, 'A.md')
    const newPath = path.join(root, 'bee.md') // created by the test above
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    const before = store.get()
    expect(await registered(CH.fsRename)({ sender: {} }, { oldPath, newPath })).toEqual({
      ok: false,
      error: { code: 'ALREADY_EXISTS', message: 'a file with this name already exists', path: newPath },
    })
    expect(store.get()).toBe(before)
    expect(w.webContents.send).not.toHaveBeenCalled()
  })
})
