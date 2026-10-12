import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { MAX_FOCUS, VAULT_CONFIG_DIR, type FocusConfig } from '@shared/types'
import { isRecord, isStringArray } from '@shared/guards'
import { deletedAt, isSafeRel, owningRoot, remap, renamedTo, toAbs, toRel, under } from './favorites'
import { BridgeFailure, createRootChain, requireAbsPath, toBridgeFailure } from './fs/fsUtils'
import { readConfigDetailed, subscribeConfig, writeConfig } from './vaultConfig'
import { macId } from './vaultIndex/mint'

/**
 * The focus list of a vault, in the vault (YAZ-2702, Decisions 1 and 2): ONE list for each vault,
 * ONE file for each Mac — `<root>/.yaseendocs/focus.<mac id>.json` =
 * `{ version: 1, at: <ISO time>, focus: string[] }` of VAULT-RELATIVE POSIX paths in the user's
 * order — and the NEWEST file is the list. WHY a file for each Mac: two Macs never change one
 * file, so GitHub sync cannot conflict on focus, and a conflict stops the sync of the whole vault
 * (`git/sync.ts`; the rule of the count files, YAZ-2681 R15). The price is known: two Macs that
 * change focus while offline are not merged — the later change is the list.
 *
 * Electron-free, over the vaultConfig plumbing like `favorites.ts`, whose path helpers and repair
 * rule this module uses. The API speaks ABSOLUTE paths; the file never does.
 *
 * Read (R1, R3, R5, R6, R13): the newest VALID focus file, by `at`; of two files with one `at`, the
 * later name. A file that is not valid — bad JSON, a wrong shape, a `version` that is not 1, an `at`
 * that is not a time, or a file that cannot be read — is passed over, never an error: it is another
 * Mac's file, and this Mac must not lose its list to it. A read needs no Mac ID and creates nothing.
 * Write (R2, R4, R7, R8): this Mac's file only, also over one that was not valid, with an `at`
 * later than every file it read — so a Mac whose clock is behind still makes the newest file. A
 * list that did not change writes NOTHING: no byte changes, so no sync starts for nothing.
 * Repair (R10): `renamePath` / `removePath` remap or drop entries in the LONGEST open root that
 * owns the path, by Favorites' rule, and write only when the list changed.
 */

/** `focus.<mac id>.json`: the Mac ID has `mint.ts`'s shape. Any other name in the dotfolder is not a focus file. */
const FOCUS_FILE_RE = /^focus\.[0-9a-z]{12}\.json$/
export const focusFile = (mac: string): string => `focus.${mac}.json`
/** A read looks at this many focus files at most, the first by name (R13): a folder full of them must not make a read slow. */
export const MAX_FOCUS_FILES = 64

const clean = (rels: readonly string[]): string[] => [...new Set(rels.filter(isSafeRel))].slice(0, MAX_FOCUS)

/** The list as the newest valid file holds it, cleaned; `at` is that file's time in ms. */
interface Held {
  at: number
  rels: string[]
}

/** The vault's list, or null when no focus file is valid — a vault that has no list yet. */
async function readNewest(root: string): Promise<Held | null> {
  const dir = path.join(root, VAULT_CONFIG_DIR)
  const names = await readdir(dir).catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return [] as string[]
    throw toBridgeFailure(err, dir)
  })
  const files = names.filter((name) => FOCUS_FILE_RE.test(name)).sort().slice(0, MAX_FOCUS_FILES)
  const reads = await Promise.all(files.map((name) => readConfigDetailed(root, name).catch(() => undefined)))
  let newest: Held | null = null
  for (const res of reads) {
    if (res?.state !== 'ok') continue
    const v = res.value
    if (!isRecord(v) || v.version !== 1 || typeof v.at !== 'string' || !isStringArray(v.focus)) continue
    const at = Date.parse(v.at)
    if (Number.isNaN(at)) continue
    // `>=`: the files are in name order, so of two with one `at` the later name is the list (R1).
    if (newest === null || at >= newest.at) newest = { at, rels: clean(v.focus) }
  }
  return newest
}

/** Writes and repairs on one root never interleave (R9). */
const chained = createRootChain()

/**
 * `rels` becomes the vault's list: this Mac's file, dated after `held`, the newest file this write
 * read (R4). Nothing at all when `rels` is the list already (R8) — an empty list over no list too.
 */
async function save(root: string, rels: string[], held: Held | null): Promise<void> {
  const now = held?.rels ?? []
  if (rels.length === now.length && rels.every((rel, i) => rel === now[i])) return
  const value: FocusConfig = { version: 1, at: new Date(Math.max(Date.now(), (held?.at ?? 0) + 1)).toISOString(), focus: rels }
  await writeConfig(root, focusFile(await macId(root)), value)
}

/** ABSOLUTE paths in stored order; no valid focus file → `[]`. Never creates anything. */
export async function getFocus(root: string): Promise<string[]> {
  const r = requireAbsPath(root, 'root')
  return ((await readNewest(r))?.rels ?? []).map((rel) => toAbs(r, rel))
}

/** Replace the list (absolute paths inside `root`); the first write creates the dotfolder and this Mac's file. */
export async function setFocus(root: string, absPaths: readonly string[]): Promise<void> {
  const r = requireAbsPath(root, 'root')
  for (const p of absPaths) {
    if (typeof p !== 'string' || !under(r, p)) throw new BridgeFailure('BAD_REQUEST', 'a focus item must be inside the vault', { path: String(p) })
  }
  await chained(r, async () => {
    const unique = [...new Set(absPaths)]
    const alive = await Promise.all(unique.map((p) => stat(p).then(() => true, () => false)))
    const kept = unique.filter((_, i) => alive[i]) // R7, Favorites' D14: an item whose file is gone leaves the list here
    await save(r, clean(kept.map((p) => toRel(r, p))), await readNewest(r))
  })
}

/** Fires after any change to a focus file of the vault — an own write, or another Mac's file that a sync brought (R12). Returns an unsubscribe. */
export function subscribeFocus(root: string, listener: (change: { root: string }) => void): () => void {
  const r = requireAbsPath(root, 'root')
  return subscribeConfig(r, (c) => {
    if (FOCUS_FILE_RE.test(c.name)) listener({ root: r })
  })
}

/** Read-remap-write on the owning root: the list as it is now, remapped, into this Mac's file. Untouched when nothing changed, or when there is no list. */
function repair(roots: readonly string[], p: string, map: (abs: string) => string | null): Promise<void> {
  const root = owningRoot(roots, p)
  if (root === null) return Promise.resolve()
  return chained(root, async () => {
    const held = await readNewest(root)
    const next = held === null ? null : remap(root, held.rels, map)
    if (next !== null) await save(root, clean(next), held)
  })
}

/** R10: a focus item follows its rename, one inside a renamed folder too; one moved out of the vault is dropped. */
export function renamePath(roots: readonly string[], oldPath: string, newPath: string): Promise<void> {
  return repair(roots, oldPath, renamedTo(oldPath, newPath))
}

/** R10: a deleted focus item, and everything under a deleted folder, leaves the list. */
export function removePath(roots: readonly string[], deleted: string): Promise<void> {
  return repair(roots, deleted, deletedAt(deleted))
}
