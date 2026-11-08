import type { PropertyDecl } from '@shared/types'
import type { Group, Row } from './engine'
import { propertyLabel } from './engine'
import { DateValue, ErrorValue, FileValue, LinkValue, type Resolver, type Value, linkText, render } from './expr'
import { formatDateValue, formatNumber } from './columnFormat'
import type { ViewSet } from './viewSchema'
import { canonicalKey } from './view/keys'

/**
 * "Export as CSV…" and "Copy as table" (YAZ-4594 S30): a view's shown rows × its shown columns, as the cells show them.
 * Pure, except `downloadText`. Nothing here runs until one of the two items is clicked.
 */

/** What a cell's text needs besides its row: the view's resolver, the folder's column formats, and the Folder column's titles. */
export interface CellTextContext {
  resolve?: Resolver
  /** The folder's declarations by bare name: a Number or Date column's `format` (YAZ-4591). */
  decls: Readonly<Record<string, PropertyDecl>>
  /** The folder page's own folder, as the index names it: a note directly in it has an empty Folder cell. */
  pageFolder: string
  /** A folder's title, as its Folder chip shows it (YAZ-4564). */
  folderTitle: (dir: string) => string
}

/** One value as a cell shows it: a link by its note's title, a list joined by ", ", a formatted Number or Date. */
function valueText(v: Value | undefined, resolve: Resolver | undefined, decl?: PropertyDecl): string {
  if (v === undefined || v === null) return ''
  if (v instanceof ErrorValue) return '#ERROR'
  if (Array.isArray(v)) return v.map((item) => valueText(item, resolve)).join(', ')
  if (v instanceof LinkValue) return linkText(v, resolve)
  if (v instanceof FileValue) return v.record.title
  if (decl?.format !== undefined) {
    if (decl.kind === 'number' && typeof v === 'number') return formatNumber(v, decl.format)
    if (decl.kind === 'date' && v instanceof DateValue) return formatDateValue(v.ms, v.hasTime, decl.format) ?? render(v, resolve)
  }
  return render(v, resolve)
}

/** A row's cell for `key` as the views draw it (`rowCell`, `rowTitle`): Name is the title, Folder the folder's title. */
export function cellText(row: Row, key: string, ctx: CellTextContext): string {
  const c = canonicalKey(key)
  if (c === 'file.name') return row.record.title
  if (c === 'file.folder') return row.record.folder === ctx.pageFolder ? '' : ctx.folderTitle(row.record.folder)
  return valueText(row.values[key], ctx.resolve, c.startsWith('note.') ? ctx.decls[c.slice('note.'.length)] : undefined)
}

/**
 * The rows in the order the view shows them: group by group, a group's direct rows before its inner groups (the
 * table's walk). Each note once: a fanned-out row that shows under two groups is one line in a file. A collapsed
 * group's rows are in: they are the view's rows, only folded away.
 */
export function shownRows(rows: readonly Row[], groups: readonly Group[] | null): Row[] {
  if (groups === null) return [...rows]
  const out: Row[] = []
  const seen = new Set<string>()
  const walk = (list: readonly Group[]) => {
    for (const g of list) {
      for (const row of g.children === undefined ? g.rows : g.direct ?? []) {
        if (seen.has(row.record.path)) continue
        seen.add(row.record.path)
        out.push(row)
      }
      if (g.children !== undefined) walk(g.children)
    }
  }
  walk(groups)
  return out
}

/** The header line and one line per row: Name first, then the shown columns in the view's order. */
export function viewTable(def: ViewSet, keys: readonly string[], rows: readonly Row[], ctx: CellTextContext): string[][] {
  const name = keys.find((k) => canonicalKey(k) === 'file.name') ?? 'file.name'
  const columns = [name, ...keys.filter((k) => canonicalKey(k) !== 'file.name')]
  return [columns.map((k) => propertyLabel(def, k)), ...rows.map((row) => columns.map((k) => cellText(row, k, ctx)))]
}

/** RFC 4180: a field with a quote, a comma or a line break is quoted, a quote doubled; lines end in CRLF. */
export function toCsv(table: readonly (readonly string[])[]): string {
  const field = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s)
  return table.map((line) => line.map(field).join(',')).join('\r\n') + '\r\n'
}

/** Tab-separated, for Sheets or a note's table: a tab or a line break inside a cell becomes a space. */
export function toTsv(table: readonly (readonly string[])[]): string {
  return table.map((line) => line.map((s) => s.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n')
}

/** The file name the save sheet opens on: `<folder> - <view>.csv`, with no path separator or colon in it. */
export const csvName = (folder: string, view: string): string => `${folder} - ${view}.csv`.replace(/[/\\:]/g, '-')

/**
 * The save sheet through a download link (S30 decision): no main-process save door takes CSV (`dialog.save*` each
 * enforce one extension), and Electron shows its own save sheet for a download that has no path.
 */
export function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
