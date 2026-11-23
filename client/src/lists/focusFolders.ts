/** The focus folders' pure rules live in `@shared/collectionFolders`, which main's CLI navigation shares (YAZ-4502). */
import { rootOfPath, stripSlash, type FocusFolder } from '@shared/types'
import { resolveItem, vaultNameOf, type FolderItem } from '@shared/collectionFolders'
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

/**
 * The vault a New page / New folder / New drawing of a focus or favorite folder is made in (YAZ-4782): its root, with no
 * slash at the end. A folder holds no files of its own — it is a list — so the item goes to a vault's root: the vault of
 * the folder's first item this window shows (a ghost, or a name two vaults share, is no vault here), else the window's
 * first vault. One vault in the window: always that one.
 */
export function vaultOfFolder(folder: FocusFolder | undefined, roots: readonly string[]): string {
  for (const item of folder?.items ?? []) {
    if (!('path' in resolveItem(item, roots))) continue
    const root = roots.find((r) => vaultNameOf(r) === item.vault)
    if (root !== undefined) return stripSlash(root)
  }
  return stripSlash(roots[0])
}
