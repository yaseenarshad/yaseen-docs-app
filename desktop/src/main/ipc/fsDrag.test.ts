/**
 * Drags between Finder and the sidebar (YAZ-3252): `fs:import` moves Finder's items in (YAZ-3253
 * D3, D9A), and `fs:drag-out` hands rows to the OS drag (YAZ-3254 D4). Plain node, temp folders.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserWindow, ipcMain, nativeImage } from 'electron'
import { CONTRACT, type Envelope } from '@shared/ipc'
import { createStore, type Store } from '../store'
import { fileClip } from '../fileClip'
import { _evictAll, getIndex } from '../vaultIndex'
import { registerFsIpc } from './fs'

/** The items whose move fails as a move to another disk does (`EXDEV`): set per test. */
const otherDisk = vi.hoisted(() => new Set<string>())

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  shell: { trashItem: vi.fn(async () => undefined) },
  nativeImage: { createFromBuffer: vi.fn((buffer: Buffer, options: { scaleFactor: number }) => ({ image: buffer.length, ...options })) },
  screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ scaleFactor: 2 }) },
}))
// No watcher echo, ever: what the index holds after a door answers is what the door gave it (YAZ-3258).
vi.mock('../fs/watchers', () => ({ subscribe: vi.fn(() => () => undefined), activeWatcherRoots: () => [] }))
vi.mock('../favorites', () => ({ renamePath: vi.fn(async () => undefined), removePath: vi.fn(async () => undefined) }))
vi.mock('../focus', () => ({ renamePath: vi.fn(async () => undefined), removePath: vi.fn(async () => undefined) }))
// Another disk, injected (D9A): `fs.rename` across volumes fails `EXDEV`; a temp folder is on one disk.
vi.mock('../fs/rename', async (importOriginal) => {
  const real = await importOriginal<typeof import('../fs/rename')>()
  return {
    ...real,
    renameFile: async (req: { oldPath: string; newPath: string }) => {
      if (otherDisk.has(req.oldPath)) throw Object.assign(new Error(`EXDEV: cross-device link not permitted, rename '${req.oldPath}'`), { code: 'EXDEV' })
      return real.renameFile(req)
    },
  }
})

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>
const registered = (door: { channel: string }): Handler => {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === door.channel)
  if (call === undefined) throw new Error(`no handler registered for ${door.channel}`)
  return call[1] as unknown as Handler
}

let base: string
let store: Store
let senderWinId: string | undefined
const windows = { idFor: () => senderWinId, vaultNotice: vi.fn() }
/** This window's vault, another window's vault, and a Finder folder outside both. */
let vault: string
let other: string
let finder: string
const entry = { file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, bounds: { x: 0, y: 0, width: 800, height: 600 } }

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'yd-fs-drag-'))
  store = createStore(path.join(base, 'yaseendocs.json'))
  registerFsIpc(store, windows)
})
afterAll(async () => {
  await store.flush()
  await rm(base, { recursive: true, force: true })
})
afterEach(() => {
  otherDisk.clear()
  senderWinId = undefined
  store.removeWindow('w-this')
  store.removeWindow('w-other')
})

/** A fresh layout: `vault/Plans` holds `Taken.md`; `other/Elsewhere.md`; Finder holds a note, a folder with a note inside, `.DS_Store` and `Taken.md`. */
async function layout() {
  const at = await mkdtemp(path.join(base, 'case-'))
  vault = path.join(at, 'vault')
  other = path.join(at, 'other')
  finder = path.join(at, 'Downloads')
  await mkdir(path.join(vault, 'Plans'), { recursive: true })
  await mkdir(other)
  await mkdir(path.join(finder, 'Trip', 'Days'), { recursive: true })
  await Promise.all([
    writeFile(path.join(vault, 'Plans', 'Taken.md'), 'in the vault'),
    writeFile(path.join(other, 'Elsewhere.md'), 'other vault'),
    writeFile(path.join(finder, 'Note.md'), 'from finder'),
    writeFile(path.join(finder, 'Trip', 'Days', 'one.md'), 'day one'),
    writeFile(path.join(finder, '.DS_Store'), 'hidden'),
    writeFile(path.join(finder, 'Taken.md'), 'from finder'),
  ])
  store.upsertWindow({ ...entry, id: 'w-this', root: vault })
  store.upsertWindow({ ...entry, id: 'w-other', root: other })
  senderWinId = 'w-this'
}

