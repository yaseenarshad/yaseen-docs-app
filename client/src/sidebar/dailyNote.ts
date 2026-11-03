/**
 * Today's daily note in one vault (YAZ-3607): found in the vault index (D3), else made (D5, D6, D9) in the main process
 * (`fs:make-daily-note`, YAZ-4269 D2). App opens it.
 *
 * The note is found by its TITLE, not by its file name: a vault that uses IDs builds the file name from the title and
 * the id (`2026-10-28-yaz-41.md`). In a vault that does not use IDs the title is the file name, so one rule serves both.
 */
import { findDailyNote, type DailyNoteSettings } from '@shared/noteBirth'
import type { IndexRecord, TreeNode } from '@shared/types'
import { findDirNode, findNode } from '../lib/treeState'
import { placePath } from './goToPlace'

export { findDailyNote, type DailyNoteSettings }

/**
 * Today's note, or null when it must be made (D5). The vault index is the only place that knows a note's title, but
 * it hears of a change about 2 s after the sidebar's tree does (YAZ-3642). So the tree has the last word: a record of a
 * file the tree no longer holds is a note deleted a moment ago (D16), and `made`, the note this window made for this
 * vault, folder and name, stands in either layout while the tree holds it, before the index has it (D18). The name is
 * trimmed as the index trims a title (YAZ-3643).
 */
export function todaysNote({ records, tree, folder, title, dayFolder, made }: { records: readonly IndexRecord[]; tree: readonly TreeNode[]; folder: string; title: string; dayFolder: boolean; made?: string }): string | null {
  const held = (path: string) => findNode(tree, path) !== null
  if (made !== undefined && held(made)) return made
  const name = title.trim()
  // Only the records of this name are asked of the tree: a few, not the vault.
  return findDailyNote(records.filter((r) => r.title === name && held(r.path)), folder, name, dayFolder)
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
