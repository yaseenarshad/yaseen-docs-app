/**
 * The Table part of a page's right-click menu (YAZ-3769, YAZ-3696 🔒 D5 / S3), after the paste
 * rows, when the right-click is in a cell of an editable page (R3). It is the ONE table menu
 * (YAZ-3820): a row or column handle opens the same page menu, on the cells it selected
 * (`pageMenu.tsx`). Six groups:
 * - the clicked cell's note (YAZ-3818 D8): "Add cell note" on a cell with none; "Open cell note" and
 *   "Delete cell note" on a cell with one. Delete asks nothing; ⌘Z brings the note and its mark back;
 * - Insert row above / below, Insert column left / right, Duplicate row, Duplicate column (YAZ-4168);
 * - Delete row, Delete column, Clear cells; Merge cells (YAZ-4792, `tableMerge.ts`: disabled while the target cannot
 *   merge, `mergeRect`), and on a merged cell Unmerge cells;
 * - Align ▸ (the cells' own alignment, YAZ-3819; the column's own value clears it; then Top · Middle · Bottom, the
 *   cells' own vertical alignment, YAZ-4166 D10; the table's own value clears it), Fill ▸ and
 *   Text colour ▸ (the cell toolbar's palette: the clear item, the ten names, Custom colour…,
 *   YAZ-3817, on the target cells of the moment it opens, `colours.ts`); "Text in this column ›" / "Text in these
 *   columns ›" (YAZ-4900: Table's choice / Wrap / Clip for the target's whole columns, ✓ at what they show; the
 *   column's `text` on each of its cells, saved as `text 2:clip`; it wins over the table's "Text in cells");
 * - Sort A to Z, Sort Z to A, by the target's left column; "Fold N rows" on a target of two or more body rows
 *   (YAZ-4165, `tableFold.ts`; the header row never folds); YAZ-4899: "Make subheader row" / "Make N subheader rows"
 *   on body rows (off in a calendar table, with the reason) or "Turn back into a normal row" on subheader rows; on a
 *   subheader row "Subheader row style ›", "Collapse all subheaders" and "Expand all subheaders"; on a header-row cell
 *   "Header row style ›" (item 3), the six-dot menu's own tabbed panel (`rowLookParent`, YAZ-4899 demo);
 * - Freeze up to this row, Freeze up to this column, Unfreeze rows, Unfreeze columns.
 *
 * A row acts on the CellSelection when there is one in the clicked table, else on the clicked cell:
 * the prosemirror-tables command runs on a state whose selection is that cell, and the note keeps
 * its own selection. Each row is one transaction with the history closed (one undo step, R4).
 * The header row (row 1) has no row above it, and it is never deleted or duplicated. The last body
 * row or column is not deleted either (GFM needs a header row and one row, and the table one
 * column). A new row takes each column's alignment, as Milkdown's own row does, and the vertical alignment of the
 * cell above it in each column (YAZ-4166).
 *
 * The labels count the target's rows and columns, as in Sheets (YAZ-3801): "Insert 2 rows above",
 * "Delete 3 columns"; one row or column keeps the singular label. Insert N inserts N. Whole rows and whole columns
 * count the same way: every item is always there, and counts what is selected (the YAZ-4163 demo).
 *
 * Freeze (S3) counts from the top and from the left: "Freeze up to this row" sets `freezeRows` to
 * the clicked row's number (row 1 is the header), the column item `freezeCols` the same way; there
 * is no "Freeze header row". `tableFreeze.ts` keeps the counts inside the table and draws them. On the row
 * (column) where the freeze ends, the item reads "✓ Frozen up to this row" and a click unfreezes (YAZ-3804).
 *
 * MERGED CELLS (YAZ-4792): Insert row, Insert column, Delete row and Delete column take them as prosemirror-tables
 * does (a merged cell that spans the place grows or shrinks). Duplicate row is disabled while a merged cell crosses
 * the target rows' edge, Duplicate column while a merged cell is in the target columns at all, Sort while a body cell
 * spans rows, and Fold while a merged cell crosses the target rows' edge: each would copy or move a cell twice, or
 * leave a row short, and write a broken grid. Sort reads a column's cells through the table map.
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import { Fragment, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { EditorState, type Selection, type Transaction } from '@milkdown/kit/prose/state'
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
import { createElement } from 'react'
import type { MenuAction, MenuItem, MenuParent, MenuSection } from '../../sidebar/menuSections'
import { fillFlyout, type MenuRow } from '../blockHandleMenu'
import { canMoveToCellNote, moveToCellNote, openCellNote } from './cellNoteCard'
import { deleteText, deleteWithNotes, duplicateWithNotes, type DeleteKind } from './cellNoteGuard'
import { cellNoteLabelsIn, cellNoteOf, removeCellNote, tableAround } from './cellNotes'
import { bodySpansRows, cellAt, isMerged, mergeCrosses, rectHasMerge, rowFolded, rowNoDim, rowSubhead, setCellsAlign, setCellsAttr, setCellsValign, typedValue, wholeColumns, wholeRows } from './cells'
import { capital, fillSwatch, pickCustomColour, textSwatch } from './colours'
import { foldRows, keepingScroll, unfoldRun } from './tableFold'
import { headerRowParent, swatchIcon } from './tableRows'
import { setAllSections, setSubhead } from './tableSubhead'
import { mergeCells, mergeRect, unmergeCells } from './tableMerge'
import { CELL_ALIGNS, TABLE_COLORS, VALIGNS, cellText, type CellAlign, type CellText, type TableColor, type Valign } from './tableStyle'

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
 * The transaction of `command` on the target cells of `current`, with the history closed, or null when it makes none.
 * The command sees a state whose selection is the target; the note's own selection is put back when it was not.
 */
