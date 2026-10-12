import { stat } from 'node:fs/promises'
import path from 'node:path'
import { MAX_FAVORITES, VAULT_CONFIG_DIR, type FavoritesConfig } from '@shared/types'
import { isRecord, isStringArray } from '@shared/guards'
import { BridgeFailure, createRootChain, requireAbsPath } from './fs/fsUtils'
import { readConfigDetailed, subscribeConfig, writeConfig } from './vaultConfig'

/**
 * The Favorites list in the vault (YAZ-1766 6A, D11): `<root>/.yaseendocs/favorites.json` =
 * `{ version: 1, favorites: string[] }` of VAULT-RELATIVE POSIX paths in the user's order, so
 * GitHub sync carries it between machines. Electron-free, over the vaultConfig plumbing like
 * `properties/`. The API speaks ABSOLUTE paths; the file never does.
 *
 * Corrupt-file policy (properties' R2.5): unparsable JSON or a wrong shape reads as `[]` and
 * refuses every write with `INVALID_CONFIG` — the file is never overwritten or moved aside.
 * Dead-entry cleanup (D14): a write drops entries whose path no longer exists on disk; the
 * renderer never prunes. Repair (D13): `renamePath` / `removePath` remap or drop entries in the
 * LONGEST open root that owns the path, writing only when something changed.
 */

export const FAVORITES_FILE = 'favorites.json'

export const toRel = (root: string, abs: string): string => path.relative(root, abs).split(path.sep).join('/')
export const toAbs = (root: string, rel: string): string => path.join(root, ...rel.split('/'))
/** A stored entry: non-empty, relative, no `..` segment, no NUL. */
export const isSafeRel = (p: unknown): p is string => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes('\0') && !p.split('/').includes('..')

/** `p` is `root` or inside it. Exported for the focus list (`focus.ts`, YAZ-2702), which has the same rule. */
export const under = (root: string, p: string): boolean => p === root || p.startsWith(`${root}/`)
const clean = (rels: readonly string[]): string[] => [...new Set(rels.filter(isSafeRel))].slice(0, MAX_FAVORITES)

type Raw = { state: 'absent' } | { state: 'ok'; rels: string[] } | { state: 'bad'; file: string }

/** The file as stored, cleaned; `bad` is malformed JSON or not `{ version: 1, favorites: string[] }`. */
async function readRaw(root: string): Promise<Raw> {
  const res = await readConfigDetailed(root, FAVORITES_FILE)
  if (res.state === 'absent') return res
  const file = path.join(root, VAULT_CONFIG_DIR, FAVORITES_FILE)
  if (res.state === 'malformed') return { state: 'bad', file }
  const v = res.value
  if (!isRecord(v) || v.version !== 1 || !isStringArray(v.favorites)) return { state: 'bad', file }
  return { state: 'ok', rels: clean(v.favorites) }
}

/** Writes and repairs on one root never interleave. */
const chained = createRootChain()

/** ABSOLUTE paths in stored order; absent or malformed → `[]`. Never creates anything. */
export async function getFavorites(root: string): Promise<string[]> {
  const r = requireAbsPath(root, 'root')
  const raw = await readRaw(r)
  return raw.state === 'ok' ? raw.rels.map((rel) => toAbs(r, rel)) : []
}

/** Replace the list (absolute paths inside `root`); creates the dotfolder and file on first write. */
export async function setFavorites(root: string, absPaths: readonly string[]): Promise<void> {
  const r = requireAbsPath(root, 'root')
  for (const p of absPaths) {
    if (typeof p !== 'string' || !under(r, p)) throw new BridgeFailure('BAD_REQUEST', 'a favorite must be inside the vault', { path: String(p) })
  }
  await chained(r, async () => {
    const raw = await readRaw(r)
    if (raw.state === 'bad') throw new BridgeFailure('INVALID_CONFIG', 'favorites.json is malformed; fix or delete it', { path: raw.file })
    const unique = [...new Set(absPaths)]
    const alive = await Promise.all(unique.map((p) => stat(p).then(() => true, () => false)))
    const kept = unique.filter((_, i) => alive[i]) // D14: a favorite whose file is gone leaves the list here
    const value: FavoritesConfig = { version: 1, favorites: clean(kept.map((p) => toRel(r, p))) }
    await writeConfig(r, FAVORITES_FILE, value)
  })
}

/** Fires after any change to favorites.json — an own write or an external edit. Returns an unsubscribe. */
export function subscribeFavorites(root: string, listener: (change: { root: string }) => void): () => void {
  const r = requireAbsPath(root, 'root')
  return subscribeConfig(r, (c) => {
    if (c.name === FAVORITES_FILE) listener({ root: r })
  })
}

/** The LONGEST root that equals or prefixes `p`; null when no open root owns it. */
export function owningRoot(roots: readonly string[], p: string): string | null {
  let best: string | null = null
  for (const r of roots) if (under(r, p) && (best === null || r.length > best.length)) best = r
  return best
}

/**
 * `rels` after a rename or a delete: `map` answers the new absolute path of an entry, or null to
 * drop it. Null when nothing changed, so the caller writes nothing. Pure, and shared with the
 * focus list (`focus.ts`, YAZ-2702 R10): one repair rule for the two lists.
 */
export function remap(root: string, rels: readonly string[], map: (abs: string) => string | null): string[] | null {
  let changed = false
  const next: string[] = []
  for (const rel of rels) {
    const abs = toAbs(root, rel)
    const mapped = map(abs)
    if (mapped === abs) {
      next.push(rel)
      continue
    }
    changed = true
    if (mapped !== null && under(root, mapped)) next.push(toRel(root, mapped)) // moved OUT of the vault: dropped
  }
  return changed ? next : null
}

/** The map of a rename: the entry, and every entry inside a renamed folder, takes the new path (store.renamePath's prefix idiom). */
export function renamedTo(oldPath: string, newPath: string): (abs: string) => string {
  const prefix = `${oldPath}/`
  return (p) => (p === oldPath || p.startsWith(prefix) ? newPath + p.slice(oldPath.length) : p)
}

/** The map of a delete: the entry, and every entry under a deleted folder, is dropped. */
export function deletedAt(deleted: string): (abs: string) => string | null {
  const prefix = `${deleted}/`
  return (p) => (p === deleted || p.startsWith(prefix) ? null : p)
}

/** Read-remap-write of the owning root's file. Untouched when nothing changed. */
function repair(roots: readonly string[], p: string, map: (abs: string) => string | null): Promise<void> {
  const root = owningRoot(roots, p)
  if (root === null) return Promise.resolve()
  return chained(root, async () => {
    const raw = await readRaw(root)
    if (raw.state !== 'ok') return // absent or malformed: never write
    const next = remap(root, raw.rels, map)
    if (next === null) return
    const value: FavoritesConfig = { version: 1, favorites: clean(next) }
    await writeConfig(root, FAVORITES_FILE, value)
  })
}

/** D13: a favorited entry follows its rename, one inside a renamed folder too. */
export function renamePath(roots: readonly string[], oldPath: string, newPath: string): Promise<void> {
  return repair(roots, oldPath, renamedTo(oldPath, newPath))
}

/** D13: a deleted favorite, and everything under a deleted folder, leaves the list. */
export function removePath(roots: readonly string[], deleted: string): Promise<void> {
  return repair(roots, deleted, deletedAt(deleted))
}
