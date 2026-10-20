import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { CONTRACT, type Envelope } from '@shared/ipc'
import { registerDialogIpc } from './dialog'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
}))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>

function registered(channel: string): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`no handler registered for ${channel}`)
  return call[1] as unknown as Handler
}

const showOpenDialog = vi.mocked(dialog.showOpenDialog)
const fromWebContents = vi.mocked(BrowserWindow.fromWebContents)
const sender = { id: 1 }

beforeEach(() => {
  vi.mocked(ipcMain.handle).mockClear()
  showOpenDialog.mockReset()
  fromWebContents.mockReset().mockReturnValue(null)
  registerDialogIpc()
})

const pick = () => registered(CONTRACT.pickFolder.channel)({ sender })
const open = () => registered(CONTRACT.dialog.openDrawing.channel)({ sender })

describe('dialog:pick-folder', () => {
  it('registers exactly the pick-folder, the two export channels and the import (YAZ-3038)', () => {
    expect(vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch)).toEqual([CONTRACT.pickFolder.channel, CONTRACT.dialog.saveDrawing.channel, CONTRACT.dialog.saveImage.channel, CONTRACT.dialog.openDrawing.channel])
  })

  it('opens an openDirectory dialog parented to the calling window and answers { path }', async () => {
    const win = { id: 'w' } as unknown as BrowserWindow
    fromWebContents.mockReturnValue(win)
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/Users/x/vault'] })
    expect(await pick()).toEqual({ ok: true, value: { path: '/Users/x/vault' } })
    expect(fromWebContents).toHaveBeenCalledWith(sender)
    expect(showOpenDialog).toHaveBeenCalledWith(win, { title: 'Open folder', properties: ['openDirectory', 'createDirectory'] })
  })

  it('falls back to an unparented dialog when the sender has no window', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/Users/x/vault'] })
    expect(await pick()).toEqual({ ok: true, value: { path: '/Users/x/vault' } })
    expect(showOpenDialog).toHaveBeenCalledWith({ title: 'Open folder', properties: ['openDirectory', 'createDirectory'] })
  })

  it('answers { cancelled: true } when the dialog is dismissed or returns no path', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await pick()).toEqual({ ok: true, value: { cancelled: true } })
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] })
    expect(await pick()).toEqual({ ok: true, value: { cancelled: true } })
  })

  it('strips trailing slashes from the picked path, except for the filesystem root', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/Users/x/vault//'] })
    expect(await pick()).toEqual({ ok: true, value: { path: '/Users/x/vault' } })
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/'] })
    expect(await pick()).toEqual({ ok: true, value: { path: '/' } })
  })

  it('a dialog failure comes out as PICKER_FAILED', async () => {
    showOpenDialog.mockRejectedValue(new Error('no display'))
    expect(await pick()).toEqual({ ok: false, error: { code: 'PICKER_FAILED', message: 'no display' } })
  })
})

/** The Components tab's Import (YAZ-3038, ported from Draw's YAZ-1833 tests). */
describe('dialog:open-file', () => {
  let dir = ''
  const file = async (name: string, content: string) => {
    if (dir === '') dir = await mkdtemp(path.join(tmpdir(), 'yd-dialog-open-'))
    const p = path.join(dir, name)
    await writeFile(p, content, 'utf8')
    return p
  }
  afterAll(() => (dir === '' ? undefined : rm(dir, { recursive: true, force: true })))

  it('opens an openFile dialog filtered to .excalidraw, parented to the calling window, and answers the bytes', async () => {
    const win = { id: 'w' } as unknown as BrowserWindow
    fromWebContents.mockReturnValue(win)
    const picked = await file('03 Legacy embedded.excalidraw', '{"type":"excalidraw","elements":[]}')
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [picked] })
    expect(await open()).toEqual({ ok: true, value: { path: picked, name: '03 Legacy embedded', content: '{"type":"excalidraw","elements":[]}' } })
    expect(showOpenDialog).toHaveBeenCalledWith(win, { title: 'Import Excalidraw JSON', properties: ['openFile'], filters: [{ name: 'Excalidraw', extensions: ['excalidraw'] }] })
  })

  it('a dismissal is { cancelled: true }; a typed name that is not .excalidraw is UNSUPPORTED_EXTENSION; a file gone before the read is NOT_FOUND', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await open()).toEqual({ ok: true, value: { cancelled: true } })
    const notes = await file('notes.txt', 'hello')
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [notes] })
    expect(await open()).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_EXTENSION', path: notes } })
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [path.join(tmpdir(), 'yd-dialog-missing', 'gone.excalidraw')] })
    expect(await open()).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  })

  it('shares the one-dialog-in-flight guard with the folder picker', async () => {
    let settle!: (v: Electron.OpenDialogReturnValue) => void
    showOpenDialog.mockReturnValueOnce(new Promise<Electron.OpenDialogReturnValue>((r) => (settle = r)))
    const first = pick()
    expect(await open()).toEqual({ ok: true, value: { cancelled: true } })
    expect(showOpenDialog).toHaveBeenCalledTimes(1)
    settle({ canceled: true, filePaths: [] })
    expect(await first).toEqual({ ok: true, value: { cancelled: true } })
  })
})

