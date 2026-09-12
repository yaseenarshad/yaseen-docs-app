/**
 * Delete a column (YAZ-1513, Notion semantics, confirm-first): ONE function behind both doorways —
 * the table header's right-click and the Properties menu's detail panel. It removes
 *
 *  (a) the declaration `folder_page_settings.columns.<key>` on THIS folder page,
 *  (b) every reference the page's views hold to the key — `order`, `sort`, `groupBy`,
 *      `summaries`, `columnSize`, `cardStyle` — and its label under `properties`, so nothing
 *      dangles (a `frozenColumns` prefix follows the shortened order, as `setViewOrder` keeps it),
 *  (c) the key from the frontmatter of every DIRECT member that carries it.
 *
 * (a)+(b) are ONE settings write through the host's `setColumns` door — never a bypass of the
 * folder page host's echo guard (YAZ-1234/1241) — and they land FIRST: settings are the source of
 * truth, and the presence invariant (YAZ-999) must not re-add the key while the strips run. (c)
 * is per note, against fresh file bytes, byte-preserving every other key; a note whose record
 * shows the key but whose disk no longer does is simply not written. Failures are aggregated the
 * way `folderPageColumns.ts` aggregates its own — one error for the banner, successes committed,
 * no rollback; the next open is the retry.
 *
 * ACCEPTED (by ruling): a member that ALSO belongs to another folder page declaring the same key
 * gets it re-added by THAT page's presence invariant when it is next opened. The declaration is
 * per page; the value follows whichever declaration is live.
 *
 * Built-in columns are never deletable — `file.*`, `formula.*` and the reserved keys — only
 * hidden. `undeletableReason` is the one rule both menus disable their item by.
 */
import { setFrontmatterProperty } from '@shared/frontmatter'
import type { IndexRecord } from '@shared/types'
import { FOLDER_PAGES_KEY } from '../links/folderPages'
import { RESERVED_KEYS } from '../links/reservedKeys'
import type { ColumnDecl } from './folderPageSettings'
import { frozenColumnCount } from './view/frozenColumns'
import { canonicalKey } from './view/keys'
import { groupByLevels, type ViewDef, type ViewSet } from './viewSchema'
import { transformFile } from './writeProperty'

/** The tooltip a disabled "Delete column…" wears, or null when the key may go. */
export function undeletableReason(key: string): string | null {
  const c = canonicalKey(key)
  if (!c.startsWith('note.')) return 'Built-in column — hide it instead'
  const bare = c.slice(5)
  if (RESERVED_KEYS.has(bare) || bare === FOLDER_PAGES_KEY) return 'Built-in column — hide it instead'
  return null
}

/** The direct members whose card currently carries the key — the confirm sheet's count, the strip's list. */
export function membersCarrying(members: readonly IndexRecord[], key: string): IndexRecord[] {
  const bare = canonicalKey(key).slice('note.'.length)
  return members.filter((member) => Object.prototype.hasOwnProperty.call(member.properties, bare))
}

/** Every view minus every reference to the key; untouched views come back as the same object. */
export function pruneColumnFromViews(views: readonly ViewDef[], key: string): ViewDef[] {
  const c = canonicalKey(key)
  const names = (k: unknown): boolean => typeof k === 'string' && canonicalKey(k) === c
  return views.map((view) => {
    let changed = false
    const next: ViewDef = { ...view }
    if (Array.isArray(view.order)) {
      const order = view.order.filter((k) => !names(k))
      if (order.length !== view.order.length) {
        changed = true
        next.order = order
        // The frozen prefix is a COUNT over the shown columns (YAZ-1007): it follows the order.
        if (next.frozenColumns !== undefined) {
          const count = frozenColumnCount(next.frozenColumns, order.length)
          if (count === 0) delete next.frozenColumns
          else next.frozenColumns = count
        }
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
  /** The folder page's declarations as the host holds them. */
  columns: Readonly<Record<string, ColumnDecl>>
  /** The LIVE def (views + labels) — the host's `parsed.def`, never the index snapshot (YAZ-1234). */
  def: ViewSet
  /** The DIRECT members — the same set the presence invariant walks (YAZ-999). */
  members: readonly IndexRecord[]
  /** The host's one settings door (`FolderPageMode.setColumns`): declarations, views and labels in ONE write. */
  writeSettings: (columns: Record<string, ColumnDecl>, views: ViewDef[], properties: ViewSet['properties']) => void
}

/** Delete `key` everywhere on this page (see the module doc). Rejects with the aggregated member failures; the settings write is the host's to report. */
export async function deleteColumn(key: string, host: DeleteColumnHost): Promise<void> {
  const reason = undeletableReason(key)
  if (reason !== null) throw new Error(`Can't delete ${canonicalKey(key)}: ${reason.toLowerCase()}`)
  const bare = canonicalKey(key).slice('note.'.length)

  const columns: Record<string, ColumnDecl> = { ...host.columns }
  delete columns[bare]
  host.writeSettings(columns, pruneColumnFromViews(host.def.views, key), pruneColumnLabel(host.def.properties, key))

  const carrying = membersCarrying(host.members, key)
  const results = await Promise.allSettled(
    carrying.map((member) => transformFile(member.path, (content) => setFrontmatterProperty(content, bare, undefined))),
  )
  const failed = results.flatMap((result, index) =>
    result.status === 'rejected' ? [{ member: carrying[index]!, why: result.reason instanceof Error ? result.reason.message : String(result.reason) }] : [],
  )
  if (failed.length === 0) return
  throw new Error(
    `Could not remove "${bare}" from ${failed.length} ${failed.length === 1 ? 'note' : 'notes'}: ${failed.map(({ member, why }) => `${member.basename} (${why})`).join('; ')}`,
  )
}
