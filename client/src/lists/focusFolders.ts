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

/**
 * The window's folders: one for each id, the latest copy, no tombstones, in the tab's order — the dragged order (`pos`)
 * first, then the order they were made.
 *
 * Each vault owns its own items (YAZ-4470, 1): with the copies by vault root, the items of a vault come from that
 * vault's own live copy. Only a window that shows a vault can change its items, and that window writes the vault's
 * copy too, so its copy is never behind on them — while a window that does not show it holds an old copy of them, and
 * its later change of the folder (a rename) would else bring that old copy back: a file renamed since, lost.
 */
export function mergeFolders(copies: Readonly<Record<string, readonly FocusFolder[]>> | readonly (readonly FocusFolder[])[]): FocusFolder[] {
  const byRoot: [string | null, readonly FocusFolder[]][] = Array.isArray(copies) ? copies.map((list) => [null, list]) : Object.entries(copies)
  const newest = new Map<string, FocusFolder>()
  for (const [, list] of byRoot)
    for (const folder of list) {
      const held = newest.get(folder.id)
      if (held === undefined || folder.at > held.at) newest.set(folder.id, folder)
    }
  const owned = (w: FocusFolder): FocusFolder => {
    let items = w.items
    for (const [root, list] of byRoot) {
      const own = root === null ? undefined : list.find((f) => f.id === w.id && !f.deleted)
      if (root === null || own === undefined || own === w) continue
      const name = vaultNameOf(root)
      const mine = own.items.filter((i) => i.vault === name)
      // The winner's order, less its items of this vault that the vault's copy does not hold, then the vault's own that it lacks.
      const kept = items.filter((i) => i.vault !== name || mine.some((m) => sameItem(m, i)))
      items = [...kept, ...mine.filter((m) => !kept.some((i) => sameItem(i, m)))]
    }
    return items === w.items ? w : { ...w, items }
  }
  const at = (f: FocusFolder) => f.pos ?? Infinity
  return [...newest.values()]
    .filter((f) => !f.deleted)
    .map(owned)
    .sort((a, b) => at(a) - at(b) || a.created - b.created || (a.id < b.id ? -1 : 1))
}

/**
 * An item as an absolute path of a vault of the window, or the name of the vault that is not there (F6). Two vaults of
 * the window with that folder name (YAZ-4470, 3): a ghost too, with `clash`, never a guess that could open the wrong file.
 */
export function resolveItem(item: FolderItem, roots: readonly string[]): { path: string } | { ghost: string; clash?: true } {
  const named = roots.filter((r) => vaultNameOf(r) === item.vault)
  if (named.length > 1) return { ghost: item.vault, clash: true }
  return named.length === 0 ? { ghost: item.vault } : { path: `${stripSlash(named[0])}/${item.path}` }
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
