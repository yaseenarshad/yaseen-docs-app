import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { LIBRARY_FAVORITES_DIR, MEDIA_LIBRARY_FILE, type MediaItem } from '@shared/types'
import { CONTRACT } from '@shared/ipc'
import { createStore, type Store } from '../store'
import { registerMediaLibraryIpc, type MediaLibraryIpc } from './mediaLibrary'
import { registered } from './ipcFixture'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

const ok = (value: unknown) => ({ ok: true, value })
const bad = (code: string) => expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) })
const item = (over: Partial<MediaItem> = {}): MediaItem => ({ itemKey: 'pixabay:1', provider: 'pixabay', providerId: '1', kind: 'photo', title: 'A tree', ...over })
const sender = { id: 1 }
/** This test's "Mac": it writes `media-<MAC>.json` (YAZ-4364). */
const MAC = 'aaaaaaaaaaaa'

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

let dir: string
let userData: string
let store: Store
let media: MediaLibraryIpc
beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  dir = await mkdtemp(path.join(tmpdir(), 'yd-media-ipc-'))
  userData = path.join(dir, 'userData')
  await mkdir(path.join(userData, 'library'), { recursive: true })
  store = createStore(path.join(userData, 'yaseendocs.json'))
  media = registerMediaLibraryIpc(store, userData, { macId: async () => MAC })
})
afterEach(async () => {
  await media.close()
  await store.flush()
  await rm(dir, { recursive: true, force: true })
})

const favorites = (req: unknown) => registered(CONTRACT.media.favorites)({ sender }, req)
const used = (req: unknown) => registered(CONTRACT.media.used)({ sender }, req)
const favoriteCopies = () => registered(CONTRACT.media.favoriteCopies)({ sender })

