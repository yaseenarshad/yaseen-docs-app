import path from 'node:path'
import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import type { OpenDrawingResponse, PickFolderResponse, PickPicturesFolderResponse, SaveDrawingResponse } from '@shared/types'
import { CONTRACT } from '@shared/ipc'
import { isDrawing } from '@shared/fileKind'
import { isValidPicturesFolder } from '@shared/drawingAssets'
import { BOARDS } from '../fs/boardDocument'
import { readBoundedRegularFile } from '../fs/boundedRead'
import { printSvgToPdf } from '../drawings/printPdf'
import { atomicWrite, BridgeFailure, fsCall, requireAbsPath } from '../fs/fsUtils'
import { blockedPicturesFolder, PICTURE_FOLDERS_FULL, realFolder } from '../fs/picturesFolders'
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

/** A board's own pictures folder (YAZ-3943 demo round 3); `defaultPath` is set per call. */
const PICTURES_FOLDER_OPTIONS: Electron.OpenDialogOptions = { title: 'Choose a folder for the pictures', properties: ['openDirectory', 'createDirectory'] }

/** What the refusal of a picked folder says — the renderer shows it as it is. */
export const PICTURES_FOLDER_ROOT = 'Pick a folder, not the vault itself.'
export const PICTURES_FOLDER_SYSTEM = "The app can't keep pictures in a system folder. Pick another folder."
export const PICTURES_FOLDER_HIDDEN = "A hidden folder, or node_modules, can't hold a board's pictures. Pick another folder."

/**
 * `window.yaseenDocs.pickPicturesFolder({ root, current? })` (YAZ-3943 demo round 3): the cog's "Choose a folder…" and
 * Settings › Files & Links › "In a folder you pick". `pickFolder`'s dialog, opened on the board's current folder or the
 * vault root, answering the pick RELATIVE to `root` with `/` separators when it is inside the vault, and ABSOLUTE when
 * it is outside — the shapes the `yaseendraw` block and the setting store. The user's own pick is the one thing that
 * lets the app write outside the vault. Settings' pick (`approveNow`) goes to `approve` (the store's approved list) at
 * once. The cog's goes to `remember` only: its confirmed move approves it (`ipc/board.ts`), so a Cancel in the box
 * approves nothing (YAZ-4074 6A item 3). The vault itself, a system
 * folder (`blockedPicturesFolder`) or a folder `isValidPicturesFolder` refuses is `BAD_REQUEST` with the one-line reason;
 * no picture is written here. One sheet per window, as `pickFolder`.
 */
