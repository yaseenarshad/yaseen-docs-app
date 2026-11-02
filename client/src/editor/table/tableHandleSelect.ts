/**
 * Select rows and columns as in Sheets (the YAZ-4163 demo):
 *
 * - DRAG ALONG THE HANDLES: a press on a row (column) handle whose row (column) is not selected, then a drag, selects
 *   every row (column) from that one to the one under the pointer, as a drag down Sheets' row numbers does. A press on
 *   a handle of a selected row keeps the vendored drag, which moves the rows. After a drag that selected, the click
 *   that follows opens no menu: right-click the selection for it. The rows are read from the table's own `<tr>`s by
 *   the pointer's y (the columns from the header row's cells by its x), so a folded (hidden) row is skipped; their
 *   boxes once at the press, and again after a scroll, not on each move (YAZ-4176). The press
 *   is ours: no text selection of the browser runs across the rows as the pointer passes (it flashed), and a drag
 *   from a body row never takes in the header row (a pinned header sits over the rows under it).
 * - SHIFT+SPACE with cells selected selects their whole rows; CTRL+SPACE in a table selects the whole columns of the
 *   selected cells, or of the caret's cell. With only a caret, Shift+Space still types a space, so typing in capitals
 *   never selects a row.
 * - ORDER: the keys go in just before `tableEditing`, as `tableShiftArrow.ts`.
 */
import { SchemaReady, prosePluginsCtx } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { keydownHandler } from '@milkdown/kit/prose/keymap'
import { type Command, Plugin, TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection, tableEditingKey } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'

type Kind = 'row' | 'col'

/** The table's own rows (`kind` row) or header cells (`kind` col), not the drag preview's. */
function linesOf(block: Element, kind: Kind): HTMLElement[] {
  const table = [...(block.querySelector('.table-wrapper')?.children ?? [])].find((el): el is HTMLTableElement => el instanceof HTMLTableElement)
  if (table === undefined) return []
  return kind === 'row' ? [...table.rows] : [...(table.rows[0]?.cells ?? [])]
}

/** Each line's span on the screen (y for rows, x for columns), `null` for a hidden line. */
function spansOf(lines: HTMLElement[], kind: Kind): Array<[number, number] | null> {
  return lines.map((line) => {
    const r = line.getBoundingClientRect()
    if ((kind === 'row' ? r.height : r.width) === 0) return null
    return kind === 'row' ? [r.top, r.bottom] : [r.left, r.right]
  })
}

/** The index of the line under `at`, the nearest end when outside; hidden lines are skipped. */
function lineAt(spans: Array<[number, number] | null>, at: number): number {
  let best = -1
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]
    if (span == null) continue
    if (best < 0 || at >= span[0]) best = i
    if (at < span[1]) break
  }
  return best
}

/** The document position of the first cell of a row element, or of a header cell element. */
function cellPosOf(view: EditorView, el: HTMLElement, kind: Kind): number | null {
  const cell = kind === 'row' ? (el as HTMLTableRowElement).cells[0] : el
  if (cell === undefined) return null
  const $pos = view.state.doc.resolve(view.posAtDOM(cell, 0))
  for (let d = $pos.depth; d > 0; d--) {
    const role = $pos.node(d).type.spec.tableRole
    if (role === 'cell' || role === 'header_cell') return $pos.before(d)
  }
  return null
}

/** Whether line `index` of the table is in the selection's whole rows (columns). */
function selected(view: EditorView, lines: HTMLElement[], kind: Kind, index: number): boolean {
  const { selection } = view.state
  if (!(selection instanceof CellSelection) || !(kind === 'row' ? selection.isRowSelection() : selection.isColSelection())) return false
  const pos = cellPosOf(view, lines[index]!, kind)
  if (pos === null) return false
  let inside = false
  selection.forEachCell((_, cellPos) => {
    if (cellPos === pos) inside = true
  })
  return inside
}

function select(view: EditorView, lines: HTMLElement[], kind: Kind, anchor: number, head: number): void {
  const from = cellPosOf(view, lines[anchor]!, kind)
  const to = cellPosOf(view, lines[head]!, kind)
  if (from === null || to === null) return
  const { doc } = view.state
  const range = kind === 'row' ? CellSelection.rowSelection(doc.resolve(from), doc.resolve(to)) : CellSelection.colSelection(doc.resolve(from), doc.resolve(to))
  if (!range.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(range))
}

