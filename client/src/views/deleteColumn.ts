/**
 * Delete a column (YAZ-1513, Notion semantics, confirm-first): ONE function behind both doorways —
 * the table header's right-click and the Properties menu's detail panel. It removes
 *
 *  (a) the declaration `folder_settings.columns.<key>` of THIS folder,
 *  (b) every reference the folder's views hold to the key — `order`, `sort`, `groupBy`,
 *      `summaries`, `columnSize`, `cardStyle`, a cards `image`, and every filter leaf that names
 *      it — and its label under `properties`, so nothing dangles (a `frozenColumns` prefix follows
 *      the shortened order through the one order writer, `withOrder`),
 *  (c) the field from THIS folder's block (D19, `shared/folderValues.ts`) in every indexed note
 *      that holds it there (`notesHolding`). Nothing else in a note is touched: not its own field
 *      of that name, not another folder's.
 *
 * (a)+(b) are ONE settings write through the host's door — never a bypass of the folder
 * host's echo guard (YAZ-1234/1241) — and they land FIRST and are AWAITED: settings are the source
 * of truth, and if that write is refused nothing else moves (YAZ-1549). (c) is per note, against
 * fresh file bytes, byte-preserving every other key; a note whose record shows the field but whose
 * disk no longer does is simply not written. Strip failures are aggregated — one error for the
 * banner, successes committed, no rollback.
 *
 * Built-in columns are never deletable — `file.*`, `formula.*` and the reserved keys — only
 * hidden. `undeletableReason` is the one rule both menus disable their item by.
 */
import { setFolderValue } from '@shared/folderValues'
import type { IndexRecord } from '@shared/types'
import { canonicalKey, notesHolding, pruneColumnFromViews, pruneColumnLabel, undeletableReason } from '@shared/folderColumns'
import type { ColumnDecl } from './folderSettings'
import type { ViewDef, ViewSet } from './viewSchema'
import { transformFile } from './writeProperty'
// The pure rules live in `@shared/folderColumns`, which the CLI's `folderColumn remove` shares (YAZ-4518).
export { filterMentions, notesHolding, pruneColumnFromViews, pruneColumnLabel, pruneFilter, undeletableReason } from '@shared/folderColumns'

const bareOf = (key: string): string => canonicalKey(key).slice('note.'.length)

export interface DeleteColumnHost {
  /** The folder's declarations as the host holds them — its AHEAD copy (YAZ-1549), never a stale snapshot. */
  columns: Readonly<Record<string, ColumnDecl>>
  /** The LIVE def (views + labels) — the host's `parsed.def`, never the index snapshot (YAZ-1234). */
  def: ViewSet
  /** The WHOLE index snapshot and the folder's id: whose block the strip reads and rewrites (`notesHolding`). */
  records: readonly IndexRecord[]
  folderId: string | undefined
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

  const { folderId } = host
  if (folderId === undefined) return // no id, no values
  const strip = notesHolding(host.records, folderId, key)
  const results = await Promise.allSettled(strip.map((note) => transformFile(note.path, (content) => setFolderValue(content, folderId, bare, undefined), true))) // quiet: a tidy-up of each note (YAZ-3235 D1)
  const failed = results.flatMap((result, index) =>
    result.status === 'rejected' ? [{ note: strip[index]!, why: result.reason instanceof Error ? result.reason.message : String(result.reason) }] : [],
  )
  if (failed.length === 0) return
  throw new Error(
    `Could not remove "${bare}" from ${failed.length} ${failed.length === 1 ? 'note' : 'notes'}: ${failed.map(({ note, why }) => `${note.title} (${why})`).join('; ')}`,
  )
}
