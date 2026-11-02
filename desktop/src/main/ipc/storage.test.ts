import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { registerStorageIpc } from './storage'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
function registered(door: { channel: string }): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === door.channel)
  if (call === undefined) throw new Error(`no handler registered for ${door.channel}`)
  return call[1] as unknown as Handler
}
// electron-vite's `?modulePath` is a build-time import; here it is the same worker, bundled by the fixture.
vi.mock('../storageWorker?modulePath', async () => ({ default: await (await import('../git/gitFixture')).bundleStorageWorker() }))

/** The `storage.*` doors (YAZ-1801, YAZ-3039): requests are checked like request bodies before any walk or rewrite. */

const bad = (code: string) => expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) })

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-storage-ipc-'))
  vi.mocked(ipcMain.handle).mockClear()
  registerStorageIpc()
})
afterEach(() => rm(root, { recursive: true, force: true }))

describe('storage IPC (YAZ-1801, YAZ-3039)', () => {
  it('stats answers for a plain folder, with git null', async () => {
    await writeFile(path.join(root, 'a.excalidraw'), '{"elements":[],"files":{}}')
    const res = await registered(CONTRACT.storage.stats)(undefined, root)
    expect(res).toMatchObject({ ok: true, value: { root, boards: { count: 1 }, git: null } })
  })

  it('refuses a relative root and a skip list that is not absolute paths — nothing is walked', async () => {
    await expect(registered(CONTRACT.storage.stats)(undefined, 'relative/dir')).resolves.toEqual(bad('NOT_ABSOLUTE'))
    await expect(registered(CONTRACT.storage.shrink)(undefined, root, 'not-an-array')).resolves.toEqual(bad('BAD_REQUEST'))
    await expect(registered(CONTRACT.storage.shrink)(undefined, root, ['relative.excalidraw'])).resolves.toEqual(bad('NOT_ABSOLUTE'))
  })

  it('a vault that is gone answers NOT_FOUND from main, before any worker starts — for both doors', async () => {
    const gone = path.join(root, 'moved-away')
    await expect(registered(CONTRACT.storage.stats)(undefined, gone)).resolves.toEqual(bad('NOT_FOUND'))
    await expect(registered(CONTRACT.storage.shrink)(undefined, gone, [])).resolves.toEqual(bad('NOT_FOUND'))
  })

  it('shrink answers the counts', async () => {
    await expect(registered(CONTRACT.storage.shrink)(undefined, root, [])).resolves.toEqual({ ok: true, value: { shrunk: 0, skipped: 0, bytesMoved: 0 } })
  })

  it('YAZ-3943 demo round 3: shrink hands the worker this Mac\'s approved pictures folders, so a board\'s picked outside folder takes its pictures', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'mdapp-storage-outside-'))
    try {
      const png = `data:image/png;base64,${Buffer.from('A').toString('base64')}`
      await writeFile(path.join(root, 'Far.excalidraw'), JSON.stringify({ yaseendraw: { createdAt: 1, updatedAt: 1, picturesFolder: outside }, type: 'excalidraw', elements: [{ id: 'i', type: 'image', fileId: 'aaa' }], appState: {}, files: { aaa: { mimeType: 'image/png', dataURL: png } } }))
      vi.mocked(ipcMain.handle).mockClear()
      registerStorageIpc({ get: () => ({ approvedPictureFolders: [outside] }) } as unknown as Parameters<typeof registerStorageIpc>[0])
      await expect(registered(CONTRACT.storage.shrink)(undefined, root, [])).resolves.toMatchObject({ ok: true, value: { shrunk: 1 } })
      expect(await readdir(outside)).toEqual(['aaa.png'])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})
