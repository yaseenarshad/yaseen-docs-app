/**
 * Pure (YAZ-4460 F2): the focus folders of a window, out of each vault's copy. Each vault of a workspace holds the
 * whole folder; of two copies of one folder the later `at` wins, and a deleted folder (a tombstone) hides every older
 * copy. An item names its vault by the vault's folder name, so an item of a vault the window does not show is a ghost.
 */
import { rootOfPath, stripSlash, type FocusFolder } from '@shared/types'

export type FolderItem = FocusFolder['items'][number]

/** What a vault is called inside a focus folder: its folder name, the same on each Mac. */
export const vaultNameOf = (root: string): string => {
  const r = stripSlash(root)
  return r.slice(r.lastIndexOf('/') + 1)
}

/** The window's folders: one for each id, the latest copy, no tombstones, in the order they were made. */
export function mergeFolders(copies: readonly (readonly FocusFolder[])[]): FocusFolder[] {
  const newest = new Map<string, FocusFolder>()
  for (const list of copies)
    for (const folder of list) {
      const held = newest.get(folder.id)
      if (held === undefined || folder.at > held.at) newest.set(folder.id, folder)
    }
  return [...newest.values()].filter((f) => !f.deleted).sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1))
}

/** An item as an absolute path of a vault of the window, or the name of the vault that is not there (F6). */
export function resolveItem(item: FolderItem, roots: readonly string[]): { path: string } | { ghost: string } {
  const root = roots.find((r) => vaultNameOf(r) === item.vault)
  return root === undefined ? { ghost: item.vault } : { path: `${stripSlash(root)}/${item.path}` }
}

/** A path of the window as an item: its vault's name, and the path inside it; null for a path in no vault. */
export function itemOf(path: string, roots: readonly string[]): FolderItem | null {
  const root = rootOfPath(roots, path)
  if (root === null) return null
  const r = stripSlash(root)
  return path === r ? null : { vault: vaultNameOf(r), path: path.slice(r.length + 1) }
}

export const sameItem = (a: FolderItem, b: FolderItem): boolean => a.vault === b.vault && a.path === b.path

/** `list` with `folder` in its place, or after the others. */
export const upsert = (list: readonly FocusFolder[], folder: FocusFolder): FocusFolder[] =>
  list.some((f) => f.id === folder.id) ? list.map((f) => (f.id === folder.id ? folder : f)) : [...list, folder]
