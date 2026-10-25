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
type Expect = { op: 'copy' | 'cut'; paths: string[] }
/** `fs:paste` with the clip the window confirmed (YAZ-3266). */
const pasteAs = (targetDir: string, expect: Expect) => registered(CONTRACT.file.paste)({ sender: {} }, { targetDir, expect })
/** The window's paste (YAZ-3266): read `clip-state` fresh, then paste the clip that read confirmed. */
const paste = async (targetDir: string) => {
  const read = (await clipState()) as { ok: true; value: (Expect & { count: number }) | null }
  if (read.value === null) throw new Error('nothing on the clipboard: the window pastes nothing')
  return pasteAs(targetDir, { op: read.value.op, paths: read.value.paths })
}

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
    // A window that still shows the spent cut pastes nothing: main has no clip to match it (YAZ-3266).
    expect(await pasteAs(vault, { op: 'cut', paths: [pdf] })).toMatchObject({ ok: false, error: { code: 'CONFLICT', message: 'The clipboard changed. Paste again.' } })
  })

  it('a Finder Copy of hidden items only is nothing to paste', async () => {
    await layout()
    finderCopies(path.join(finder, '.DS_Store'))
    expect(await clipState()).toEqual({ ok: true, value: null })
  })
})

describe('YAZ-3266 (checker 2C1): the window is not told when the clipboard changes under it', () => {
  it("app Cut, then Finder Copy (the window reads it on focus), then text copied in the app: the paste must be what the window shows, or the window must hear of the change", async () => {
    await layout()
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    const pdf = path.join(vault, 'report.pdf')
    await clip('cut', pdf)
    vi.mocked(w.webContents.send).mockClear()
    finderCopies(path.join(finder, 'Note.md'))
    // The window comes back from Finder: its focus read caches this answer.
    const shown = await clipState()
    expect(shown).toEqual({ ok: true, value: { count: 1, op: 'copy', paths: [path.join(finder, 'Note.md')] } })
    // Text copied in the app's own editor: no focus event, and main pushes nothing.
    textCopied()
    const pushed = vi.mocked(w.webContents.send).mock.calls.length
    // A paste that names what the window showed (YAZ-3266: `expect`, as a window that did not read again would send it).
    const res = await pasteAs(path.join(vault, 'Plans'), { op: 'copy', paths: [path.join(finder, 'Note.md')] })
    // The window shows a COPY of Note.md. It must not get a MOVE of report.pdf without being told.
    const movedPdf = JSON.stringify(res).includes('report.pdf')
    expect({ pushed, movedPdf }).not.toEqual({ pushed: 0, movedPdf: true })
    // Nothing pasted: main says the clipboard changed, and report.pdf stays where it was.
    expect(res).toEqual({ ok: false, error: { code: 'CONFLICT', message: 'The clipboard changed. Paste again.' } })
    expect(await readdir(vault)).toContain('report.pdf')
    expect(await readdir(path.join(vault, 'Plans'))).not.toContain('Note.md')
    // The window reads again at paste time: main answers the app's cut, and the paste of THAT clip moves it.
    expect(await clipState()).toEqual({ ok: true, value: { count: 1, op: 'cut', paths: [pdf] } })
    expect(await pasteAs(path.join(vault, 'Plans'), { op: 'cut', paths: [pdf] })).toMatchObject({ ok: true, value: { pasted: [{ from: pdf, to: path.join(vault, 'Plans', 'report.pdf') }] } })
  })

  it('a paste with no `expect`, or a bad one, is refused: a paste names the clip it is for', async () => {
    await layout()
    const pdf = path.join(vault, 'report.pdf')
    await clip('copy', pdf)
    const door = registered(CONTRACT.file.paste)
    expect(await door({ sender: {} }, { targetDir: vault })).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(await door({ sender: {} }, { targetDir: vault, expect: { op: 'move', paths: [pdf] } })).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(await door({ sender: {} }, { targetDir: vault, expect: { op: 'copy', paths: 'x' } })).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    // The verb is part of the clip: a Copy is not the Cut the window confirmed.
    expect(await pasteAs(path.join(vault, 'Plans'), { op: 'cut', paths: [pdf] })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await readdir(path.join(vault, 'Plans'))).not.toContain('report.pdf')
  })
})

describe('the paste target (checker nit, YAZ-3248 rulings): a paste writes only into a vault of the calling window', () => {
  it("a target no vault of the calling window holds is BAD_REQUEST: Finder's files and the app's own clip paste nothing there, and both clips stay", async () => {
    await layout()
    const outside = await mkdtemp(path.join(base, 'outside-'))
    // Finder's files, into a folder of no vault, and into Finder's own folder.
    finderCopies(path.join(finder, 'Note.md'))
    for (const target of [outside, finder]) {
      expect(await paste(target)).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST', path: target } })
    }
    expect(await readdir(outside)).toEqual([])
    expect((await readdir(finder)).sort()).toEqual(['.DS_Store', 'Note.md', 'Taken.md', 'Trip'])
    // The app's own Copy and Cut, into the same folder.
    const pdf = path.join(vault, 'report.pdf')
    for (const op of ['copy', 'cut'] as const) {
      await clip(op, pdf)
      expect(await paste(outside)).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST', path: outside } })
      expect(fileClip.get()).toEqual({ op, paths: [pdf] })
    }
    expect(await readdir(outside)).toEqual([])
    expect(await readFile(pdf, 'utf8')).toBe('pdf')
    // The vault is this window's: a sender that no window owns, or a window of another vault, pastes nothing into it.
    for (const id of [undefined, 'w-other']) {
      if (id !== undefined) store.upsertWindow({ ...entry, id, root: outside })
      senderWinId = id
      expect(await paste(path.join(vault, 'Plans'))).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    }
    store.removeWindow('w-other')
    expect(await readdir(path.join(vault, 'Plans'))).not.toContain('report.pdf')
    // A target that is not an absolute path is refused before the vault check.
    senderWinId = 'w-this'
    expect(await registered(CONTRACT.file.paste)({ sender: {} }, { targetDir: 42, expect: { op: 'cut', paths: [pdf] } })).toMatchObject({ ok: false, error: { code: 'NOT_ABSOLUTE' } })
    expect(await readFile(pdf, 'utf8')).toBe('pdf')
  })

  it("a target in the window's vault, its root, or its second vault still pastes", async () => {
    await layout()
    const second = await mkdtemp(path.join(base, 'second-'))
    store.upsertWindow({ ...entry, id: 'w-this', root: vault, roots: [vault, second] })
    finderCopies(path.join(finder, 'Note.md'))
    for (const target of [vault, path.join(vault, 'Plans'), second]) {
      expect(await paste(target)).toMatchObject({ ok: true, value: { pasted: [{ to: path.join(target, 'Note.md') }], failed: [] } })
    }
    await clip('cut', path.join(vault, 'report.pdf'))
    expect(await paste(path.join(vault, 'Plans', 'Trip'))).toMatchObject({ ok: true, value: { pasted: [{ to: path.join(vault, 'Plans', 'Trip', 'report.pdf') }] } })
  })
})
