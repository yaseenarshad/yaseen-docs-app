/**
 * Cell and row fills in the folder table (YAZ-4536, D3 / D12). A view keeps them in its own YAML:
 * `fills: [{ note: "[[…]]", column?, fill }]`. `note` is a link, so a rename keeps the fill
 * (`mapFolderSettingsLinks`). No `column` means the whole row. `fill` is a table-block colour name
 * (`TABLE_COLORS`) or `#rrggbb`. A cell fill wins over its row's fill.
 */
import type { IndexRecord } from '@shared/types'
import { exactLinkTarget } from '@shared/linkRewrite'
import { isRecord } from '@shared/guards'
import { cellColor } from '../../editor/table/tableComment'
import type { ResolveLink } from '../../editor/wikilink/wikilinkPlugin'
import { isFolderRow, rowPage } from '../../links/shortcuts'
import type { ViewSet } from '../viewSchema'
import { canonicalKey } from './keys'

export interface ViewFill {
  note: string
  column?: string
  fill: string
}

/** The row's key in a `FillIndex` entry: a fill with no column. */
const ROW = '*'

/**
 * Row page → canonical column key (or `*` for the row) → fill. A row's page (`rowPage`) is the note's path, or a
 * folder row's FOLDER (YAZ-4644 E1): a link to a folder resolves to its directory, never to its `.folder.md`.
 */
export type FillIndex = ReadonlyMap<string, ReadonlyMap<string, string>>

/** The note a fill's link names, or null when the link resolves to none. */
const noteOf = (note: string, resolveLink: ResolveLink): string | null => {
  const target = exactLinkTarget(note, (page) => resolveLink(page) !== null)
  return target === null ? null : resolveLink(target)
}

/** A usable entry's note path, its slot (`ROW` or the canonical column) and its checked fill, else null. */
function readFill(entry: unknown, resolveLink: ResolveLink): { path: string; slot: string; fill: string } | null {
  if (!isRecord(entry) || typeof entry.note !== 'string') return null
  if (entry.column !== undefined && typeof entry.column !== 'string') return null
  const fill = cellColor(entry.fill)
  const path = noteOf(entry.note, resolveLink)
  if (fill === null || path === null) return null
  return { path, slot: entry.column === undefined ? ROW : canonicalKey(entry.column), fill }
}

/** `view.fills` as an index; what it cannot use (a bad colour, a link to nothing, a stray shape) it skips. */
export function fillIndex(fills: unknown, resolveLink: ResolveLink): FillIndex {
  const index = new Map<string, Map<string, string>>()
  if (!Array.isArray(fills)) return index
  for (const entry of fills) {
    const read = readFill(entry, resolveLink)
    if (read === null) continue
    let slots = index.get(read.path)
    if (slots === undefined) index.set(read.path, (slots = new Map()))
    slots.set(read.slot, read.fill)
  }
  return index
}

/** A cell's fill: its own, else its row's. `path` is the row's record path; a folder row is found by its folder (E1). */
export function cellFillOf(index: FillIndex, path: string, key: string): string | undefined {
  const slots = index.get(rowPage(path))
  return slots?.get(canonicalKey(key)) ?? slots?.get(ROW)
}

/** The CSS a fill paints: the table block's wash of a name, or a custom hex at its custom wash (`table.css`). */
export const fillPaint = (fill: string): string =>
  fill.startsWith('#') ? `color-mix(in srgb, ${fill} var(--table-fill-wash), transparent)` : `var(--table-fill-${fill})`

/**
 * The link a fill names its note by, as every link the app writes (YAZ-2293): the note's id when it has
 * one, else its title while the title resolves to it, else its root-relative path without the extension.
 * A folder row (YAZ-4644 E1) is its folder: the title or the path that resolves to the directory, never `.folder`.
 */
export function noteLinkOf(record: IndexRecord, resolveLink: ResolveLink): string {
  if (record.id !== undefined) return `[[${record.id}]]`
  const page = rowPage(record.path)
  if (resolveLink(record.title) === page) return `[[${record.title}]]`
  const own = isFolderRow(record) ? page.slice(page.lastIndexOf('/') + 1) : record.basename
  return `[[${record.folder === '' ? own : `${record.folder}/${own}`}]]`
}

/**
 * The ONE fills write, as a `Mutate` body: `record`'s cell in `column` (undefined = its row) takes `fill`,
 * or loses its fill when `fill` is null. Every other entry stays as it is (YAZ-4636 T9b): a note the view
 * does not show now (Subfolders: Hide) or a link that does not resolve at this moment keeps its fill.
 */
export function setViewFill(d: ViewSet, viewIndex: number, record: IndexRecord, column: string | undefined, fill: string | null, resolveLink: ResolveLink, prune = false): void {
  setViewFills(d, viewIndex, [{ record, column }], fill, resolveLink, prune)
}

/**
 * The same write for several cells or rows at once (YAZ-4593: a fill on a selection): one pass over the list. With
 * `prune` (YAZ-4637, after T9b) — the table, whose `resolveLink` is the loaded vault index — an entry whose note link
 * names no note of the vault goes: the note was deleted, and the list would only grow. A hidden note's entry, or one
 * of a shape that is not ours to judge, stays.
 */
export function setViewFills(d: ViewSet, viewIndex: number, targets: readonly { record: IndexRecord; column?: string }[], fill: string | null, resolveLink: ResolveLink, prune = false): void {
  const view = d.views[viewIndex]
  const checked = cellColor(fill)
  /** Each target's `path` + slot → its new entry (null: no fill), in the targets' order. */
  const made = new Map<string, ViewFill | null>()
  for (const { record, column } of targets)
    made.set(`${rowPage(record.path)}\n${column === undefined ? ROW : canonicalKey(column)}`, checked === null ? null : { note: noteLinkOf(record, resolveLink), ...(column === undefined ? {} : { column }), fill: checked })
  // A changed fill keeps its place in the list, so the YAML changes one line.
  const placed = new Set<string>()
  const kept: unknown[] = []
  /** The entries a prune would drop; they go only when the write changes a fill anyway — a no-op gesture writes nothing (T9b). */
  const stale = new Set<unknown>()
  for (const entry of Array.isArray(view.fills) ? view.fills : []) {
    const read = readFill(entry, resolveLink)
    if (read === null) {
      if (prune && isRecord(entry) && typeof entry.note === 'string' && noteOf(entry.note, resolveLink) === null) stale.add(entry)
      kept.push(entry)
      continue
    }
    const at = `${read.path}\n${read.slot}`
    const next = made.get(at)
    if (next === undefined) kept.push(entry)
    else if (!placed.has(at) && next !== null) kept.push(next)
    if (next !== undefined) placed.add(at)
  }
  for (const [at, next] of made) if (!placed.has(at) && next !== null) kept.push(next)
  const was = Array.isArray(view.fills) ? view.fills : []
  const changed = kept.length !== was.length || kept.some((entry, i) => entry !== was[i])
  const out = changed ? kept.filter((entry) => !stale.has(entry)) : kept
  if (out.length > 0) view.fills = out
  else delete view.fills
}
