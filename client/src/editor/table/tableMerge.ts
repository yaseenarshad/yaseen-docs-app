/**
 * Merge cells (YAZ-4792): two or more selected cells that form a rectangle become ONE cell, as in Google Docs.
 *
 * - WHERE: "Merge" in the cell toolbar (`cellToolbar.ts`) and "Merge cells" in the table menu (`tableMenu.ts`), on a
 *   CellSelection whose cells form a rectangle (`mergeRect`); "Unmerge cells" in the menu of a merged cell. Each is one
 *   transaction with the history closed: one ⌘Z (R4).
 * - NOT ALLOWED (`mergeRect` gives null): one cell; a selection that cuts through a merged cell; a selection from the
 *   header row into the body (a header cell is one line, and the file's header row is one row); a selection that
 *   holds a folded row (`fold`, YAZ-4165: a hidden cell would go into the merge unseen).
 * - TEXT, NOTHING LOST: the merged cell holds every cell's text in reading order, top-left first; an empty cell adds
 *   nothing. Two lines join with a line break (one paragraph, `a<br>b` in the file, the shape a reload gives), a list
 *   goes in as its own block. A cell note's mark (`[^cell-N]`) is inline, so it goes along: the note belongs to the
 *   merged cell. The merged cell keeps the top-left cell's own settings (fill, colour, alignment).
 * - THE MODEL is prosemirror-tables': the merged cell gets `colspan` / `rowspan` and a `colwidth` per column, and the
 *   cells it covered leave the document. The file keeps the whole grid (`tableStyle.ts`, `tableComment.ts` `merge`).
 * - UNMERGE puts the covered cells back, empty, each with the merged cell's fill, colour and alignments (as Sheets
 *   keeps the format) and its column's width and GFM alignment; the text stays in the top-left cell. The cells it made
 *   stay selected, so the toolbar can merge them again.
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import { Fragment, type Node as ProseNode, type Schema } from '@milkdown/kit/prose/model'
import type { Command, EditorState, Selection } from '@milkdown/kit/prose/state'
import { CellSelection, TableMap, cellAround, type TableRect } from '@milkdown/kit/prose/tables'
import { isMerged, mergeCrosses } from './cells'

/** The rectangle `selection` would merge, or null when it cannot merge (see the header). */
export function mergeRect(selection: Selection): TableRect | null {
  if (!(selection instanceof CellSelection) || selection.$anchorCell.pos === selection.$headCell.pos) return null
  const table = selection.$anchorCell.node(-1)
  const tableStart = selection.$anchorCell.start(-1)
  const map = TableMap.get(table)
  const rect: TableRect = { ...map.rectBetween(selection.$anchorCell.pos - tableStart, selection.$headCell.pos - tableStart), table, tableStart, map }
  if (rect.top === 0 && rect.bottom > 1) return null
  // A Super table's rows move alone in its views (YAZ-4869 item 17): no cell may span rows there.
  if (table.attrs.superTable === true && rect.bottom - rect.top > 1) return null
  if (mergeCrosses(rect)) return null
  if (map.cellsInRect(rect).some((pos) => table.nodeAt(pos)!.attrs.fold === true)) return null
  return rect
}

/** A cell with one empty line and nothing else: it adds no text to a merge. */
const isEmptyCell = (cell: ProseNode): boolean => cell.childCount === 1 && cell.firstChild!.isTextblock && cell.firstChild!.content.size === 0

/**
 * The content of the merged cell: each cell's blocks in order; a line after a line joins it with a line break, so the
 * cell holds what a reload of `a<br>b` gives. Empty cells add nothing; with no text at all, one empty line.
 */
function joinContent(schema: Schema, cells: readonly ProseNode[]): Fragment {
  const blocks: ProseNode[] = []
  for (const cell of cells) {
    if (isEmptyCell(cell)) continue
    cell.forEach((block) => {
      const last = blocks.at(-1)
      if (last !== undefined && last.type.name === 'paragraph' && block.type.name === 'paragraph') {
        blocks[blocks.length - 1] = last.copy(last.content.append(Fragment.from(schema.nodes.hardbreak!.create())).append(block.content))
      } else blocks.push(block)
    })
  }
  return Fragment.from(blocks.length > 0 ? blocks : schema.nodes.paragraph!.create())
}

