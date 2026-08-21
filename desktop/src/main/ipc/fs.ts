import { CH } from '../../channels'
import { readAsset } from '../fs/assets'
import { createDir, createFile } from '../fs/create'
import { readFile, writeFile } from '../fs/file'
import { tree } from '../fs/tree'
import { getIndex } from '../vaultIndex'
import { handle } from './envelope'

/** The fs half of `window.yaseenDocs` (`dialog:pick-folder` lives in `./dialog`). */
export function registerFsIpc(): void {
  handle(CH.fsTree, tree)
  handle(CH.fsRead, readFile)
  handle(CH.fsWrite, writeFile)
  handle(CH.fsCreateDir, createDir)
  handle(CH.fsCreateFile, createFile)
  handle(CH.fsIndex, getIndex)
  handle(CH.fsReadAsset, readAsset)
}