/** A `BrowserWindow` stand-in: only what the broadcaster touches. */
function fakeWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } }
}

describe('fs:import (YAZ-3253 D3, D9A)', () => {
  const importInto = (paths: string[], targetDir: string) => registered(CONTRACT.file.import)({ sender: {} }, { paths, targetDir })

  it('moves a note and a folder with its contents in, through the paste move verb (S17, S24); a hidden item is skipped with no row (S20); the app clipboard is untouched', async () => {
    await layout()
    const clip = { op: 'copy' as const, paths: [path.join(vault, 'Plans', 'Taken.md')] }
    fileClip.set(clip)
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    const plans = path.join(vault, 'Plans')
    const res = await importInto([path.join(finder, 'Note.md'), path.join(finder, 'Trip'), path.join(finder, '.DS_Store')], plans)
    expect(res).toEqual({
      ok: true,
      value: {
        moved: [
          { from: path.join(finder, 'Note.md'), to: path.join(plans, 'Note.md'), kind: 'file' },
          { from: path.join(finder, 'Trip'), to: path.join(plans, 'Trip'), kind: 'dir' },
        ],
        copied: [],
        failed: [],
      },
    })
    expect(await readFile(path.join(plans, 'Trip', 'Days', 'one.md'), 'utf8')).toBe('day one')
    expect((await readdir(finder)).sort()).toEqual(['.DS_Store', 'Taken.md']) // they left Finder; the hidden one stayed
    // The paste's move verb: `file:renamed` to every window, once per item. No clip:changed.
    expect(w.webContents.send.mock.calls.map(([channel]) => channel)).toEqual([CONTRACT.file.onRenamed.channel, CONTRACT.file.onRenamed.channel])
    expect(fileClip.get()).toEqual(clip)
    fileClip.clear()
  })

  it('an item on another disk is copied in under its own name and stays in Finder (S18); a clash stays in Finder and is named (S19)', async () => {
    await layout()
    const plans = path.join(vault, 'Plans')
    otherDisk.add(path.join(finder, 'Trip'))
    const res = await importInto([path.join(finder, 'Note.md'), path.join(finder, 'Trip'), path.join(finder, 'Taken.md')], plans)
    expect(res).toEqual({
      ok: true,
      value: {
        moved: [{ from: path.join(finder, 'Note.md'), to: path.join(plans, 'Note.md'), kind: 'file' }],
        copied: [{ from: path.join(finder, 'Trip'), to: path.join(plans, 'Trip'), kind: 'dir' }],
        failed: [{ from: path.join(finder, 'Taken.md'), code: 'ALREADY_EXISTS', message: 'a file with this name already exists' }],
      },
    })
    expect(await readFile(path.join(plans, 'Trip', 'Days', 'one.md'), 'utf8')).toBe('day one')
    expect(await readFile(path.join(finder, 'Trip', 'Days', 'one.md'), 'utf8')).toBe('day one') // a copy: the original stays
    expect(await readFile(path.join(plans, 'Taken.md'), 'utf8')).toBe('in the vault') // never over anything
    expect(await readFile(path.join(finder, 'Taken.md'), 'utf8')).toBe('from finder')
  })

  it('refuses an item inside another vault the app has open, and moves the rest (S22); a target in no vault of the window is refused whole', async () => {
    await layout()
    const plans = path.join(vault, 'Plans')
    const res = await importInto([path.join(other, 'Elsewhere.md'), path.join(finder, 'Note.md')], plans)
    expect(res).toEqual({
      ok: true,
      value: {
        moved: [{ from: path.join(finder, 'Note.md'), to: path.join(plans, 'Note.md'), kind: 'file' }],
        copied: [],
        failed: [{ from: path.join(other, 'Elsewhere.md'), code: 'BAD_REQUEST', message: 'To move between vaults, use cut and paste' }],
      },
    })
    expect(await readdir(other)).toEqual(['Elsewhere.md'])
    expect(await importInto([path.join(finder, 'Taken.md')], other)).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(await importInto(['relative.md'], plans)).toMatchObject({ ok: false, error: { code: 'NOT_ABSOLUTE' } })
    expect(await readFile(path.join(finder, 'Taken.md'), 'utf8')).toBe('from finder')
  })
  it('refuses a Finder folder that holds a vault open in any window, as one vault cannot be inside another; the rest move (audit 8)', async () => {
    await layout()
    store.upsertWindow({ ...entry, id: 'w-other', root: path.join(finder, 'Trip', 'Days') })
    const plans = path.join(vault, 'Plans')
    const res = await importInto([path.join(finder, 'Trip'), path.join(finder, 'Note.md')], plans)
    expect(res).toEqual({
      ok: true,
      value: {
        moved: [{ from: path.join(finder, 'Note.md'), to: path.join(plans, 'Note.md'), kind: 'file' }],
        copied: [],
        failed: [{ from: path.join(finder, 'Trip'), code: 'BAD_REQUEST', message: 'it holds a vault that is open' }],
      },
    })
    expect(await readFile(path.join(finder, 'Trip', 'Days', 'one.md'), 'utf8')).toBe('day one')
  })
})

