import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { MAX_PICTURE_FOLDERS, PICTURE_FOLDERS_FULL } from '../fs/picturesFolders'
import { FOLDER_REFUSED, registerPictureFoldersIpc, rememberPick } from './pictureFolders'

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
    return true
  }),
  removePictureFolder: vi.fn((folder: string) => {
    list = list.filter((f) => f !== folder)
  }),
} as unknown as Parameters<typeof registerPictureFoldersIpc>[0]

const OUTSIDE = path.join(tmpdir(), 'Board pictures')

/** The cog's picks this session (`ipc/index.ts`): Settings › Remove forgets one there too. */
let picked: Set<string>
beforeEach(() => {
  list = []
  picked = new Set()
  vi.mocked(ipcMain.handle).mockClear()
  vi.mocked(store.approvePictureFolder).mockClear()
  registerPictureFoldersIpc(store, picked)
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

  it('YAZ-4074 6A item 21: allow past MAX_PICTURE_FOLDERS says so in one line, and drops no folder', async () => {
    list = Array.from({ length: MAX_PICTURE_FOLDERS }, (_, n) => `/pics/${n}`)
    vi.mocked(store.approvePictureFolder).mockImplementationOnce(() => false)
    expect(await registered(CONTRACT.pictureFolders.allow)(undefined, OUTSIDE)).toEqual({ ok: false, error: expect.objectContaining({ code: 'BAD_REQUEST', message: PICTURE_FOLDERS_FULL }) })
    expect(list).toHaveLength(MAX_PICTURE_FOLDERS)
  })

  it('YAZ-4071 nit: allow checks the hidden-folder rule on the real place too: a link to a hidden folder is refused', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'allow-hidden-'))
    try {
      await mkdir(path.join(dir, '.secret'))
      await symlink(path.join(dir, '.secret'), path.join(dir, 'Pics'))
      expect(await registered(CONTRACT.pictureFolders.allow)(undefined, path.join(dir, 'Pics'))).toEqual({ ok: false, error: expect.objectContaining({ code: 'BAD_REQUEST', message: FOLDER_REFUSED }) })
      expect(list).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('YAZ-4071 nit: Settings › Remove forgets a folder the cog picked this session too, so a move cannot write there', async () => {
    rememberPick(picked, OUTSIDE)
    list = [OUTSIDE]
    await registered(CONTRACT.pictureFolders.remove)(undefined, OUTSIDE)
    expect([...picked]).toEqual([])
  })

  it('YAZ-4071 nit: the cog\'s picks this session hold MAX_PICTURE_FOLDERS at most: the oldest pick goes first', () => {
    for (let n = 0; n <= MAX_PICTURE_FOLDERS; n++) rememberPick(picked, `/pics/${n}`)
    expect(picked.size).toBe(MAX_PICTURE_FOLDERS)
    expect(picked.has('/pics/0')).toBe(false)
    // A pick again is the newest.
    rememberPick(picked, '/pics/1')
    rememberPick(picked, '/pics/new')
    expect(picked.has('/pics/1')).toBe(true)
    expect(picked.has('/pics/2')).toBe(false)
  })

  it('YAZ-4074 6A item 4: allow refuses a symbolic link to a system folder', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'allow-link-'))
    try {
      await symlink('/Library', path.join(dir, 'Lib'))
      expect(await registered(CONTRACT.pictureFolders.allow)(undefined, path.join(dir, 'Lib'))).toEqual({ ok: false, error: expect.objectContaining({ code: 'BAD_REQUEST', message: FOLDER_REFUSED }) })
      expect(await registered(CONTRACT.pictureFolders.allow)(undefined, path.join(dir, 'Lib', 'Fonts'))).toMatchObject({ ok: false })
      expect(list).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
