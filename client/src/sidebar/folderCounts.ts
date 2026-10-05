import { alsoIn } from '@shared/alsoIn'
import type { IndexRecord, TreeNode } from '@shared/types'
import { absFrom } from '../lib/paths'
import { foldersById, isShortcut, rowsByFolder } from '../links/shortcuts'

/**
 * What the tree shows of each folder (YAZ-2290), by the folder's absolute path, in ONE pass over the
 * rows its own view shows (`rowsByFolder`), run once per index snapshot:
 *  - `counts` (🔒 E6): how many notes it shows — its table's rows: every note under it, plus its
 *    shortcuts (D2), each once. A file that is no note is no record, and a folder showing none
 *    has no entry.
 *  - `shortcuts` (D2): the notes whose `also_in` names THIS folder and that do not live under it,
 *    as the file rows the tree draws under it — a shortcut into a subfolder stands under the
 *    subfolder alone. A folder with none has no entry.
 * The vault root has no row, so it has neither.
 */
export function folderCounts(root: string, records: readonly IndexRecord[], folders: readonly IndexRecord[]): { counts: Map<string, number>; shortcuts: Map<string, TreeNode[]> } {
  const counts = new Map<string, number>()
  const shortcuts = new Map<string, TreeNode[]>()
  const byId = foldersById(folders)
  for (const [folder, rows] of rowsByFolder(records, folders)) {
    if (folder === '') continue
    const dir = absFrom(root, folder)
    counts.set(dir, rows.length)
    const elsewhere = rows.filter((row) => isShortcut(row, folder) && alsoIn(row.properties).some((id) => byId.get(id)?.folder === folder))
    if (elsewhere.length > 0) shortcuts.set(dir, elsewhere.map(({ name, path, size, mtime }) => ({ type: 'file', name, path, size, mtime, kind: 'markdown' })))
  }
  return { counts, shortcuts }
}