export async function pickPicturesFolder(e: IpcMainInvokeEvent, inFlight: Set<BrowserWindow | null>, body: unknown, approve: (folder: string) => boolean = () => true, remember: (folder: string) => void = () => undefined): Promise<PickPicturesFolderResponse> {
  const req = requireRequest(body)
  const root = requireAbsPath(req.root, 'root')
  const { current } = req
  const options = { ...PICTURES_FOLDER_OPTIONS, defaultPath: isValidPicturesFolder(current) ? (path.isAbsolute(current) ? current : path.join(root, ...current.split('/'))) : root }
  const win = BrowserWindow.fromWebContents(e.sender)
  if (inFlight.has(win)) return { cancelled: true }
  inFlight.add(win)
  let result: Electron.OpenDialogReturnValue
  try {
    result = await (win === null ? dialog.showOpenDialog(options) : dialog.showOpenDialog(win, options))
  } catch (err) {
    throw new BridgeFailure('PICKER_FAILED', err instanceof Error ? err.message : String(err))
  } finally {
    inFlight.delete(win)
  }
  const picked = result.filePaths[0]
  if (result.canceled || picked === undefined) return { cancelled: true }
  // Real places on both sides (YAZ-4074 6A item 4): a link to a system folder is that folder, and a link in the vault that leads out is outside.
  const abs = await realFolder(path.resolve(picked))
  if (blockedPicturesFolder(abs)) throw new BridgeFailure('BAD_REQUEST', PICTURES_FOLDER_SYSTEM, { path: abs })
  const rel = path.relative(await realFolder(root), abs)
  if (rel === '') throw new BridgeFailure('BAD_REQUEST', PICTURES_FOLDER_ROOT, { path: abs })
  const inside = !rel.startsWith('..') && !path.isAbsolute(rel)
  const folder = inside ? rel.split(path.sep).join('/') : abs
  if (!isValidPicturesFolder(folder)) throw new BridgeFailure('BAD_REQUEST', PICTURES_FOLDER_HIDDEN, { path: abs })
  if (inside) return { folder }
  // A full list refuses the add in one line (YAZ-4074 6A item 21).
  if (req.approveNow !== true) remember(abs)
  else if (!approve(abs)) throw new BridgeFailure('BAD_REQUEST', PICTURE_FOLDERS_FULL, { path: abs })
  return { folder }
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

/** A drawing's PDF (YAZ-3943 D6). */
const SAVE_PDF_OPTIONS: Omit<Electron.SaveDialogOptions, 'defaultPath'> = {
  title: 'Export PDF',
  filters: [{ name: 'PDF', extensions: ['pdf'] }],
  properties: ['createDirectory', 'showOverwriteConfirmation'],
}

const isSide = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

/**
 * `window.yaseenDocs.dialog.savePdf(req)` (YAZ-3943 D6): the PDF button. `saveDrawingFile`'s one-door
 * rule — the sheet, then the write, in the same call, one sheet per window — with `.pdf` enforced. The
 * PDF is printed from the SVG only once a place is picked (`printSvgToPdf`, one hidden window).
 */
export async function savePdfFile(e: IpcMainInvokeEvent, inFlight: Set<BrowserWindow | null>, body: unknown, print = printSvgToPdf): Promise<SaveDrawingResponse> {
  const { svg, width, height, ...rest } = requireRequest(body)
  const defaultName = str(rest.defaultName, 'defaultName')
  if (typeof svg !== 'string' || !svg.trimStart().startsWith('<svg')) throw new BridgeFailure('BAD_REQUEST', "'svg' must be an SVG document")
  if (!isSide(width) || !isSide(height)) throw new BridgeFailure('BAD_REQUEST', "'width' and 'height' must be positive numbers")
  const file = await showSave(e, inFlight, { ...SAVE_PDF_OPTIONS, defaultPath: defaultName })
  if (file === null) return { cancelled: true }
  if (path.extname(file).toLowerCase() !== '.pdf') throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'a PDF exports as .pdf', { path: file })
  // YAZ-4071 7Q: the PDF's Title is the name picked for the file
  const pdf = await print(svg, { width, height }, path.basename(file, path.extname(file)))
  await fsCall(file, () => atomicWrite(file, pdf))
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

/**
 * `print` is the PDF maker: the hidden window's, or a test's. `approve` puts a picked outside pictures folder on the store's
 * list (YAZ-3943 demo round 3); `remember` keeps the cog's pick until its move is confirmed (YAZ-4074 6A item 3).
 */
export function registerDialogIpc(print = printSvgToPdf, approve: (folder: string) => boolean = () => true, remember: (folder: string) => void = () => undefined): void {
  const inFlight = new Set<BrowserWindow | null>()
  handleWithEvent(CONTRACT.pickFolder, (e) => pickFolder(e, inFlight))
  handleWithEvent(CONTRACT.pickPicturesFolder, (e, body: unknown) => pickPicturesFolder(e, inFlight, body, approve, remember))
  handleWithEvent(CONTRACT.dialog.saveDrawing, (e, body: unknown) => saveDrawingFile(e, inFlight, body))
  handleWithEvent(CONTRACT.dialog.saveImage, (e, body: unknown) => saveImageFile(e, inFlight, body))
  handleWithEvent(CONTRACT.dialog.savePdf, (e, body: unknown) => savePdfFile(e, inFlight, body, print))
  handleWithEvent(CONTRACT.dialog.openDrawing, (e) => openDrawingFile(e, inFlight))
}
