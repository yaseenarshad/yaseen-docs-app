/**
 * Paste like a spreadsheet (YAZ-3764, YAZ-3696 🔒 D4 / S2). `clipboardPaste.ts` calls `pasteIntoCells`
 * before Milkdown's clipboard plugin, which would put the pasted rows in at the caret and split the
 * table (and so `prosemirror-tables`' own `handlePaste` never runs).
 *
 * - IN A TABLE, the pasted cells are the slice's cells when the HTML has a `<table>` (a copy of
 *   cells in this app, Sheets), else tab-separated `text/plain`: one line with a tab is enough. With
 *   a caret they fill from its cell, right and down; with selected cells, from the selection's
 *   top-left cell. A paste bigger than the table adds rows and columns. One value (one cell, or one
 *   line of text) fills each selected cell. Anything else declines: several lines without tabs keep
 *   the cell paste of today (YAZ-1452 / YAZ-1462), and paths stay one line (YAZ-3631).
 * - TAB-SEPARATED TEXT is one rule in a table and outside one (`tsvRows`): a line that starts with a
 *   tab has an empty first cell, and that is indented code, not a sheet: the text stays text.
 * - Cells from HTML bring their `fill`, `color` and own `align` (none from Sheets, so the target's go, as in
 *   Sheets); text changes the text only. A pasted cell takes its target row's type (header or
 *   body) and keeps its column's `alignment` and `colwidth`.
 * - WRITE: GFM tables have no merged cells, so the changed rows are built here and written by ONE
 *   `replaceWith` — not `insertCells`, which assumes one row type (GFM has two) and steps per row.
 * - OUTSIDE A TABLE (S2) a Sheets `<table>` already makes a table (Milkdown's `tablePasteRule`).
 *   Tab-separated text with no HTML makes one here: 2 lines or more, the same number of tabs on
 *   each. The first line is the header row.
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import { Fragment, Slice, type Node as ProseNode, type Schema } from '@milkdown/kit/prose/model'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { CellSelection, TableMap, __pastedCells, isInTable, selectedRect } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { cellPosAt } from './cells'

/** One pasted cell: its block content, and its `fill` / `color` / `align` when it came from HTML (or the source cell, for fill down). */
export interface Cell {
  content: Fragment
  style: { fill: unknown; color: unknown; align: unknown } | null
}

export const textCell = (schema: Schema, text: string): Cell => ({
  content: Fragment.from(schema.nodes.paragraph.create(null, text ? schema.text(text) : null)),
  style: null,
})

/**
 * Tab-separated text as rows of strings, or `null` when it has no tab or a line starts with a tab
 * (indented code, not a sheet). A last empty line is dropped.
 */
function tsvRows(text: string): string[][] | null {
  if (!text.includes('\t')) return null
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length > 1 && lines.at(-1) === '') lines.pop()
  return lines.some((line) => line.startsWith('\t')) ? null : lines.map((line) => line.split('\t'))
}

/** The slice's cells, as a rectangle. A row of empty header cells that Milkdown added to a `<table>` with no `<th>` is dropped. */
function sliceCells(slice: Slice, html: string): Cell[][] | null {
  const pasted = __pastedCells(slice)
  if (pasted === null) return null
  const rows = pasted.rows.map((row) => {
    const cells: Cell[] = []
    row.forEach((cell) => cells.push({ content: cell.content, style: { fill: cell.attrs.fill ?? null, color: cell.attrs.color ?? null, align: cell.attrs.align ?? null } }))
    return { cells, header: row.firstChild?.type.spec.tableRole === 'header_cell', empty: row.textBetween(0, row.size) === '' }
  })
  if (rows.length > 1 && rows[0]!.header && rows[0]!.empty && !/<th[\s>]/i.test(html)) rows.shift()
  return rows.map((row) => row.cells)
}

/** The one value of a slice: a single textblock's inline content, as a cell. */
function oneValue(schema: Schema, slice: Slice): Cell | null {
  const only = slice.content.childCount === 1 ? slice.content.firstChild! : null
  if (only === null || !only.isTextblock) return null
  return { content: Fragment.from(schema.nodes.paragraph.create(null, only.content)), style: null }
}

/**
 * Write `grid` into the table at `tableStart` from (top, left), growing it as needed, with ONE
 * `replaceWith` in `tr`. Shared with fill down (`tableFill.ts`).
 */
