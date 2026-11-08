/** The focus folders' pure rules live in `@shared/collectionFolders`, which main's CLI navigation shares (YAZ-4502). */
import { rootOfPath, stripSlash, type FocusFolder } from '@shared/types'
import { vaultNameOf, type FolderItem } from '@shared/collectionFolders'
export { mergeFolders, resolveItem, sameItem, vaultNameOf, type FolderItem } from '@shared/collectionFolders'

/** A path of the window as an item: its vault's name, and the path inside it; null for a path in no vault. */
export function itemOf(path: string, roots: readonly string[]): FolderItem | null {
  const root = rootOfPath(roots, path)
  if (root === null) return null
  const r = stripSlash(root)
  return path === r ? null : { vault: vaultNameOf(r), path: path.slice(r.length + 1) }
}

/** `list` with `folder` in its place, or after the others. */
export const upsert = (list: readonly FocusFolder[], folder: FocusFolder): FocusFolder[] =>
  list.some((f) => f.id === folder.id) ? list.map((f) => (f.id === folder.id ? folder : f)) : [...list, folder]
