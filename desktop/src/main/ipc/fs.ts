import { CH } from '../../channels'
import { createDir, createFile } from '../fs/create'
import { readFile, writeFile } from '../fs/file'
import { tree } from '../fs/tree'
import { handle } from './envelope'

/** The fs half of `window.yaseenDocs` (`dialog:pick-folder` comes with GRO-2163). */
export function registerFsIpc(): void {
  handle(CH.fsTree, tree)
  handle(CH.fsRead, readFile)
  handle(CH.fsWrite, writeFile)
  handle(CH.fsCreateDir, createDir)
  handle(CH.fsCreateFile, createFile)
}
