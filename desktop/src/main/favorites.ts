import { stat } from 'node:fs/promises'
import path from 'node:path'
import { LIST_SCOPES, MAX_FAVORITES, VAULT_CONFIG_DIR, type FavoritesConfig, type ListScope } from '@shared/types'
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
 *
 * Two lists for each vault since YAZ-4450 (D1): its own (`scope: 'vault'`), and its list for a
 * window with two or more vaults (`'workspace'`, `favorites-workspace.json`), by the same rules and
 * the same merge. No workspace file is an EMPTY workspace list (D3): never the vault's own list.
 */

export const FAVORITES_FILE = 'favorites.json'
/** The vault's Favorites in a workspace (YAZ-4450 D1): the shape, rules and merge of `favorites.json`. An old build never reads it. */
export const FAVORITES_WORKSPACE_FILE = 'favorites-workspace.json'
const fileOf = (scope: ListScope): string => (scope === 'vault' ? FAVORITES_FILE : FAVORITES_WORKSPACE_FILE)

export const toRel = (root: string, abs: string): string => path.relative(root, abs).split(path.sep).join('/')
export const toAbs = (root: string, rel: string): string => path.join(root, ...rel.split('/'))
/** A stored entry: non-empty, relative, no `..` segment, no NUL. */
export const isSafeRel = (p: unknown): p is string => typeof p === 'string' && p !== '' && !p.startsWith('/') && !p.includes('\0') && !p.split('/').includes('..')

/** `p` is `root` or inside it. Exported for the focus list (`focus.ts`, YAZ-2702), which has the same rule. */
export const under = (root: string, p: string): boolean => p === root || p.startsWith(`${root}/`)
const clean = (rels: readonly string[]): string[] => [...new Set(rels.filter(isSafeRel))].slice(0, MAX_FAVORITES)

type Raw = { state: 'absent' } | { state: 'ok'; rels: string[] } | { state: 'bad'; file: string }

/** The file of `scope` as stored, cleaned; `bad` is malformed JSON or not `{ version: 1, favorites: string[] }`. */
async function readRaw(root: string, scope: ListScope = 'vault'): Promise<Raw> {
  const res = await readConfigDetailed(root, fileOf(scope))
  if (res.state === 'absent') return res
  const file = path.join(root, VAULT_CONFIG_DIR, fileOf(scope))
  const rels = res.state === 'malformed' ? null : relsOf(res.value)
  return rels === null ? { state: 'bad', file } : { state: 'ok', rels }
}

/** The cleaned list in a parsed `favorites.json`, or null when it is not `{ version: 1, favorites: string[] }`. */
const relsOf = (v: unknown): string[] | null => (isRecord(v) && v.version === 1 && isStringArray(v.favorites) ? clean(v.favorites) : null)

/**
 * Two machines' `favorites.json` after both changed it (YAZ-1897 scope, ported by YAZ-3039 D4): a
 * 3-way list merge — an entry either side removed is gone, the remote's order is kept, and our
 * additions follow it. `base` is null when both machines created the file. Answers the file's
 * text, or null when a side is not a favorites file (sync then stops, as for any conflict it cannot settle).
 */
export function mergeFavoritesFile(base: string | null, theirs: string, mine: string): string | null {
  const parse = (text: string): string[] | null => {
    try {
      return relsOf(JSON.parse(text))
    } catch {
      return null
    }
  }
  const [b, t, m] = [base === null ? [] : parse(base), parse(theirs), parse(mine)]
  if (b === null || t === null || m === null) return null
  const [was, mineSet, theirSet] = [new Set(b), new Set(m), new Set(t)]
  const kept = t.filter((rel) => !was.has(rel) || mineSet.has(rel))
  const added = m.filter((rel) => !was.has(rel) && !theirSet.has(rel))
  return `${JSON.stringify({ version: 1, favorites: clean([...kept, ...added]) }, null, 2)}\n`
}

/** Writes and repairs on one root never interleave. */
const chained = createRootChain()

