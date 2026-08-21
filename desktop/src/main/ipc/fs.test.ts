import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { ipcMain } from 'electron'
import type { IndexResponse } from '@shared/types'
import { CH, type Envelope } from '../../channels'
import { makeFixture } from '../fs/testFixture'
import { _evictAll } from '../vaultIndex'
import { registerFsIpc } from './fs'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>

function registered(channel: string): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`no handler registered for ${channel}`)
  return call[1] as unknown as Handler
}

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(async () => {
  _evictAll()
  await cleanup()
})

describe('registerFsIpc', () => {
  it('registers every fs channel the preload invokes (and nothing else)', () => {
    registerFsIpc()
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()
    expect(channels).toEqual([CH.fsCreateDir, CH.fsCreateFile, CH.fsIndex, CH.fsRead, CH.fsReadAsset, CH.fsTree, CH.fsWrite].sort())
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
})