describe('registerMediaLibraryIpc (🔒 YAZ-1775 D4 / D5, YAZ-1817)', () => {
  it('reads and writes `<userData>/library/media-<macId>.json` by default (🔒 YAZ-1775 D5, YAZ-4364), every verb answering its list', async () => {
    expect(await favorites({ op: 'list' })).toEqual(ok([]))
    const added = await favorites({ op: 'add', item: item() })
    expect(added).toEqual(ok([expect.objectContaining({ itemKey: 'pixabay:1', updatedAt: expect.any(Number) })]))
    expect(await used({ op: 'record', item: item({ itemKey: 'iconify:a', provider: 'iconify', providerId: 'a', kind: 'icon' }), query: 'a' })).toEqual(
      ok(expect.objectContaining({ recent: [expect.objectContaining({ itemKey: 'iconify:a' })], used: [expect.objectContaining({ itemKey: 'iconify:a', count: 1, words: ['a'] })] })),
    )
    expect(await used({ op: 'list' })).toEqual(ok(expect.objectContaining({ recent: [expect.objectContaining({ itemKey: 'iconify:a' })] })))
    expect(await favorites({ op: 'remove', itemKey: 'pixabay:1' })).toEqual(ok([]))
    const disk = JSON.parse(await readFile(path.join(userData, 'library', `media-${MAC}.json`), 'utf8')) as { favorites: unknown[]; recent: unknown[] }
    expect(disk.favorites).toEqual([])
    expect(disk.recent).toHaveLength(1)
  })

  it('refuses a malformed request or a half-read item with BAD_REQUEST, writing nothing', async () => {
    expect(await favorites(undefined)).toEqual(bad('BAD_REQUEST'))
    expect(await favorites({ op: 'eat' })).toEqual(bad('BAD_REQUEST'))
    expect(await favorites({ op: 'add', item: { ...item(), provider: 'unsplash' } })).toEqual(bad('BAD_REQUEST'))
    expect(await favorites({ op: 'add', item: { ...item(), width: '640' } })).toEqual(bad('BAD_REQUEST'))
    expect(await favorites({ op: 'remove', itemKey: '' })).toEqual(bad('BAD_REQUEST'))
    expect(await used({ op: 'record', item: { itemKey: 'x' }, query: '' })).toEqual(bad('BAD_REQUEST'))
    expect(await used({ op: 'record', item: item() })).toEqual(bad('BAD_REQUEST'))
    expect(await used({ op: 'add-word', item: item(), word: 7 })).toEqual(bad('BAD_REQUEST'))
    expect(await used({ op: 'forget' })).toEqual(bad('BAD_REQUEST'))
    expect(await favorites({ op: 'list' })).toEqual(ok([]))
  })

  it('a renderer`s own updatedAt and unknown fields are dropped — main stamps the row', async () => {
    const res = await favorites({ op: 'add', item: { ...item(), updatedAt: 1, rogue: true } })
    expect(res).toEqual(ok([{ ...item(), updatedAt: expect.any(Number) }]))
    expect((res as { value: { updatedAt: number }[] }).value[0].updatedAt).not.toBe(1)
  })

  it('YAZ-286 (checked for YAZ-4365): a Recent row as the Add panel holds it, `updatedAt` and all, favorites through media:favorites', async () => {
    await used({ op: 'record', item: item(), query: 'tree' })
    const row = ((await used({ op: 'list' })) as { value: { recent: Record<string, unknown>[] } }).value.recent[0]
    expect(row.updatedAt).toEqual(expect.any(Number))
    const answer = await favorites({ op: 'add', item: row })
    expect(answer).toEqual(ok([{ ...item(), updatedAt: expect.any(Number) }]))
    expect(await favorites({ op: 'list' })).toEqual(answer)
  })

  it('broadcasts media:changed to EVERY window on an own write and on an external edit — the cross-vault promise', async () => {
    const a = fakeWindow()
    const b = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([a, b] as unknown as BrowserWindow[])
    await new Promise((r) => setTimeout(r, 300)) // let the poller anchor
    await favorites({ op: 'add', item: item() })
    expect(a.webContents.send).toHaveBeenCalledExactlyOnceWith(CONTRACT.media.onChanged.channel)
    expect(b.webContents.send).toHaveBeenCalledExactlyOnceWith(CONTRACT.media.onChanged.channel)
    a.webContents.send.mockClear()
    // The other Mac's file, as a sync brings it (YAZ-4364): heard, and read with this Mac's own.
    await writeFile(path.join(userData, 'library', 'media-bbbbbbbbbbbb.json'), JSON.stringify({ version: 1, favorites: [{ ...item({ itemKey: 'theirs', providerId: 't' }), updatedAt: 1 }], recent: [] }))
    await until(() => a.webContents.send.mock.calls.some(([ch]) => ch === CONTRACT.media.onChanged.channel))
    expect(await favorites({ op: 'list' })).toEqual(ok([expect.objectContaining({ itemKey: 'pixabay:1' }), expect.objectContaining({ itemKey: 'theirs' })]))
  })

  it('a favorite add saves its copy, also the auto-favorite at the third use; a removal deletes it (YAZ-4363)', async () => {
    const svg = `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`
    void media.copies.start(async (req) => ({ mimeType: 'image/svg+xml', dataURL: svg, item: item({ itemKey: `${req.provider}:${req.id}`, provider: req.provider, providerId: req.id }) }))
    const copiesDir = path.join(userData, 'library', LIBRARY_FAVORITES_DIR)
    const copyCount = async () => (await readdir(copiesDir).catch(() => [])).length
    const icon = item({ itemKey: 'iconify:mdi:home', provider: 'iconify', providerId: 'mdi:home', kind: 'icon' })
    await favorites({ op: 'add', item: icon })
    await media.copies.backfill()
    expect(await copyCount()).toBe(1)
    const auto = item({ itemKey: 'iconify:mdi:star', provider: 'iconify', providerId: 'mdi:star', kind: 'icon' })
    for (let i = 0; i < 3; i++) await used({ op: 'record', item: auto, query: '' })
    await media.copies.backfill()
    expect(await copyCount()).toBe(2)
    expect(await favoriteCopies()).toEqual(ok({ favorites: 2, saved: 2, saving: 0, waitingForKey: 0, failed: 0, bytes: 12 }))
    await favorites({ op: 'remove', itemKey: icon.itemKey })
    expect(await copyCount()).toBe(1)
  })

  it('follows settings.libraryFolder: the store re-points to the chosen folder and every window is told', async () => {
    const a = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([a] as unknown as BrowserWindow[])
    await favorites({ op: 'add', item: item({ itemKey: 'default', providerId: 'd' }) })
    const chosen = path.join(dir, 'Vault', 'Library')
    await mkdir(chosen, { recursive: true })
    await writeFile(path.join(chosen, MEDIA_LIBRARY_FILE), JSON.stringify({ version: 1, favorites: [{ ...item({ itemKey: 'chosen', providerId: 'c' }), updatedAt: 1 }], recent: [] }))
    a.webContents.send.mockClear()
    store.setSettings({ ...store.get().settings, libraryFolder: chosen })
    expect(a.webContents.send).toHaveBeenCalledWith(CONTRACT.media.onChanged.channel)
    expect(await favorites({ op: 'list' })).toEqual(ok([expect.objectContaining({ itemKey: 'chosen' })]))
    // A settings change that leaves the folder alone is not a library change.
    a.webContents.send.mockClear()
    store.setSettings({ ...store.get().settings, confirmDelete: false })
    expect(a.webContents.send).not.toHaveBeenCalled()
    // Reset to default: back to the userData library, which still holds what was written there.
    store.setSettings({ ...store.get().settings, libraryFolder: null })
    expect(await favorites({ op: 'list' })).toEqual(ok([expect.objectContaining({ itemKey: 'default' })]))
  })
})
