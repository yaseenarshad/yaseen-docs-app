/**
 * A Super table's rows for the folder-page engine (YAZ-4869 S2, YAZ-4873; CONTRACTS rule 41a). Pure: a table node in,
 * the view's rows, groups and summaries out. In the lazy chunk with `SuperTable.tsx`.
 *
 * - THE RECORDS: each body row is one `IndexRecord`, `path` `table-row:<row>` (padded, so the engine's tie on path keeps
 *   table order), `properties` its cells by column key (`headerKeys`). Item 14, typed cells: a number is a number, `[x]`
 *   and `[ ]` are a checkbox, and the engine reads an ISO date as a date. A cell list gives its first line; a cell a
 *   merge covers gives nothing.
 * - ONE RUN PER NODE: `tableData` is kept per table node (a `WeakMap`); `computeView` runs the engine once per call, and
 *   `superRuns` counts the runs for the speed test (item 20).
 * - GROUP ORDER (item 10): a level with no order keeps the groups in the order of their first row in the table; A to Z
 *   and Z to A are the engine's. "No value" is always last.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { TableMap } from '@milkdown/kit/prose/tables'
import type { IndexRecord } from '@shared/types'
import { runView, type Group, type Row, type ViewResult } from '../../../views/engine'
import type { Value } from '../../../views/expr'
import { ruleToExpr } from '../../../views/view/filterRows'
import { groupKeyOf } from '../../../views/view/GroupHeader'
import type { ViewDef, ViewSet } from '../../../views/viewSchema'
import { isCellNoteMark } from '../cellNotes'
import { cellStartsAt } from '../cells'
import { headerKeys } from './superTables'
import { VIEW_OPS, type TableViewDef } from './viewGrammar'

/** One grid place of a row, as a view draws it. */
export interface ViewCell {
  /** Its first line: the first paragraph, or a list's first bullet. */
  text: string
  fill: string | null
  color: string | null
  /** The columns it spans; 0 for a place a merged cell covers (drawn by the cell that starts left of it). */
  span: number
  /** The cell's place in the table (`TableMap`), `-1` for a covered place. */
  pos: number
  merged: boolean
  /** It holds a cell note's mark. */
  note: boolean
  /** Its first block is a paragraph: a view can edit it (S5). */
  plain: boolean
}

export interface TableData {
  keys: string[]
  /** Every row of the table by its index; row 0 is the header. */
  cells: ViewCell[][]
  /** One record per body row, in table order. */
  records: IndexRecord[]
}

/** A cell's first line: its first paragraph, or its first bullet's (YAZ-3818). */
function firstLine(cell: ProseNode): string {
  let block = cell.firstChild
  while (block !== null && !block.isTextblock && block.firstChild !== null) block = block.firstChild
  return block === null ? '' : block.textBetween(0, block.content.size, ' ', ' ').trim()
}

function hasNoteMark(cell: ProseNode): boolean {
  let found = false
  cell.descendants((node) => {
    found ||= isCellNoteMark(node)
    return !found
  })
  return found
}

/** Item 14: a cell's text as a typed value. */
export function typedValue(text: string): unknown {
  // An empty cell is no value: it sorts last and makes the "No value" group, as an empty field does on folder pages.
  if (text === '') return null
  if (/^\[[xX]\]$/.test(text)) return true
  if (text === '[ ]') return false
  const number = text.replace(/,(?=\d{3}(\D|$))/g, '')
  if (/^-?\d+(\.\d+)?$/.test(number)) return Number(number)
  return text
}

/** The record path of a body row; `rowOf` reads it back. */
const PATH = 'table-row:'
const pathOf = (row: number): string => `${PATH}${String(row).padStart(6, '0')}`
export const rowOf = (row: Row): number => Number(row.record.path.slice(PATH.length))

const dataCache = new WeakMap<ProseNode, TableData>()

/** The table's keys, cells and records, once per table node. */
export function tableData(table: ProseNode): TableData {
  const cached = dataCache.get(table)
  if (cached !== undefined) return cached
  const map = TableMap.get(table)
  const keys = headerKeys(table)
  const cells: ViewCell[][] = []
  const records: IndexRecord[] = []
  for (let r = 0; r < map.height; r++) {
    const row: ViewCell[] = []
    const properties: Record<string, unknown> = {}
    for (let c = 0; c < map.width; c++) {
      const pos = map.map[r * map.width + c]!
      const cell = table.nodeAt(pos)
      if (cell === null || !cellStartsAt(map, r, c)) {
        row.push({ text: '', fill: null, color: null, span: 0, pos: -1, merged: false, note: false, plain: false })
        properties[keys[c]!] = null
        continue
      }
      const text = firstLine(cell)
      const span = Math.min((cell.attrs.colspan as number) ?? 1, map.width - c)
      const merged = span > 1 || (cell.attrs.rowspan as number) > 1
      row.push({ text, fill: (cell.attrs.fill as string | null) ?? null, color: (cell.attrs.color as string | null) ?? null, span, pos, merged, note: hasNoteMark(cell), plain: cell.firstChild?.type.name === 'paragraph' })
      properties[keys[c]!] = typedValue(text)
    }
    cells.push(row)
    if (r === 0) continue
    const name = row[0]?.text || `Row ${r}`
    records.push({ path: pathOf(r), name, basename: name, title: name, folder: '', ext: '', size: 0, ctime: 0, mtime: 0, properties, aliases: [], tags: [], links: [], embeds: [] })
  }
  const data = { keys, cells, records }
  dataCache.set(table, data)
  return data
}

