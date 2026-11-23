import { isRecord, isStringArray } from './guards'
import { MAX_FAVORITES, MAX_FOCUS, type FocusFolder, type ListScope } from './types'

/**
 * The pure rules of the lists a vault keeps in `.yaseendocs/` (YAZ-1766 Favorites), shared by the Mac's main process
 * (`desktop/src/main/favorites.ts`, which reads and writes the files) and the phone (YAZ-5452, which only reads them):
 * one rule for what a stored entry is, what a valid file holds, and which of each Mac's files is the list.
 */

/** The vault's own Favorites (`scope: 'vault'`): `{ version: 1, favorites: string[] }` of vault-relative POSIX paths, in the user's order. */
export const FAVORITES_FILE = 'favorites.json'

/** A stored entry: non-empty, relative, no `..` segment, no NUL. */
export const isSafeRel = (p: unknown): p is string => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes('\0') && !p.split('/').includes('..')

/** The safe entries of `rels`, once each, in their order, `max` at most. */
export const cleanRels = (rels: readonly string[], max: number): string[] => [...new Set(rels.filter(isSafeRel))].slice(0, max)

/** The cleaned list in a parsed `favorites.json`, or null when it is not `{ version: 1, favorites: string[] }` (a corrupt file). */
export const favoritesOf = (v: unknown): string[] | null => (isRecord(v) && v.version === 1 && isStringArray(v.favorites) ? cleanRels(v.favorites, MAX_FAVORITES) : null)

/**
 * The Focus list (YAZ-2702) and the folders of the Focus and Favorites tabs (YAZ-4460) are ONE FILE FOR EACH MAC:
 * `<prefix>.<mac id>.json`, the Mac ID being that Mac's own (`desktop/src/main/vaultIndex/mint.ts` `macId`: made once
 * on each machine, kept in its app data, the same for every window; twelve of `[0-9a-z]`). Two Macs never write one
 * file, so a sync never conflicts on them; the NEWEST valid file, by its `at`, is the list (`pickNewest`).
 */
const PREFIX = {
  focus: { vault: 'focus', workspace: 'focus-workspace' },
  'focus-folders': { vault: 'focus-folders', workspace: 'focus-folders-workspace' },
  'favorite-folders': { vault: 'favorite-folders', workspace: 'favorite-folders-workspace' },
  // The Files tab's Manual order (YAZ-5916, `shared/filesOrder.ts`): a vault's own, so only `vault` is ever written.
  'files-order': { vault: 'files-order', workspace: 'files-order-workspace' },
} as const satisfies Record<string, Record<ListScope, string>>
export type MacListFile = keyof typeof PREFIX

/** The name of a Mac's file of `list` in `scope`. */
export const macListFile = (list: MacListFile, mac: string, scope: ListScope): string => `${PREFIX[list][scope]}.${mac}.json`
/** The names of the files of `list` in `scope`: any Mac's. Any other name in the dotfolder is not one (an old build reads `vault` names only). */
export const macListRe = (list: MacListFile, scope: ListScope): RegExp => new RegExp(`^${PREFIX[list][scope]}\\.[0-9a-z]{12}\\.json$`)
/** A read looks at this many files of a list at most, the first by name (YAZ-2702 R13): a folder full of them must not make a read slow. */
export const MAX_LIST_FILES = 64
/** The files of `list` in `scope` a read looks at, of the dotfolder's `names`: in name order, `MAX_LIST_FILES` at most. */
export const macListFiles = (names: readonly string[], list: MacListFile, scope: ListScope): string[] => {
  const re = macListRe(list, scope)
  return names.filter((name) => re.test(name)).sort().slice(0, MAX_LIST_FILES)
}

/** `at` of a list file, in ms; null when it is not a time. */
export const atOf = (v: Record<string, unknown>): number | null => {
  const at = typeof v.at === 'string' ? Date.parse(v.at) : NaN
  return Number.isNaN(at) ? null : at
}

/** A parsed focus file `{ version: 1, at, focus: string[] }`, cleaned; null when it is not valid (bad shape, version, or time). */
export function focusOf(v: unknown): { at: number; rels: string[] } | null {
  if (!isRecord(v) || v.version !== 1 || !isStringArray(v.focus)) return null
  const at = atOf(v)
  return at === null ? null : { at, rels: cleanRels(v.focus, MAX_FOCUS) }
}

/** A vault keeps this many focus folders of a scope at most, tombstones included (YAZ-4460). */
export const MAX_FOCUS_FOLDERS = 100
/** The items of one focus or favorite folder at most (YAZ-4479): as many as a vault's top level of Focus holds. */
export const MAX_FOLDER_ITEMS = 500

export const isFocusFolder = (v: unknown): v is FocusFolder => {
  if (typeof v !== 'object' || v === null) return false
  const f = v as Record<string, unknown>
  return typeof f.id === 'string' && f.id !== '' && typeof f.name === 'string' && typeof f.created === 'number' && typeof f.at === 'number' && (f.deleted === undefined || f.deleted === true) && (f.pos === undefined || (typeof f.pos === 'number' && Number.isFinite(f.pos))) && Array.isArray(f.items) && f.items.every((i) => typeof i === 'object' && i !== null && typeof (i as Record<string, unknown>).vault === 'string' && typeof (i as Record<string, unknown>).path === 'string')
}

/** The valid folders of a folders file: once each id, items with a safe path and a vault name, the caps of YAZ-4460. */
export function cleanFolders(folders: readonly unknown[]): FocusFolder[] {
  const seen = new Set<string>()
  const out: FocusFolder[] = []
  for (const f of folders) {
    if (!isFocusFolder(f) || seen.has(f.id)) continue
    seen.add(f.id)
    out.push({ ...f, items: f.items.filter((item) => isSafeRel(item.path) && item.vault !== '').slice(0, MAX_FOLDER_ITEMS) })
  }
  return out.slice(0, MAX_FOCUS_FOLDERS)
}

/** A parsed folders file `{ version: 1, at, folders, self? }`, cleaned; null when it is not valid. `self`: the vault's folder name it was written under. */
export function foldersOf(v: unknown): { at: number; folders: FocusFolder[]; self?: string } | null {
  if (!isRecord(v) || v.version !== 1 || !Array.isArray(v.folders)) return null
  const at = atOf(v)
  if (at === null) return null
  return { at, folders: cleanFolders(v.folders), ...(typeof v.self === 'string' && v.self !== '' && { self: v.self }) }
}

/**
 * The list of a vault (YAZ-2702 R1): of `values` (each Mac's file as read, IN NAME ORDER; undefined for one that could
 * not be read), the newest valid one by `at`; of two with one `at`, the later name. A file that is not valid is passed
 * over, never an error: it is another Mac's, and this one must not lose its list to it. Null: no valid file.
 */
export function pickNewest<T extends { at: number }>(values: readonly unknown[], parse: (v: unknown) => T | null): T | null {
  let newest: T | null = null
  for (const v of values) {
    const held = v === undefined ? null : parse(v)
    if (held !== null && (newest === null || held.at >= newest.at)) newest = held
  }
  return newest
}
