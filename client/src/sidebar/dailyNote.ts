/**
 * Today's daily note in one vault (YAZ-3607): found in the vault index (D3), else made (D5, D6, D9). App opens it.
 *
 * The note is found by its TITLE, not by its file name: a vault that uses IDs builds the file name from the title and
 * the id (`2026-10-28-yaz-41.md`). In a vault that does not use IDs the title is the file name, so one rule serves both.
 */
import { dailyNoteName } from '@shared/dailyNote'
import type { IndexRecord, SettingsState, TreeNode } from '@shared/types'
import { BridgeRequestError, api } from '../api'
import { findDirNode } from '../lib/treeState'
import { createNote, folderPath } from '../views/scaffold'
import { plainEntryName } from './createEntry'
import { placePath } from './goToPlace'

export type DailyNoteSettings = Pick<SettingsState, 'dailyNoteFolder' | 'dailyNoteFormat' | 'dailyNoteDayFolder'>

/** Today's name (D4), on the Mac's own day. */
export const todaysDailyNote = (settings: DailyNoteSettings, now: Date = new Date()): string => dailyNoteName(settings.dailyNoteFormat, now)

/**
 * The path of the note titled `title` in the daily notes folder `folder` (root-relative), or one level down in a day
 * folder when `dayFolder` is on (D9); null when the vault has none yet. One pass over the records, nothing read from disk.
 * A day folder is matched by where it stands, not by its name, so a renamed day folder still holds its day's note.
 */
export function findDailyNote(records: readonly IndexRecord[], folder: string, title: string, dayFolder: boolean): string | null {
  const inPlace = (at: string) => (dayFolder ? at.slice(0, Math.max(0, at.lastIndexOf('/'))) === folder && at !== folder : at === folder)
  return records.find((r) => r.title === title && inPlace(r.folder))?.path ?? null
}

/**
 * Makes today's note titled `title` (D5). The daily notes folder must stand: a missing one is said, never made, since
 * a folder the person moved or renamed is not one to make again. A day folder (D9) is made when it is missing, or used
 * when it stands. The template is the daily notes folder's `.template.md`, in a day folder too (D6). Never over a file:
 * `createFile` refuses one (`ALREADY_EXISTS`).
 */
export async function makeDailyNote(vault: string, vaultName: string, settings: DailyNoteSettings, title: string, ids: boolean, tree: readonly TreeNode[]): Promise<string> {
  const root = placePath(vault, settings.dailyNoteFolder)
  // The folder is a path in the vault of the tab in front (D2): another vault of the window may hold it, this one does not.
  if (root !== vault && findDirNode(tree, root) === null) throw new Error(`${vaultName} has no folder "${settings.dailyNoteFolder}". Make it there, or change the daily notes folder in Settings › Files & Links`)
  let dir = root
  if (settings.dailyNoteDayFolder) {
    dir = folderPath(root, title, ids)
    try {
      await api.createDir(ids ? { path: dir, title } : { path: dir })
    } catch (err) {
      if (!(err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS')) throw err
    }
  }
  try {
    return await createNote(dir, title, ids, undefined, undefined, `${root}/.template.md`)
  } catch (err) {
    // A vault that does not use IDs names the file by the title: a note the index has not seen yet is today's note.
    if (!ids && err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS') return `${dir}/${plainEntryName(title, 'file')}`
    throw err
  }
}
