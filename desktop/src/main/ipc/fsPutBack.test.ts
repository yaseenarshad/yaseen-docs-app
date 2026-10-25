/**
 * The doors of an undone delete (YAZ-3268 D16): `fs:delete` answers where the item went in the Trash,
 * and `fs:put-back` moves it back. Plain node, temp folders: the home folder, and so `~/.Trash`, is a
 * temp folder, and `shell.trashItem` moves the item there under a new name, as the real Trash can.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserWindow, ipcMain, shell } from 'electron'
import { CONTRACT, type Envelope } from '@shared/ipc'
import { createStore, type Store } from '../store'
import { _evictAll, getIndex } from '../vaultIndex'
import { registerFsIpc } from './fs'

const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('node:os', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:os')>()
  return { ...real, homedir: () => home.dir }
})
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  shell: { trashItem: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
  screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ scaleFactor: 2 }) },
  clipboard: { read: vi.fn(() => ''), writeBuffer: vi.fn() },
}))
vi.mock('../fs/watchers', () => ({ subscribe: vi.fn(() => () => undefined), activeWatcherRoots: () => [] }))
vi.mock('../favorites', () => ({ renamePath: vi.fn(async () => undefined), removePath: vi.fn(async () => undefined) }))
vi.mock('../focus', () => ({ renamePath: vi.fn(async () => undefined), removePath: vi.fn(async () => undefined) }))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>
const registered = (door: { channel: string }): Handler => {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === door.channel)
  if (call === undefined) throw new Error(`no handler registered for ${door.channel}`)
  return call[1] as unknown as Handler
}

let store: Store
let vault: string
let trash: string
const entry = { file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, bounds: { x: 0, y: 0, width: 800, height: 600 } }

beforeAll(async () => {
  home.dir = await mkdtemp(path.join(tmpdir(), 'yd-home-'))
  trash = path.join(home.dir, '.Trash')
  vault = path.join(home.dir, 'vault')
  await mkdir(trash)
  await mkdir(path.join(vault, 'Plans'), { recursive: true })
  store = createStore(path.join(home.dir, 'yaseendocs.json'))
  store.upsertWindow({ ...entry, id: 'w-this', root: vault })
  registerFsIpc(store, { idFor: () => 'w-this', vaultNotice: vi.fn() })
  // The Trash held a note of this name already: the new one goes in under a new name.
  vi.mocked(shell.trashItem).mockImplementation(async (p: string) => rename(p, path.join(trash, `${path.parse(p).name} 10.21.33${path.extname(p)}`)))
})
afterEach(() => _evictAll())
afterAll(async () => {
  await store.flush()
  await rm(home.dir, { recursive: true, force: true })
})

const del = (p: string) => registered(CONTRACT.file.delete)({ sender: {} }, { path: p })
const putBack = (trashed: string, p: string) => registered(CONTRACT.file.putBack)({ sender: {} }, { trashed, path: p })

describe('fs:delete, then fs:put-back (YAZ-3268 D16)', () => {
  it('the delete answers the entry in the Trash; the put-back moves it back, and the index has it at once, with no push (S58)', async () => {
    const plan = path.join(vault, 'Plans', 'Plan.md')
    await writeFile(plan, 'See [[Other]].')
    await getIndex(vault)
    const gone = await del(plan)
    const trashed = path.join(trash, 'Plan 10.21.33.md')
    expect(gone).toEqual({ ok: true, value: { path: plan, kind: 'file', trashed } })
    vi.mocked(BrowserWindow.getAllWindows).mockClear()
    expect(await putBack(trashed, plan)).toEqual({ ok: true, value: { path: plan, kind: 'file' } })
    expect(await readFile(plan, 'utf8')).toBe('See [[Other]].')
    expect((await getIndex(vault)).records.find((r) => r.path === plan)).toMatchObject({ links: ['Other'] })
    // An add: the watcher puts it back in the tree; nothing is pushed.
    expect(BrowserWindow.getAllWindows).not.toHaveBeenCalled()
  })

  it('a place in no vault of the calling window is refused, and the entry stays in the Trash', async () => {
    const trashed = path.join(trash, 'Kept.md')
    await writeFile(trashed, 'k')
    const away = path.join(home.dir, 'Elsewhere.md')
    expect(await putBack(trashed, away)).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(await putBack(trashed, vault)).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect((await stat(trashed)).isFile()).toBe(true)
  })
})
