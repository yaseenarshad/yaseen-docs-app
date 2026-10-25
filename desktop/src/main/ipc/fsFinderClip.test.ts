/**
 * Copy and paste between Finder and the sidebar (YAZ-3265 D13, D14): the app's Cut / Copy also
 * writes the system clipboard, and `fs:clip-state` / `fs:paste` take the newer of the two. Plain
 * node, temp folders; Electron's `clipboard` is an in-memory pasteboard, so no test touches the real one.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { CONTRACT, type Envelope } from '@shared/ipc'
import { makeFirstMac } from '../fs/testFixture'
import { createStore, type Store } from '../store'
import { fileClip } from '../fileClip'
import { _evictAll } from '../vaultIndex'
import { registerFsIpc } from './fs'

/** The stand-in pasteboard: one value per type. A write replaces everything, as on the Mac. */
const board = vi.hoisted(() => new Map<string, string>())
const TYPE = 'NSFilenamesPboardType'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  shell: { trashItem: vi.fn(async () => undefined) },
  nativeImage: { createFromBuffer: vi.fn() },
  screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ scaleFactor: 2 }) },
  clipboard: {
    read: vi.fn((type: string) => board.get(type) ?? ''),
    clear: vi.fn(() => board.clear()),
    writeBuffer: vi.fn((type: string, buffer: Buffer) => {
      board.clear()
      board.set(type, buffer.toString('utf8'))
    }),
  },
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
const clipState = () => registered(CONTRACT.file.clipState)({ sender: {} })
const clip = (op: 'copy' | 'cut', ...paths: string[]) => registered(CONTRACT.file.clip)({ sender: {} }, { op, paths })
const paste = (targetDir: string) => registered(CONTRACT.file.paste)({ sender: {} }, { targetDir })

/** Finder's Copy, as it writes the pasteboard: a plist of the paths. */
const finderCopies = (...paths: string[]) => {
  board.clear()
  board.set(TYPE, `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<array>\n${paths.map((p) => `\t<string>${p}</string>\n`).join('')}</array>\n</plist>\n`)
}
/** Text copied anywhere: the pasteboard holds no files. */
const textCopied = () => {
  board.clear()
  board.set('public.utf8-plain-text', 'hello')
}

let base: string
let store: Store
let senderWinId: string | undefined
const windows = { idFor: () => senderWinId, vaultNotice: vi.fn() }
let vault: string
let finder: string
const entry = { file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'files' as const, bounds: { x: 0, y: 0, width: 800, height: 600 } }

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'yd-fs-finder-clip-'))
  store = createStore(path.join(base, 'yaseendocs.json'))
  registerFsIpc(store, windows)
})
afterAll(async () => {
  _evictAll()
  await store.flush()
  await rm(base, { recursive: true, force: true })
})
afterEach(() => {
  board.clear()
  fileClip.clear()
  store.removeWindow('w-this')
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
})

/** A vault that gives IDs, where `Plans` holds `Taken.md` and a `Trip` folder; Finder holds a note, a folder with a note inside, `.DS_Store` and `Taken.md`. */
async function layout() {
  const at = await mkdtemp(path.join(base, 'case-'))
  vault = path.join(at, 'vault')
  finder = path.join(at, 'Downloads')
  await mkdir(path.join(vault, 'Plans', 'Trip'), { recursive: true })
  await mkdir(path.join(vault, '.yaseendocs'), { recursive: true })
  await mkdir(path.join(finder, 'Trip', 'Days'), { recursive: true })
  await Promise.all([
    writeFile(path.join(vault, '.yaseendocs', 'ids.json'), '{"enabled":true}'),
    writeFile(path.join(vault, 'Plans', 'Taken.md'), 'in the vault'),
    writeFile(path.join(vault, 'report.pdf'), 'pdf'),
    writeFile(path.join(finder, 'Note.md'), '# from finder\n'),
    writeFile(path.join(finder, 'Trip', 'Days', 'one.md'), 'day one'),
    writeFile(path.join(finder, '.DS_Store'), 'hidden'),
    writeFile(path.join(finder, 'Taken.md'), 'from finder'),
  ])
  await makeFirstMac(vault)
  store.upsertWindow({ ...entry, id: 'w-this', root: vault })
  senderWinId = 'w-this'
}

/** A `BrowserWindow` stand-in: only what the broadcaster touches. */
function fakeWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } }
}

