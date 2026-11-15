import { atOrBelow } from '@client/lib/treeState'
import { mergeFolders } from '@client/lists/focusFolders'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { FAVORITES_FILE, favoritesOf, focusOf, foldersOf, macListFiles, pickNewest, type MacListFile } from '@shared/vaultLists'
import type { VaultStore } from '../store'
import { readRecent, type RecentEntry } from './recent'
import { readJson, type VaultData } from './vaultData'

/**
 * THE MAC'S LISTS AS SEARCH FILTERS (YAZ-5452, YAZ-5453): a filter next to "All types" that shows one list of the vault,
 * read from the files the Mac keeps in `.yaseendocs/` (the phone downloads that folder first, `isEager` in
 * `sync/plan.ts`), by the Mac's own rules (`@shared/vaultLists`, which `desktop/src/main/` uses too). Read only: the
 * phone never writes these files. Its own chunk (Search's tree), never the first load (YAZ-5377).
 *
 * Each list is the VAULT's own (`scope: 'vault'`), never its workspace list (`*-workspace*.json`, YAZ-4450): that one
 * is for a Mac window with two or more vaults, and the phone shows one vault.
 *  - Favorites: `favorites.json` (`desktop/src/main/favorites.ts`), and the Favorites tab's folders,
 *    `favorite-folders.<mac id>.json` (YAZ-4460 demo).
 *  - Focus: `focus.<mac id>.json` (`focus.ts`) and the Focus tab's folders, `focus-folders.<mac id>.json`
 *    (`focusFolders.ts`). The `<mac id>` is a MAC's, not a window's: each Mac writes only its own file, so a sync never
 *    conflicts, and the Mac shows the NEWEST valid file by its `at` (of two with one `at`, the later name). So does the phone.
 *  - Recent (YAZ-5457): the phone's own list of what was opened on it (`recent.ts`): the Mac's Recents are not in the vault.
 */

export type ListKind = 'favorites' | 'focus' | 'recent'

/** A folder of the Focus or the Favorites tab (YAZ-4460): a named group of the list's items; it moves nothing on disk. */
export interface ListFolder {
  id: string
  name: string
  /** Its items of this vault, vault-relative, in its order. */
  paths: readonly string[]
}

/** A list as a Search filter: what it holds, in the Mac's order, and the test of a search row. */
export interface Scope {
  kind: ListKind
  /** The tab's folders, in the tab's order (`mergeFolders`): above the top rows, as on the Mac. */
  folders: readonly ListFolder[]
  /** The list's own paths, vault-relative, in the Mac's order: its top rows. */
  top: readonly string[]
  /** Recent: what was opened, newest first (a card by its file or page, and its ID). */
  recent?: readonly RecentEntry[]
  /** `path` is in the list: one of its paths, or inside a folder of it (the Mac's `atOrBelow`); Recent: one of its paths. */
  has(path: string): boolean
  /** The list is still being read: nothing is drawn yet, and no "No favorites" line. */
  loading?: true
}

const CONFIG = `${VAULT_CONFIG_DIR}/`
const read = (store: VaultStore, vault: string, name: string) => readJson(store, vault, `${CONFIG}${name}`)

/** The names in the vault's `.yaseendocs/` (the checkpoint's list: what the vault holds at the commit the phone has). */
const configNames = (files: readonly string[]): string[] => files.flatMap((f) => (f.startsWith(CONFIG) && !f.includes('/', CONFIG.length) ? [f.slice(CONFIG.length)] : []))

/** The newest valid file of a list of one file for each Mac, parsed by `parse`; null when none is valid (or there is none). */
async function newestOf<T extends { at: number }>(store: VaultStore, vault: string, names: readonly string[], list: MacListFile, parse: (v: unknown) => T | null): Promise<T | null> {
  return pickNewest(await Promise.all(macListFiles(names, list, 'vault').map((name) => read(store, vault, name))), parse)
}

