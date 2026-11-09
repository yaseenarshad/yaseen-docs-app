import path from 'node:path'
import { isValidPicturesFolder } from '@shared/drawingAssets'
import { BridgeFailure } from './fs/fsUtils'
import { blockedPicturesFolder, PICTURE_FOLDERS_FULL, realFolder } from './fs/picturesFolders'
import type { Store } from './store'

export const FOLDER_REFUSED = "That folder can't hold a board's pictures."
export async function allowPictureFolder(store: Pick<Store, 'get' | 'approvePictureFolder'>, folder: unknown): Promise<string[]> {
  if (!isValidPicturesFolder(folder) || !path.isAbsolute(folder)) throw new BridgeFailure('BAD_REQUEST', FOLDER_REFUSED)
  const real = await realFolder(folder)
  if (blockedPicturesFolder(real) || !isValidPicturesFolder(real)) throw new BridgeFailure('BAD_REQUEST', FOLDER_REFUSED)
  if (!store.approvePictureFolder(folder)) throw new BridgeFailure('BAD_REQUEST', PICTURE_FOLDERS_FULL)
  return store.get().approvedPictureFolders
}
