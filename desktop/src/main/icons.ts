import path from 'node:path'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { cleanIconPaths, ICONS_FILE, parseIconsConfig, remapIconPaths, type IconsConfig, type VaultIcons } from '@shared/vaultIcons'
import { BridgeFailure, createRootChain, requireAbsPath } from './fs/fsUtils'
import { deletedAt, owningRoot, renamedTo, toAbs, toRel, under } from './favorites'
import { readConfigDetailed, subscribeConfig, writeConfig } from './vaultConfig'

/**
 * A vault's one-row icon picks in the vault (YAZ-3440 D8): `<root>/.yaseendocs/icons.json` (`shared/vaultIcons.ts` has
 * the shape; the name rules are a setting (D9), `sidebarIconRules`), favorites.json's idiom over the vaultConfig plumbing: VAULT-RELATIVE paths in the file so sync carries
 * it, ABSOLUTE paths on the bridge, created on the first write and never by a read, written atomically, watched
 * (an own write or an external edit pushes `icons:changed`), and merged by sync (`mergeIconsFile`).
 *
 * Corrupt-file policy (favorites' R2.5): unparsable JSON or a wrong shape reads as no icons and refuses every
 * write with `INVALID_CONFIG`; the file is never overwritten. A bad entry inside a good file is dropped on read.
 * Repair (D): `renamePath` / `removePath` carry or drop the picks of the LONGEST open root that owns the path,
 * a folder's with every pick below it, writing only when something changed. A rename outside the app loses its pick.
 */

type Raw = { state: 'absent' } | { state: 'ok'; config: IconsConfig } | { state: 'bad'; file: string }

async function readRaw(root: string): Promise<Raw> {
  const res = await readConfigDetailed(root, ICONS_FILE)
  if (res.state === 'absent') return res
  const config = res.state === 'malformed' ? null : parseIconsConfig(res.value)
  return config === null ? { state: 'bad', file: path.join(root, VAULT_CONFIG_DIR, ICONS_FILE) } : { state: 'ok', config }
}

/** The file's picks by absolute path. */
const toVault = (root: string, config: IconsConfig): VaultIcons => ({ paths: Object.fromEntries(Object.entries(config.paths).map(([rel, id]) => [toAbs(root, rel), id])) })

/** Absolute picks back to the file's relative ones; a pick outside the vault is dropped. */
const toConfig = (root: string, icons: VaultIcons): IconsConfig => ({
  version: 1,
  paths: cleanIconPaths(Object.fromEntries(Object.entries(icons.paths).filter(([p]) => p !== root && under(root, p)).map(([p, id]) => [toRel(root, p), id])), () => true),
})

/** Writes and repairs on one root never interleave. */
const chained = createRootChain()

/** The vault's picks; absent or malformed → none. Never creates anything. */
export async function getIcons(root: string): Promise<VaultIcons> {
  const r = requireAbsPath(root, 'root')
  const raw = await readRaw(r)
  return raw.state === 'ok' ? toVault(r, raw.config) : { paths: {} }
}

/** Replace the vault's picks (by absolute path inside `root`); creates the dotfolder and file on the first write. */
export async function setIcons(root: string, icons: unknown): Promise<void> {
  const r = requireAbsPath(root, 'root')
  const v = icons as Partial<VaultIcons> | null
  if (typeof v !== 'object' || v === null || typeof v.paths !== 'object' || v.paths === null || Array.isArray(v.paths)) throw new BridgeFailure('BAD_REQUEST', 'icons must be { paths }')
  for (const p of Object.keys(v.paths)) {
    if (!path.isAbsolute(p) || !under(r, p) || p === r) throw new BridgeFailure('BAD_REQUEST', 'an icon pick must be inside the vault', { path: p })
  }
  await chained(r, async () => {
    const raw = await readRaw(r)
    if (raw.state === 'bad') throw new BridgeFailure('INVALID_CONFIG', 'icons.json is malformed; fix or delete it', { path: raw.file })
    await writeConfig(r, ICONS_FILE, toConfig(r, { paths: v.paths as Record<string, string> }))
  })
}

/** Fires after any change to icons.json, an own write or an external edit. Returns an unsubscribe. */
export function subscribeIcons(root: string, listener: (change: { root: string }) => void): () => void {
  const r = requireAbsPath(root, 'root')
  return subscribeConfig(r, (c) => {
    if (c.name === ICONS_FILE) listener({ root: r })
  })
}

function repair(roots: readonly string[], p: string, map: (abs: string) => string | null): Promise<void> {
  const root = owningRoot(roots, p)
  if (root === null) return Promise.resolve()
  return chained(root, async () => {
    const raw = await readRaw(root)
    if (raw.state !== 'ok') return // absent or malformed: never write
    const icons = toVault(root, raw.config)
    const next = remapIconPaths(icons.paths, map)
    if (next === null) return
    await writeConfig(root, ICONS_FILE, toConfig(root, { paths: next }))
  })
}

/** D: a pick follows its rename or move, and a folder's carries every pick below it. */
export function renamePath(roots: readonly string[], oldPath: string, newPath: string): Promise<void> {
  return repair(roots, oldPath, renamedTo(oldPath, newPath))
}

/** D: a deleted row's pick, and every pick under a deleted folder, leaves the file. */
export function removePath(roots: readonly string[], deleted: string): Promise<void> {
  return repair(roots, deleted, deletedAt(deleted))
}