/**
 * The tab's folders (YAZ-4460), the Mac's way: tombstones out, the dragged order, then the order they were made
 * (`mergeFolders`, the Mac's own). Each item names its vault by the vault's folder name on the Mac; the file says which
 * name is this vault's (`self`), and an item of another vault (a ghost on the Mac) is not shown. An old file with no
 * `self`: every item is taken (a path this vault does not hold has no row anyway).
 */
async function readFolders(store: VaultStore, vault: string, names: readonly string[], list: 'focus-folders' | 'favorite-folders'): Promise<ListFolder[]> {
  const held = await newestOf(store, vault, names, list, foldersOf)
  if (held === null) return []
  return mergeFolders([held.folders]).map((f) => ({ id: f.id, name: f.name, paths: f.items.filter((i) => held.self === undefined || i.vault === held.self).map((i) => i.path) }))
}

/** The vault's Favorites, in the Mac's order. A missing or corrupt `favorites.json` is an empty list (the Mac's rule, R2.5). */
export async function readFavorites(store: VaultStore, vault: string): Promise<string[]> {
  return favoritesOf(await read(store, vault, FAVORITES_FILE)) ?? []
}

/** The list of `kind` of the vault as the phone holds it. */
async function readList(store: VaultStore, data: VaultData, kind: ListKind): Promise<{ folders: ListFolder[]; top: string[]; recent?: RecentEntry[] }> {
  if (kind === 'recent') {
    const recent = await readRecent(store, data.vault)
    return { folders: [], top: [...new Set(recent.map((e) => e.path))], recent }
  }
  const names = configNames(data.files)
  if (kind === 'favorites') return { folders: await readFolders(store, data.vault, names, 'favorite-folders'), top: await readFavorites(store, data.vault) }
  return { folders: await readFolders(store, data.vault, names, 'focus-folders'), top: (await newestOf(store, data.vault, names, 'focus', focusOf))?.rels ?? [] }
}

/** The filter of `kind` over its folders and top rows. */
export function scopeOf(kind: ListKind, folders: readonly ListFolder[], top: readonly string[], recent?: readonly RecentEntry[]): Scope {
  const set = new Set([...folders.flatMap((f) => f.paths), ...top])
  if (recent !== undefined) return { kind, folders, top, recent, has: (path) => set.has(path) }
  return { kind, folders, top, has: (path) => atOrBelow(set, path) }
}

/** A list while it is read for the first time. */
export const loadingScope = (kind: ListKind): Scope => ({ kind, folders: [], top: [], has: () => false, loading: true })

/** The filter each vault has on, and the last list read, kept while the app runs (a page opened over Search keeps it). */
const chosen = new Map<string, ListKind>()
const lists = new Map<string, { sign: string; scope: Scope }>()
export const chosenOf = (vault: string | null): ListKind | null => chosen.get(vault ?? '') ?? null
export function choose(vault: string | null, kind: ListKind | null): void {
  if (kind === null) chosen.delete(vault ?? '')
  else chosen.set(vault ?? '', kind)
}
export const heldList = (vault: string | null, kind: ListKind): Scope | undefined => lists.get(`${vault}\n${kind}`)?.scope

/** The list of `kind` as the phone holds it now: the same object as before when nothing in it changed (no search runs again). */
export async function loadScope(store: VaultStore, data: VaultData, kind: ListKind): Promise<Scope> {
  const { folders, top, recent } = await readList(store, data, kind)
  const key = `${data.vault}\n${kind}`
  const sign = JSON.stringify([folders, top, recent])
  const held = lists.get(key)
  if (held !== undefined && held.sign === sign) return held.scope
  const scope = scopeOf(kind, folders, top, recent)
  lists.set(key, { sign, scope })
  return scope
}

/** Forgets the filters and lists (a test starts clean). */
export function forgetLists(): void {
  chosen.clear()
  lists.clear()
}
