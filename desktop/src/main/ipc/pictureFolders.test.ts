import { beforeEach, describe, expect, it, vi } from 'vitest'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { FOLDER_REFUSED, registerPictureFoldersIpc } from './pictureFolders'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

/**
 * `picture-folders:*` (YAZ-3943 demo round 3): this Mac's list of OUTSIDE folders the app may write a board's
 * pictures to. `allow` comes from a renderer, so it checks the path again like a pick; `remove` only takes it off.
 */

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
function registered(door: { channel: string }): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === door.channel)
  if (call === undefined) throw new Error(`no handler registered for ${door.channel}`)
  return call[1] as unknown as Handler
}

/** A store with only the list: the real one's rules are pinned in `store.test.ts`. */
let list: string[]
const store = {
  get: () => ({ approvedPictureFolders: list }),
  approvePictureFolder: vi.fn((folder: string) => {
    if (!list.includes(folder)) list = [...list, folder]
  }),
  removePictureFolder: vi.fn((folder: string) => {
    list = list.filter((f) => f !== folder)
  }),
} as unknown as Parameters<typeof registerPictureFoldersIpc>[0]

const OUTSIDE = path.join(tmpdir(), 'Board pictures')

beforeEach(() => {
  list = []
  vi.mocked(ipcMain.handle).mockClear()
  vi.mocked(store.approvePictureFolder).mockClear()
  registerPictureFoldersIpc(store)
})

describe('picture-folders IPC (YAZ-3943 demo round 3)', () => {
  it('allow puts an outside folder on the list and answers the list; list and remove answer it too; remove moves no file', async () => {
    expect(await registered(CONTRACT.pictureFolders.allow)(undefined, OUTSIDE)).toEqual({ ok: true, value: [OUTSIDE] })
    expect(await registered(CONTRACT.pictureFolders.list)(undefined)).toEqual({ ok: true, value: [OUTSIDE] })
    expect(await registered(CONTRACT.pictureFolders.remove)(undefined, OUTSIDE)).toEqual({ ok: true, value: [] })
    expect(await registered(CONTRACT.pictureFolders.remove)(undefined, 7)).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
  })

  it('allow checks the path again, as a pick does: a vault-relative path, a hidden folder, node_modules, a system folder, ~/Library and the home folder are refused, and nothing joins the list', async () => {
    const home = homedir()
    for (const bad of ['Board pictures', '/', path.join(tmpdir(), '.hidden'), path.join(tmpdir(), 'node_modules'), '/System/Library', '/Library/Fonts', path.join(home, 'Library', 'Caches'), home, '../up', '', 7, null]) {
      expect(await registered(CONTRACT.pictureFolders.allow)(undefined, bad)).toEqual({ ok: false, error: expect.objectContaining({ code: 'BAD_REQUEST', message: FOLDER_REFUSED }) })
    }
    expect(store.approvePictureFolder).not.toHaveBeenCalled()
    expect(list).toEqual([])
  })
})
