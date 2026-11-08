/**
 * A FOLDER RENAME OR MOVE IN THE APP (YAZ-4128 6B2): each board of the vault whose own pictures folder (`picturesFolder`
 * in its `yaseendraw` block) is the renamed folder, or a folder under it, names the new path. Called by the rename door
 * (`afterRename` in `ipc/fs.ts`), after the folder moved on disk. A rename in Finder is out of reach: the board then
 * shows its missing pictures (YAZ-3943 1F).
 *
 * Each board is read ONCE and written ONCE, as `board:set-pictures` does (`fs/boardPictures.ts`): `withPicturesOut`
 * with the new folder, so the dates stay and only the folder and its switch time change. The conflict guard: a board
 * that changed on disk since the read is not written (a save that landed first wins; its block still names the old
 * folder, and its missing-pictures notice says so). Only a board whose block names a folder is read whole; the others
 * cost a head read. An open board hears the write from the watcher and reloads, as after a cog switch elsewhere.
 */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { picturesFolderOf, picturesFolderOutside, picturesOut, serializeBoard, withPicturesOut } from '@shared/drawingAssets'
import { isDrawing } from '@shared/fileKind'
import { BOARDS } from './boardDocument'
import { readBoardHead } from './boardHead'
import { readBoundedRegularFile } from './boundedRead'
import { parseScene } from './drawing'
import { atomicWrite, vaultFiles } from './fsUtils'

/** `abs` as a vault-relative `/` path of `root`, or null when it is not inside it. */
function relOf(root: string, abs: string): string | null {
  const rel = path.relative(root, abs)
  return rel === '' || rel.startsWith('..') || path.isAbsolute(rel) ? null : rel.split(path.sep).join('/')
}

/** The boards of `root` that named a folder at or under `oldPath` now name it under `newPath`. Answers the boards written. */
export async function renameBoardFolders(root: string, oldPath: string, newPath: string): Promise<string[]> {
  const from = relOf(root, oldPath)
  if (from === null) return []
  // A move out of the vault: the folder is named by its full path, as a folder picked outside the vault is.
  const to = relOf(root, newPath) ?? path.resolve(newPath)
  const written: string[] = []
  for await (const { full, name } of vaultFiles(root)) {
    if (!isDrawing(name)) continue
    const block = (await readBoardHead(full).catch(() => null))?.block
    const folder = picturesFolderOf(block)
    if (folder === null || picturesFolderOutside(folder) || !picturesOut(block)) continue
    if (folder !== from && !folder.startsWith(`${from}/`)) continue
    const next = path.isAbsolute(to) ? path.join(to, ...folder.slice(from.length).split('/')) : `${to}${folder.slice(from.length)}`
    if (await writeFolder(full, next)) written.push(full)
  }
  return written
}

/** One read, one write: the board names `folder`. False when it could not be read, or changed under the read. */
async function writeFolder(file: string, folder: string): Promise<boolean> {
  try {
    const snap = await readBoundedRegularFile(file, BOARDS.drawing.max, BOARDS.drawing.tooLarge)
    const { scene } = parseScene(snap.data.toString('utf8'), file, 'IO_ERROR')
    const next = serializeBoard(withPicturesOut(scene, true, snap.mtime, Date.now(), folder))
    if ((await stat(file)).mtimeMs !== snap.mtime) return false
    await atomicWrite(file, next, undefined, snap.mtime)
    return true
  } catch {
    // A board that is not a scene, or that went: nothing to name.
    return false
  }
}
