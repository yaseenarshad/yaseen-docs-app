/**
 * This Mac's approved pictures folders (YAZ-3943 demo round 3): the folders OUTSIDE a vault that the app may write a
 * board's pictures to (`AppState.approvedPictureFolders`, the rule of `fs/picturesFolders.ts`). The folder window's pick
 * adds to it on its own (`ipc/dialog.ts`); these doors are for a board's "Allow this board's pictures folder?" sheet and
 * Settings › Files & Links › "Allowed picture folders". `allow` never trusts the renderer's path: the same shape check and
 * blocked-folder check as a pick. `remove` only takes a folder off the list; no file moves or goes.
 */
import path from 'node:path'
import { isValidPicturesFolder } from '@shared/drawingAssets'
import { CONTRACT } from '@shared/ipc'
import { BridgeFailure } from '../fs/fsUtils'
import { blockedPicturesFolder, PICTURE_FOLDERS_FULL, realFolder } from '../fs/picturesFolders'
import type { Store } from '../store'
import { handle } from './envelope'

/** What `allow` says of a path that is no outside folder the app may write to. */
export const FOLDER_REFUSED = "That folder can't hold a board's pictures."

export function registerPictureFoldersIpc(store: Pick<Store, 'get' | 'approvePictureFolder' | 'removePictureFolder'>): void {
  handle(CONTRACT.pictureFolders.list, async () => store.get().approvedPictureFolders)
  handle(CONTRACT.pictureFolders.allow, async (folder: unknown) => {
    // The real place: a symbolic link to a system folder is that folder (YAZ-4074 6A item 4).
    if (!isValidPicturesFolder(folder) || !path.isAbsolute(folder) || blockedPicturesFolder(await realFolder(folder))) throw new BridgeFailure('BAD_REQUEST', FOLDER_REFUSED)
    if (!store.approvePictureFolder(folder)) throw new BridgeFailure('BAD_REQUEST', PICTURE_FOLDERS_FULL)
    return store.get().approvedPictureFolders
  })
  handle(CONTRACT.pictureFolders.remove, async (folder: unknown) => {
    if (typeof folder !== 'string') throw new BridgeFailure('BAD_REQUEST', "'folder' must be a string")
    store.removePictureFolder(folder)
    return store.get().approvedPictureFolders
  })
}
