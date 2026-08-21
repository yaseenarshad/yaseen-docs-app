import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import type { PickFolderResponse } from '@shared/types'
import { CH } from '../../channels'
import { BridgeFailure } from '../fs/fsUtils'
import { handleWithEvent } from './envelope'

const OPTIONS: Electron.OpenDialogOptions = { title: 'Open folder', properties: ['openDirectory', 'createDirectory'] }

/** `window.yaseenDocs.pickFolder()`: the native open-directory dialog, parented to the calling window. */
export async function pickFolder(e: IpcMainInvokeEvent): Promise<PickFolderResponse> {
  const win = BrowserWindow.fromWebContents(e.sender)
  let result: Electron.OpenDialogReturnValue
  try {
    result = await (win === null ? dialog.showOpenDialog(OPTIONS) : dialog.showOpenDialog(win, OPTIONS))
  } catch (err) {
    throw new BridgeFailure('PICKER_FAILED', err instanceof Error ? err.message : String(err))
  }
  const picked = result.filePaths[0]
  if (result.canceled || picked === undefined) return { cancelled: true }
  return { path: picked.replace(/\/+$/, '') || '/' }
}

export function registerDialogIpc(): void {
  handleWithEvent(CH.dialogPickFolder, pickFolder)
}
