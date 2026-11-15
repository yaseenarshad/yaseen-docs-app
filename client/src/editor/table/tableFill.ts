/**
 * Fill down (YAZ-3765, YAZ-3696 🔒 S4): a small square in the bottom-right corner of the selected
 * cells (or of the caret's cell). Drag it down or right; on mouseup the cells passed fill with
 * `fillSeries`, each column (down) or row (right) on its own, in ONE transaction (one undo step).
 * It stops at the last row and column; it never adds rows or columns. No ⌘D.
 *
 * - HANDLE: a widget at the end of that cell; table.css puts it in the cell's corner (cells are
 *   `position: relative`). Inside the corner, not across it: the table clips its edge. CSS places
 *   it in layout px, so it follows document zoom with no geometry here (R2). Its `stopEvent` hides
 *   its mousedown from ProseMirror, so neither the cell select drag nor the column resize starts.
 * - DRAG: the cell under the pointer is `view.posAtCoords`, as the cell select drag's. Down or
 *   right, whichever passes more cells; off the table the target stays. While it runs each cell of
 *   the range gets `data-fill-target` with its outer edges, which table.css draws dashed.
 * - VALUES: a copied value keeps its source cell's content (marks); a new cell takes the `fill`
 *   and `color` of its source cell in the repeated pattern. Read-only: no handle (R3).
 * - FOLDED ROWS (YAZ-4165) are never read or written: the series runs in the rows that are not folded, so a drag
 *   across a folded run goes on below it, and the run keeps its text.
 * - MERGED CELLS (YAZ-4792): a source that holds a merged cell has no handle (its series would count one cell for
 *   several), and a drag stops at the row (column) before the first merged cell in its way, so the fill never writes
 *   into one.
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { TableMap, cellAround, isInTable, selectedRect } from '@milkdown/kit/prose/tables'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { cellPosAt, isMerged, rectHasMerge, rowFolded, rowSubhead } from './cells'
import { fillSeries } from './fillSeries'
import { selectCells, textCell, writeCells, type Cell } from './tablePaste'

/** The source cells: rows `top` to `bottom` and columns `left` to `right`, both ends exclusive (a `TableRect`). */
interface FillSource {
  tableStart: number
  top: number
  left: number
  bottom: number
  right: number
}
type FillAxis = 'down' | 'right'
interface Drag {
  axis: FillAxis
  count: number
}
interface FillState {
  source: FillSource | null
  drag: Drag | null
  decorations: DecorationSet
}

const key = new PluginKey<FillState>('mdapp-table-fill')

/** The selected cells, or the caret's cell; `null` outside a table, and when the cells hold a merged cell (YAZ-4792). */
export function fillSource(state: EditorState): FillSource | null {
  if (!isInTable(state)) return null
  const rect = selectedRect(state)
  if (rectHasMerge(rect)) return null
  const { tableStart, top, left, bottom, right } = rect
  return { tableStart, top, left, bottom, right }
}

/** How many cells past `source` a fill may go in `axis` before the first merged cell in its way, at most `count` (YAZ-4792). */
function mergeFreeCount(table: ProseNode, source: FillSource, axis: FillAxis, count: number): number {
  const map = TableMap.get(table)
  const limit = axis === 'down' ? Math.min(count, map.height - source.bottom) : Math.min(count, map.width - source.right)
  for (let n = 0; n < limit; n++) {
    const line = axis === 'down' ? source.bottom + n : source.right + n
    const across = axis === 'down' ? [source.left, source.right] : [source.top, source.bottom]
    for (let i = across[0]!; i < across[1]!; i++) {
      const pos = axis === 'down' ? map.map[line * map.width + i]! : map.map[i * map.width + line]!
      if (isMerged(table.nodeAt(pos)!)) return n
    }
  }
  return limit
}

