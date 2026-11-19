import type { IndexRecord } from '@shared/types'
import { inOrder, type FilesSort, type FolderOrders } from '@shared/filesOrder'
import { boardKindOf } from '../drawing/boardFiles'

/**
 * THE MAC'S SIDEBAR TREE ON THE PHONE: the Files tree of the Mac (`client/src/sidebar/Tree.tsx`), cut to
 * what the phone opens: folders, pages and card files. The pure parts, copied from the Mac (its modules pull the
 * desktop's tree feed and bridge, which the phone's import wall stops):
 *  - The ORDER is the Mac's default (`treeSort.ts` `sortLevel`, Sort Name A to Z, `DEFAULT_SIDEBAR_SORT`): each level
 *    folders first, then files, each by the name the row shows, case-blind, "Phase 2" before "Phase 10".
 *  - The NAME is the Mac's (`pathTitles.ts` `pageLabel`): a page's and a card file's title; a folder's own title (its
 *    `.folder.md`), else its folder name.
 *  - The ICON is the Mac's default (Material set, file icons "Colour"/quiet, folder icons "Plain", `app.css`): a folder's
 *    Material folder (open while open), a page's grey page glyph, a card file's card in the card colour (`search.css`).
 * Hidden folders and files (a name that starts with `.`) are not in it, as on the Mac.
 *
 * FAST FOR 5,000 PAGES: `buildTree` is one pass that only groups (no sort). A level is sorted the first time it is
 * opened, then kept. `visibleRows` walks only the open folders, so a closed folder costs nothing.
 */

export type TreeKind = 'folder' | 'page' | 'card' | 'drawing' | 'diagram'

export interface TreeFolder {
  path: string
  name: string
  folders: Map<string, TreeFolder>
  files: IndexRecord[]
  /** The Mac's Files sort (YAZ-5916 Q4, the vault's newest `files-order.<mac id>.json`); absent: Name, A to Z. */
  sort?: FilesSort
  /** Under Manual: this folder's items by name, in the Mac's order (D4). */
  order?: readonly string[]
}

/** What the phone's tree follows of the Mac's Files tab (YAZ-5916 D4, Q4): its sort, and under Manual each folder's order. */
export interface TreeView {
  sort: FilesSort
  folders: FolderOrders
}

export interface TreeRow {
  kind: TreeKind
  path: string
  label: string
  depth: number
  /** A folder row: it is open. */
  open?: boolean
  /** A card file's card ID (what the card view opens). */
  id?: string
}

/** Names in reading order (the Mac's `treeSort.ts`): case-blind, numbers as numbers. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const hidden = (part: string) => part.startsWith('.')

/** The tree of `records` (pages and card files); `folders` are the `.folder.md` records that name a folder. */
export function buildTree(records: readonly IndexRecord[], folders: readonly IndexRecord[] = [], view?: TreeView | null): TreeFolder {
  const sort = view === null || view === undefined || (view.sort.by === 'name' && !view.sort.reverse) ? undefined : view.sort
  const orders = sort?.by === 'manual' ? view?.folders : undefined
  const viewOf = (path: string) => ({ ...(sort !== undefined && { sort }), ...(orders?.[path] !== undefined && { order: orders[path] }) })
  const root: TreeFolder = { path: '', name: '', folders: new Map(), files: [], ...viewOf('') }
  const titles = new Map<string, string>()
  for (const f of folders) {
    const dir = f.path.slice(0, Math.max(0, f.path.lastIndexOf('/')))
    if (dir !== '' && f.title.trim() !== '') titles.set(dir, f.title)
  }
  for (const record of records) {
    const parts = record.path.split('/')
    if (parts.some(hidden)) continue
    let at = root
    for (let i = 0; i < parts.length - 1; i++) {
      let next = at.folders.get(parts[i])
      if (next === undefined) {
        const path = parts.slice(0, i + 1).join('/')
        next = { path, name: titles.get(path) ?? parts[i], folders: new Map(), files: [], ...viewOf(path) }
        at.folders.set(parts[i], next)
      }
      at = next
    }
    at.files.push(record)
  }
  return root
}

