import path from 'node:path'
import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import type { OpenDrawingResponse, PickFolderResponse, SaveDrawingResponse } from '@shared/types'
import { CONTRACT } from '@shared/ipc'
import { isDrawing } from '@shared/fileKind'
import { BOARDS } from '../fs/boardDocument'
import { readBoundedRegularFile } from '../fs/boundedRead'
import { atomicWrite, BridgeFailure, fsCall } from '../fs/fsUtils'
import { requireRequest, str } from '../fs/validate'
import { handleWithEvent } from './envelope'

const OPTIONS: Electron.OpenDialogOptions = { title: 'Open folder', properties: ['openDirectory', 'createDirectory'] }

/**
 * `window.yaseenDocs.pickFolder()`: the native open-directory dialog, parented to the calling window.
 * One dialog in flight per window (`inFlight`; windowless senders share the `null` bucket): a second
 * call while that window's dialog is open resolves `{ cancelled: true }` — a benign no-op for the
 * renderer, same as dismissing the dialog — rather than stacking another sheet or rejecting.
 */
export async function pickFolder(e: IpcMainInvokeEvent, inFlight: Set<BrowserWindow | null>): Promise<PickFolderResponse> {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (inFlight.has(win)) return { cancelled: true }
  inFlight.add(win)
  let result: Electron.OpenDialogReturnValue
  try {
    result = await (win === null ? dialog.showOpenDialog(OPTIONS) : dialog.showOpenDialog(win, OPTIONS))
  } catch (err) {
    throw new BridgeFailure('PICKER_FAILED', err instanceof Error ? err.message : String(err))
  } finally {
    inFlight.delete(win)
  }
  const picked = result.filePaths[0]
  if (result.canceled || picked === undefined) return { cancelled: true }
  return { path: picked.replace(/\/+$/, '') || '/' }
}

/** The Components tab's Import sheet (YAZ-3038, Draw's YAZ-1833): one `.excalidraw`, never a folder. */
const OPEN_DRAWING_OPTIONS: Electron.OpenDialogOptions = { title: 'Import Excalidraw JSON', properties: ['openFile'], filters: [{ name: 'Excalidraw', extensions: ['excalidraw'] }] }

/**
 * `window.yaseenDocs.dialog.openDrawing()` (YAZ-3038, Draw's YAZ-1833): pick one `.excalidraw` and get its
 * bytes. The picked file lives OUTSIDE the vault and no other door reads an arbitrary absolute path, so
 * the dialog reads what the user has just chosen — bounded by `MAX_DRAWING_BYTES`, as `drawing:load` is,
 * because an imported scene may still embed its images. A picked file that is not a `.excalidraw` (a
 * filter can be defeated by typing a name) is `UNSUPPORTED_EXTENSION`. One sheet per window, as `pickFolder`.
 */
export async function openDrawingFile(e: IpcMainInvokeEvent, inFlight: Set<BrowserWindow | null>): Promise<OpenDrawingResponse> {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (inFlight.has(win)) return { cancelled: true }
  inFlight.add(win)
  let result: Electron.OpenDialogReturnValue
  try {
    result = await (win === null ? dialog.showOpenDialog(OPEN_DRAWING_OPTIONS) : dialog.showOpenDialog(win, OPEN_DRAWING_OPTIONS))
  } catch (err) {
    throw new BridgeFailure('PICKER_FAILED', err instanceof Error ? err.message : String(err))
  } finally {
    inFlight.delete(win)
  }
  const picked = result.filePaths[0]
  if (result.canceled || picked === undefined) return { cancelled: true }
  const file = path.resolve(picked)
  if (!isDrawing(file)) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'an import reads a .excalidraw', { path: file })
  const snapshot = await fsCall(file, () => readBoundedRegularFile(file, BOARDS.drawing.max, BOARDS.drawing.tooLarge))
  return { path: file, name: path.basename(file, path.extname(file)), content: snapshot.data.toString('utf8') }
}

/** The export sheet (Draw's 🔒 YAZ-1775 D3, YAZ-1821): one file, the extension it is getting, and no directory picking. */
const SAVE_DRAWING_OPTIONS: Omit<Electron.SaveDialogOptions, 'defaultPath'> = {
  title: 'Export Excalidraw Drawing',
  filters: [{ name: 'Excalidraw', extensions: ['excalidraw'] }],
  properties: ['createDirectory', 'showOverwriteConfirmation'],
}

/**
 * `window.yaseenDocs.dialog.saveDrawing(req)` (Draw's YAZ-1821, ported by YAZ-3028): the export sheet,
 * then the write. ONE DOOR, not "pick a path, then write it": the only path ever written is the one
 * the user has just typed into a native sheet, in the same call. The write is `atomicWrite`, and the
 * `.excalidraw` extension is enforced because a sheet lets a name be typed freely. The vault file is
 * not touched: the bytes come from the renderer, which assembled them from the live canvas. The
 * one-sheet-per-window rule is `pickFolder`'s, through the same `inFlight` set.
 */