/** Fill `count` cells past `source` down or right, stopped at the table's edge; `null` when nothing is passed. */
export function fillCells(state: EditorState, source: FillSource, axis: FillAxis, count: number): Transaction | null {
  const { tableStart, top, left, bottom, right } = source
  const table = state.doc.nodeAt(tableStart - 1)!
  const map = TableMap.get(table)
  // The rows that are not folded (YAZ-4165) and not subheader rows (YAZ-4899): the source rows, and down, the rows passed.
  const open = (from: number, to: number) => Array.from({ length: Math.max(to - from, 0) }, (_, i) => from + i).filter((r) => !rowFolded(table.child(r)) && !rowSubhead(table.child(r)))
  const rows = open(top, bottom)
  const passed = axis === 'down' ? open(bottom, Math.min(bottom + count, map.height)) : []
  const n = axis === 'down' ? passed.length : Math.min(count, map.width - right)
  if (n <= 0 || rows.length === 0) return null
  const cell = (row: number, col: number) => state.doc.nodeAt(cellPosAt(map, tableStart, row, col))!
  // One series per column (down) or per row (right): `lines` of `length` source cells each.
  const lines = axis === 'down' ? right - left : rows.length
  const length = axis === 'down' ? rows.length : right - left
  const grid: Cell[][] = Array.from({ length: axis === 'down' ? n : lines }, () => [])
  for (let line = 0; line < lines; line++) {
    const sources = Array.from({ length }, (_, i) => (axis === 'down' ? cell(rows[i]!, left + line) : cell(rows[line]!, left + i)))
    // A cell's words, its lines and bullets joined with a space (YAZ-3818).
    const texts = sources.map((node) => node.textBetween(0, node.content.size, ' '))
    fillSeries(texts, n).forEach((value, i) => {
      const from = sources[i % length]!
      const content = value === texts[i % length] ? from.content : textCell(state.schema, value).content
      const filled: Cell = { content, style: { fill: from.attrs.fill, color: from.attrs.color, align: from.attrs.align } }
      if (axis === 'down') grid[i]![line] = filled
      else grid[line]![i] = filled
    })
  }
  const tr = axis === 'down'
    ? writeCells(closeHistory(state.tr), tableStart, bottom, left, grid)
    : writeCells(closeHistory(state.tr), tableStart, top, right, grid)
  return selectCells(tr, tableStart, top, left, axis === 'down' ? passed.at(-1)! : bottom - 1, axis === 'right' ? right - 1 + n : right - 1)
}

/** Where a drag from `source` points: down or right, the cells passed; `undefined` off the table. */
function dragTo(view: EditorView, source: FillSource, event: MouseEvent): Drag | undefined {
  const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
  const $cell = at === null ? null : cellAround(view.state.doc.resolve(at.pos))
  if ($cell === null || $cell.start(-1) !== source.tableStart) return undefined
  const { top, left } = TableMap.get($cell.node(-1)).findCell($cell.pos - source.tableStart)
  const down = top - (source.bottom - 1)
  const right = left - (source.right - 1)
  const drag: Drag = down >= right ? { axis: 'down', count: Math.max(down, 0) } : { axis: 'right', count: right }
  // Never into a merged cell (YAZ-4792): the drag stops before the first one in its way.
  return { ...drag, count: mergeFreeCount($cell.node(-1), source, drag.axis, drag.count) }
}

/** A running drag's document listeners, by view: the plugin view removes them when the note closes mid-drag. */
const drags = new WeakMap<EditorView, () => void>()