/** Shift+Space: the selected cells' whole rows. Ctrl+Space: the whole columns of the selected cells or of the caret's cell. */
const wholeLines = (kind: Kind): Command => (state, dispatch) => {
  const { selection } = state
  let $anchor
  let $head
  if (selection instanceof CellSelection) [$anchor, $head] = [selection.$anchorCell, selection.$headCell]
  else if (kind === 'col' && selection instanceof TextSelection) {
    const { $head: $caret } = selection
    for (let d = $caret.depth; d > 0 && $anchor === undefined; d--) {
      const role = $caret.node(d).type.spec.tableRole
      if (role === 'cell' || role === 'header_cell') $anchor = $head = state.doc.resolve($caret.before(d))
    }
  }
  if ($anchor === undefined || $head === undefined) return false
  if (dispatch) dispatch(state.tr.setSelection(kind === 'row' ? CellSelection.rowSelection($anchor, $head) : CellSelection.colSelection($anchor, $head)))
  return true
}

export const tableHandleSelect: MilkdownPlugin = (ctx) => async () => {
  await ctx.wait(SchemaReady)
  const plugin = new Plugin({
    props: {
      handleKeyDown: keydownHandler({ 'Shift-Space': wholeLines('row'), 'Ctrl-Space': wholeLines('col') }),
    },
    view: (view) => {
      // The lines' spans are read at the press, and again after a scroll moved them (YAZ-4176): not on each move.
      let drag: { kind: Kind; lines: HTMLElement[]; spans: Array<[number, number] | null> | null; anchor: number; moved: boolean } | null = null
      const swallowClick = (e: MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
      }
      const onMove = (e: MouseEvent) => {
        if (drag === null) return
        drag.spans ??= spansOf(drag.lines, drag.kind)
        let head = lineAt(drag.spans, drag.kind === 'row' ? e.clientY : e.clientX)
        if (drag.kind === 'row' && drag.anchor > 0) head = Math.max(head, 1)
        e.preventDefault()
        if (head < 0 || (head === drag.anchor && !drag.moved)) return
        drag.moved = true
        select(view, drag.lines, drag.kind, drag.anchor, head)
      }
      const onScroll = () => {
        if (drag !== null) drag.spans = null
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove, true)
        document.removeEventListener('mouseup', onUp, true)
        document.removeEventListener('scroll', onScroll, true)
        if (drag?.moved) {
          // The click that follows this mouseup selected nothing new: no menu.
          document.addEventListener('click', swallowClick, true)
          setTimeout(() => document.removeEventListener('click', swallowClick, true), 0)
        }
        drag = null
      }
      const onDown = (e: MouseEvent) => {
        if (e.button !== 0 || !view.editable || !(e.target instanceof Element)) return
        const handle = e.target.closest('[data-role="row-drag-handle"], [data-role="col-drag-handle"]')
        const block = handle?.closest('.milkdown-table-block')
        if (handle == null || block == null) return
        const kind: Kind = handle.getAttribute('data-role') === 'row-drag-handle' ? 'row' : 'col'
        const lines = linesOf(block, kind)
        const spans = spansOf(lines, kind)
        const anchor = lineAt(spans, kind === 'row' ? e.clientY : e.clientX)
        // A selected row's handle: the vendored drag moves the rows.
        if (anchor < 0 || selected(view, lines, kind, anchor)) return
        // Ours: no text selection of the browser (and no native drag) starts from this press.
        e.preventDefault()
        drag = { kind, lines, spans, anchor, moved: false }
        document.addEventListener('mousemove', onMove, true)
        document.addEventListener('mouseup', onUp, true)
        document.addEventListener('scroll', onScroll, true)
      }
      // The native drag of a handle we select with is no drag.
      const onDragStart = (e: DragEvent) => {
        if (drag === null) return
        e.preventDefault()
        e.stopPropagation()
      }
      view.dom.addEventListener('mousedown', onDown, true)
      view.dom.addEventListener('dragstart', onDragStart, true)
      return {
        destroy: () => {
          view.dom.removeEventListener('mousedown', onDown, true)
          view.dom.removeEventListener('dragstart', onDragStart, true)
          onUp()
        },
      }
    },
  })
  ctx.update(prosePluginsCtx, (ps) => {
    const at = ps.findIndex((p) => p.spec.key === tableEditingKey)
    return at < 0 ? [...ps, plugin] : [...ps.slice(0, at), plugin, ...ps.slice(at)]
  })
  return () => {
    ctx.update(prosePluginsCtx, (ps) => ps.filter((p) => p !== plugin))
  }
}