describe('fs:drag-out (YAZ-3254 D4)', () => {
  /** A real PNG's first bytes are enough: main checks the data URL, not the picture. */
  const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')}`

  it("starts the OS drag for the calling window's rows, with the pill at the screen's scale", async () => {
    await layout()
    const startDrag = vi.fn()
    const paths = [path.join(vault, 'Plans', 'Taken.md'), path.join(vault, 'Plans')]
    expect(await registered(CONTRACT.file.dragOut)({ sender: { startDrag } }, { paths, icon: PNG })).toEqual({ ok: true, value: undefined })
    expect(startDrag).toHaveBeenCalledExactlyOnceWith({ file: paths[0], files: paths, icon: { image: 11, scaleFactor: 2 } })
    expect(nativeImage.createFromBuffer).toHaveBeenCalledOnce()
  })

  it('in the hidden e2e mode it starts no OS drag, which would take the real mouse: it records the paths for the e2e instead (audit 5)', async () => {
    await layout()
    const startDrag = vi.fn()
    const paths = [path.join(vault, 'Plans', 'Taken.md')]
    vi.stubEnv('YASEEN_DOCS_E2E_HIDDEN', '1')
    try {
      expect(await registered(CONTRACT.file.dragOut)({ sender: { startDrag } }, { paths, icon: PNG })).toEqual({ ok: true, value: undefined })
    } finally {
      vi.unstubAllEnvs()
    }
    expect(startDrag).not.toHaveBeenCalled()
    expect((globalThis as { e2eDragOuts?: string[][] }).e2eDragOuts?.at(-1)).toEqual(paths)
  })

  it('refuses a path that does not exist, and starts no drag (audit 18)', async () => {
    await layout()
    const startDrag = vi.fn()
    expect(await registered(CONTRACT.file.dragOut)({ sender: { startDrag } }, { paths: [path.join(vault, 'Plans', 'Gone.md')], icon: PNG })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(startDrag).not.toHaveBeenCalled()
  })

  it.each([
    ['a relative path', () => ({ paths: ['Plans/Taken.md'], icon: PNG })],
    ['no path', () => ({ paths: [], icon: PNG })],
    ["a path in another window's vault", () => ({ paths: [path.join(other, 'Elsewhere.md')], icon: PNG })],
    ['a path in no vault', () => ({ paths: [path.join(finder, 'Note.md')], icon: PNG })],
    ['a vault itself', () => ({ paths: [vault], icon: PNG })],
    ['an icon that is no PNG data URL', () => ({ paths: [path.join(vault, 'Plans', 'Taken.md')], icon: 'data:image/jpeg;base64,AAAA' })],
    ['an icon of 64 KB or more', () => ({ paths: [path.join(vault, 'Plans', 'Taken.md')], icon: `data:image/png;base64,${'A'.repeat(64 * 1024)}` })],
  ])('refuses %s and starts no drag', async (_, req) => {
    await layout()
    const startDrag = vi.fn()
    expect(await registered(CONTRACT.file.dragOut)({ sender: { startDrag } }, req())).toMatchObject({ ok: false, error: { code: expect.stringMatching(/^(BAD_REQUEST|NOT_ABSOLUTE)$/) } })
    expect(startDrag).not.toHaveBeenCalled()
  })
})

describe('the index takes an in-app move and a tidy-up write at once (YAZ-3258, audit 1)', () => {
  const rename = (oldPath: string, newPath: string) => registered(CONTRACT.file.rename)({ sender: {} }, { oldPath, newPath })
  const write = (req: { path: string; content: string; quiet?: boolean }) => registered(CONTRACT.writeFile)({ sender: {} }, req)
  const record = async (p: string) => (await getIndex(vault)).records.find((r) => r.path === p)
  afterEach(() => _evictAll())

  it('a note moved by `fs:rename` is at its new path in the next `getIndex`, with its links: the next move of a gesture finds it there (S3)', async () => {
    await layout()
    const x = path.join(vault, 'X.md')
    await writeFile(x, 'See [[Plans/Y]].')
    await getIndex(vault)
    expect(await rename(x, path.join(vault, 'Plans', 'X.md'))).toMatchObject({ ok: true })
    expect(await record(x)).toBeUndefined()
    expect(await record(path.join(vault, 'Plans', 'X.md'))).toMatchObject({ folder: 'Plans', links: ['Plans/Y'] })
  })

  it("a folder moved by `fs:rename` takes its notes along, each with the new path and folder; a folder's settings file is read again (it is titled by its folder)", async () => {
    await layout()
    await mkdir(path.join(vault, 'Archive'))
    await writeFile(path.join(vault, 'Plans', '.folder.md'), '---\nstatus: open\n---\n')
    await getIndex(vault)
    expect(await rename(path.join(vault, 'Plans'), path.join(vault, 'Archive', 'Done'))).toMatchObject({ ok: true })
    const { records, folders } = await getIndex(vault)
    expect(records.map((r) => [r.path, r.folder])).toEqual([[path.join(vault, 'Archive', 'Done', 'Taken.md'), 'Archive/Done']])
    expect(folders.map((r) => [r.path, r.title])).toEqual([[path.join(vault, 'Archive', 'Done', '.folder.md'), 'Done']])
  })

  it('a Finder item moved in by `fs:import` is in the next `getIndex`, a folder with each note inside it', async () => {
    await layout()
    await getIndex(vault)
    const plans = path.join(vault, 'Plans')
    await registered(CONTRACT.file.import)({ sender: {} }, { paths: [path.join(finder, 'Note.md'), path.join(finder, 'Trip')], targetDir: plans })
    expect((await getIndex(vault)).records.map((r) => r.path)).toEqual([path.join(plans, 'Note.md'), path.join(plans, 'Taken.md'), path.join(plans, 'Trip', 'Days', 'one.md')])
  })

  it("a quiet write (a link rewrite) is in the next `getIndex`: a quick ⌘Z finds the note that links to the new path (S33). A user's edit waits for the watcher", async () => {
    await layout()
    const z = path.join(vault, 'Z.md')
    await writeFile(z, 'See [[Plans/Y]].')
    await getIndex(vault)
    expect(await write({ path: z, content: 'See [[Archive/Y]].', quiet: true })).toMatchObject({ ok: true })
    expect(await record(z)).toMatchObject({ links: ['Archive/Y'] })
    expect(await write({ path: z, content: 'See [[Elsewhere/Y]].' })).toMatchObject({ ok: true })
    expect(await record(z)).toMatchObject({ links: ['Archive/Y'] })
  })
})