/** A page's or a card file's name: the Mac's `pageLabel` (the title, else the file name without its extension). */
export const fileLabel = (record: IndexRecord): string => (record.title.trim() !== '' ? record.title : record.name.replace(/\.(md|markdown)$/i, ''))

/** A page, a card file, or a drawing file (the Mac's drawing and diagram rows). */
export const fileKind = (record: IndexRecord): TreeKind => (record.kind === 'card' ? 'card' : (boardKindOf(record.path) ?? 'page'))

interface Level {
  folders: TreeFolder[]
  files: { record: IndexRecord; label: string }[]
  /** The Mac's Manual order (YAZ-5916): folders and files mixed as the person put them; unnamed items last, in the Name order. */
  mixed?: ({ folder: TreeFolder } | { record: IndexRecord; label: string })[]
}

/** A folder's own name on disk (its row may show its title). */
const dirName = (folder: TreeFolder): string => folder.path.slice(folder.path.lastIndexOf('/') + 1)
const levels = new WeakMap<TreeFolder, Level>()

/** A folder's time for Last updated: its newest file anywhere inside (the Mac's `timeOf`), once per folder. */
const times = new WeakMap<TreeFolder, number>()
function timeOf(folder: TreeFolder): number {
  let time = times.get(folder)
  if (time === undefined) {
    time = Math.max(0, ...folder.files.map((r) => r.mtime), ...[...folder.folders.values()].map(timeOf))
    times.set(folder, time)
  }
  return time
}

/** One level in the Mac's order, sorted once. */
export function levelOf(folder: TreeFolder): Level {
  let level = levels.get(folder)
  if (level === undefined) {
    // The Mac's sort (Q4): Name or Last updated, each way; folders first, then files, as on the Mac. Manual: Name, then the order.
    const by = folder.sort?.by === 'updated' ? 'updated' : 'name'
    const way = folder.sort?.reverse === true && folder.sort.by !== 'manual' ? -1 : 1
    const folders = [...folder.folders.values()].sort((a, b) => way * (by === 'updated' ? timeOf(b) - timeOf(a) || collator.compare(a.name, b.name) : collator.compare(a.name, b.name)))
    const files = folder.files.map((record) => ({ record, label: fileLabel(record) })).sort((a, b) => way * (by === 'updated' ? b.record.mtime - a.record.mtime || collator.compare(a.label, b.label) : collator.compare(a.label, b.label)))
    const named = [...folders.map((f) => ({ folder: f })), ...files]
    const rank = new Map(named.map((item, i) => [item, i]))
    const mixed = folder.order === undefined ? undefined : inOrder(named, (item) => ('folder' in item ? dirName(item.folder) : item.record.name), folder.order, (a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
    levels.set(folder, (level = { folders, files, ...(mixed !== undefined && { mixed }) }))
  }
  return level
}

/**
 * The rows that show: each level of `root` in order, and inside each OPEN folder its own rows, to any depth.
 * `files`: which files show (Pages leaves card files out).
 */
export function visibleRows(root: TreeFolder, open: ReadonlySet<string>, files: (record: IndexRecord) => boolean = () => true): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (folder: TreeFolder, depth: number) => {
    const level = levelOf(folder)
    const items = level.mixed ?? [...level.folders.map((f) => ({ folder: f })), ...level.files]
    for (const item of items) {
      if ('folder' in item) {
        const sub = item.folder
        const isOpen = open.has(sub.path)
        rows.push({ kind: 'folder', path: sub.path, label: sub.name, depth, open: isOpen })
        if (isOpen) walk(sub, depth + 1)
        continue
      }
      const { record, label } = item
      if (!files(record)) continue
      const kind = fileKind(record)
      const id = kind === 'card' ? (record.cards?.find((c) => c.id !== null)?.id ?? undefined) : undefined
      rows.push({ kind, path: record.path, label, depth, ...(id != null && { id }) })
    }
  }
  walk(root, 0)
  return rows
}
