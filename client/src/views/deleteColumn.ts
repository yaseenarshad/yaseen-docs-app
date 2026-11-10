/**
 * Delete a column (YAZ-1513, Notion semantics, confirm-first): ONE function behind both doorways —
 * the table header's right-click and the Properties menu's detail panel. It removes
 *
 *  (a) the declaration `folder_settings.columns.<key>` of THIS folder,
 *  (b) every reference the folder's views hold to the key — `order`, `sort`, `groupBy`,
 *      `summaries`, `columnSize`, `columnWrap`, `columnAlign`, `columnFill`, `cardStyle`, a cards `image`, a calendar's `dateProperty`, the cell
 *      `fills` in it, and every filter leaf that names it — and its label under `properties`, so nothing dangles (a
 *      `frozenColumns` prefix loses the column if it held it, then follows the shortened order through the one order
 *      writer, `withOrder`),
 *  (b') the same references in the views of every `.folder.md` below the folder whose page takes the column from it
 *      (YAZ-4713 C7, `below`): no view under the owner keeps pointing at a column that is gone,
 *  (c) with "Delete column and clear N values" only (C7): the value from every note the host names (`records`) that
 *      holds it (`notesHolding`) — the note's own field (C1), or for a separate column (C3) this page's block of `in`
 *      (D19, `shared/folderValues.ts`). "Keep the values in the notes" leaves every note as it is: the field then
 *      shows under "Other properties". Nothing else in a note is touched, and a read-only note is never written.
 *
 * (a)+(b) are ONE settings write through the host's door — never a bypass of the folder
 * host's echo guard (YAZ-1234/1241) — and they land FIRST and are AWAITED: settings are the source
 * of truth, and if that write is refused nothing else moves (YAZ-1549). (b') is one quiet write per file. (c) is per note, against
 * fresh file bytes, byte-preserving every other key; a note whose record shows the field but whose
 * disk no longer does is simply not written. Strip failures are aggregated — one error for the
 * banner, successes committed, no rollback.
 *
 * Built-in columns are never deletable — `file.*`, `formula.*` and the reserved keys — only
 * hidden. `undeletableReason` is the one rule both menus disable their item by.
 */
import { folderValues } from '@shared/folderValues'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { foldedValue, heldKey, setFolderValueOneSpelling, setOneSpelling } from '@shared/propertyKeys'
import { isRecord } from '@shared/guards'
import { isReadOnlyProperties } from '@shared/readOnly'
import type { IndexRecord } from '@shared/types'
import { reservedKeys } from '../links/reservedKeys'
import { propertyLabel } from './engine'
import { type ColumnDecl, rebaseSettings, rewriteFolderViews } from './folderSettings'
import type { ValueHome } from './renameOption'
import { withOrder } from './view/columnOrder'
import { frozenColumnCount } from './view/frozenColumns'
import { canonicalKey } from './view/keys'
import { groupByLevels, type FilterNode, type ViewDef, type ViewSet } from './viewSchema'
import { transformFile } from './writeProperty'

const bareOf = (key: string): string => canonicalKey(key).slice('note.'.length)

/** The tooltip a disabled "Delete column…" wears, or null when the key may go. */
export function undeletableReason(key: string): string | null {
  const c = canonicalKey(key)
  return !c.startsWith('note.') || reservedKeys(true).has(c.slice('note.'.length)) ? 'Built-in column — hide it instead' : null
}

/**
 * The indexed notes holding the field where `home` says (YAZ-4713 C7): the note's own field (null), or the block of the
 * page with that id (a separate column, C3) — the notes a delete clears, and the confirm sheet's count.
 */
export function notesHolding(records: readonly IndexRecord[], home: ValueHome, key: string): IndexRecord[] {
  const bare = bareOf(key)
  // YAZ-4769: a note holds the column in any capitals.
  return records.filter((record) => heldKey(home === null ? record.properties : folderValues(record.properties, home.block), bare) !== undefined)
}

/**
 * One note's bytes with `value` put where `home` says (`undefined` removes it); a note read only on disk stays as it is (YAZ-3076 D6).
 * YAZ-4769: under the column's spelling, the note's other spellings going in the same write; the app's keys never.
 */