/** The width of grid column `col`, from the header row's cell that covers it; `0` for none. */
function columnWidth(rect: TableRect, col: number): number {
  const pos = rect.map.map[col]!
  const cell = rect.table.nodeAt(pos)!
  const widths = cell.attrs.colwidth as number[] | null
  return widths?.[col - rect.map.findCell(pos).left] ?? 0
}

/** The cells of the rectangle, in reading order (the top-left first), with their positions in the table. */
const cellsOf = (rect: TableRect): Array<{ pos: number; cell: ProseNode }> => rect.map.cellsInRect(rect).map((pos) => ({ pos, cell: rect.table.nodeAt(pos)! }))

/** Merge the selected cells into their top-left cell (see the header). */
export const mergeCells: Command = (state, dispatch) => {
  const rect = mergeRect(state.selection)
  if (rect === null) return false
  if (dispatch) {
    const { tableStart } = rect
    const cells = cellsOf(rect)
    const [first] = cells
    if (first === undefined) return false
    const tr = closeHistory(state.tr)
    // The later cells go first, from the last one back, so the earlier positions hold.
    for (const { pos, cell } of cells.slice(1).reverse()) tr.delete(tableStart + pos, tableStart + pos + cell.nodeSize)
    const widths = Array.from({ length: rect.right - rect.left }, (_, i) => columnWidth(rect, rect.left + i))
    const attrs = {
      ...first.cell.attrs,
      colspan: rect.right - rect.left,
      rowspan: rect.bottom - rect.top,
      colwidth: widths.some((w) => w > 0) ? widths : null,
    }
    const merged = first.cell.type.create(attrs, joinContent(state.schema, cells.map(({ cell }) => cell)))
    tr.replaceWith(tableStart + first.pos, tableStart + first.pos + first.cell.nodeSize, merged)
    tr.setSelection(new CellSelection(tr.doc.resolve(tableStart + first.pos)))
    dispatch(tr)
  }
  return true
}

/** The merged cell the selection stands in (one selected cell, or the caret's cell), with its position, or null. */
export function mergedCellOf(state: EditorState): { pos: number; cell: ProseNode } | null {
  const { selection } = state
  let pos: number | null = null
  if (selection instanceof CellSelection) {
    if (selection.$anchorCell.pos !== selection.$headCell.pos) return null
    pos = selection.$anchorCell.pos
  } else pos = cellAround(selection.$from)?.pos ?? null
  const cell = pos === null ? null : state.doc.nodeAt(pos)
  return cell !== null && pos !== null && isMerged(cell) ? { pos, cell } : null
}

/** Unmerge the merged cell of the selection (see the header): the text stays in the top-left cell. */
export const unmergeCells: Command = (state, dispatch) => {
  const merged = mergedCellOf(state)
  if (merged === null) return false
  if (dispatch) {
    const $cell = state.doc.resolve(merged.pos)
    const table = $cell.node(-1)
    const tableStart = $cell.start(-1)
    const map = TableMap.get(table)
    const rect: TableRect = { ...map.findCell(merged.pos - tableStart), table, tableStart, map }
    const tr = closeHistory(state.tr)
    // The merged cell's own look on every cell; each column's width and GFM alignment (a header cell keeps its own).
    const attrsAt = (row: number, col: number): Record<string, unknown> => {
      const width = columnWidth(rect, col)
      const header = table.nodeAt(map.map[col]!)!
      return { ...merged.cell.attrs, colspan: 1, rowspan: 1, colwidth: width > 0 ? [width] : null, alignment: row === 0 ? merged.cell.attrs.alignment : header.attrs.alignment }
    }
    let last: number | null = null
    for (let row = rect.top; row < rect.bottom; row++) {
      let pos = map.positionAt(row, rect.left, table)
      if (row === rect.top) pos += merged.cell.nodeSize
      for (let col = rect.left; col < rect.right; col++) {
        if (row === rect.top && col === rect.left) continue
        last = tr.mapping.map(pos + tableStart, 1)
        tr.insert(last, merged.cell.type.createAndFill(attrsAt(row, col))!)
      }
    }
    tr.setNodeMarkup(merged.pos, undefined, attrsAt(rect.top, rect.left))
    tr.setSelection(new CellSelection(tr.doc.resolve(merged.pos), last === null ? undefined : tr.doc.resolve(last)))
    dispatch(tr)
  }
  return true
}