function buildOn(current: EditorState, pointer: number, command: Command): Transaction | null {
  const cell = clickedCell(current.doc, pointer)
  if (cell === null) return null
  const own = current.selection
  const target = targetSelection(current, cell)
  const state = target === own ? current : EditorState.create({ doc: current.doc, selection: target })
  let made: Transaction | null = null
  command(state, (tr) => {
    if (target !== own) tr.setSelection(own.map(tr.doc, tr.mapping))
    made = closeHistory(tr)
  })
  return made
}

/** Run `command` on the target cells, in one transaction with the history closed (`buildOn`). */
function runOn(view: EditorView, pointer: number, command: Command): void {
  const tr = buildOn(view.state, pointer, command)
  if (tr !== null) view.dispatch(tr)
}

/**
 * A delete of rows, columns or cells that asks first when it would take a cell note (YAZ-4206 D16,
 * `deleteWithNotes`): the sheet names what goes and how many cell notes.
 */
function deleteOn(view: EditorView, pointer: number, command: Command, kind: DeleteKind, count: number): void {
  deleteWithNotes(view, (state) => buildOn(state, pointer, command), (gone) => deleteText(kind, count, gone))
}

/**
 * Duplicate rows or columns, with the choice for their cell notes (YAZ-4206 D17, `duplicateWithNotes`): the copied
 * cells' marks, and the table's end for the cloned cell notes.
 */
function duplicateOn(view: EditorView, pointer: number, kind: 'rows' | 'columns'): void {
  const cell = clickedCell(view.state.doc, pointer)
  if (cell === null) return
  const rect = selectedRect(EditorState.create({ doc: view.state.doc, selection: targetSelection(view.state, cell) }))
  const labels: string[] = []
  for (let row = kind === 'rows' ? rect.top : 0; row < (kind === 'rows' ? rect.bottom : rect.map.height); row++) {
    for (let col = kind === 'rows' ? 0 : rect.left; col < (kind === 'rows' ? rect.map.width : rect.right); col++) {
      for (const label of cellNoteLabelsIn(rect.table.nodeAt(rect.map.map[row * rect.map.width + col]!)!)) if (!labels.includes(label)) labels.push(label)
    }
  }
  const count = kind === 'rows' ? rect.bottom - rect.top : rect.right - rect.left
  const noun = kind === 'rows' ? (count === 1 ? 'This row' : 'These rows') : count === 1 ? 'This column' : 'These columns'
  duplicateWithNotes(
    view,
    labels,
    noun,
    (state, copy) => buildOn(state, pointer, kind === 'rows' ? duplicateRows(copy) : duplicateColumns(copy)),
    (doc) => tableAround(doc, cell.pos).end,
  )
}

/**
 * As many body rows as the rect holds, at index `at` of its table, each cell with its column's alignment:
 * a copy of Milkdown's `addRowWithAlignment`, which needs the editor's `ctx`; the page menu has the view only.
 * Each cell also takes the `valign` of the cell above it (YAZ-4166); above the first body row, that row's own, not the
 * header's (YAZ-4173 12C). A merged cell that spans the place (YAZ-4792) grows by the rows, as prosemirror-tables'
 * `addRow` does, and the new rows have no cell of their own under it.
 */
