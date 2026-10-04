/**
 * Delete a column (YAZ-1513, Notion semantics, confirm-first): ONE function behind both doorways —
 * the table header's right-click and the Properties menu's detail panel. It removes
 *
 *  (a) the declaration `folder_settings.columns.<key>` of THIS folder,
 *  (b) every reference the folder's views hold to the key — `order`, `sort`, `groupBy`,
 *      `summaries`, `columnSize`, `cardStyle`, a cards `image`, and every filter leaf that names
 *      it — and its label under `properties`, so nothing dangles (a `frozenColumns` prefix follows
 *      the shortened order through the one order writer, `withOrder`),
 *  (c) the key from the frontmatter of every note the folder SHOWS that carries it — under it at
 *      any depth, or a shortcut — unless another folder showing that note has a column of that
 *      name, saved or default (`notesCarrying`).
 *
 * (a)+(b) are ONE settings write through the host's door — never a bypass of the folder
 * host's echo guard (YAZ-1234/1241) — and they land FIRST and are AWAITED: settings are the source
 * of truth, and if that write is refused nothing else moves (YAZ-1549). (c) is per note, against
 * fresh file bytes, byte-preserving every other key; a note whose record shows the key but whose
 * disk no longer does is simply not written. Strip failures are aggregated — one error for the
 * banner, successes committed, no rollback.
 *
 * Built-in columns are never deletable — `file.*`, `formula.*` and the reserved keys — only
 * hidden. `undeletableReason` is the one rule both menus disable their item by.
 */
import { setFrontmatterProperty } from '@shared/frontmatter'
import type { IndexRecord } from '@shared/types'
import { RESERVED_KEYS } from '../links/reservedKeys'
import { foldersById, foldersShowing } from '../links/shortcuts'
import { folderSettings, type ColumnDecl } from './folderSettings'
import { withOrder } from './view/columnOrder'
import { canonicalKey } from './view/keys'
import { groupByLevels, type FilterNode, type ViewDef, type ViewSet } from './viewSchema'
import { transformFile } from './writeProperty'

const bareOf = (key: string): string => canonicalKey(key).slice('note.'.length)

/** The tooltip a disabled "Delete column…" wears, or null when the key may go. */
export function undeletableReason(key: string): string | null {
  const c = canonicalKey(key)
  return !c.startsWith('note.') || RESERVED_KEYS.has(c.slice('note.'.length)) ? 'Built-in column — hide it instead' : null
}

/**
 * The rows of `folder` whose frontmatter carries the key, by what a delete does to each — the
 * confirm sheet's two counts, the strip's list. `strip` lose the value; `keep` hold it, because
 * another folder showing the note has a column of that name: one it saved, or the default one.
 * With no folder (null — no folder host) nothing is kept.
 */
export function notesCarrying(rows: readonly IndexRecord[], key: string, folder: string | null, folders: readonly IndexRecord[]): { strip: IndexRecord[]; keep: IndexRecord[] } {
  const bare = bareOf(key)
  const byId = foldersById(folders)
  const settings = new Map(folders.map((record) => [record.folder, record]))
  const declared = new Map<string, boolean>()
  const declares = (other: string): boolean => {
    let has = declared.get(other)
    if (has === undefined) declared.set(other, (has = Object.prototype.hasOwnProperty.call(folderSettings(settings.get(other)).columns, bare)))
    return has
  }
  const strip: IndexRecord[] = []
  const keep: IndexRecord[] = []
  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(row.properties, bare)) continue
    const kept = folder !== null && foldersShowing(row.folder, row.properties, byId).some((other) => other !== folder && declares(other))
    ;(kept ? keep : strip).push(row)
  }
  return { strip, keep }
}

/** Every `"…"` / `'…'` literal blanked (escapes honoured), so a key spelled INSIDE a string is not a reference. */
const withoutStringLiterals = (expr: string): string => expr.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')

/**
 * Does a filter expression name the column? The identifier `note.<key>` or the bare `<key>` as a
 * whole token, outside string literals — a tokenizer-free check: literals go first, then a
 * word-boundary match (YAZ-1549).
 */
