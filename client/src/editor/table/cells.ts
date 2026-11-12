/**
 * Cell helpers shared by the table actions (YAZ-3696): the document position of a cell, and one
 * attribute on every cell of a rectangle. The rectangle of the selected cells (or of the caret's
 * cell) is prosemirror-tables' own `selectedRect`.
 *
 * MERGED CELLS (YAZ-4792, `tableMerge.ts`): a merged cell has `colspan` or `rowspan` above 1 and stands at its top-left
 * grid position; the cells it covers are not in the document. So a row's children are not its columns: a feature that
 * wants the cell of a column asks the table's `TableMap` (`cellAt`, `cellStartsAt`), and one that cannot take a merged
 * cell asks `rectHasMerge` / `mergeCrosses` first and stays out of its way.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Transaction } from '@milkdown/kit/prose/state'
import { TableMap, type TableRect } from '@milkdown/kit/prose/tables'

/** The document position of the cell at (row, col) of the table whose content starts at `tableStart`. */
export const cellPosAt = (map: TableMap, tableStart: number, row: number, col: number): number => tableStart + map.map[row * map.width + col]!

/** A merged cell (YAZ-4792): it spans more than one column or row. */
export const isMerged = (cell: ProseNode): boolean => (cell.attrs.colspan as number) > 1 || (cell.attrs.rowspan as number) > 1

/** The cell that covers grid position (row, col) of `table`: its own, or the merged cell over it. */
export const cellAt = (table: ProseNode, map: TableMap, row: number, col: number): ProseNode => table.nodeAt(map.map[row * map.width + col]!)!

/** The cell at (row, col) starts there: it is no part of a merged cell above it or left of it. */
export function cellStartsAt(map: TableMap, row: number, col: number): boolean {
  const pos = map.map[row * map.width + col]
  return (row === 0 || map.map[(row - 1) * map.width + col] !== pos) && (col === 0 || map.map[row * map.width + col - 1] !== pos)
}

/** The words of the cell that covers (row, col): a time in column A, a name in the header row. `''` for a cell that starts elsewhere. */
export function cellTextAt(table: ProseNode, row: number, col: number): string {
  const map = TableMap.get(table)
  if (row >= map.height || col >= map.width || !cellStartsAt(map, row, col)) return ''
  return cellAt(table, map, row, col).textContent
}

/** Some cell of `table` is merged. */
export function tableHasMerge(table: ProseNode): boolean {
  let merged = false
  table.forEach((row) => row.forEach((cell) => (merged ||= isMerged(cell))))
  return merged
}

/** A body cell spans rows (YAZ-4792): the rows cannot move one by one, so Sort, a row drag with sections and a Super table are off. */
export function bodySpansRows(table: ProseNode): boolean {
  let spans = false
  table.forEach((row, _, r) => {
    if (r > 0) row.forEach((cell) => (spans ||= (cell.attrs.rowspan as number) > 1))
  })
  return spans
}

/** A cell's text as a typed value (the Super table's item 14; a Sort compares numbers as numbers, YAZ-4834 P7). */
export function typedValue(text: string): unknown {
  // An empty cell is no value: it sorts last and makes the "No value" group, as an empty field does on folder pages.
  if (text === '') return null
  if (/^\[[xX]\]$/.test(text)) return true
  if (text === '[ ]') return false
  const number = text.replace(/,(?=\d{3}(\D|$))/g, '')
  if (/^-?\d+(\.\d+)?$/.test(number)) return Number(number)
  return text
}

/** Every cell with a part in `rect`, once each (prosemirror-tables' `cellsInRect` leaves out a cell that starts above or left of it). */
function cellsTouching(rect: TableRect): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (let row = rect.top; row < rect.bottom; row++) {
    for (let col = rect.left; col < rect.right; col++) {
      const pos = rect.map.map[row * rect.map.width + col]!
      if (!seen.has(pos)) {
        seen.add(pos)
        out.push(pos)
      }
    }
  }
  return out
}

/** Some cell in `rect`, whole or in part, is merged. */
export const rectHasMerge = (rect: TableRect): boolean => cellsTouching(rect).some((pos) => isMerged(rect.table.nodeAt(pos)!))

/** A merged cell crosses an edge of `rect`: it is in the rectangle only in part. */
export function mergeCrosses(rect: TableRect): boolean {
  return cellsTouching(rect).some((pos) => {
    const cell = rect.map.findCell(pos)
    return cell.top < rect.top || cell.bottom > rect.bottom || cell.left < rect.left || cell.right > rect.right
  })
}