function setValue(content: string, home: ValueHome, bare: string, value: unknown): string {
  const parsed = parseFrontmatter(splitFrontmatter(content).frontmatter)
  // A file that does not parse is refused by the writer below, in its own words.
  if (!parsed.error && isReadOnlyProperties(parsed.properties)) return content
  return home === null ? setOneSpelling(content, bare, value, reservedKeys(true)) : setFolderValueOneSpelling(content, home.block, bare, value)
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
        // A frozen column that goes takes its place in the frozen count with it (YAZ-4596 S37): the line stays
        // after the same column, and the column after it does not freeze in its place.
        const frozen = frozenColumnCount(view.frozenColumns, view.order.length)
        const frozenGone = view.order.slice(0, frozen).filter(names).length
        next = withOrder(frozenGone > 0 ? { ...next, frozenColumns: frozen - frozenGone } : next, order)
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
    // A calendar's "Show by" (YAZ-4596 S37): it falls back to the first date column.
    if (names(view.dateProperty)) {
      changed = true
      delete next.dateProperty
    }
    // A cell fill in the column goes; a row fill stays (YAZ-4596 S37).
    if (Array.isArray(view.fills)) {
      const fills = view.fills.filter((fill: unknown) => !(isRecord(fill) && names(fill.column)))
      if (fills.length !== view.fills.length) {
        changed = true
        if (fills.length === 0) delete next.fills
        else next.fills = fills
      }
    }
    if (view.filters !== undefined) {
      const filters = pruneFilter(view.filters, key)
      if (filters !== view.filters) {
        changed = true
        if (filters === undefined) delete next.filters
        else next.filters = filters
      }
    }
    for (const map of ['summaries', 'columnSize', 'columnWrap', 'columnAlign', 'columnFill', 'cardStyle'] as const) {
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
  /**
   * The notes (and subfolder `.folder.md`s, D31) whose value a "clear" removes — those that hold it go (`notesHolding`) —
   * and where the value is (`home`): the note's own field (C1), or this page's block for a separate column (C3).
   */
  records: readonly IndexRecord[]
  home: ValueHome
  /** C7: the other `.folder.md`s whose views lose their references to the column too, in the same Undo. */
  below?: readonly IndexRecord[]
  /** The host's one settings door: declarations, views and labels in ONE write. Resolves when it landed; rejects when it did not. */
  writeSettings: (columns: Record<string, ColumnDecl>, views: ViewDef[], properties: ViewSet['properties']) => Promise<void>
  /**
   * The S29 Undo toast (YAZ-4608 C6): `restore` writes the declaration, the views' references and the label back, in
   * ONE settings write, then each note's value back (YAZ-3746 13AY: the values the delete took from the notes, kept at
   * the delete). It rejects with the notes it could not write back.
   */
  notice?: (message: string, restore: () => Promise<void>) => void
  /**
   * The declarations, def and settings door CURRENT when the Undo runs (YAZ-4637 M3): the restore inverts only the delete
   * on them. The door too (YAZ-3746 13AY): the delete's own door compares against the settings of its render, which
   * still held the column, so it saw no change and the declaration never came back. Absent: this host's.
   */
  current?: () => Pick<DeleteColumnHost, 'columns' | 'def'> & Partial<Pick<DeleteColumnHost, 'writeSettings'>>
}

/** The references a delete takes out of one stored views list and its labels (C7): a list that is not one stays as it is. */
export const pruneStored = (key: string) => (views: unknown, properties: unknown) => ({
  views: Array.isArray(views) ? pruneColumnFromViews(views as ViewDef[], key) : views,
  properties: isRecord(properties) ? pruneColumnLabel(properties as ViewSet['properties'], key) : properties,
})

/**
 * Delete `key` everywhere in this folder (see the module doc); `clear` false keeps every note's value (C7). The
 * settings write is awaited and a refusal ABORTS — no note is touched; the host has already surfaced that error.
 * Rejects with the aggregated failures otherwise.
 */
export async function deleteColumn(key: string, host: DeleteColumnHost, clear = true): Promise<void> {
  const reason = undeletableReason(key)
  if (reason !== null) throw new Error(`Can't delete ${canonicalKey(key)}: ${reason.toLowerCase()}`)
  const bare = bareOf(key)

  const before = { columns: { ...host.columns }, views: structuredClone(host.def.views), properties: structuredClone(host.def.properties) }
  const { home } = host
  // Each note's value, kept before the strip, so the Undo puts it back (YAZ-3746 13AY).
  const strip = clear ? notesHolding(host.records, home, key) : []
  const values = strip.map((note) => ({ note, value: foldedValue(home === null ? note.properties : folderValues(note.properties, home.block), bare) }))
  const columns: Record<string, ColumnDecl> = { ...host.columns }
  delete columns[bare]
  const pruned = { views: pruneColumnFromViews(host.def.views, key), properties: pruneColumnLabel(host.def.properties, key) }
  await host.writeSettings(columns, pruned.views, pruned.properties)
  // The views below (C7): each file's views and labels as they were, and as the prune left them, for the Undo's rebase.
  const prune = pruneStored(key)
  const belowDone = await Promise.allSettled(
    (host.below ?? []).map(async (record) => {
      const was = await rewriteFolderViews(record.path, prune)
      return { path: record.path, was, now: prune(was.views, was.properties) }
    }),
  )
  const prunedBelow = belowDone.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  // The Undo inverts the delete alone (YAZ-4637 M3): the declaration back among the declarations current then, and the
  // views' references and the label laid back onto the def current then by the one rebase — a later sort or view stays.
  host.notice?.(`Deleted column ${propertyLabel(host.def, key)}`, () => {
    const now = (host.current ?? (() => host))()
    const declaration = before.columns[bare]
    const { [bare]: _gone, ...others } = now.columns
    const labels = rebaseSettings(pruned.properties ?? {}, before.properties ?? {}, now.def.properties ?? {}) as Record<string, { displayName?: string }>
    return (now.writeSettings ?? host.writeSettings)(
        declaration === undefined ? others : { ...others, [bare]: declaration },
        rebaseSettings(pruned.views, before.views, now.def.views) as ViewDef[],
        Object.keys(labels).length === 0 ? undefined : labels,
      ).then(async () => {
        // The views below (C7), each laid back onto the file as it is then, by the same rebase.
        const views = await Promise.allSettled(
          prunedBelow.map(({ path, was, now: left }) => rewriteFolderViews(path, (nowViews, nowLabels) => ({ views: rebaseSettings(left.views, was.views, nowViews), properties: rebaseSettings(left.properties, was.properties, nowLabels) }))),
        )
        const back = await Promise.allSettled(values.map(({ note, value }) => transformFile(note.path, (content) => setValue(content, home, bare, value), true)))
        const lost = back.flatMap((result, index) => (result.status === 'rejected' ? [values[index]!.note.title] : []))
        const pages = views.filter((result) => result.status === 'rejected').length
        if (lost.length > 0) throw new Error(`Could not put "${bare}" back on ${lost.length} ${lost.length === 1 ? 'note' : 'notes'}: ${lost.join(', ')}`)
        if (pages > 0) throw new Error(`Could not put "${bare}" back in the views of ${pages} ${pages === 1 ? 'folder page' : 'folder pages'}`)
      })
  })

  const results = await Promise.allSettled(strip.map((note) => transformFile(note.path, (content) => setValue(content, home, bare, undefined), true))) // quiet: a tidy-up of each note (YAZ-3235 D1)
  const failed = results.flatMap((result, index) =>
    result.status === 'rejected' ? [{ note: strip[index]!, why: result.reason instanceof Error ? result.reason.message : String(result.reason) }] : [],
  )
  const pagesFailed = belowDone.filter((result) => result.status === 'rejected').length
  if (failed.length > 0)
    throw new Error(
      `Could not remove "${bare}" from ${failed.length} ${failed.length === 1 ? 'note' : 'notes'}: ${failed.map(({ note, why }) => `${note.title} (${why})`).join('; ')}`,
    )
  if (pagesFailed > 0) throw new Error(`Could not remove "${bare}" from the views of ${pagesFailed} ${pagesFailed === 1 ? 'folder page' : 'folder pages'}`)
}
