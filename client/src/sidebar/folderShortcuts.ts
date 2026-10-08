import { alsoIn } from '@shared/alsoIn'
import type { IndexRecord, TreeNode } from '@shared/types'
import { absFrom } from '../lib/paths'
import { foldersById, isShortcut, rowsByFolder } from '../links/shortcuts'

/**
 * Each folder's shortcuts (YAZ-2290 D2), by the folder's absolute path, in ONE pass over the rows
 * its own view shows (`rowsByFolder`), run once per index snapshot: the notes whose `also_in` names
 * THIS folder and that do not live under it, as the file rows the tree draws under it — a shortcut
 * into a subfolder stands under the subfolder alone. A folder with none has no entry, and the vault
 * root has no row, so it has none.
 */
export function folderShortcuts(root: string, records: readonly IndexRecord[], folders: readonly IndexRecord[]): Map<string, TreeNode[]> {
  const shortcuts = new Map<string, TreeNode[]>()
  const byId = foldersById(folders)
  for (const [folder, rows] of rowsByFolder(records, folders)) {
    if (folder === '') continue
    const dir = absFrom(root, folder)
    const elsewhere = rows.filter((row) => isShortcut(row, folder) && alsoIn(row.properties).some((id) => byId.get(id)?.folder === folder))
    if (elsewhere.length > 0) shortcuts.set(dir, elsewhere.map(({ name, path, size, mtime }) => ({ type: 'file', name, path, size, mtime, kind: 'markdown' })))
  }
  return shortcuts
}
