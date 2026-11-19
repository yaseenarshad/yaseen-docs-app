import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { DEFAULT_FILES_SORT, filesOrderFile, type FilesOrderState, type FilesSort, filesOrderFiles, filesOrderOf, placeOf, renamedOrders, sameOrders, type LeftPlace, withFolderOrder, type FilesOrder, type FolderOrders } from '@shared/filesOrder'
import { pickNewest } from '@shared/vaultLists'
import { owningRoot, toAbs, toRel, under } from './favorites'
import { BridgeFailure, createRootChain, requireAbsPath, toBridgeFailure } from './fs/fsUtils'
import { readConfigDetailed, subscribeConfig, writeConfig } from './vaultConfig'
import { macId } from './vaultIndex/mint'

/**
 * The Files tab's Manual order of a vault (YAZ-5916), in the vault by the focus list's rule (`focus.ts`, YAZ-2702):
 * ONE FILE FOR EACH MAC, `<root>/.yaseendocs/files-order.<mac id>.json` = `{ version: 1, at, folders, sort, reverse }`
 * (`shared/filesOrder.ts`), and the NEWEST valid file is the order. Two Macs never write one file, so a sync never
 * conflicts on it. A write is this Mac's file only, dated after every file it read, through the vaultConfig door
 * (`writeConfig`: atomic, tmp + rename); an order that did not change writes nothing.
 *
 * The bridge speaks ABSOLUTE folder paths; the file speaks vault-relative ones ('' for the top). Repair: a rename or a
 * move in the app keeps the item's place in its folder, or puts it last in the new folder (the move back of an Undo:
 * in its old place, YAZ-5935); a folder's orders follow
 * it; a delete takes the item and its folder's orders out. A rename outside the app loses its place (the item is then
 * unknown in the list: last).
 */

const chained = createRootChain()

async function readNewest(root: string): Promise<FilesOrder | null> {
  const dir = path.join(root, VAULT_CONFIG_DIR)
  const names = await readdir(dir).catch((err: unknown) => {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return [] as string[]
    throw toBridgeFailure(err, dir)
  })
  const reads = await Promise.all(filesOrderFiles(names).map((name) => readConfigDetailed(root, name).catch(() => undefined)))
  return pickNewest(reads.map((res) => (res?.state === 'ok' ? res.value : undefined)), filesOrderOf)
}

const MANUAL: FilesSort = { by: 'manual', reverse: false }
const sameSort = (a: FilesSort, b: FilesSort): boolean => a.by === b.by && a.reverse === b.reverse

/** `folders` and `sort` become the vault's order: this Mac's file, dated after `held`; nothing when neither changed. */
async function save(root: string, folders: FolderOrders, sort: FilesSort, held: FilesOrder | null): Promise<void> {
  if (held !== null ? sameOrders(held.folders, folders) && sameSort(held.sort, sort) : Object.keys(folders).length === 0 && sameSort(sort, DEFAULT_FILES_SORT)) return
  const at = new Date(Math.max(Date.now(), (held?.at ?? 0) + 1)).toISOString()
  await writeConfig(root, filesOrderFile(await macId(root)), { version: 1, at, sort: sort.by, reverse: sort.reverse, folders })
}

const toState = (root: string, held: FilesOrder | null): FilesOrderState => ({
  sort: held?.sort ?? DEFAULT_FILES_SORT,
  folders: Object.fromEntries(Object.entries(held?.folders ?? {}).map(([rel, names]) => [rel === '' ? root : toAbs(root, rel), [...names]])),
})

/** The vault's order, its folders by ABSOLUTE path; none when no file is valid. Never creates anything. */
export async function getFilesOrder(root: string): Promise<FilesOrderState> {
  const r = requireAbsPath(root, 'root')
  return toState(r, await readNewest(r))
}

/** One folder's order (`dir`: the vault or a folder inside it; `names`: its items' names in order); the sort is Manual. */
export async function setFolderOrder(root: string, dir: string, names: readonly string[]): Promise<void> {
  const r = requireAbsPath(root, 'root')
  const d = requireAbsPath(dir, 'dir')
  if (!under(r, d)) throw new BridgeFailure('BAD_REQUEST', 'the folder must be inside the vault', { path: d })
  await chained(r, async () => {
    const held = await readNewest(r)
    // A reorder happens only under Manual: this Mac's file says so, so the phone shows the order at once (Q4).
    await save(r, withFolderOrder(held?.folders ?? {}, d === r ? '' : toRel(r, d), names), MANUAL, held)
  })
}

/** This Mac's Files sort (Q4), written at each change of it: the phone sorts its tree by the newest file's (D4). */
export async function setFilesSort(root: string, sort: FilesSort): Promise<void> {
  const r = requireAbsPath(root, 'root')
  await chained(r, async () => {
    const held = await readNewest(r)
    await save(r, held?.folders ?? {}, { by: sort.by, reverse: sort.reverse }, held)
  })
}

/** Fires after any change to an order file of the vault, an own write or another Mac's file that a sync brought. */
export function subscribeFilesOrder(root: string, listener: (change: { root: string }) => void): () => void {
  const r = requireAbsPath(root, 'root')
  return subscribeConfig(r, (c) => {
    if (filesOrderFiles([c.name]).length > 0) listener({ root: r })
  })
}

/**
 * Where each item that a move took out of its folder's list stood (YAZ-5935), by vault, then by the item's new
 * vault-relative path. The Undo of a ⌘-drag into a folder is the move back (`invertMoves`); it finds the place here,
 * so the item lands where it was, not last. Any other repair of that path forgets it. This run of the app only.
 */
const lefts = new Map<string, Map<string, LeftPlace & { from: string }>>()
const MAX_LEFT = 200

const parentRel = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')
const atOrBelow = (key: string, rel: string): boolean => key === rel || key.startsWith(`${rel}/`)

function repair(roots: readonly string[], oldPath: string, newPath: string | null): Promise<void> {
  const root = owningRoot(roots, oldPath)
  if (root === null || root === oldPath) return Promise.resolve()
  return chained(root, async () => {
    const oldRel = toRel(root, oldPath)
    const newRel = newPath !== null && under(root, newPath) && newPath !== root ? toRel(root, newPath) : null
    const mine = lefts.get(root) ?? new Map<string, LeftPlace & { from: string }>()
    lefts.set(root, mine)
    const left = mine.get(oldRel)
    for (const key of [...mine.keys()]) if (atOrBelow(key, oldRel)) mine.delete(key)
    const held = await readNewest(root)
    if (held === null) return
    // A move to another folder: remember the place that the item leaves, for the move back.
    const leaves = newRel !== null && parentRel(newRel) !== parentRel(oldRel) ? placeOf(held.folders, oldRel) : null
    if (leaves !== null && newRel !== null) {
      mine.set(newRel, { ...leaves, from: oldRel })
      if (mine.size > MAX_LEFT) mine.delete(mine.keys().next().value as string)
    }
    const back = left !== undefined && left.from === newRel ? left : undefined
    const next = renamedOrders(held.folders, oldRel, newRel, back)
    if (next !== null) await save(root, next, held.sort, held)
  })
}

/** An item keeps its place through a rename; a move puts it last in its new folder, or back in its old place (YAZ-5935); a folder's orders follow it. */
export function renamePath(roots: readonly string[], oldPath: string, newPath: string): Promise<void> {
  return repair(roots, oldPath, newPath)
}

/** A deleted item, and a deleted folder's orders, leave the file. */
export function removePath(roots: readonly string[], deleted: string): Promise<void> {
  return repair(roots, deleted, null)
}
