import { isRecord, isStringArray } from './guards'
import { atOf, macListFile, macListFiles } from './vaultLists'

/**
 * THE FILES TAB'S MANUAL ORDER (YAZ-5916), kept in the vault by the Focus list's rule (Q3): ONE FILE FOR EACH MAC,
 * `.yaseendocs/files-order.<mac id>.json` = `{ version: 1, at, folders, sort, reverse }`, written only by its own Mac; the
 * NEWEST valid file is the order (`pickNewest`), on every Mac and on the phone. Pure, shared by the Mac's main process
 * (`desktop/src/main/filesOrder.ts`, which writes this Mac's file), the sidebar (`sortLevel`) and the phone (read only).
 *
 * `folders` maps a folder, VAULT-RELATIVE ('' is the vault's top), to the NAMES of its items in the person's order. A
 * name the folder no longer holds is passed over; an item the list does not name goes at the end, folders first, then
 * files, each by name (D1, D3). `sort` and `reverse` (Q4): the Files sort of the Mac that wrote the file, written again
 * at each change of it; the phone, which cannot see a Mac's settings, sorts its tree by the newest file's (D4): Manual by
 * the order, Name or Last updated as that. A file with no `sort` reads as Name, A to Z.
 */

export const FILES_ORDER_LIST = 'files-order'
/** The name of a Mac's order file. */
export const filesOrderFile = (mac: string): string => macListFile(FILES_ORDER_LIST, mac, 'vault')
/** The order files among the dotfolder's `names`, in name order (the read's cap, `MAX_LIST_FILES`). */
export const filesOrderFiles = (names: readonly string[]): string[] => macListFiles(names, FILES_ORDER_LIST, 'vault')

/** A vault keeps an order for this many folders at most, and this many names in one folder: a hand edit must not make a read slow. */
export const MAX_ORDER_FOLDERS = 5000
export const MAX_ORDER_NAMES = 2000

export type FolderOrders = Readonly<Record<string, readonly string[]>>

/** A Files sort as the file keeps it (Q4): what it sorts by, and whether the natural way is flipped. */
export type FilesSortBy = 'manual' | 'name' | 'updated'
export interface FilesSort {
  by: FilesSortBy
  reverse: boolean
}
export const DEFAULT_FILES_SORT: FilesSort = { by: 'name', reverse: false }
export const isFilesSort = (v: unknown): v is FilesSort => isRecord(v) && (v.by === 'manual' || v.by === 'name' || v.by === 'updated') && typeof v.reverse === 'boolean'

/** The order on the bridge (`filesOrder.get`): each folder by its ABSOLUTE path, and the newest file's Files sort. */
export interface FilesOrderState {
  sort: FilesSort
  folders: Record<string, string[]>
}

/** One Mac's order file as read: its time in ms, the orders, and that Mac's Files sort. */
export interface FilesOrder {
  at: number
  folders: FolderOrders
  sort: FilesSort
}

/** A folder key: '' or a relative POSIX path with no `..`, no empty part and no NUL. */
const isFolderKey = (k: string): boolean => k === '' || (!k.startsWith('/') && !k.includes('\0') && k.split('/').every((part) => part !== '' && part !== '..' && part !== '.'))
/** An item name: one path part. */
const isName = (n: string): boolean => n !== '' && n !== '.' && n !== '..' && !n.includes('/') && !n.includes('\0')

/** The safe orders of `v`, each name once; an empty list is no order. */
export function cleanOrders(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!isRecord(v)) return out
  let count = 0
  for (const [key, names] of Object.entries(v)) {
    if (count >= MAX_ORDER_FOLDERS) break
    if (!isFolderKey(key) || !isStringArray(names)) continue
    const kept = [...new Set(names.filter(isName))].slice(0, MAX_ORDER_NAMES)
    if (kept.length === 0) continue
    out[key] = kept
    count++
  }
  return out
}

/** A parsed order file, cleaned; null when it is not `{ version: 1, at, folders }` (another Mac's bad file is passed over). */
export function filesOrderOf(v: unknown): FilesOrder | null {
  if (!isRecord(v) || v.version !== 1 || !isRecord(v.folders)) return null
  const at = atOf(v)
  const sort = { by: v.sort, reverse: v.reverse === true }
  return at === null ? null : { at, folders: cleanOrders(v.folders), sort: isFilesSort(sort) ? sort : DEFAULT_FILES_SORT }
}

/**
 * The items of one folder in its Manual order: the named ones in the list's order, then every other item by `rest`
 * (the Name rule: folders first, then files, by name). Never drops or adds an item.
 */
export function inOrder<T>(items: readonly T[], nameOf: (item: T) => string, listed: readonly string[] | undefined, rest: (a: T, b: T) => number): T[] {
  if (listed === undefined || listed.length === 0) return [...items].sort(rest)
  const at = new Map(listed.map((name, i) => [name, i]))
  const known: T[] = []
  const unknown: T[] = []
  for (const item of items) (at.has(nameOf(item)) ? known : unknown).push(item)
  known.sort((a, b) => (at.get(nameOf(a)) ?? 0) - (at.get(nameOf(b)) ?? 0))
  return [...known, ...unknown.sort(rest)]
}