describe('copy and paste with Finder (YAZ-3265 D13, D14)', () => {
  it("fs:clip also writes the paths to the system clipboard, so Finder's Paste takes them (S50); clip:changed is as before", async () => {
    await layout()
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    const paths = [path.join(vault, 'report.pdf'), path.join(vault, 'Plans')]
    await clip('cut', ...paths)
    expect(board.get(TYPE)).toContain(`<string>${paths[1]}</string>`)
    expect(w.webContents.send).toHaveBeenCalledExactlyOnceWith(CONTRACT.file.onClipChanged.channel, { count: 2, op: 'cut', paths })
    // The app's cut still waits for an in-app paste: the clipboard holds its own files, so it is the app's clip.
    expect(await clipState()).toEqual({ ok: true, value: { count: 2, op: 'cut', paths } })
  })

  it("S48, S44, S52: a Finder Copy after the app's is the newer: clip-state counts its files (a hidden item is not one); ⌘V copies them with their own names, a folder with its contents; Finder keeps them", async () => {
    await layout()
    await clip('copy', path.join(vault, 'report.pdf'))
    finderCopies(path.join(finder, 'Note.md'), path.join(finder, 'Trip'), path.join(finder, '.DS_Store'))
    const files = [path.join(finder, 'Note.md'), path.join(finder, 'Trip')]
    expect(await clipState()).toEqual({ ok: true, value: { count: 2, op: 'copy', paths: files } })
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    const plans = path.join(vault, 'Plans')
    const target = path.join(plans, 'Trip')
    expect(await paste(target)).toEqual({
      ok: true,
      value: {
        pasted: [
          // Its own name, in a vault that gives IDs: no built note name, no " copy" title (D14).
          { from: files[0], to: path.join(target, 'Note.md'), kind: 'file' },
          { from: files[1], to: path.join(target, 'Trip'), kind: 'dir' },
        ],
        failed: [],
      },
    })
    expect(await readFile(path.join(target, 'Note.md'), 'utf8')).toBe('# from finder\n') // the same bytes
    expect(await readFile(path.join(target, 'Trip', 'Days', 'one.md'), 'utf8')).toBe('day one')
    expect((await readdir(finder)).sort()).toEqual(['.DS_Store', 'Note.md', 'Taken.md', 'Trip']) // Finder keeps them
    expect(await readdir(target)).not.toContain('.DS_Store')
    // A copy: nothing to remap and nothing pushed; the app's own clip is untouched.
    expect(w.webContents.send).not.toHaveBeenCalled()
    expect(fileClip.get()).toEqual({ op: 'copy', paths: [path.join(vault, 'report.pdf')] })
  })

  it('S51: a Finder name that clashes in the target takes the next free name, a file and a folder alike', async () => {
    await layout()
    finderCopies(path.join(finder, 'Taken.md'), path.join(finder, 'Trip'))
    const plans = path.join(vault, 'Plans')
    expect(await paste(plans)).toEqual({
      ok: true,
      value: {
        pasted: [
          { from: path.join(finder, 'Taken.md'), to: path.join(plans, 'Taken copy.md'), kind: 'file' },
          { from: path.join(finder, 'Trip'), to: path.join(plans, 'Trip copy'), kind: 'dir' },
        ],
        failed: [],
      },
    })
    expect(await readFile(path.join(plans, 'Taken.md'), 'utf8')).toBe('in the vault') // never over anything
    expect(await readFile(path.join(plans, 'Taken copy.md'), 'utf8')).toBe('from finder')
    expect(await readFile(path.join(plans, 'Trip copy', 'Days', 'one.md'), 'utf8')).toBe('day one')
    // A Finder clip pastes again and again, as a copy does.
    expect(await paste(plans)).toMatchObject({ ok: true, value: { pasted: [{ to: path.join(plans, 'Taken copy 2.md') }, { to: path.join(plans, 'Trip copy 2') }] } })
  })

  it("S47: the app's Copy after Finder's is the newer: its own clip pastes", async () => {
    await layout()
    finderCopies(path.join(finder, 'Note.md'))
    const pdf = path.join(vault, 'report.pdf')
    await clip('copy', pdf)
    expect(await clipState()).toEqual({ ok: true, value: { count: 1, op: 'copy', paths: [pdf] } })
    expect(await paste(path.join(vault, 'Plans'))).toEqual({ ok: true, value: { pasted: [{ from: pdf, to: path.join(vault, 'Plans', 'report.pdf'), kind: 'file' }], failed: [] } })
  })

  it("S49: text copied after the app's Copy holds no files: the app's own clip pastes, as before", async () => {
    await layout()
    const pdf = path.join(vault, 'report.pdf')
    await clip('copy', pdf)
    textCopied()
    expect(await clipState()).toEqual({ ok: true, value: { count: 1, op: 'copy', paths: [pdf] } })
    expect(await paste(path.join(vault, 'Plans'))).toMatchObject({ ok: true, value: { pasted: [{ from: pdf }] } })
  })

  it("a Cut the app pasted is spent: the system clipboard is emptied of the moved files, so Finder's Paste finds no stale paths, and nothing is left to offer", async () => {
    await layout()
    const pdf = path.join(vault, 'report.pdf')
    await clip('cut', pdf)
    expect(await paste(path.join(vault, 'Plans'))).toMatchObject({ ok: true, value: { pasted: [{ from: pdf, to: path.join(vault, 'Plans', 'report.pdf') }] } })
    expect(fileClip.get()).toBeNull()
    expect(board.get(TYPE)).toBeUndefined()
    expect(await clipState()).toEqual({ ok: true, value: null })
    expect(await paste(vault)).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST', message: 'nothing to paste' } })
  })

  it('a Finder Copy of hidden items only is nothing to paste', async () => {
    await layout()
    finderCopies(path.join(finder, '.DS_Store'))
    expect(await clipState()).toEqual({ ok: true, value: null })
  })
})