function insertRows(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, rect: TableRect, at: number): boolean {
  if (at === 0) return false
  if (dispatch) {
    const { table_row: rowType, table_cell: cellType } = state.schema.nodes
    const { table, map, tableStart } = rect
    let pos = tableStart
    for (let i = 0; i < at; i++) pos += table.child(i).nodeSize
    const attr = (row: number, col: number, name: string): unknown => cellAt(table, map, row, col).attrs[name] ?? null
    const count = rect.bottom - rect.top
    const tr = state.tr
    // YAZ-4899 item 18: a row below a collapsed subheader row opens its section first, so the new row shows.
    if (at < map.height && rowSubhead(table.child(at - 1)) && rowFolded(table.child(at))) unfoldRun(tr, tableStart - 1, at)
    const cells: ProseNode[] = []
    for (let col = 0; col < map.width; col++) {
      // The cell at this place is the one above it too: it spans the place.
      if (at < map.height && map.map[at * map.width + col] === map.map[(at - 1) * map.width + col]) {
        const spanning = map.map[at * map.width + col]!
        if (col === 0 || map.map[at * map.width + col - 1] !== spanning) {
          const attrs = table.nodeAt(spanning)!.attrs
          tr.setNodeMarkup(tableStart + spanning, undefined, { ...attrs, rowspan: (attrs.rowspan as number) + count })
        }
        continue
      }
      cells.push(cellType.createAndFill({ alignment: attr(0, col, 'alignment'), valign: attr(at === 1 ? 1 : at - 1, col, 'valign') })!)
    }
    const rows = Array.from({ length: count }, () => rowType.create(null, cells))
    dispatch(tr.insert(pos, rows))
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

/** One cell attribute (`fill`, `color`) on every target cell. */
const cellsAttr =
  (attr: 'fill' | 'color', value: string | null): Command =>
  (state, dispatch) => {
    const tr = setCellsAttr(state.tr, selectedRect(state), attr, value)
    if (tr.docChanged) dispatch?.(tr)
    return true
  }

/** The target cells' own alignment: `null` where it is the column's (`setCellsAlign`, YAZ-3819). */
const cellsAlign =
  (align: CellAlign): Command =>
  (state, dispatch) => {
    const tr = setCellsAlign(state.tr, selectedRect(state), align)
    if (tr.docChanged) dispatch?.(tr)
    return true
  }

/**
 * The target's whole columns' own Wrap or Clip, or `null` for the table's (YAZ-4900): `text` on every cell of each column,
 * header cell too (the column's value is its header cell's; `keepColumnAlign` keeps the body cells with it).
 */
const columnsText =
  (text: CellText | null): Command =>
  (state, dispatch) => {
    const rect = selectedRect(state)
    const tr = setCellsAttr(state.tr, wholeColumns(rect, rect.left, rect.right), 'text', text)
    if (tr.docChanged) dispatch?.(tr)
    return true
  }

/** The target cells' own vertical alignment: `null` where it is the table's (`setCellsValign`, YAZ-4166). */
const cellsValign =
  (valign: Valign): Command =>
  (state, dispatch) => {
    const tr = setCellsValign(state.tr, selectedRect(state), valign)
    if (tr.docChanged) dispatch?.(tr)
    return true
  }

/** The target's own cells again, at the same rows and columns of the table, in `tr`. */
function sameCells(tr: Transaction, rect: TableRect): Transaction {
  const table = tr.doc.nodeAt(rect.tableStart - 1)!
  const map = TableMap.get(table)
  const at = (row: number, col: number) => rect.tableStart + map.positionAt(row, col, table)
  return tr.setSelection(CellSelection.create(tr.doc, at(rect.top, rect.left), at(rect.bottom - 1, rect.right - 1)))
}

// "9" before "10"; case and accents do not count.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** One level of a sort: a grid column of the table and its direction. */
export interface SortLevel {
  col: number
  desc: boolean
}

/**
 * The body rows sorted inside each section (YAZ-4899 item 15): a subheader row stays where it is, and the rows under it
 * (to the next subheader row) sort among themselves, as do the rows above the first subheader row. `compare` orders two
 * body rows by their index among the body rows.
 */
function sortSections(rows: readonly ProseNode[], compare: (a: number, b: number) => number): ProseNode[] {
  const out: ProseNode[] = []
  let section: number[] = []
  const flush = () => {
    out.push(...section.sort(compare).map((index) => rows[index]!))
    section = []
  }
  rows.forEach((row, index) => {
    if (rowSubhead(row)) {
      flush()
      out.push(row)
    } else section.push(index)
  })
  flush()
  return out
}

/**
 * THE ONE SORT of a table's real rows (YAZ-4834 P7): the right-click "Sort A to Z" (one level, the target's left column)
 * and the Super table's base Sort (a view's levels) both come here. The body rows of the table at `tablePos` sorted by
 * `levels` in `tr` (the first level that differs wins): the header row stays first, each section sorts inside itself
 * (`sortSections`), empty cells go last, numbers as numbers (`typedValue`: `-3`, `1,000`), the rest by the collator,
 * equal rows keep their order. The whole rows move, so each cell keeps its attributes. `false` when the rows cannot
 * sort (a body cell spans rows, YAZ-4792; no level); `tr` is unchanged when they are in order already.
 */
export function sortBodyRows(tr: Transaction, tablePos: number, levels: readonly SortLevel[]): boolean {
  const table = tr.doc.nodeAt(tablePos)
  if (table?.type.name !== 'table' || levels.length === 0 || bodySpansRows(table)) return false
  const map = TableMap.get(table)
  const rows: ProseNode[] = []
  table.forEach((row, _, index) => {
    if (index > 0) rows.push(row)
  })
  // A cell's words, its lines and bullets joined with a space (YAZ-3818); the column's cell through the map (YAZ-4792).
  const texts = rows.map((_, index) =>
    levels.map(({ col }) => {
      const cell = cellAt(table, map, index + 1, col)
      return cell.textBetween(0, cell.content.size, ' ').trim()
    }),
  )
  const compare = (a: number, b: number): number => {
    for (const [level, { desc }] of levels.entries()) {
      const ta = texts[a]![level]!
      const tb = texts[b]![level]!
      if (!ta !== !tb) return ta ? -1 : 1
      const va = typedValue(ta)
      const vb = typedValue(tb)
      const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : collator.compare(ta, tb)
      if (d !== 0) return desc ? -d : d
    }
    return a - b
  }
  const sorted = sortSections(rows, compare)
  if (sorted.every((row, index) => row === rows[index])) return true
  const from = tablePos + 1 + table.firstChild!.nodeSize
  tr.replaceWith(from, tablePos + 1 + table.content.size, sorted)
  return true
}

/**
 * Sort the body rows by the target's left column (YAZ-3696 D9, moved from the vendored handle menu by YAZ-3820):
 * `sortBodyRows` with one level. The same cells stay selected.
 */
const sortRows =
  (direction: 1 | -1): Command =>
  (state, dispatch) => {
    const rect = selectedRect(state)
    const tr = state.tr
    if (!sortBodyRows(tr, rect.tableStart - 1, [{ col: rect.left, desc: direction === -1 }])) return false
    if (tr.docChanged) dispatch?.(sameCells(tr, rect))
    return true
  }

/**
 * A copy of the target's body rows below the last of them (YAZ-3696 D9, moved by YAZ-3820). `copy` makes what is
 * inserted from the copied rows: their cell notes' marks relabelled or dropped (YAZ-4206 D17).
 */
const duplicateRows =
  (copy: (content: Fragment) => Fragment = (content) => content): Command =>
  (state, dispatch) => {
    const rect = selectedRect(state)
    const { table, tableStart, top, bottom } = rect
    if (top === 0 || mergeCrosses(wholeRows(rect, top, bottom))) return false
    const rows: ProseNode[] = []
    let pos = tableStart
    for (let index = 0; index < bottom; index++) {
      if (index >= top) rows.push(table.child(index))
      pos += table.child(index).nodeSize
    }
    dispatch?.(state.tr.insert(pos, copy(Fragment.from(rows))))
    return true
  }

/**
 * A copy of the target's columns right of the last of them (YAZ-4168): in each row, the same cell
 * nodes again, so every attribute goes with them — text, fill, colour, own alignment, width
 * (`colwidth`) and the GFM `alignment`. One `insert` per row, mapped through the ones before it.
 */
const duplicateColumns =
  (copy: (content: Fragment) => Fragment = (content) => content): Command =>
  (state, dispatch) => {
    const rect = selectedRect(state)
    if (rectHasMerge(wholeColumns(rect, rect.left, rect.right))) return false
    if (dispatch) {
      const { table, tableStart, map, left, right } = rect
      const tr = state.tr
      for (let row = 0; row < map.height; row++) {
        const at = (col: number) => map.map[row * map.width + col]!
        const cells = Array.from({ length: right - left }, (_, i) => table.nodeAt(at(left + i))!)
        const last = at(right - 1)
        tr.insert(tr.mapping.map(tableStart + last + table.nodeAt(last)!.nodeSize), copy(Fragment.from(cells)))
      }
      dispatch(tr)
    }
    return true
  }

/** One freeze count on the clicked table. */
function setFreeze(view: EditorView, tableStart: number, attr: 'freezeRows' | 'freezeCols', count: number): void {
  const pos = tableStart - 1
  if (view.state.doc.nodeAt(pos)?.attrs[attr] === count) return
  view.dispatch(closeHistory(view.state.tr).setNodeAttribute(pos, attr, count))
}

/**
 * "Don't dim this row" / "Dim this row again" (YAZ-4796: "i have started adding a todo list on the second row and i want
 * the ability for it to not be dim"): `nodim` on every cell of the body rows `top`…`bottom`, one transaction, one ⌘Z.
 */
function setNoDim(view: EditorView, table: ProseNode, tableStart: number, top: number, bottom: number, on: boolean): void {
  const tr = closeHistory(view.state.tr)
  let at = tableStart
  table.forEach((row, _, r) => {
    if (r >= Math.max(top, 1) && r < bottom)
      row.forEach((c, offset) => {
        if (c.attrs.nodim !== on) tr.setNodeAttribute(at + 1 + offset, 'nodim', on)
      })
    at += row.nodeSize
  })
  if (tr.docChanged) view.dispatch(tr)
}

/** Unmerge the clicked cell (YAZ-4792): the command runs on a state whose selection is that cell alone, as `buildOn` does. */
function unmergeOn(view: EditorView, cellPos: number): void {
  const state = EditorState.create({ doc: view.state.doc, selection: CellSelection.create(view.state.doc, cellPos) })
  unmergeCells(state, (tr) => view.dispatch(tr))
}

/** Custom colour… on the target cells of this moment: the colour box opens under them, and its picks go to them (`colours.ts`). */
function customColour(view: EditorView, pointer: number, attr: 'fill' | 'color'): void {
  const cell = clickedCell(view.state.doc, pointer)
  if (cell !== null) pickCustomColour(view, targetSelection(view.state, cell), attr)
}

/**
 * The vendored table block's ask for the table menu (YAZ-3820): `{ x, y, pos }` in `detail`. The
 * package sends its own copy of this name (`operation.ts`); `pageMenu.test.tsx` clicks a real handle.
 */
export const TABLE_HANDLE_MENU = 'milkdown-table-handle-menu'

/** A colour's swatch before its label, as the cell toolbar's palette draws it. */
const swatch = (background: string) => createElement('span', { className: 'table-menu-swatch', style: { background } })

/** Each palette row's swatch colour (YAZ-4970): the Format panel draws it as the six-dot menu's swatch. */
const swatches = new WeakMap<MenuAction, string>()

/**
 * "Header row style ›" (item 3) and "Subheader row style ›" (YAZ-4899 demo: "why is subheader row formatting in one
 * place … but then on the right click on the row itself its in a different way?"): the six-dot menu's own panel
 * (`tableRows.ts` `headerRowParent`: Plain, the Fill · Text · Style tabs, the Strength switch), drawn by its own
 * code (`fillFlyout`) in this menu's flyout. A pick keeps the panel open and draws it again from the table (the ✓
 * moves, the tab stays, the focused row keeps the focus); one ⌘Z each, as the six-dot menu's.
 */
function rowLookParent(view: EditorView, pos: number, kind: 'header' | 'subheader'): MenuParent {
  return {
    id: `table-${kind}-style`,
    label: kind === 'header' ? 'Header row style' : 'Subheader row style',
    children: [],
    panel: (host, close) => {
      const draw = () => {
        const focused = host.contains(document.activeElement) ? document.activeElement!.textContent : null
        host.replaceChildren()
        fillFlyout(host, headerRowParent(view, pos, kind), close, refresh)
        if (focused !== null) [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === focused)?.focus({ preventScroll: true })
      }
      const refresh = (run: () => void) => {
        run()
        draw()
      }
      draw()
    },
  }
}

/**
 * What a right-click opened the table menu on (YAZ-4970): cells (a right-click in a cell), or a row or column handle
 * (`pageMenu.tsx` reads it from the handle's selection, `handleKind`).
 */
export type TableMenuKind = 'cells' | 'row' | 'column'

/** What a table handle selected, as the handle's menu reads it (YAZ-4970): whole columns, whole body rows, or neither. */
export function handleKind(selection: Selection): TableMenuKind {
  if (!(selection instanceof CellSelection)) return 'cells'
  return selection.isColSelection() ? 'column' : selection.isRowSelection() ? 'row' : 'cells'
}

/**
 * "Format ›" (YAZ-4970): Align, Fill, Text colour and "Text in this column" as one row, its flyout the six-dot menu's
 * tabbed panel (`fillFlyout`, as "Header row style ›"). `children` holds the same rows as data, so a search of the menu's
 * rows finds them; the panel draws them. A pick runs and closes the menu, as the old flyouts' did.
 */
function formatParent(align: MenuAction[][], fill: MenuParent, color: MenuParent, text: MenuParent | null): MenuParent {
  const row = (action: MenuAction): MenuRow => ({
    label: action.label,
    disabled: action.disabled,
    hint: action.radio !== undefined ? (action.radio.on ? '✓' : undefined) : action.hint,
    icon: swatches.has(action) ? swatchIcon(swatches.get(action)!) : undefined,
    run: action.onSelect,
  })
  const rowsOf = (groups: readonly MenuAction[][]) => groups.map((group) => group.map(row))
  const tabs: NonNullable<MenuRow['tabs']> = [
    { label: 'Align', children: rowsOf(align) },
    { label: 'Fill', children: rowsOf(fill.children) },
    { label: 'Text colour', children: rowsOf(color.children) },
    ...(text === null ? [] : [{ label: 'Wrap', headings: [text.label], children: rowsOf(text.children) }]),
  ]
  return {
    id: 'table-format',
    label: 'Format',
    children: [...align, ...fill.children, ...color.children, ...(text?.children ?? [])],
    panel: (host, close) => fillFlyout(host, { label: 'Format', run: () => {}, tabs }, close),
  }
}

/** The Table part's groups for `kind` (YAZ-4970), or none: no cell at `pointer`, or a read-only page. */
export function tableMenuSections(view: EditorView, pointer: number | null, kind: TableMenuKind = 'cells'): MenuSection[] {
  if (!view.editable || pointer === null) return []
  const cell = clickedCell(view.state.doc, pointer)
  if (cell === null) return []
  const target = targetSelection(view.state, cell)
  const map = TableMap.get(cell.table)
  // The target's rows and columns, from its corner cells.
  const { top, bottom, left, right } = map.rectBetween(target.$anchorCell.pos - cell.tableStart, target.$headCell.pos - cell.tableStart)
  const rect: TableRect = { top, bottom, left, right, table: cell.table, tableStart: cell.tableStart, map }
  const run = (command: Command) => () => runOn(view, pointer, command)
  const rows = bottom - top
  const cols = right - left
  // The target's body rows: the header row never folds (YAZ-4165); a merged cell across the rows' edge stops it (YAZ-4792).
  const folds = mergeCrosses(wholeRows(rect, Math.max(top, 1), bottom)) ? 0 : bottom - Math.max(top, 1)
  const { freezeRows, freezeCols } = cell.table.attrs as { freezeRows: number; freezeCols: number }
  // YAZ-4796: a calendar table's target body rows, all kept out of the dimming already.
  const calendar = (cell.table.attrs.calendar as number) > 0
  const bodyRows = Array.from({ length: Math.max(bottom - Math.max(top, 1), 0) }, (_, i) => cell.table.child(Math.max(top, 1) + i))
  const undimmed = bodyRows.length > 0 && bodyRows.every((row) => rowNoDim(row))
  const item = (id: string, label: string, onSelect: () => void, disabled = false): MenuAction => ({ id: `table-${id}`, label, onSelect, disabled })
  // YAZ-4899: the target's body rows as subheader rows. Off in a calendar table (its rows are time slots), with the reason.
  const tablePos = cell.tableStart - 1
  const subheads = bodyRows.length > 0 && bodyRows.every((row) => rowSubhead(row))
  const bodyCount = Math.max(bottom - Math.max(top, 1), 1)
  const subheadItems: MenuAction[] =
    bottom <= 1
      ? []
      : subheads
        ? [item('subhead-off', counted(bodyCount, 'Turn back into a normal row', 'Turn N back into normal rows'), () => view.dispatch(closeHistory(setSubhead(view.state.tr, tablePos, top, bottom, false))))]
        : [
            {
              ...item('subhead', counted(bodyCount, 'Make subheader row', 'Make N subheader rows'), () => view.dispatch(closeHistory(setSubhead(view.state.tr, tablePos, top, bottom, true))), calendar),
              ...(calendar && { hint: 'Time slots are on' }),
            },
          ]
  const onSubhead = cell.row > 0 && rowSubhead(cell.table.child(cell.row))
  const sectionItems: MenuItem[] =
    onSubhead
      ? [
          rowLookParent(view, tablePos, 'subheader'),
          item('subhead-collapse-all', 'Collapse all subheaders', () => keepingScroll(view, () => view.dispatch(closeHistory(setAllSections(view.state.tr, tablePos, true))))),
          item('subhead-expand-all', 'Expand all subheaders', () => view.dispatch(closeHistory(setAllSections(view.state.tr, tablePos, false)))),
        ]
      : []
  /** Fill ▸ or Text colour ▸: the cell toolbar's palette — the clear item, the ten names, Custom colour… (YAZ-3817). */
  const palette = (attr: 'fill' | 'color', label: string, clear: string, color: (c: TableColor) => string): MenuParent => ({
    id: `table-${attr}`,
    label,
    children: [
      [item(`${attr}-none`, clear, run(cellsAttr(attr, null)))],
      TABLE_COLORS.map((c) => {
        const row: MenuAction = { ...item(`${attr}-${c}`, capital(c), run(cellsAttr(attr, c))), icon: swatch(color(c)) }
        swatches.set(row, color(c))
        return row
      }),
      [item(`${attr}-custom`, 'Custom colour…', () => customColour(view, pointer, attr))],
    ],
  })
  // YAZ-4900: "Text in this column ›" (or "these columns"): Table's choice / Wrap / Clip, ✓ at what the target columns
  // show (their header cells' `text`; mixed columns light none). Each pick is a radio row, so the menu stays open.
  const shownTexts = new Set(Array.from({ length: cols }, (_, i) => cellText(cellAt(cell.table, map, 0, left + i).attrs.text)))
  const textRow = (id: string, label: string, value: CellText | null): MenuAction => ({ id: `table-text-${id}`, label, onSelect: run(columnsText(value)), radio: { group: 'table-text', on: shownTexts.size === 1 && shownTexts.has(value) } })
  const textParent: MenuParent = {
    id: 'table-text',
    label: counted(cols, 'Text in this column', 'Text in these columns'),
    children: [[textRow('table', "Table's choice", null), textRow('wrap', 'Wrap', 'wrap'), textRow('clip', 'Clip', 'clip')]],
  }
  const note = cellNoteOf(view.state.doc, cell.pos)
  // The YAZ-3818 demo: a cell with some text moves all of it into its cell note.
  const move = canMoveToCellNote(view, cell.pos) ? [item('move-to-note', 'Move to cell note', () => moveToCellNote(view, cell.pos))] : []
  const noteItems: MenuItem[] =
    note === null
      ? [item('add-note', 'Add cell note', () => openCellNote(view, cell.pos)), ...move]
      : [
          item('open-note', 'Open cell note', () => openCellNote(view, cell.pos)),
          ...move,
          item('delete-note', 'Delete cell note', () => view.dispatch(closeHistory(removeCellNote(view.state.tr, note)))),
        ]
  const insertRowAbove = item('insert-row-above', counted(rows, 'Insert row above', 'Insert N rows above'), run(rowsAbove), top === 0)
  const insertRowBelow = item('insert-row-below', counted(rows, 'Insert row below', 'Insert N rows below'), run(rowsBelow))
  const insertColLeft = item('insert-col-left', counted(cols, 'Insert column left', 'Insert N columns left'), run(columns('left')))
  const insertColRight = item('insert-col-right', counted(cols, 'Insert column right', 'Insert N columns right'), run(columns('right')))
  // YAZ-4792: a merged cell across the rows' edge, or in the columns, would be copied twice or left out.
  const duplicateRow = item('duplicate-rows', counted(rows, 'Duplicate row', 'Duplicate N rows'), () => duplicateOn(view, pointer, 'rows'), top === 0 || mergeCrosses(wholeRows(rect, top, bottom)))
  const duplicateCol = item('duplicate-cols', counted(cols, 'Duplicate column', 'Duplicate N columns'), () => duplicateOn(view, pointer, 'columns'), rectHasMerge(wholeColumns(rect, left, right)))
  // YAZ-4206 D16: each asks first when it would take a cell note.
  const deleteRowItem = item('delete-row', counted(rows, 'Delete row', 'Delete N rows'), () => deleteOn(view, pointer, deleteRow, 'row', rows), top === 0 || rows >= map.height - 1)
  const deleteColItem = item('delete-col', counted(cols, 'Delete column', 'Delete N columns'), () => deleteOn(view, pointer, deleteColumn, 'column', cols), cols >= map.width)
  const clearMerge: MenuItem[] = [
    item('clear', 'Clear cells', () => deleteOn(view, pointer, deleteCellSelection, 'cells', rows * cols)),
    // YAZ-4792: the target cells as one; a merged cell's right-click also takes it apart again.
    item('merge', 'Merge cells', run(mergeCells), mergeRect(target) === null),
    ...(isMerged(view.state.doc.nodeAt(cell.pos)!) ? [item('unmerge', 'Unmerge cells', () => unmergeOn(view, cell.pos))] : []),
  ]
  const align: MenuAction[][] = [CELL_ALIGNS.map((a) => item(`align-${a}`, capital(a), run(cellsAlign(a)))), VALIGNS.map((v) => item(`align-${v}`, capital(v), run(cellsValign(v))))]
  // YAZ-4970: Format › holds Align, Fill, Text colour and, but on a row, "Text in this column" (Wrap · Clip).
  const format = formatParent(align, palette('fill', 'Fill', 'No fill', fillSwatch), palette('color', 'Text colour', 'Default colour', textSwatch), kind === 'row' ? null : textParent)
  // YAZ-4792: a body cell that spans rows keeps the rows where they are.
  const sort: MenuParent = {
    id: 'table-sort',
    label: 'Sort',
    children: [[item('sort-asc', 'Sort A to Z', run(sortRows(1)), bodySpansRows(rect.table)), item('sort-desc', 'Sort Z to A', run(sortRows(-1)), bodySpansRows(rect.table))]],
  }
  // Item 3: the header row's look from its cells too (the six-dot menu's "Header row ›").
  const headerStyle: MenuItem[] = cell.row === 0 ? [rowLookParent(view, tablePos, 'header')] : []
  // The rows' own state: Fold, subheader rows, the dimming of a calendar table's rows.
  const rowState: MenuItem[] = [
    ...(folds >= 2 ? [item('fold', `Fold ${folds} rows`, () => keepingScroll(view, run(foldRows)))] : []),
    ...subheadItems,
    ...sectionItems,
    // YAZ-4796: a calendar table's body row can stay out of the past rows' dimming (a to-do row, say).
    ...(calendar && bottom > 1
      ? [
          undimmed
            ? item('dim', counted(Math.max(bottom - Math.max(top, 1), 1), 'Dim this row again', 'Dim N rows again'), () => setNoDim(view, cell.table, cell.tableStart, top, bottom, false))
            : item('nodim', counted(Math.max(bottom - Math.max(top, 1), 1), "Don't dim this row", "Don't dim N rows"), () => setNoDim(view, cell.table, cell.tableStart, top, bottom, true)),
        ]
      : []),
  ]
  const freeze: MenuParent = {
    id: 'table-freeze',
    label: 'Freeze',
    children: [
      [
        freezeRows === cell.row + 1
          ? item('freeze-rows', '✓ Frozen up to this row', () => setFreeze(view, cell.tableStart, 'freezeRows', 0))
          : item('freeze-rows', 'Freeze up to this row', () => setFreeze(view, cell.tableStart, 'freezeRows', cell.row + 1)),
        freezeCols === cell.col + 1
          ? item('freeze-cols', '✓ Frozen up to this column', () => setFreeze(view, cell.tableStart, 'freezeCols', 0))
          : item('freeze-cols', 'Freeze up to this column', () => setFreeze(view, cell.tableStart, 'freezeCols', cell.col + 1)),
      ],
      [
        item('unfreeze-rows', 'Unfreeze rows', () => setFreeze(view, cell.tableStart, 'freezeRows', 0), freezeRows === 0),
        item('unfreeze-cols', 'Unfreeze columns', () => setFreeze(view, cell.tableStart, 'freezeCols', 0), freezeCols === 0),
      ],
    ],
  }
  // YAZ-4970 (Yaseen: "option 1, shorter and fits"): each menu shows what applies to what was right-clicked.
  if (kind === 'row') return [[insertRowAbove, insertRowBelow, duplicateRow], [deleteRowItem, ...clearMerge], [format], rowState, [freeze]]
  if (kind === 'column') return [[insertColLeft, insertColRight, duplicateCol], [deleteColItem, ...clearMerge], [format, sort, ...headerStyle], [freeze]]
  const parent = (id: string, label: string, children: MenuAction[][]): MenuParent => ({ id: `table-${id}`, label, children })
  return [
    [
      parent('insert', 'Insert', [
        [insertRowAbove, insertRowBelow],
        [insertColLeft, insertColRight],
      ]),
      parent('duplicate', 'Duplicate', [[duplicateRow, duplicateCol]]),
      parent('delete', 'Delete', [[deleteRowItem, deleteColItem]]),
      ...clearMerge,
    ],
    noteItems,
    // Sort is a column action the cell's menu keeps, as Insert ›, Duplicate › and Delete › keep theirs.
    [format, sort],
    [...rowState, ...headerStyle],
    [freeze],
  ]
}
