/**
 * Column resize (YAZ-3696 D2): `prosemirror-tables`' `columnResizing` as installed (not vendored). The table
 * block draws the `<colgroup>` (`View: null`); the drag writes `colwidth` once, on mouseup.
 *
 * - ORDER: ProseMirror gives a mousedown to the plugins in order and stops at the first that takes it. A grip
 *   drag must not also start `tableEditing`'s cell selection drag (B2), so the plugin goes in just BEFORE
 *   `tableEditing`, which keeps its own place (a plain `$prose` would land after it).
 * - DOCUMENT ZOOM (R2): the plugin adds the mouse travel in screen px to a width in layout px, so under the CSS
 *   zoom on `.ProseMirror` the edge ran ahead of (or behind) the cursor. While an edge drags, a window capture
 *   listener gives each `mousemove`/`mouseup` the travel in layout px, before the plugin reads it. The zoom is the
 *   one at the dragged cell's `<table>`: the page zoom times the table's own (YAZ-4091, `table.css` zooms the block's
 *   content, so the block itself has the page zoom only).
 * - HEADER ROW ONLY (YAZ-3800, 2D): as in Sheets, a column resizes only from a header cell's edge. Over a body
 *   cell (`td`) the plugin's mousemove clears the grip (its own `mouseleave` code), and its mousedown does not
 *   run, so `tableEditing` starts a cell selection there.
 * - MERGED HEADER (YAZ-4792 demo): a header cell merged across columns has no edge between them. Each column edge
 *   then resizes from the FIRST row that has it (`firstRowWithEdge`): a body cell's right edge grips only there. A
 *   plain header row has every edge, so nothing changes for a table without merges.
 */
import { Plugin } from '@milkdown/kit/prose/state'
import { TableMap, columnResizing, columnResizingPluginKey } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { cssZoom } from '../../lib/cssZoom'
import { beforeTableEditing } from './beforeTableEditing'

function zoomedDrag(view: EditorView) {
  const win = view.dom.ownerDocument.defaultView ?? window
  const toLayout = (event: MouseEvent) => {
    const state = columnResizingPluginKey.getState(view.state)
    const dragging = state?.dragging
    const cell = dragging ? view.nodeDOM(state!.activeHandle) : null
    const zoom = cssZoom((cell instanceof Element ? cell.closest('table') : null) ?? view.dom)
    if (!dragging || zoom === 1) return
    Object.defineProperty(event, 'clientX', { value: dragging.startX + (event.clientX - dragging.startX) / zoom })
  }
  win.addEventListener('mousemove', toLayout, true)
  win.addEventListener('mouseup', toLayout, true)
  return {
    destroy() {
      win.removeEventListener('mousemove', toLayout, true)
      win.removeEventListener('mouseup', toLayout, true)
    },
  }
}

/**
 * How far from a header cell's edge the grip takes the mouse, in px (YAZ-4788): 8, not the plugin's 5. The cell note
 * button keeps this far in from a header cell's right edge (`cellNoteButton.ts`), so the whole edge can be grabbed.
 */
export const GRIP_WIDTH = 8

const inBody = (event: Event) => event.target instanceof Element && event.target.closest('td, th')?.tagName === 'TD'

/**
 * The first row, from the top, with a cell edge at column boundary `col` (the line left of column `col`), or -1. The
 * table's outer right edge is in every row, so its row is 0 (YAZ-4792 demo: a merged cell has no edge inside it).
 */
function firstRowWithEdge(map: TableMap, col: number): number {
  if (col >= map.width) return 0
  for (let row = 0; row < map.height; row++) if (map.map[row * map.width + col - 1] !== map.map[row * map.width + col]) return row
  return -1
}

/**
 * The cell whose RIGHT edge the mouse is on, as the plugin's handle position, or null (YAZ-4788): a header cell's, or a
 * body cell's when its row is the first with that edge (a merged header, the YAZ-4792 demo). The plugin finds the
 * cell with `posAtCoords` 8 px inside it, where the cell note button can stand: then no cell is found and the top of
 * the edge could not be grabbed. This reads the cell under the mouse itself.
 */
function rightEdgeHandle(view: EditorView, event: MouseEvent): number | null {
  const cell = event.target instanceof Element ? event.target.closest('td, th') : null
  if (cell === null || !view.dom.contains(cell)) return null
  const { left, right } = cell.getBoundingClientRect()
  if (right - event.clientX > GRIP_WIDTH || event.clientX - left <= GRIP_WIDTH) return null
  const $pos = view.state.doc.resolve(view.posAtDOM(cell, 0))
  for (let depth = $pos.depth; depth > 2; depth--) {
    const role = $pos.node(depth).type.spec.tableRole
    if (role !== 'header_cell' && role !== 'cell') continue
    const table = $pos.node(depth - 2)
    if (table.type.spec.tableRole !== 'table') return null
    const map = TableMap.get(table)
    const rect = map.findCell($pos.before(depth) - $pos.start(depth - 2))
    const first = firstRowWithEdge(map, rect.right)
    return first >= rect.top && first < rect.bottom ? $pos.before(depth) : null
  }
  return null
}

/** `columnResizing` with its grip on the header row only: the same key, state and decorations. */
function headerResizing(): Plugin {
  // 24 px, not 60 (YAZ-4791): a column of numbers drags close to them; under `NARROW_COLUMN` its cells pad 4 px.
  const { spec } = columnResizing({ View: null, cellMinWidth: 24, handleWidth: GRIP_WIDTH })
  const { mousemove, mouseleave, mousedown } = spec.props!.handleDOMEvents!
  return new Plugin({
    ...spec,
    props: {
      ...spec.props,
      handleDOMEvents: {
        mousemove(view, event) {
          // A read-only page has no grip, as the plugin's own mousemove says (`rightEdgeHandle` set it there).
          if (!view.editable) return false
          const state = columnResizingPluginKey.getState(view.state)
          const edge = state?.dragging ? null : rightEdgeHandle(view, event)
          // A body cell grips only where `rightEdgeHandle` gave it the edge (a merged header above it).
          if (edge === null && inBody(event)) return mouseleave!.call(this, view, event)
          if (edge === null) return mousemove!.call(this, view, event)
          if (state?.activeHandle !== edge) view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setHandle: edge }))
          return false
        },
        mouseleave,
        mousedown(view, event) {
          return inBody(event) && rightEdgeHandle(view, event) === null ? false : mousedown!.call(this, view, event)
        },
      },
    },
  })
}

export const tableColumnResize = beforeTableEditing(() => [headerResizing(), new Plugin({ view: zoomedDrag })])