function startDrag(view: EditorView, event: MouseEvent): void {
  if (event.button !== 0 || !view.editable || key.getState(view.state)?.source == null) return
  event.preventDefault()
  const doc = view.dom.ownerDocument
  let drag: Drag = { axis: 'down', count: 0 }
  const move = (e: MouseEvent) => {
    const source = key.getState(view.state)?.source
    const next = source ? dragTo(view, source, e) : undefined
    if (next === undefined || (next.axis === drag.axis && next.count === drag.count)) return
    drag = next
    view.dispatch(view.state.tr.setMeta(key, drag))
  }
  const stop = () => {
    doc.removeEventListener('mousemove', move)
    doc.removeEventListener('mouseup', up)
    drags.delete(view)
  }
  const up = (e: MouseEvent) => {
    move(e)
    stop()
    const source = key.getState(view.state)?.source
    const tr = (source && drag.count > 0 ? fillCells(view.state, source, drag.axis, drag.count) : null) ?? view.state.tr
    view.dispatch(tr.setMeta(key, null))
  }
  doc.addEventListener('mousemove', move)
  doc.addEventListener('mouseup', up)
  drags.set(view, stop)
}

/** The handle's DOM: one function, so ProseMirror keeps the same element while the widget moves. */
function handleDOM(view: EditorView): HTMLElement {
  const dom = document.createElement('span')
  dom.className = 'table-fill-handle'
  dom.contentEditable = 'false'
  dom.addEventListener('mousedown', (event) => startDrag(view, event))
  return dom
}

/** The handle widget at the end of the source's bottom-right cell, and the outline of a running drag. */
function decorationsOf(state: EditorState, source: FillSource | null, drag: Drag | null): DecorationSet {
  if (source === null) return DecorationSet.empty
  const { tableStart, top, left } = source
  const table = state.doc.nodeAt(tableStart - 1)!
  const map = TableMap.get(table)
  const corner = cellPosAt(map, tableStart, source.bottom - 1, source.right - 1)
  const decorations = [
    Decoration.widget(corner + state.doc.nodeAt(corner)!.nodeSize - 1, handleDOM, { key: 'table-fill-handle', side: 1, ignoreSelection: true, stopEvent: () => true }),
  ]
  if (drag !== null && drag.count > 0) {
    const bottom = drag.axis === 'down' ? Math.min(source.bottom + drag.count, map.height) : source.bottom
    const right = drag.axis === 'right' ? Math.min(source.right + drag.count, map.width) : source.right
    for (let row = top; row < bottom; row++) {
      for (let col = left; col < right; col++) {
        const edges = [row === top && 'top', row === bottom - 1 && 'bottom', col === left && 'left', col === right - 1 && 'right'].filter(Boolean).join(' ')
        const pos = cellPosAt(map, tableStart, row, col)
        decorations.push(Decoration.node(pos, pos + table.nodeAt(pos - tableStart)!.nodeSize, { 'data-fill-target': edges }))
      }
    }
  }
  return DecorationSet.create(state.doc, decorations)
}

const sameSource = (a: FillSource | null, b: FillSource | null) =>
  a === b || (a !== null && b !== null && a.tableStart === b.tableStart && a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right)

export const tableFill = $prose(() => {
  let view: EditorView | null = null
  return new Plugin<FillState>({
    key,
    state: {
      init: (_, state) => ({ source: fillSource(state), drag: null, decorations: decorationsOf(state, fillSource(state), null) }),
      apply: (tr, prev, _, state) => {
        const meta = tr.getMeta(key) as Drag | null | undefined
        const drag = meta === undefined ? prev.drag : meta
        if (!tr.docChanged && !tr.selectionSet && meta === undefined) return prev
        const source = fillSource(state)
        // Typing outside a table keeps the empty state; a moved caret in the same cell keeps the handle.
        if (source === null && prev.source === null && drag === null) return prev
        if (!tr.docChanged && sameSource(source, prev.source) && drag === prev.drag) return prev
        return { source, drag, decorations: decorationsOf(state, source, drag) }
      },
    },
    view: (v) => {
      view = v
      return {
        destroy: () => {
          drags.get(v)?.()
          view = null
        },
      }
    },
    // Read-only: no handle (R3). ProseMirror sets `view.editable` before it asks for decorations; the
    // first ask comes before the plugin view, so table.css hides a handle in a read-only view too.
    props: { decorations: (state) => (view?.editable !== false ? key.getState(state)?.decorations : undefined) },
  })
})