export function writeCells(tr: Transaction, tableStart: number, top: number, left: number, grid: Cell[][]): Transaction {
  const { schema } = tr.doc.type
  const table = tr.doc.nodeAt(tableStart - 1)!
  const width = TableMap.get(table).width
  const gridWidth = Math.max(...grid.map((row) => row.length))
  const newWidth = Math.max(width, left + gridWidth)
  const newHeight = Math.max(table.childCount, top + grid.length)
  const grows = newWidth > width
  // Rows `first` up to `end` change: the pasted rows, and every row when columns are added.
  const first = grows ? 0 : top
  const end = grows ? newHeight : top + grid.length
  const header = table.firstChild!
  const rows: ProseNode[] = []
  for (let r = first; r < end; r++) {
    const old = r < table.childCount ? table.child(r) : null
    const cellType = r === 0 ? schema.nodes.table_header : schema.nodes.table_cell
    const cells: ProseNode[] = []
    for (let c = 0; c < newWidth; c++) {
      const oldCell = old !== null && c < old.childCount ? old.child(c) : null
      const pasted = r >= top && c >= left ? grid[r - top]?.[c - left] : undefined
      if (pasted === undefined && oldCell !== null) {
        cells.push(oldCell)
        continue
      }
      const column = c < header.childCount ? header.child(c).attrs : null
      const attrs = { ...(oldCell?.attrs ?? { alignment: column?.alignment ?? null, colwidth: column?.colwidth ?? null }), ...pasted?.style }
      cells.push((pasted && cellType.createAndFill(attrs, pasted.content)) ?? cellType.createAndFill(attrs)!)
    }
    rows.push((old ?? schema.nodes.table_row.create()).copy(Fragment.from(cells)))
  }
  let from = tableStart
  for (let r = 0; r < first; r++) from += table.child(r).nodeSize
  let to = from
  for (let r = first; r < Math.min(end, table.childCount); r++) to += table.child(r).nodeSize
  return tr.replaceWith(from, to, rows)
}

/** Select the cells of the table at `tableStart` from (top, left) to (bottom, right), inclusive. */
export function selectCells(tr: Transaction, tableStart: number, top: number, left: number, bottom: number, right: number): Transaction {
  const map = TableMap.get(tr.doc.nodeAt(tableStart - 1)!)
  return tr.setSelection(CellSelection.create(tr.doc, cellPosAt(map, tableStart, top, left), cellPosAt(map, tableStart, bottom, right)))
}

/** S2: tab-separated text with no HTML, pasted outside a table, becomes a new table. */
function pasteTable(view: EditorView, text: string): boolean {
  const rows = tsvRows(text)
  if (rows === null || rows.length < 2 || rows.some((row) => row.length !== rows[0]!.length)) return false
  const { schema } = view.state
  const row = (cells: string[], header: boolean) =>
    (header ? schema.nodes.table_header_row : schema.nodes.table_row).create(
      null,
      cells.map((value) => (header ? schema.nodes.table_header : schema.nodes.table_cell).createAndFill(null, textCell(schema, value).content)!),
    )
  const table = schema.nodes.table.create(null, rows.map((cells, i) => row(cells, i === 0)))
  let slice = new Slice(Fragment.from(table), 0, 0)
  // The folder outline's bullets-only conversion and the table repair run as on any paste.
  view.someProp('transformPasted', (transform) => { slice = transform(slice, view, true) })
  view.dispatch(closeHistory(view.state.tr).replaceSelection(slice).setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView())
  return true
}

/** The table and the cell the paste starts at: the caret's cell, or the top-left cell of the selected cells. */
function target(state: EditorState): { tableStart: number; top: number; left: number; rect: { width: number; height: number } | null } {
  const { tableStart, top, left, right, bottom } = selectedRect(state)
  return { tableStart, top, left, rect: state.selection instanceof CellSelection ? { width: right - left, height: bottom - top } : null }
}

/** Paste into table cells, or make a table from tab-separated text outside one. `false` declines (the paste of today runs). */
export function pasteIntoCells(view: EditorView, event: ClipboardEvent, slice: Slice): boolean {
  const { state } = view
  const html = event.clipboardData?.getData('text/html') ?? ''
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (!isInTable(state)) return html === '' && pasteTable(view, text)
  const { schema } = state
  // ProseMirror parses a paste in the cell's context, so a second paragraph or line gets a cell of
  // its own: only a real `<table>` counts as cells. Other HTML, and text with no tabs, decline.
  let grid = (/<table[\s>]/i.test(html) ? sliceCells(slice, html) : null) ?? tsvRows(text)?.map((row) => row.map((value) => textCell(schema, value))) ?? null
  const { tableStart, top, left, rect } = target(state)
  const one = grid === null ? oneValue(schema, slice) : grid.length === 1 && grid[0]!.length === 1 ? grid[0]![0]! : null
  if (rect !== null && one !== null) grid = Array.from({ length: rect.height }, () => Array<Cell>(rect.width).fill(one))
  if (grid === null) return false
  const right = left + Math.max(...grid.map((row) => row.length)) - 1
  const tr = selectCells(writeCells(closeHistory(state.tr), tableStart, top, left, grid), tableStart, top, left, top + grid.length - 1, right)
  view.dispatch(tr.setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView())
  return true
}
