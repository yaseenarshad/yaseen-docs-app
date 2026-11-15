import { isRecord, isStringArray } from './guards'
import { MAX_FAVORITES } from './types'

/**
 * The pure rules of the lists a vault keeps in `.yaseendocs/` (YAZ-1766 Favorites), shared by the Mac's main process
 * (`desktop/src/main/favorites.ts`, which reads and writes the files) and the phone (YAZ-5452, which only reads them):
 * one rule for what a stored entry is, and what a valid file holds.
 */

/** The vault's own Favorites (`scope: 'vault'`): `{ version: 1, favorites: string[] }` of vault-relative POSIX paths, in the user's order. */
export const FAVORITES_FILE = 'favorites.json'

/** A stored entry: non-empty, relative, no `..` segment, no NUL. */
export const isSafeRel = (p: unknown): p is string => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes('\0') && !p.split('/').includes('..')

/** The safe entries of `rels`, once each, in their order, `max` at most. */
export const cleanRels = (rels: readonly string[], max: number): string[] => [...new Set(rels.filter(isSafeRel))].slice(0, max)

/** The cleaned list in a parsed `favorites.json`, or null when it is not `{ version: 1, favorites: string[] }` (a corrupt file). */
export const favoritesOf = (v: unknown): string[] | null => (isRecord(v) && v.version === 1 && isStringArray(v.favorites) ? cleanRels(v.favorites, MAX_FAVORITES) : null)
