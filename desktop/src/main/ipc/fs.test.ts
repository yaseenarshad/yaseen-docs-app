import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { ipcMain } from 'electron'
import { CH, type Envelope } from '../../channels'
import { makeFixture } from '../fs/testFixture'
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
afterAll(() => cleanup())

describe('registerFsIpc', () => {
  it('registers every fs channel the preload invokes (and nothing else)', () => {
    registerFsIpc()
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()
    expect(channels).toEqual([CH.fsCreateDir, CH.fsCreateFile, CH.fsRead, CH.fsTree, CH.fsWrite].sort())
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
})
