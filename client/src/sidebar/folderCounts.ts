import type { IndexRecord, TreeNode } from '@shared/types'
import { absFrom } from '../lib/paths'
import { isShortcut, rowsByFolder } from '../links/shortcuts'

/**
 * What the tree shows of each folder (YAZ-2290), by the folder's absolute path, in ONE pass over the
 * rows its own view shows (`rowsByFolder`), run once per index snapshot:
 *  - `counts` (🔒 E6): how many notecards it shows — the records that live DIRECTLY in it, plus its
 *    shortcuts (D2). A subfolder's notecards are its own, a file that is no notecard is no record,
 *    and a folder showing none has no entry.
 *  - `shortcuts` (D2): the notecards it shows that live somewhere else, as the file rows the tree
 *    draws under it. A folder with none has no entry.
 * The vault root has no row, so it has neither.
 */
export function folderCounts(root: string, records: readonly IndexRecord[], folders: readonly IndexRecord[]): { counts: Map<string, number>; shortcuts: Map<string, TreeNode[]> } {
  const counts = new Map<string, number>()
  const shortcuts = new Map<string, TreeNode[]>()
  for (const [folder, rows] of rowsByFolder(records, folders)) {
    if (folder === '') continue
    const dir = absFrom(root, folder)
    counts.set(dir, rows.length)
    const elsewhere = rows.filter((row) => isShortcut(row, folder))
    if (elsewhere.length > 0) shortcuts.set(dir, elsewhere.map(({ name, path, size, mtime }) => ({ type: 'file', name, path, size, mtime, kind: 'markdown' })))
  }
  return { counts, shortcuts }
}
