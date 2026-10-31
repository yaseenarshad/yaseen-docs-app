/**
 * The Table part of a note's right-click menu (YAZ-3769, YAZ-3696 🔒 D5 / S3), after the paste
 * rows, when the right-click is in a cell of an editable note (R3). Three groups:
 * - Insert row above / below, Insert column left / right;
 * - Delete row, Delete column, Clear cells, Fill ▸ (the four fills | None);
 * - Freeze up to this row, Freeze up to this column, Unfreeze rows, Unfreeze columns.
 *
 * A row acts on the CellSelection when there is one in the clicked table, else on the clicked cell:
 * the prosemirror-tables command runs on a state whose selection is that cell, and the note keeps
 * its own selection. Each row is one transaction with the history closed (one undo step, R4).
 * The header row (row 1) has no row above it and is never deleted, and the last body row or column
 * is not deleted either (GFM needs a header row and one row, and the table one column). A new row
 * takes each column's alignment, as Milkdown's own row does.
 *
 * The labels count the target's rows and columns, as in Sheets (YAZ-3801): "Insert 2 rows above",
 * "Delete 3 columns"; one row or column keeps the singular label. Insert N inserts N.
 *
 * Freeze (S3) counts from the top and from the left: "Freeze up to this row" sets `freezeRows` to
 * the clicked row's number (row 1 is the header), the column item `freezeCols` the same way; there
 * is no "Freeze header row". `tableFreeze.ts` keeps the counts inside the table and draws them. On the row
 * (column) where the freeze ends, the item reads "✓ Frozen up to this row" and a click unfreezes (YAZ-3804).
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { EditorState, type Transaction } from '@milkdown/kit/prose/state'
import {
  CellSelection,
  TableMap,
  addColumn,
  cellAround,
  deleteCellSelection,
  deleteColumn,
  deleteRow,
  selectedRect,
  type TableRect,
} from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MenuAction, MenuSection } from '../../sidebar/menuSections'
import { setCellsAttr } from './cells'
import { capital } from './cellToolbar'
import { FILL_COLORS, type FillColor } from './tableStyle'

type Command = (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean

/** The clicked cell: its position, its table's, and its row and column. `null` off a table. */
function clickedCell(doc: ProseNode, pointer: number): { pos: number; table: ProseNode; tableStart: number; row: number; col: number } | null {
  if (pointer < 0 || pointer > doc.content.size) return null
  const $cell = cellAround(doc.resolve(pointer))
  if ($cell === null) return null
  const table = $cell.node(-1)
  const tableStart = $cell.start(-1)
  const rect = TableMap.get(table).findCell($cell.pos - tableStart)
  return { pos: $cell.pos, table, tableStart, row: rect.top, col: rect.left }
}

/** The selection a row acts on: the CellSelection in the clicked table, else the clicked cell alone. */
function targetSelection(state: EditorState, cell: { pos: number; tableStart: number }): CellSelection {
  const { selection } = state
  if (selection instanceof CellSelection && selection.$anchorCell.start(-1) === cell.tableStart) return selection
  return CellSelection.create(state.doc, cell.pos)
}

/**
 * Run `command` on the target cells, in one transaction with the history closed. The command sees
 * a state whose selection is the target; the note's own selection is put back when it was not.
 */
function runOn(view: EditorView, pointer: number, command: Command): void {
  const cell = clickedCell(view.state.doc, pointer)
  if (cell === null) return
  const own = view.state.selection
  const target = targetSelection(view.state, cell)
  const state = target === own ? view.state : EditorState.create({ doc: view.state.doc, selection: target })
  command(state, (tr) => {
    if (target !== own) tr.setSelection(own.map(tr.doc, tr.mapping))
    view.dispatch(closeHistory(tr))
  })
}

/**
 * As many body rows as the rect holds, at index `at` of its table, each cell with its column's alignment:
 * a copy of Milkdown's `addRowWithAlignment`, which needs the editor's `ctx`; the note menu has the view only.
 */
function insertRows(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, rect: TableRect, at: number): boolean {
  if (at === 0) return false
  if (dispatch) {
    const { table_row: rowType, table_cell: cellType } = state.schema.nodes
    let pos = rect.tableStart
    for (let i = 0; i < at; i++) pos += rect.table.child(i).nodeSize
    const row = () => rowType.create(null, Array.from({ length: rect.map.width }, (_, col) => cellType.createAndFill({ alignment: rect.table.nodeAt(rect.map.map[col])?.attrs.alignment })!))
    dispatch(state.tr.insert(pos, Array.from({ length: rect.bottom - rect.top }, row)))
  }
  return true
}

