/**
 * Today's daily note in one vault (YAZ-3607): found in the vault index (D3), else made (D5, D6, D9). App opens it.
 *
 * The note is found by its TITLE, not by its file name: a vault that uses IDs builds the file name from the title and
 * the id (`2026-10-28-yaz-41.md`). In a vault that does not use IDs the title is the file name, so one rule serves both.
 */
import { dailyNoteName } from '@shared/dailyNote'
import { kebabTitle } from '@shared/noteName'
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
 * The path of the note titled `title` in the daily notes folder `folder` (root-relative), or one level down in its day
 * folder (D9); null when the vault has none yet. One pass over the records for each layout, nothing read from disk.
 * Both layouts are asked, the one `dayFolder` names first: "Make a folder for each day" switched in the middle of a day
 * finds the note made before the switch, never a second one. A day folder carries today's name, as it is made: the
 * title in a vault without IDs, its kebab-case in one with them (`folderPath`). So a note of that title in another
 * folder is never today's.
 */
export function findDailyNote(records: readonly IndexRecord[], folder: string, title: string, dayFolder: boolean): string | null {
  const dayNames = new Set([title.trim(), kebabTitle(title)])
  const flat = (at: string) => at === folder
  const inDay = (at: string) => {
    const cut = at.lastIndexOf('/')
    return (cut === -1 ? '' : at.slice(0, cut)) === folder && at !== folder && dayNames.has(at.slice(cut + 1))
  }
  const [first, then] = dayFolder ? [inDay, flat] : [flat, inDay]
  return (records.find((r) => r.title === title && first(r.folder)) ?? records.find((r) => r.title === title && then(r.folder)))?.path ?? null
}

/**
 * The vault of today's note (D2, amended in the demo): the folder is a path inside a vault, and the window's vaults
 * are asked in order, the one of the tab in front first. The first that holds the folder is the one. So a window on
 * two vaults finds the folder in either, and a vault that has its own keeps its own. Null when none holds it: a folder
 * the person moved or renamed is not one to make again. The vault folder itself ('') is in every vault.
 */
export function dailyNoteVault(vaults: ReadonlyArray<{ root: string; tree: readonly TreeNode[] }>, folder: string): string | null {
  return vaults.find(({ root, tree }) => folder === '' || findDirNode(tree, placePath(root, folder)) !== null)?.root ?? null
}

/**
 * Makes today's note titled `title` (D5) in the daily notes folder of `vault`, which `dailyNoteVault` found. A day
 * folder (D9) is made when it is missing, or used when it stands. The template is the daily notes folder's
 * `.template.md`, in a day folder too (D6). Never over a file: `createFile` refuses one (`ALREADY_EXISTS`).
 */
export async function makeDailyNote(vault: string, settings: DailyNoteSettings, title: string, ids: boolean): Promise<string> {
  const root = placePath(vault, settings.dailyNoteFolder)
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
