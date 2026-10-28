/**
 * The doors of an undone delete (YAZ-3268 D16): `fs:delete` answers where the item went in the Trash,
 * and `fs:put-back` moves it back. Plain node, temp folders: the home folder, and so `~/.Trash`, is a
 * temp folder, and `shell.trashItem` moves the item there under the name macOS gives a clash
 * (`Plan.md 01-30-05-828.md`, the local time of the move), as the real Trash does.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
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
// The vault's own icons (YAZ-3440 D) ride the same handlers too; `icons.test.ts` owns their disk behaviour.
vi.mock('../icons', () => ({ renamePath: vi.fn(async () => undefined), removePath: vi.fn(async () => undefined) }))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>
const registered = (door: { channel: string }): Handler => {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === door.channel)
  if (call === undefined) throw new Error(`no handler registered for ${door.channel}`)
  return call[1] as unknown as Handler
}

let store: Store
let given = ''
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
  // The Trash held a note of this name already: the new one goes in under the clash name of its time.
  vi.mocked(shell.trashItem).mockImplementation(async (p: string) => {
    const d = new Date()
    const two = (n: number) => String(n).padStart(2, '0')
    given = `${path.basename(p)} ${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}${path.extname(p)}`
    await rename(p, path.join(trash, given))
  })
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
    const trashed = path.join(trash, given)
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

  it('never replaces a broken link with the old name, through the door: ALREADY_EXISTS, and the link and the entry stay (YAZ-3271)', async () => {
    const trashed = path.join(trash, 'L.md')
    await writeFile(trashed, 'the deleted note')
    const to = path.join(vault, 'L.md')
    await symlink(path.join(vault, 'nowhere.md'), to)
    expect(await putBack(trashed, to)).toMatchObject({ ok: false, error: { code: 'ALREADY_EXISTS', path: to } })
    expect((await lstat(to)).isSymbolicLink()).toBe(true)
    expect(await readFile(trashed, 'utf8')).toBe('the deleted note')
  })

  it('an entry of a `.Trashes/<uid>` folder that is not the Trash of that disk is refused (YAZ-3268 nit 1)', async () => {
    const fake = path.join(home.dir, 'other', '.Trashes', String(process.getuid?.() ?? 0))
    await mkdir(fake, { recursive: true })
    const trashed = path.join(fake, 'secret.md')
    await writeFile(trashed, 's')
    expect(await putBack(trashed, path.join(vault, 'secret.md'))).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(await readFile(trashed, 'utf8')).toBe('s')
  })
})