const property = (column: string): string => `note.${column}`

/** The engine's view for a table view. */
export function engineView(def: TableViewDef): ViewDef {
  const summaries = def.summary ?? []
  const filters = (def.filter ?? []).filter((f) => !VIEW_OPS[f.op] || (f.value ?? '') !== '')
  return {
    type: 'table',
    name: def.name,
    // The summarised columns only: a group header's summaries read them; the cells are drawn from the table itself.
    order: summaries.map((s) => property(s.column)),
    ...(def.sort?.length && { sort: def.sort.map((s) => ({ property: property(s.column), direction: s.desc === true ? ('DESC' as const) : ('ASC' as const) })) }),
    ...(def.group?.length && {
      groupBy: def.group.map((g) => ({ property: property(g.column), direction: g.order === 'desc' ? ('DESC' as const) : ('ASC' as const), ...(g.highlight !== undefined && { highlight: g.highlight }), ...(g.large === true && { large: true }) })),
    }),
    // A filter still waiting for its value filters nothing: a new filter hides no row before you type.
    ...(filters.length > 0 && { filters: { and: filters.map((f) => ruleToExpr({ property: property(f.column), op: f.op, value: f.value ?? '' })) } }),
    ...(summaries.length > 0 && { summaries: Object.fromEntries(summaries.map((s) => [property(s.column), s.kind.charAt(0).toUpperCase() + s.kind.slice(1)])) }),
    groupLines: def.lines ?? 'hover',
    groupLineStyle: def.thread === true ? 'thread' : 'plain',
  }
}

/** The view set a group header reads its labels from: each column by its key. */
export function viewSetOf(view: ViewDef, keys: readonly string[]): ViewSet {
  return { views: [view], properties: Object.fromEntries(keys.map((k) => [property(k), { displayName: k }])) }
}

/** Engine runs, for the speed test (item 20). */
export const superRuns = { count: 0 }

const firstRow = (group: Group): number => group.rows.reduce((min, row) => Math.min(min, rowOf(row)), Infinity)

/** Item 10: the levels with no order keep the groups in the order their first rows have in the table. */
function firstAppearance(groups: Group[], levels: readonly { order?: string }[], at: number): Group[] {
  const ordered = levels[at]?.order === undefined ? [...groups].sort((a, b) => (a.key === null ? 1 : 0) - (b.key === null ? 1 : 0) || firstRow(a) - firstRow(b)) : groups
  for (const group of ordered) if (group.children !== undefined) group.children = firstAppearance(group.children, levels, at + 1)
  return ordered
}

export interface SuperResult {
  data: TableData
  view: ViewDef
  result: ViewResult
}

/** The view of `table` that `def` describes: one engine run. */
export function computeView(table: ProseNode, def: TableViewDef): SuperResult {
  const data = tableData(table)
  const view = engineView(def)
  superRuns.count++
  const result = runView(viewSetOf(view, data.keys), view, data.records)
  if (result.groups !== null) result.groups = firstAppearance(result.groups, def.group ?? [], 0)
  return { data, view, result }
}

/** One line a view draws: a group header, or a body row (its table row index). */
export type Line =
  | { kind: 'group'; group: Group; depth: number; key: string; path: Group[] }
  | { kind: 'row'; row: number; depth: number; path: Group[] }

/** A group's collapse key at any level: the folder pages' (`groupPathKeyOf`). */
const pathKey = (path: readonly Group[]): string => path.map((g) => groupKeyOf(g.key as Value | null)).join('\u001f')

/**
 * The lines of a view in order: each group's header, then (open) its own rows and its inner groups. `open` overrides a
 * collapsed group (find shows a row inside one).
 */
export function linesOf(result: ViewResult, collapsed: ReadonlySet<string>, open: ReadonlySet<string> = new Set()): Line[] {
  if (result.groups === null) return result.rows.map((row) => ({ kind: 'row', row: rowOf(row), depth: 0, path: [] }))
  const out: Line[] = []
  const walk = (groups: readonly Group[], parents: Group[]) => {
    for (const group of groups) {
      const path = [...parents, group]
      const key = pathKey(path)
      out.push({ kind: 'group', group, depth: parents.length, key, path })
      if (collapsed.has(key) && !open.has(key)) continue
      const own = group.children === undefined ? group.rows : (group.direct ?? [])
      for (const row of own) out.push({ kind: 'row', row: rowOf(row), depth: path.length, path })
      if (group.children !== undefined) walk(group.children, path)
    }
  }
  walk(result.groups, [])
  return out
}

/** The collapse keys of the groups that hold body row `row` (find opens them). */
export function groupsHolding(result: ViewResult, row: number): Set<string> {
  const out = new Set<string>()
  const walk = (groups: readonly Group[], parents: Group[]) => {
    for (const group of groups) {
      if (!group.rows.some((r) => rowOf(r) === row)) continue
      const path = [...parents, group]
      out.add(pathKey(path))
      if (group.children !== undefined) walk(group.children, path)
    }
  }
  if (result.groups !== null) walk(result.groups, [])
  return out
}

/** The rows as a Markdown table, in the given order (item 21): the header first, `|` escaped. */
export function markdownTable(keys: readonly string[], rows: readonly string[][]): string {
  const line = (cells: readonly string[]) => `| ${cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`
  return [line(keys), line(keys.map(() => '---')), ...rows.map(line)].join('\n')
}