export async function saveDrawingFile(e: IpcMainInvokeEvent, inFlight: Set<BrowserWindow | null>, body: unknown): Promise<SaveDrawingResponse> {
  const req = requireRequest(body)
  const defaultName = str(req.defaultName, 'defaultName')
  const { content } = req
  if (typeof content !== 'string') throw new BridgeFailure('BAD_REQUEST', "'content' must be a string")
  const file = await showSave(e, inFlight, { ...SAVE_DRAWING_OPTIONS, defaultPath: defaultName })
  if (file === null) return { cancelled: true }
  if (!isDrawing(file)) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'a drawing exports as .excalidraw', { path: file })
  await fsCall(file, () => atomicWrite(file, content))
  return { path: file }
}

/** Export Image… for a diagram (Draw's 🔒 YAZ-1802 D9): PNG first, the format Yasin reuses as content. */
const SAVE_IMAGE_OPTIONS: Omit<Electron.SaveDialogOptions, 'defaultPath'> = {
  title: 'Export Image',
  filters: [
    { name: 'PNG image', extensions: ['png'] },
    { name: 'SVG image', extensions: ['svg'] },
  ],
  properties: ['createDirectory', 'showOverwriteConfirmation'],
}

/** The data URL each picture arrives as, by the extension it is written under. */
const IMAGE_DATA_URL = { '.png': 'data:image/png;base64,', '.svg': 'data:image/svg+xml;base64,' } as const

/**
 * `window.yaseenDocs.dialog.saveImage(req)` (YAZ-3028, Draw's 🔒 YAZ-1802 D9): a diagram's Export Image… —
 * `saveDrawingFile`'s one-door rule with a PNG / SVG sheet. The name the user picks decides the
 * format; any other extension is refused, because a sheet lets a name be typed freely.
 */
export async function saveImageFile(e: IpcMainInvokeEvent, inFlight: Set<BrowserWindow | null>, body: unknown): Promise<SaveDrawingResponse> {
  const { png, svg, ...rest } = requireRequest(body)
  const defaultName = str(rest.defaultName, 'defaultName')
  if (typeof png !== 'string' || !png.startsWith(IMAGE_DATA_URL['.png'])) throw new BridgeFailure('BAD_REQUEST', "'png' must be a PNG data URL")
  if (typeof svg !== 'string' || !svg.startsWith(IMAGE_DATA_URL['.svg'])) throw new BridgeFailure('BAD_REQUEST', "'svg' must be an SVG data URL")
  const file = await showSave(e, inFlight, { ...SAVE_IMAGE_OPTIONS, defaultPath: defaultName })
  if (file === null) return { cancelled: true }
  const ext = path.extname(file).toLowerCase()
  if (ext !== '.png' && ext !== '.svg') throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'an image exports as .png or .svg', { path: file })
  const dataUrl = ext === '.png' ? png : svg
  await fsCall(file, () => atomicWrite(file, Buffer.from(dataUrl.slice(IMAGE_DATA_URL[ext].length), 'base64')))
  return { path: file }
}

/**
 * The native SAVE sheet parented to the calling window, under `pickFolder`'s one-sheet-per-window
 * rule (the same `inFlight` set): the absolute path picked, or null when the sheet was dismissed or
 * another one of this window is up.
 */
async function showSave(e: IpcMainInvokeEvent, inFlight: Set<BrowserWindow | null>, options: Electron.SaveDialogOptions): Promise<string | null> {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (inFlight.has(win)) return null
  inFlight.add(win)
  let result: Electron.SaveDialogReturnValue
  try {
    result = await (win === null ? dialog.showSaveDialog(options) : dialog.showSaveDialog(win, options))
  } catch (err) {
    throw new BridgeFailure('PICKER_FAILED', err instanceof Error ? err.message : String(err))
  } finally {
    inFlight.delete(win)
  }
  const picked = result.filePath
  return result.canceled || picked === undefined || picked === '' ? null : path.resolve(picked)
}

export function registerDialogIpc(): void {
  const inFlight = new Set<BrowserWindow | null>()
  handleWithEvent(CONTRACT.pickFolder, (e) => pickFolder(e, inFlight))
  handleWithEvent(CONTRACT.dialog.saveDrawing, (e, body: unknown) => saveDrawingFile(e, inFlight, body))
  handleWithEvent(CONTRACT.dialog.saveImage, (e, body: unknown) => saveImageFile(e, inFlight, body))
  handleWithEvent(CONTRACT.dialog.openDrawing, (e) => openDrawingFile(e, inFlight))
}
