import { atOrBelow } from '@client/lib/treeState'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { FAVORITES_FILE, favoritesOf } from '@shared/vaultLists'
import type { VaultStore } from '../store'
import { readJson } from './vaultData'

/**
 * THE MAC'S LISTS AS SEARCH FILTERS (YAZ-5452): a filter next to "All types" that shows one list of the vault, read
 * from the files the Mac keeps in `.yaseendocs/` (the phone downloads that folder first, `isEager` in `sync/plan.ts`).
 * Read only: the phone never writes these files. Its own chunk (Search's tree), never the first load (YAZ-5377).
 *
 * Favorites: `favorites.json`, the Mac's `desktop/src/main/favorites.ts`, by its shared rule (`@shared/vaultLists`).
 */

export type ListKind = 'favorites'

/** A list as a Search filter: what it holds, in its order, and the test of a search row. */
export interface Scope {
  kind: ListKind
  /** The list's own paths, vault-relative, in the Mac's order: its top rows. */
  top: readonly string[]
  /** `path` is in the list: one of its paths, or inside a folder of it (the Mac's `atOrBelow`). */
  has(path: string): boolean
  /** The list is still being read: nothing is drawn yet, and no "No favorites" line. */
  loading?: true
}

const CONFIG = `${VAULT_CONFIG_DIR}/`

/**
 * The vault's Favorites, in the Mac's order. Only the vault's OWN list (`scope: 'vault'`, `favorites.json`), never its
 * workspace list (`favorites-workspace.json`, YAZ-4450): that one is for a Mac window with two or more vaults, and the
 * phone shows one vault. A missing or corrupt file is an empty list (the Mac's rule, R2.5).
 */
export async function readFavorites(store: VaultStore, vault: string): Promise<string[]> {
  return favoritesOf(await readJson(store, vault, `${CONFIG}${FAVORITES_FILE}`)) ?? []
}

/** The filter of `kind` over `top`. */
export function scopeOf(kind: ListKind, top: readonly string[]): Scope {
  const set = new Set(top)
  return { kind, top, has: (path) => atOrBelow(set, path) }
}

/** A list while it is read for the first time. */
export const loadingScope = (kind: ListKind): Scope => ({ kind, top: [], has: () => false, loading: true })

/** The filter each vault has on, and the last list read, kept while the app runs (a page opened over Search keeps it). */
const chosen = new Map<string, ListKind>()
const lists = new Map<string, Scope>()
export const chosenOf = (vault: string | null): ListKind | null => chosen.get(vault ?? '') ?? null
export function choose(vault: string | null, kind: ListKind | null): void {
  if (kind === null) chosen.delete(vault ?? '')
  else chosen.set(vault ?? '', kind)
}
export const heldList = (vault: string | null, kind: ListKind): Scope | undefined => lists.get(`${vault}\n${kind}`)

/** The list of `kind` as the phone holds it now: the same object as before when nothing in it changed. */
export async function loadScope(store: VaultStore, vault: string, kind: ListKind): Promise<Scope> {
  const top = await readFavorites(store, vault)
  const key = `${vault}\n${kind}`
  const held = lists.get(key)
  if (held !== undefined && held.top.length === top.length && held.top.every((p, i) => p === top[i])) return held
  const scope = scopeOf(kind, top)
  lists.set(key, scope)
  return scope
}

/** Forgets the filters and lists (a test starts clean). */
export function forgetLists(): void {
  chosen.clear()
  lists.clear()
}
