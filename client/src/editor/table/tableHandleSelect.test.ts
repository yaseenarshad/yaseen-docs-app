/** Sheets-style selection (the YAZ-4163 demo, `tableHandleSelect.ts`): a drag along the handles, Shift+Space, Ctrl+Space. */
import { afterEach, describe, expect, it } from 'vitest'
import { CellSelection } from '@milkdown/kit/prose/tables'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { cellPos, mountTable, unmountAll } from './tableTestKit'

afterEach(unmountAll)

const WIDE = '| h1 | h2 | h3 |\n| -- | -- | -- |\n| a | b | c |\n| d | e | f |\n| g | h | i |\n'

/** Lay the table out by hand (jsdom lays nothing out): row r at y 30r–30r+30, column c at x 100c–100c+100. */
function layOut(view: EditorView) {
  const table = view.dom.querySelector<HTMLTableElement>('.milkdown-table-block .table-wrapper > table')!
  ;[...table.rows].forEach((row, r) => {
    row.getBoundingClientRect = () => ({ top: r * 30, bottom: r * 30 + 30, height: 30, left: 0, right: 300, width: 300 }) as DOMRect
    ;[...row.cells].forEach((cell, c) => {
      cell.getBoundingClientRect = () => ({ top: r * 30, bottom: r * 30 + 30, height: 30, left: c * 100, right: c * 100 + 100, width: 100 }) as DOMRect
    })
  })
}
const handle = (view: EditorView, kind: 'row' | 'col') => view.dom.querySelector<HTMLElement>(`[data-role="${kind}-drag-handle"]`)!
const fire = (target: EventTarget, type: string, x: number, y: number) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
/** Whether it is a CellSelection, whole rows, whole columns, and how many cells. */
const rect = (view: EditorView) => {
  const s = view.state.selection
  if (!(s instanceof CellSelection)) return [false]
  let cells = 0
  s.forEachCell(() => cells++)
  return [true, s.isRowSelection(), s.isColSelection(), cells]
}

describe('a drag along the handles selects a range, as in Sheets', () => {
  it('rows: press on row 2\'s handle, move to row 4: rows 2–4 are selected; the drag moves nothing and opens no menu', async () => {
    const view = await mountTable(WIDE)
    layOut(view)
    let menus = 0
    view.dom.addEventListener('milkdown-table-handle-menu', () => menus++)
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 5, clientY: 45, button: 0 })
    handle(view, 'row').dispatchEvent(down)
    // No text selection of the browser starts from the press.
    expect(down.defaultPrevented).toBe(true)
    const start = new Event('dragstart', { bubbles: true, cancelable: true })
    handle(view, 'row').dispatchEvent(start)
    expect(start.defaultPrevented).toBe(true)
    fire(document, 'mousemove', 5, 105)
    fire(document, 'mouseup', 5, 105)
    fire(handle(view, 'row'), 'click', 5, 105)
    expect(rect(view)).toEqual([true, true, false, 9])
    expect(menus).toBe(0)
  })

  it('a drag from a body row up over the header row stops at row 2: the header row is never taken in', async () => {
    const view = await mountTable(WIDE)
    layOut(view)
    fire(handle(view, 'row'), 'mousedown', 5, 75)
    fire(document, 'mousemove', 5, 10)
    fire(document, 'mouseup', 5, 10)
    // Rows 2–3 (body rows 1–2), 3 columns each.
    expect(rect(view)).toEqual([true, true, false, 6])
  })

  it('columns: press on column A\'s handle, move to column C: columns A–C', async () => {
    const view = await mountTable(WIDE)
    layOut(view)
    fire(handle(view, 'col'), 'mousedown', 50, 5)
    fire(document, 'mousemove', 250, 5)
    fire(document, 'mouseup', 250, 5)
    expect(rect(view)).toEqual([true, true, true, 12])
  })

  it('a press on a selected row\'s handle keeps the native drag (it moves the rows)', async () => {
    const view = await mountTable(WIDE)
    layOut(view)
    view.dispatch(view.state.tr.setSelection(CellSelection.rowSelection(view.state.doc.resolve(cellPos(view, 1, 0)))))
    fire(handle(view, 'row'), 'mousedown', 5, 45)
    fire(document, 'mousemove', 5, 105)
    fire(document, 'mouseup', 5, 105)
    // The selection stays row 2: the move is the vendored drag's, not a range.
    expect(rect(view)).toEqual([true, true, false, 3])
  })
})

describe('Shift+Space and Ctrl+Space', () => {
  const key = (view: EditorView, init: KeyboardEventInit) => view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: ' ', code: 'Space', ...init })))

  it('Shift+Space with cells selected selects their rows; with only a caret it types', async () => {
    const view = await mountTable(WIDE)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 1, 1) + 2)))
    expect(key(view, { shiftKey: true })).toBeFalsy()
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, 1, 1), cellPos(view, 2, 1))))
    expect(key(view, { shiftKey: true })).toBe(true)
    expect(rect(view)).toEqual([true, true, false, 6])
  })

  it('Ctrl+Space selects the caret cell\'s column', async () => {
    const view = await mountTable(WIDE)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 2, 1) + 2)))
    expect(key(view, { ctrlKey: true })).toBe(true)
    expect(rect(view)).toEqual([true, false, true, 4])
  })
})
