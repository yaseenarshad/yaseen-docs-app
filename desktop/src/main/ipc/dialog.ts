import path from 'node:path'
import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import type { PickFolderResponse, SaveDrawingResponse } from '@shared/types'
import { CONTRACT } from '@shared/ipc'
import { isDrawing } from '@shared/fileKind'
import { atomicWrite, BridgeFailure, fsCall } from '../fs/fsUtils'
import { requireRequest } from '../fs/validate'
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
  const { defaultName, content } = req
  if (typeof defaultName !== 'string' || defaultName === '') throw new BridgeFailure('BAD_REQUEST', "'defaultName' must be a non-empty string")
  if (typeof content !== 'string') throw new BridgeFailure('BAD_REQUEST', "'content' must be a string")
  const win = BrowserWindow.fromWebContents(e.sender)
  if (inFlight.has(win)) return { cancelled: true }
  inFlight.add(win)
  let result: Electron.SaveDialogReturnValue
  try {
    const options = { ...SAVE_DRAWING_OPTIONS, defaultPath: defaultName }
    result = await (win === null ? dialog.showSaveDialog(options) : dialog.showSaveDialog(win, options))
  } catch (err) {
    throw new BridgeFailure('PICKER_FAILED', err instanceof Error ? err.message : String(err))
  } finally {
    inFlight.delete(win)
  }
  const picked = result.filePath
  if (result.canceled || picked === undefined || picked === '') return { cancelled: true }
  const file = path.resolve(picked)
  if (!isDrawing(file)) throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'a drawing exports as .excalidraw', { path: file })
  await fsCall(file, () => atomicWrite(file, content))
  return { path: file }
}

export function registerDialogIpc(): void {
  const inFlight = new Set<BrowserWindow | null>()
  handleWithEvent(CONTRACT.pickFolder, (e) => pickFolder(e, inFlight))
  handleWithEvent(CONTRACT.dialog.saveDrawing, (e, body: unknown) => saveDrawingFile(e, inFlight, body))
}