/**
 * A folder's list while the tree catches up (YAZ-5934): main writes the order of a rename or a delete before the
 * watcher's echo changes the tree, so for a moment the tree shows an item that the new list (`listed`) no longer
 * names. Each name of the list used before (`was`) that `listed` does not name, but the tree still shows
 * (`shown`), keeps its place: after the name that stood before it in `was`. A name the tree no longer shows drops,
 * so a new item of that name later is unknown (last), as D1 has it. The same list back when nothing is carried.
 */
export function carriedOrder(was: readonly string[] | undefined, listed: readonly string[], shown: (name: string) => boolean): readonly string[] {
  if (was === undefined || was === listed) return listed
  const named = new Set(listed)
  if (!was.some((name) => !named.has(name) && shown(name))) return listed
  const out = [...listed]
  was.forEach((name, i) => {
    if (named.has(name) || !shown(name)) return
    let at = 0
    for (let j = i - 1; j >= 0; j--) {
      const k = out.indexOf(was[j])
      if (k >= 0) {
        at = k + 1
        break
      }
    }
    out.splice(at, 0, name)
  })
  return out
}

const parentOf = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')
const nameOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1)
const isAtOrBelow = (key: string, rel: string): boolean => key === rel || key.startsWith(`${rel}/`)

/** Where an item stood in its folder's list when a move took it out (YAZ-5935): the name before it (null: first) and its index. */
export interface LeftPlace {
  before: string | null
  index: number
}

/** The place in `list` for an item back from a move: after the name that stood before it, else at its old index. */
const placeIn = (list: readonly string[], back: LeftPlace): number => {
  if (back.before === null) return 0
  const i = list.indexOf(back.before)
  return i >= 0 ? i + 1 : Math.min(back.index, list.length)
}

/** Where the item at `rel` stands in its folder's list, as a move out of the folder leaves it; null when the list does not name it. */
export function placeOf(folders: FolderOrders, rel: string): LeftPlace | null {
  const list = folders[parentOf(rel)]
  const index = list?.indexOf(nameOf(rel)) ?? -1
  return list === undefined || index < 0 ? null : { before: index > 0 ? list[index - 1] : null, index }
}

/**
 * The orders after a rename or a move of the item at `oldRel` (vault-relative) to `newRel` (D1): a rename in its folder
 * keeps its place; a move to another folder takes it out of the old list and puts it last in the new folder's list,
 * when that folder has one (else it is unknown there, so last anyway). A folder's own orders, and every order below
 * it, follow it. `newRel` null: the item left the vault (out of every list). `back`: the move brings the item back to
 * the folder that it left (an Undo, YAZ-5935), so it takes its old place, not the last one. Null: nothing changed.
 */
export function renamedOrders(folders: FolderOrders, oldRel: string, newRel: string | null, back?: LeftPlace): Record<string, string[]> | null {
  if (oldRel === '' || oldRel === newRel) return null
  const out: Record<string, string[]> = {}
  let changed = false
  for (const [key, names] of Object.entries(folders)) {
    if (!isAtOrBelow(key, oldRel)) {
      out[key] = [...names]
      continue
    }
    changed = true
    if (newRel !== null) out[newRel + key.slice(oldRel.length)] = [...names]
  }
  const from = parentOf(oldRel)
  const oldName = nameOf(oldRel)
  const list = out[from]
  const i = list?.indexOf(oldName) ?? -1
  if (newRel !== null && parentOf(newRel) === from) {
    if (i >= 0) {
      list[i] = nameOf(newRel)
      out[from] = [...new Set(list)]
      changed = true
    }
    return changed ? out : null
  }
  if (i >= 0) {
    list.splice(i, 1)
    if (list.length === 0) delete out[from]
    changed = true
  }
  if (newRel !== null) {
    const to = parentOf(newRel)
    const there = out[to]
    if (there !== undefined && !there.includes(nameOf(newRel))) {
      there.splice(back === undefined ? there.length : placeIn(there, back), 0, nameOf(newRel))
      changed = true
    }
  }
  return changed ? out : null
}

/** The orders with one folder's list replaced (an empty list removes it). */
export function withFolderOrder(folders: FolderOrders, dir: string, names: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = Object.fromEntries(Object.entries(folders).map(([k, v]) => [k, [...v]]))
  const kept = [...new Set(names.filter(isName))].slice(0, MAX_ORDER_NAMES)
  if (kept.length === 0) delete out[dir]
  else out[dir] = kept
  return out
}

/** Two order sets hold the same lists. */
export function sameOrders(a: FolderOrders, b: FolderOrders): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => b[k] !== undefined && a[k].length === b[k].length && a[k].every((n, i) => n === b[k][i]))
}