describe('one dialog in flight per window', () => {
  /** A dialog the test settles by hand, so a pick can be held open mid-flight. */
  function pendingDialog() {
    let settle!: (v: Electron.OpenDialogReturnValue) => void
    showOpenDialog.mockReturnValueOnce(
      new Promise<Electron.OpenDialogReturnValue>((r) => {
        settle = r
      }),
    )
    return { settle }
  }

  it('a second call while a dialog is open for the window resolves { cancelled: true }; the guard lifts when it settles', async () => {
    const win = { id: 'w' } as unknown as BrowserWindow
    fromWebContents.mockReturnValue(win)
    const { settle } = pendingDialog()
    const first = pick()
    expect(await pick()).toEqual({ ok: true, value: { cancelled: true } })
    expect(showOpenDialog).toHaveBeenCalledTimes(1)
    settle({ canceled: false, filePaths: ['/Users/x/vault'] })
    expect(await first).toEqual({ ok: true, value: { path: '/Users/x/vault' } })
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/Users/x/other'] })
    expect(await pick()).toEqual({ ok: true, value: { path: '/Users/x/other' } })
  })

  it('windows are guarded independently — a dialog open for one does not block another', async () => {
    const a = { id: 'a' } as unknown as BrowserWindow
    const b = { id: 'b' } as unknown as BrowserWindow
    fromWebContents.mockReturnValueOnce(a).mockReturnValueOnce(b)
    const heldA = pendingDialog()
    const heldB = pendingDialog()
    const pickA = pick()
    const pickB = pick()
    expect(showOpenDialog).toHaveBeenCalledTimes(2)
    heldA.settle({ canceled: false, filePaths: ['/vault/a'] })
    heldB.settle({ canceled: false, filePaths: ['/vault/b'] })
    expect(await pickA).toEqual({ ok: true, value: { path: '/vault/a' } })
    expect(await pickB).toEqual({ ok: true, value: { path: '/vault/b' } })
  })

  it('windowless senders share one guard bucket', async () => {
    const { settle } = pendingDialog()
    const first = pick()
    expect(await pick()).toEqual({ ok: true, value: { cancelled: true } })
    expect(showOpenDialog).toHaveBeenCalledTimes(1)
    settle({ canceled: true, filePaths: [] })
    expect(await first).toEqual({ ok: true, value: { cancelled: true } })
  })

  it('the guard lifts on dialog failure too', async () => {
    showOpenDialog.mockRejectedValueOnce(new Error('no display'))
    expect(await pick()).toEqual({ ok: false, error: { code: 'PICKER_FAILED', message: 'no display' } })
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/Users/x/vault'] })
    expect(await pick()).toEqual({ ok: true, value: { path: '/Users/x/vault' } })
  })
})

/** File › Export Drawing… (YAZ-3028, Draw's YAZ-1821): the sheet and the write are one door. */
describe('dialog:save-file', () => {
  const showSaveDialog = vi.mocked(dialog.showSaveDialog)
  const exportTo = (req: unknown) => registered(CONTRACT.dialog.saveDrawing.channel)({ sender }, req)
  let dir = ''
  beforeEach(async () => {
    showSaveDialog.mockReset()
    dir = await mkdtemp(path.join(tmpdir(), 'yaz-3028-export-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('writes the bytes where the user picked, opening on the board`s name; a dismissed sheet writes nothing', async () => {
    const file = path.join(dir, 'Flow.excalidraw')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: file })
    expect(await exportTo({ defaultName: 'Flow.excalidraw', content: '{"x":1}\n' })).toEqual({ ok: true, value: { path: file } })
    expect(showSaveDialog.mock.calls[0][0]).toMatchObject({ defaultPath: 'Flow.excalidraw' })
    expect(await readFile(file, 'utf8')).toBe('{"x":1}\n')
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })
    expect(await exportTo({ defaultName: 'Flow.excalidraw', content: 'other' })).toEqual({ ok: true, value: { cancelled: true } })
    expect(await readdir(dir)).toEqual(['Flow.excalidraw'])
  })

  it('refuses a typed name of any other kind and a malformed request, writing nothing', async () => {
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: path.join(dir, 'Flow.json') })
    expect(await exportTo({ defaultName: 'Flow.excalidraw', content: '{}' })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_EXTENSION' } })
    expect(await exportTo({ defaultName: '', content: '{}' })).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(await readdir(dir)).toEqual([])
  })

  it('a diagram`s Export Image… writes the PNG or the SVG by the picked extension, and nothing else', async () => {
    const image = (req: unknown) => registered(CONTRACT.dialog.saveImage.channel)({ sender }, req)
    const req = { defaultName: 'Flow.png', png: `data:image/png;base64,${Buffer.from('PNG').toString('base64')}`, svg: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}` }
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: path.join(dir, 'Flow.svg') })
    expect(await image(req)).toEqual({ ok: true, value: { path: path.join(dir, 'Flow.svg') } })
    expect(await readFile(path.join(dir, 'Flow.svg'), 'utf8')).toBe('<svg/>')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: path.join(dir, 'Flow.jpg') })
    expect(await image(req)).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_EXTENSION' } })
    expect(await image({ ...req, png: 'nope' })).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(await readdir(dir)).toEqual(['Flow.svg'])
  })
})