export function filterMentions(expr: string, key: string): boolean {
  const bare = bareOf(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\w.])(note\\.)?${bare}(?![\\w])`).test(withoutStringLiterals(expr))
}

/**
 * The filter minus every leaf that names the key: an emptied `and` / `or` / `not` node goes with
 * its last leaf, and `undefined` means the whole filter went. The same node comes back when
 * nothing under it changed.
 */
export function pruneFilter(node: FilterNode, key: string): FilterNode | undefined {
  if (typeof node === 'string') return filterMentions(node, key) ? undefined : node
  const [op, children] = Object.entries(node)[0] as ['and' | 'or' | 'not', FilterNode[]]
  const kept = children.map((child) => pruneFilter(child, key)).filter((child): child is FilterNode => child !== undefined)
  if (kept.length === 0) return undefined
  if (kept.length === children.length && kept.every((child, i) => child === children[i])) return node
  return { [op]: kept } as FilterNode
}

/** Every view minus every reference to the key; untouched views come back as the same object. */
export function pruneColumnFromViews(views: readonly ViewDef[], key: string): ViewDef[] {
  const c = canonicalKey(key)
  const names = (k: unknown): boolean => typeof k === 'string' && canonicalKey(k) === c
  return views.map((view) => {
    let changed = false
    let next: ViewDef = { ...view }
    if (Array.isArray(view.order)) {
      const order = view.order.filter((k) => !names(k))
      if (order.length !== view.order.length) {
        changed = true
        next = withOrder(next, order)
      }
    }
    if (Array.isArray(view.sort)) {
      const sort = view.sort.filter((s) => !names(s.property))
      if (sort.length !== view.sort.length) {
        changed = true
        if (sort.length === 0) delete next.sort
        else next.sort = sort
      }
    }
    if (view.groupBy !== undefined) {
      const levels = groupByLevels(view)
      const kept = levels.filter((g) => !names(g.property))
      if (kept.length !== levels.length) {
        changed = true
        if (kept.length === 0) delete next.groupBy
        else next.groupBy = Array.isArray(view.groupBy) ? kept : kept[0]
      }
    }
    if (names(view.image)) {
      changed = true
      delete next.image
    }
    if (view.filters !== undefined) {
      const filters = pruneFilter(view.filters, key)
      if (filters !== view.filters) {
        changed = true
        if (filters === undefined) delete next.filters
        else next.filters = filters
      }
    }
    for (const map of ['summaries', 'columnSize', 'cardStyle'] as const) {
      const entries = view[map]
      if (entries === undefined || entries === null || typeof entries !== 'object') continue
      const keptEntries = Object.fromEntries(Object.entries(entries).filter(([k]) => !names(k)))
      if (Object.keys(keptEntries).length === Object.keys(entries).length) continue
      changed = true
      if (Object.keys(keptEntries).length === 0) delete next[map]
      else (next as Record<string, unknown>)[map] = keptEntries
    }
    return changed ? next : view
  })
}

/** The labels minus the key's entry (any spelling); undefined once none are left, so the key deletes itself. */
export function pruneColumnLabel(properties: ViewSet['properties'], key: string): ViewSet['properties'] {
  if (properties === undefined) return undefined
  const c = canonicalKey(key)
  const kept = Object.fromEntries(Object.entries(properties).filter(([k]) => canonicalKey(k) !== c))
  return Object.keys(kept).length === 0 ? undefined : kept
}

export interface DeleteColumnHost {
  /** The folder's declarations as the host holds them — its AHEAD copy (YAZ-1549), never a stale snapshot. */
  columns: Readonly<Record<string, ColumnDecl>>
  /** The LIVE def (views + labels) — the host's `parsed.def`, never the index snapshot (YAZ-1234). */
  def: ViewSet
  /** The folder's rows, the folder as the index names it, and every folder's settings record: what `notesCarrying` decides the strip by. */
  rows: readonly IndexRecord[]
  folder: string
  folders: readonly IndexRecord[]
  /** The host's one settings door: declarations, views and labels in ONE write. Resolves when it landed; rejects when it did not. */
  writeSettings: (columns: Record<string, ColumnDecl>, views: ViewDef[], properties: ViewSet['properties']) => Promise<void>
}

/**
 * Delete `key` everywhere in this folder (see the module doc). The settings write is awaited and a
 * refusal ABORTS — no note is touched; the host has already surfaced that error. Rejects with
 * the aggregated strip failures otherwise.
 */
export async function deleteColumn(key: string, host: DeleteColumnHost): Promise<void> {
  const reason = undeletableReason(key)
  if (reason !== null) throw new Error(`Can't delete ${canonicalKey(key)}: ${reason.toLowerCase()}`)
  const bare = bareOf(key)

  const columns: Record<string, ColumnDecl> = { ...host.columns }
  delete columns[bare]
  await host.writeSettings(columns, pruneColumnFromViews(host.def.views, key), pruneColumnLabel(host.def.properties, key))

  const { strip } = notesCarrying(host.rows, key, host.folder, host.folders)
  const results = await Promise.allSettled(
    strip.map((note) => transformFile(note.path, (content) => setFrontmatterProperty(content, bare, undefined))),
  )
  const failed = results.flatMap((result, index) =>
    result.status === 'rejected' ? [{ note: strip[index]!, why: result.reason instanceof Error ? result.reason.message : String(result.reason) }] : [],
  )
  if (failed.length === 0) return
  throw new Error(
    `Could not remove "${bare}" from ${failed.length} ${failed.length === 1 ? 'note' : 'notes'}: ${failed.map(({ note, why }) => `${note.basename} (${why})`).join('; ')}`,
  )
}