const rowsAbove: Command = (state, dispatch) => insertRows(state, dispatch, selectedRect(state), selectedRect(state).top)
const rowsBelow: Command = (state, dispatch) => insertRows(state, dispatch, selectedRect(state), selectedRect(state).bottom)

/** As many columns as the rect holds, left or right of it: `addColumn` maps the rect's positions through the steps. */
const columns =
  (side: 'left' | 'right'): Command =>
  (state, dispatch) => {
    if (dispatch) {
      const rect = selectedRect(state)
      const tr = state.tr
      for (let i = rect.left; i < rect.right; i++) addColumn(tr, rect, side === 'left' ? rect.left : rect.right)
      dispatch(tr)
    }
    return true
  }

/** "Delete row" for one, "Delete 2 rows" for two (YAZ-3801). */
const counted = (count: number, one: string, many: string): string => (count > 1 ? many.replace('N', String(count)) : one)

/** The fill on every target cell. */
const fill =
  (color: FillColor | null): Command =>
  (state, dispatch) => {
    const tr = setCellsAttr(state.tr, selectedRect(state), 'fill', color)
    if (tr.docChanged) dispatch?.(tr)
    return true
  }

/** One freeze count on the clicked table. */
function setFreeze(view: EditorView, tableStart: number, attr: 'freezeRows' | 'freezeCols', count: number): void {
  const pos = tableStart - 1
  if (view.state.doc.nodeAt(pos)?.attrs[attr] === count) return
  view.dispatch(closeHistory(view.state.tr).setNodeAttribute(pos, attr, count))
}

/** The Table part's three groups, or none: no cell at `pointer`, or a read-only note. */
export function tableMenuSections(view: EditorView, pointer: number | null): MenuSection[] {
  if (!view.editable || pointer === null) return []
  const cell = clickedCell(view.state.doc, pointer)
  if (cell === null) return []
  const target = targetSelection(view.state, cell)
  const map = TableMap.get(cell.table)
  // The target's rows and columns, from its corner cells.
  const { top, bottom, left, right } = map.rectBetween(target.$anchorCell.pos - cell.tableStart, target.$headCell.pos - cell.tableStart)
  const run = (command: Command) => () => runOn(view, pointer, command)
  const rows = bottom - top
  const cols = right - left
  const { freezeRows, freezeCols } = cell.table.attrs as { freezeRows: number; freezeCols: number }
  const item = (id: string, label: string, onSelect: () => void, disabled = false): MenuAction => ({ id: `table-${id}`, label, onSelect, disabled })
  return [
    [
      item('insert-row-above', counted(rows, 'Insert row above', 'Insert N rows above'), run(rowsAbove), top === 0),
      item('insert-row-below', counted(rows, 'Insert row below', 'Insert N rows below'), run(rowsBelow)),
      item('insert-col-left', counted(cols, 'Insert column left', 'Insert N columns left'), run(columns('left'))),
      item('insert-col-right', counted(cols, 'Insert column right', 'Insert N columns right'), run(columns('right'))),
    ],
    [
      item('delete-row', counted(rows, 'Delete row', 'Delete N rows'), run(deleteRow), top === 0 || rows >= map.height - 1),
      item('delete-col', counted(cols, 'Delete column', 'Delete N columns'), run(deleteColumn), cols >= map.width),
      item('clear', 'Clear cells', run(deleteCellSelection)),
      {
        id: 'table-fill',
        label: 'Fill',
        children: [FILL_COLORS.map((color) => item(`fill-${color}`, capital(color), run(fill(color)))), [item('fill-none', 'None', run(fill(null)))]],
      },
    ],
    [
      freezeRows === cell.row + 1
        ? item('freeze-rows', '✓ Frozen up to this row', () => setFreeze(view, cell.tableStart, 'freezeRows', 0))
        : item('freeze-rows', 'Freeze up to this row', () => setFreeze(view, cell.tableStart, 'freezeRows', cell.row + 1)),
      freezeCols === cell.col + 1
        ? item('freeze-cols', '✓ Frozen up to this column', () => setFreeze(view, cell.tableStart, 'freezeCols', 0))
        : item('freeze-cols', 'Freeze up to this column', () => setFreeze(view, cell.tableStart, 'freezeCols', cell.col + 1)),
      item('unfreeze-rows', 'Unfreeze rows', () => setFreeze(view, cell.tableStart, 'freezeRows', 0), freezeRows === 0),
      item('unfreeze-cols', 'Unfreeze columns', () => setFreeze(view, cell.tableStart, 'freezeCols', 0), freezeCols === 0),
    ],
  ]
}
