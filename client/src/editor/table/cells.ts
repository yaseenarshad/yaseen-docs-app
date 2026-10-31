/**
 * Cell helpers shared by the table actions (YAZ-3696): the document position of a cell, and one
 * attribute on every cell of a rectangle. The rectangle of the selected cells (or of the caret's
 * cell) is prosemirror-tables' own `selectedRect`.
 */
import type { Transaction } from '@milkdown/kit/prose/state'
import type { TableMap, TableRect } from '@milkdown/kit/prose/tables'

/** The document position of the cell at (row, col) of the table whose content starts at `tableStart`. */
export const cellPosAt = (map: TableMap, tableStart: number, row: number, col: number): number => tableStart + map.map[row * map.width + col]!

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
