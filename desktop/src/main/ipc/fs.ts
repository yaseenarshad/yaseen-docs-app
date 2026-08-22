import { CH } from '../../channels'
import { readAsset } from '../fs/assets'
import { createDir, createFile } from '../fs/create'
import { readFile, writeFile } from '../fs/file'
import { renameFile } from '../fs/rename'
import { tree } from '../fs/tree'
import type { Store } from '../store'
import { getIndex } from '../vaultIndex'
import { broadcastAll } from './broadcast'
import { handle } from './envelope'

/** The fs half of `window.yaseenDocs` (`dialog:pick-folder` lives in `./dialog`). */
export function registerFsIpc(store: Store): void {
  handle(CH.fsTree, tree)
  handle(CH.fsRead, readFile)
  handle(CH.fsWrite, writeFile)
  handle(CH.fsCreateDir, createDir)
  handle(CH.fsCreateFile, createFile)
  handle(CH.fsIndex, getIndex)
  handle(CH.fsReadAsset, readAsset)
  // In-app rename (Links E1, GRO-2194). The SAME handler repairs the store — every stored
  // window file/tab, folder lastFile, fold key and baseGroups key follows the file — and then
  // pushes `file:renamed` to EVERY window so open tabs remap in place. The vault index needs
  // no push: the shared watcher's unlink+add echo already heals it (no double-processing).
  handle(CH.fsRename, async (req: unknown) => {
    const res = await renameFile(req)
    store.renamePath(res.oldPath, res.newPath)
    broadcastAll(CH.fileRenamed, { oldPath: res.oldPath, newPath: res.newPath })
    return res
  })
}
