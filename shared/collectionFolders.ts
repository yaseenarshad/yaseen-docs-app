/**
 * Pure (YAZ-4460 F2): the focus folders of a window, out of each vault's copy. Each vault of a workspace holds the
 * whole folder; of two copies of one folder the later `at` wins, and a deleted folder (a tombstone) hides every older
 * copy. An item names its vault by the vault's folder name, so an item of a vault the window does not show is a ghost.
 */
import { MAX_FAVORITES, MAX_FOCUS, rootOfPath, stripSlash, type FocusFolder } from '@shared/types'

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
 * The Delete of a favorite or focus folder (YAZ-4460 F3), for the sidebar and the CLI alike (D7, YAZ-4568): the
 * tombstone, with no items, goes to both list scopes. With `keep` (the Delete box's "Keep items") each item the window
 * resolves goes back to the top level of this scope's list, and of the other scope's while the folder shows there
 * (`inThere` null: it does not), unless it is there already. An item of a vault not open here leaves either way.
 */
export function folderDeletion(folder: FocusFolder, roots: readonly string[], keep: boolean, at: number, inHere: (path: string) => boolean, inThere: ((path: string) => boolean) | null): { gone: FocusFolder; here: string[]; there: string[] } {
  const back = keep ? folder.items.flatMap((item) => { const found = resolveItem(item, roots); return 'path' in found ? [found.path] : [] }) : []
  return { gone: { ...folder, deleted: true, items: [], at }, here: back.filter((p) => !inHere(p)), there: inThere === null ? [] : back.filter((p) => !inThere(p)) }
}

/** How many items one vault's top level holds, by list (YAZ-2702 R2 for Focus; the stored cap for Favorites). */
export const TOP_LEVEL_MAX = { focus: MAX_FOCUS, favorites: MAX_FAVORITES } as const

/**
 * Paths onto the top level of one vault's list, as "Keep items" of a group's Delete and a move out of a group put them:
 * each once, after the list, the first `max` kept, and `full` when some did not fit (YAZ-4479). The sidebar and the
 * CLI's `group remove` share it (YAZ-4527 P7).
 */
export function onTopLevel(list: readonly string[], paths: readonly string[], max: number): { list: string[]; full: boolean } {
  const next = [...list, ...paths.filter((p) => !list.includes(p))]
  return { list: next.slice(0, max), full: next.length > max }
}

/**
 * "Show it in ▸ Workspace / Vault" on a folder (YAZ-4460 demo): on, the folder's copy for the `to` scope comes alive;
 * off, a tombstone goes there. The last place it shows stays (null): a folder goes away by Delete. The sidebar and the
 * CLI's `group setScope` share this rule (YAZ-4599).
 */
export function folderScopeChange(folder: FocusFolder, on: boolean, at: number, showsElsewhere: boolean): FocusFolder | null {
  if (!on && !showsElsewhere) return null
  if (!on) return { ...folder, deleted: true, at }
  const { deleted: _deleted, ...alive } = folder
  return { ...alive, at }
}