/** ABSOLUTE paths of the list of `scope`, in stored order; absent or malformed → `[]`. Never creates anything. */
export async function getFavorites(root: string, scope: ListScope = 'vault'): Promise<string[]> {
  const r = requireAbsPath(root, 'root')
  const raw = await readRaw(r, scope)
  return raw.state === 'ok' ? raw.rels.map((rel) => toAbs(r, rel)) : []
}

/** Replace the list of `scope` (absolute paths inside `root`); creates the dotfolder and file on first write. */
export async function setFavorites(root: string, absPaths: readonly string[], scope: ListScope = 'vault'): Promise<void> {
  const r = requireAbsPath(root, 'root')
  for (const p of absPaths) {
    if (typeof p !== 'string' || !under(r, p)) throw new BridgeFailure('BAD_REQUEST', 'a favorite must be inside the vault', { path: String(p) })
  }
  await chained(r, async () => {
    const raw = await readRaw(r, scope)
    if (raw.state === 'bad') throw new BridgeFailure('INVALID_CONFIG', `${fileOf(scope)} is malformed; fix or delete it`, { path: raw.file })
    const unique = [...new Set(absPaths)]
    const alive = await Promise.all(unique.map((p) => stat(p).then(() => true, () => false)))
    const kept = unique.filter((_, i) => alive[i]) // D14: a favorite whose file is gone leaves the list here
    const value: FavoritesConfig = { version: 1, favorites: clean(kept.map((p) => toRel(r, p))) }
    await writeConfig(r, fileOf(scope), value)
  })
}

/**
 * Adds vault-relative entries AFTER the stored ones (the Draw import, YAZ-3028 D6): the stored
 * list keeps its order and is never pruned here; an added entry that is already there, unsafe, or
 * whose file is gone (D14) is not added; the cap is MAX_FAVORITES. A malformed file is never
 * written (R2.5). Answers how many entries it added; 0 writes nothing.
 */
export async function addFavorites(root: string, rels: readonly string[]): Promise<number> {
  const r = requireAbsPath(root, 'root')
  return chained(r, async () => {
    const raw = await readRaw(r)
    if (raw.state === 'bad') return 0
    const stored = raw.state === 'ok' ? raw.rels : []
    const fresh = [...new Set(rels.filter(isSafeRel))].filter((rel) => !stored.includes(rel))
    const alive = await Promise.all(fresh.map((rel) => stat(toAbs(r, rel)).then(() => true, () => false)))
    const added = fresh.filter((_, i) => alive[i]).slice(0, Math.max(0, MAX_FAVORITES - stored.length))
    if (added.length === 0) return 0
    const value: FavoritesConfig = { version: 1, favorites: [...stored, ...added] }
    await writeConfig(r, FAVORITES_FILE, value)
    return added.length
  })
}

/** Fires after any change to favorites.json or favorites-workspace.json, with its list — an own write or an external edit. Returns an unsubscribe. */
export function subscribeFavorites(root: string, listener: (change: { root: string; scope: ListScope }) => void): () => void {
  const r = requireAbsPath(root, 'root')
  return subscribeConfig(r, (c) => {
    const scope = LIST_SCOPES.find((s) => c.name === fileOf(s))
    if (scope !== undefined) listener({ root: r, scope })
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

/** Read-remap-write of the owning root's two files (YAZ-4450 D1). Each is untouched when nothing in it changed. */
function repair(roots: readonly string[], p: string, map: (abs: string) => string | null): Promise<void> {
  const root = owningRoot(roots, p)
  if (root === null) return Promise.resolve()
  return chained(root, async () => {
    for (const scope of LIST_SCOPES) {
      const raw = await readRaw(root, scope)
      if (raw.state !== 'ok') continue // absent or malformed: never write
      const next = remap(root, raw.rels, map)
      if (next === null) continue
      const value: FavoritesConfig = { version: 1, favorites: clean(next) }
      await writeConfig(root, fileOf(scope), value)
    }
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
