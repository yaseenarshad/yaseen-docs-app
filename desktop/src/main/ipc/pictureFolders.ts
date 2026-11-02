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
import { blockedPicturesFolder, MAX_PICTURE_FOLDERS, PICTURE_FOLDERS_FULL, realFolder } from '../fs/picturesFolders'
import type { Store } from '../store'
import { handle } from './envelope'

/** What `allow` says of a path that is no outside folder the app may write to. */
export const FOLDER_REFUSED = "That folder can't hold a board's pictures."

/**
 * The cog's folder window picked `folder` this session (`ipc/index.ts`; its confirmed move approves it, YAZ-4074 6A item 3).
 * YAZ-4071 nit: the set holds MAX_PICTURE_FOLDERS at most, the oldest pick going first; a pick again is the newest.
 */
export function rememberPick(picked: Set<string>, folder: string): void {
  picked.delete(folder)
  picked.add(folder)
  if (picked.size > MAX_PICTURE_FOLDERS) picked.delete(picked.values().next().value!)
}

/** `picked`: the cog's picks this session (`rememberPick`); Settings › Remove forgets a folder there too (YAZ-4071 nit). */
export function registerPictureFoldersIpc(store: Pick<Store, 'get' | 'approvePictureFolder' | 'removePictureFolder'>, picked: Set<string> = new Set()): void {
  handle(CONTRACT.pictureFolders.list, async () => store.get().approvedPictureFolders)
  handle(CONTRACT.pictureFolders.allow, async (folder: unknown) => {
    if (!isValidPicturesFolder(folder) || !path.isAbsolute(folder)) throw new BridgeFailure('BAD_REQUEST', FOLDER_REFUSED)
    // The real place, as a pick checks it: a symbolic link to a system folder is that folder (YAZ-4074 6A item 4), and one
    // to a hidden folder is hidden (YAZ-4071 nit).
    const real = await realFolder(folder)
    if (blockedPicturesFolder(real) || !isValidPicturesFolder(real)) throw new BridgeFailure('BAD_REQUEST', FOLDER_REFUSED)
    if (!store.approvePictureFolder(folder)) throw new BridgeFailure('BAD_REQUEST', PICTURE_FOLDERS_FULL)
    return store.get().approvedPictureFolders
  })
  handle(CONTRACT.pictureFolders.remove, async (folder: unknown) => {
    if (typeof folder !== 'string') throw new BridgeFailure('BAD_REQUEST', "'folder' must be a string")
    store.removePictureFolder(folder)
    picked.delete(folder)
    return store.get().approvedPictureFolders
  })
}