/** The whole rows `top` to `bottom` (exclusive) of `rect`'s table, as a rectangle. */
export const wholeRows = (rect: TableRect, top: number, bottom: number): TableRect => ({ ...rect, top, bottom, left: 0, right: rect.map.width })

/** The whole columns `left` to `right` (exclusive) of `rect`'s table, as a rectangle. */
export const wholeColumns = (rect: TableRect, left: number, right: number): TableRect => ({ ...rect, left, right, top: 0, bottom: rect.map.height })

/** `attr` set to `value` on every cell of `rect` that does not have it yet, in `tr`. */
export function setCellsAttr(tr: Transaction, rect: TableRect, attr: string, value: unknown): Transaction {
  for (const at of rect.map.cellsInRect(rect)) {
    if (rect.table.nodeAt(at)!.attrs[attr] !== value) tr.setNodeAttribute(rect.tableStart + at, attr, value)
  }
  return tr
}

/**
 * Each cell of `rect` aligned to `align`, in `tr` (YAZ-3819): the cell's own `align`, or `null`
 * where `align` is its column's GFM `alignment` (none counts as left), so the cell follows its
 * column and the file gets no part that changes nothing.
 */
export function setCellsAlign(tr: Transaction, rect: TableRect, align: string): Transaction {
  for (const at of rect.map.cellsInRect(rect)) {
    const cell = rect.table.nodeAt(at)!
    const value = ((cell.attrs.alignment as string | null) ?? 'left') === align ? null : align
    if (cell.attrs.align !== value) tr.setNodeAttribute(rect.tableStart + at, 'align', value)
  }
  return tr
}

/**
 * Each cell of `rect` vertically aligned to `valign`, in `tr` (YAZ-4166, D10): the cell's own `valign`, or `null`
 * where `valign` is the table's default, so the cell follows its table and the file gets no part that changes nothing.
 */
export function setCellsValign(tr: Transaction, rect: TableRect, valign: string): Transaction {
  const value = ((rect.table.attrs.valign as string | undefined) ?? 'top') === valign ? null : valign
  return setCellsAttr(tr, rect, 'valign', value)
}

/** A folded row (YAZ-4165, D3): one of its cells has the fold mark, so a new column's empty cells do not open it. */
/** The row is kept out of a calendar table's past dimming (YAZ-4796): its cells carry `nodim`, as a folded row's carry `fold`. */
export const rowNoDim = (row: ProseNode | null | undefined): boolean => {
  let kept = false
  row?.forEach((cell) => {
    if (cell.attrs.nodim === true) kept = true
  })
  return kept
}

export const rowFolded = (row: ProseNode | null | undefined): boolean => {
  let folded = false
  row?.forEach((cell) => {
    if (cell.attrs.fold === true) folded = true
  })
  return folded
}

/**
 * The first `count` rows of `table` from row `from` that are not folded, by index (YAZ-4165): where fill down and a
 * paste write, so a folded row is never written. An index past the table's last row is a row the paste adds.
 */
export function unfoldedRows(table: ProseNode, from: number, count: number): number[] {
  const out: number[] = []
  // A subheader row (YAZ-4899) is skipped as a folded row is: a fill down or a paste never writes a section's title.
  for (let row = from; out.length < count; row++) if (row >= table.childCount || !(rowFolded(table.child(row)) || rowSubhead(table.child(row)))) out.push(row)
  return out
}

/** A subheader row (YAZ-4899): one of its cells has `subhead`, as a folded row's have `fold`. Row 0 (the header) never is. */
export const rowSubhead = (row: ProseNode | null | undefined): boolean => {
  let subhead = false
  row?.forEach((cell) => {
    if (cell.attrs.subhead === true) subhead = true
  })
  return subhead
}

/** The table has a subheader row (YAZ-4899). */
export function tableHasSubheads(table: ProseNode): boolean {
  let found = false
  table.forEach((row, _, r) => (found ||= r > 0 && rowSubhead(row)))
  return found
}

/** The subheader row of the section that holds row `row` (itself when it is one), or `null` above the first subheader row. */
export function subheadOf(table: ProseNode, row: number): number | null {
  for (let r = Math.min(row, table.childCount - 1); r > 0; r--) if (rowSubhead(table.child(r))) return r
  return null
}

/** The last row of the section of subheader row `s`: the row before the next subheader row, else the table's last row. */
export function sectionEnd(table: ProseNode, s: number): number {
  for (let r = s + 1; r < table.childCount; r++) if (rowSubhead(table.child(r))) return r - 1
  return table.childCount - 1
}
