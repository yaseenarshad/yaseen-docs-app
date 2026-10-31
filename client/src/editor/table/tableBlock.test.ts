/**
 * The vendored table block (`client/vendor/milkdown-components-7.22.1-yaz1410.*`) on the real editor in jsdom:
 * mouse cell select and no redraw on a decoration change (YAZ-3696 B2, B4), column resize (D2), no insert
 * line (YAZ-3800), and the handles that ask for the app's table menu (YAZ-3820).
 * jsdom has no layout: `tableTestKit` gives each cell a 100 × 30 px box.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Node } from '@milkdown/kit/prose/model'
import { undo } from '@milkdown/kit/prose/history'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { TABLE_HANDLE_MENU } from '../noteMenu'
import { cellDOM, cellPos, dragColumnEdge, mountTable as mount, mouseAt, unmountAll } from './tableTestKit'

afterEach(unmountAll)

const tablePos = (view: EditorView) => {
  let found = -1
  view.state.doc.descendants((node: Node, pos) => {
    if (found < 0 && node.type.name === 'table') found = pos
    return found < 0
  })
  return found
}
/** A mouse event in the middle of the cell (row, col), in screen px at the document zoom. */
const mouse = (type: string, target: EventTarget, row: number, col: number, zoom = 1) => mouseAt(type, target, (col * 100 + 50) * zoom, (row * 30 + 15) * zoom)
const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
const cellTexts = (view: EditorView) => [1, 2].map(row => [0, 1].map(col => view.state.doc.nodeAt(cellPos(view, row, col))!.textContent))

describe('table block: select cells with the mouse (YAZ-3696 B2)', () => {
  it.each([1, 0.5, 2])('a mousedown and a mousemove across two cells make a CellSelection, at %× document zoom (R2)', async zoom => {
    const view = await mount(undefined, zoom)
    mouse('mousedown', cellDOM(view, 1, 0).firstChild!, 1, 0, zoom)
    mouse('mousemove', cellDOM(view, 2, 1).firstChild!, 2, 1, zoom)
    mouse('mouseup', cellDOM(view, 2, 1).firstChild!, 2, 1, zoom)
    const selection = view.state.selection
    expect(selection).toBeInstanceOf(CellSelection)
    expect((selection as CellSelection).$anchorCell.pos).toBe(cellPos(view, 1, 0))
    expect((selection as CellSelection).$headCell.pos).toBe(cellPos(view, 2, 1))
  })

  it('a click in another cell is left to ProseMirror: the caret goes there, no NodeSelection', async () => {
    const view = await mount()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 1, 0) + 2)))
    const target = cellDOM(view, 2, 1).querySelector('p')!
    mouse('mousedown', target, 2, 1)
    // The browser puts the DOM caret at the click point; ProseMirror reads it on mouseup.
    document.getSelection()!.collapse(target.firstChild!, 1)
    mouse('mouseup', target, 2, 1)
    await frame()
    await new Promise(resolve => setTimeout(resolve, 30))
    const selection = view.state.selection
    expect(selection).not.toBeInstanceOf(NodeSelection)
    expect(selection).toBeInstanceOf(TextSelection)
    expect(selection.from).toBe(cellPos(view, 2, 1) + 3)
  })

  it.each(['Delete', 'Backspace'])('%s on selected cells clears their text and keeps their attributes', async key => {
    const view = await mount('| h1 | h2 |\n| :-: | --- |\n| a | b |\n| c | d |\n')
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, 1, 0), cellPos(view, 2, 1))))
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    expect(cellTexts(view)).toEqual([['', ''], ['', '']])
    expect(view.state.doc.nodeAt(cellPos(view, 1, 0))!.attrs.alignment).toBe('center')
    expect(view.state.doc.nodeAt(cellPos(view, 0, 0))!.textContent).toBe('h1')
  })
})

describe('table block: no redraw on a decoration change (YAZ-3696 B4)', () => {
  it('a decoration-only update keeps the same table DOM and still reaches the table and its cells', async () => {
    const view = await mount()
    const dom = view.nodeDOM(tablePos(view))
    const cell = cellDOM(view, 1, 0)
    view.setProps({
      decorations: state => {
        const table = tablePos(view), first = cellPos(view, 1, 0)
        return DecorationSet.create(state.doc, [
          Decoration.node(table, table + state.doc.nodeAt(table)!.nodeSize, { 'data-probe': 'table' }),
          Decoration.node(first, first + state.doc.nodeAt(first)!.nodeSize, { 'data-probe': 'cell' }),
        ])
      },
    })
    expect(view.nodeDOM(tablePos(view))).toBe(dom)
    expect((dom as HTMLElement).getAttribute('data-probe')).toBe('table')
    expect(cellDOM(view, 1, 0)).toBe(cell)
    expect(cell.getAttribute('data-probe')).toBe('cell')
  })
})

const colwidths = (view: EditorView) => [0, 1, 2].map(row => [0, 1].map(col => view.state.doc.nodeAt(cellPos(view, row, col))!.attrs.colwidth))
const tableDOM = (view: EditorView) => cellDOM(view, 0, 0).closest('table')!

describe('table block: resize columns (YAZ-3696 D2)', () => {
  it('a plain table draws a colgroup with no widths before its rows, and no minimum width', async () => {
    const view = await mount()
    const table = tableDOM(view)
    expect(Array.from(table.children, child => child.tagName)).toEqual(['COLGROUP', 'TBODY'])
    expect(Array.from(table.querySelectorAll('col'), col => col.style.width)).toEqual(['', ''])
    expect(table.style.width).toBe('')
    expect(table.style.minWidth).toBe('')
  })

  it('a drag of a column edge writes colwidth once on mouseup, the colgroup shows it, one undo step', async () => {
    const view = await mount()
    const before = view.state.doc
    dragColumnEdge(view, 0, 50)
    expect(colwidths(view)).toEqual([[[150], null], [[150], null], [[150], null]])
    expect(Array.from(tableDOM(view).querySelectorAll('col'), col => col.style.width)).toEqual(['150px', ''])
    // The other column has no width, so the table keeps its full width and a minimum (prosemirror-tables' rule).
    expect(tableDOM(view).style.width).toBe('')
    expect(tableDOM(view).style.minWidth).toBe('250px')
    expect(undo(view.state, view.dispatch)).toBe(true)
    // Milkdown's `trailing` plugin adds an empty paragraph after the table at the first edit; undo keeps it.
    expect(view.state.doc.firstChild!.eq(before.firstChild!)).toBe(true)
    expect(Array.from(tableDOM(view).querySelectorAll('col'), col => col.style.width)).toEqual(['', ''])
  })

  it('a column is not narrower than 60 px, and widths on each column fix the table width', async () => {
    const view = await mount()
    dragColumnEdge(view, 0, -80)
    dragColumnEdge(view, 1, 40)
    expect(colwidths(view)[0]).toEqual([[60], [140]])
    expect(tableDOM(view).style.width).toBe('200px')
  })

  it('a resize drag across other cells selects no cells', async () => {
    const view = await mount()
    dragColumnEdge(view, 0, 50, 1, cellDOM(view, 0, 1).firstChild!)
    expect(view.state.selection).not.toBeInstanceOf(CellSelection)
    expect(colwidths(view)[0]![0]).toEqual([150])
  })

  // YAZ-3800 (2D): as in Sheets, a column resizes only from the header row's cell edges.
  it.each([1, 0.5, 2])('a body cell edge shows no grip and does not resize; its drag selects cells, at %× zoom', async zoom => {
    const view = await mount(undefined, zoom)
    const cell = cellDOM(view, 1, 0).firstChild!
    const edge = (100 - 2) * zoom, y = (30 + 15) * zoom
    mouseAt('mousemove', cell, edge, y)
    expect(view.dom.querySelector('.column-resize-handle')).toBeNull()
    mouseAt('mousedown', cell, edge, y)
    mouse('mousemove', cellDOM(view, 2, 1).firstChild!, 2, 1, zoom)
    mouse('mouseup', cellDOM(view, 2, 1).firstChild!, 2, 1, zoom)
    expect(colwidths(view).flat().every(width => width === null)).toBe(true)
    expect(view.state.selection).toBeInstanceOf(CellSelection)
    expect((view.state.selection as CellSelection).$anchorCell.pos).toBe(cellPos(view, 1, 0))
  })

  it('a grip from a header edge goes away over a body cell, and a mousedown there does not resize', async () => {
    const view = await mount()
    mouseAt('mousemove', cellDOM(view, 0, 0).firstChild!, 98, 15)
    expect(view.dom.querySelector('.column-resize-handle')).not.toBeNull()
    mouseAt('mousemove', cellDOM(view, 1, 0).firstChild!, 98, 45)
    expect(view.dom.querySelector('.column-resize-handle')).toBeNull()
    mouseAt('mousedown', cellDOM(view, 1, 0).firstChild!, 98, 45)
    mouseAt('mousemove', cellDOM(view, 1, 0).firstChild!, 148, 45)
    mouseAt('mouseup', cellDOM(view, 1, 0).firstChild!, 148, 45)
    expect(colwidths(view).flat().every(width => width === null)).toBe(true)
  })

  it('a read-only note shows no grip and does not resize', async () => {
    const view = await mount()
    view.setProps({ editable: () => false })
    dragColumnEdge(view, 0, 50)
    expect(view.dom.querySelector('.column-resize-handle')).toBeNull()
    expect(colwidths(view).flat().every(width => width === null)).toBe(true)
  })
})

// YAZ-3800 (2D): no hover "+" insert line. Insert stays in the handle menus and the right-click menu.
// The two line elements stay as the drop line of a row or column drag, with no button.
describe('table block: no insert line (YAZ-3800)', () => {
  it('the block has no "+" button, and a pointer at a cell edge shows no line', async () => {
    const view = await mount()
    const block = view.dom.querySelector('.milkdown-table-block')!
    expect(block.querySelector('.add-button')).toBeNull()
    expect(block.querySelectorAll('.line-handle button')).toHaveLength(0)
    // Near the right edge of a body cell, then near the bottom edge: the old insert line places.
    mouseAt('pointermove', cellDOM(view, 1, 0).firstChild!, 98, 45)
    await new Promise(resolve => setTimeout(resolve, 30))
    mouseAt('pointermove', cellDOM(view, 1, 0).firstChild!, 50, 58)
    await new Promise(resolve => setTimeout(resolve, 30))
    for (const line of block.querySelectorAll<HTMLElement>('.line-handle')) expect(line.dataset.show).toBe('false')
    // The cell handles show instead, as on any hover in a cell.
    expect(block.querySelector<HTMLElement>('[data-role="col-drag-handle"]')!.dataset.show).toBe('true')
  })
})

const handle = (view: EditorView, kind: 'col' | 'row') => view.dom.querySelector<HTMLElement>(`.milkdown-table-block [data-role="${kind}-drag-handle"]`)!
/** Hover the cell (row, col), then click its column or row handle. */
function clickHandle(view: EditorView, kind: 'col' | 'row', row: number, col: number, init: MouseEventInit = {}) {
  mouse('pointermove', cellDOM(view, row, col).firstChild!, row, col)
  handle(view, kind).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 7, clientY: 9, ...init }))
}
/** Each ask for the app's table menu that reaches the editor's DOM (YAZ-3820), from now on. */
function asks(view: EditorView): Array<{ x: number; y: number; pos: number }> {
  const got: Array<{ x: number; y: number; pos: number }> = []
  view.dom.addEventListener(TABLE_HANDLE_MENU, (e) => got.push((e as CustomEvent).detail))
  return got
}
const rowsOf = (view: EditorView) => {
  const table = view.state.doc.firstChild!, rows: string[][] = []
  table.forEach(row => { const cells: string[] = []; row.forEach(cell => { cells.push(cell.textContent) }); rows.push(cells) })
  return rows
}
/** A right-click on the handle: answers whether the note's own `contextmenu` listener heard it. */
function rightClick(view: EditorView, kind: 'col' | 'row'): boolean {
  let heard = false
  const listener = () => { heard = true }
  view.dom.addEventListener('contextmenu', listener)
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 7, clientY: 9 })
  handle(view, kind).dispatchEvent(event)
  view.dom.removeEventListener('contextmenu', listener)
  expect(event.defaultPrevented).toBe(true)
  return heard
}
const WIDE = '| h1 | h2 | h3 | h4 |\n| --- | --- | --- | --- |\n| a | b | c | d |\n| e | f | g | h |\n| i | j | k | l |\n'
const selectCols = (view: EditorView, from: number, to: number) =>
  view.dispatch(view.state.tr.setSelection(CellSelection.colSelection(view.state.doc.resolve(cellPos(view, 0, from)), view.state.doc.resolve(cellPos(view, 0, to)))))
/** The [row, column] of each selected cell. */
const selectedRect = (view: EditorView) => {
  const selection = view.state.selection as CellSelection
  const rows = rowsOf(view)
  const cells: number[][] = []
  selection.forEachCell((_, pos) => {
    rows.forEach((row, r) => row.forEach((_, c) => { if (cellPos(view, r, c) === pos) cells.push([r, c]) }))
  })
  return cells
}

describe('table block: a handle opens the app\'s table menu (YAZ-3820)', () => {
  it('the block has no menu of its own', async () => {
    const view = await mount()
    expect(view.dom.querySelector('.milkdown-table-block .button-group')).toBeNull()
  })

  it('a click on a column handle selects the column and asks for the menu at a cell of it in row 1', async () => {
    const view = await mount()
    const got = asks(view)
    clickHandle(view, 'col', 1, 1)
    const selection = view.state.selection as CellSelection
    expect(selection.isColSelection()).toBe(true)
    expect(new Set(selectedRect(view).map(([, c]) => c))).toEqual(new Set([1]))
    expect(got).toEqual([{ x: 7, y: 9, pos: cellPos(view, 0, 1) }])
  })

  it('a click on a row handle selects the row and asks at a cell of it in column A; the header row asks nothing', async () => {
    const view = await mount()
    const got = asks(view)
    clickHandle(view, 'row', 2, 1)
    expect((view.state.selection as CellSelection).isRowSelection()).toBe(true)
    expect(got).toEqual([{ x: 7, y: 9, pos: cellPos(view, 2, 0) }])
    await new Promise(resolve => setTimeout(resolve, 30))
    clickHandle(view, 'row', 0, 0)
    expect(got).toHaveLength(1)
  })

  it.each(['col', 'row'] as const)('a right-click on the %s handle does the same, and the note\'s own right-click does not run', async kind => {
    const view = await mount()
    const got = asks(view)
    mouse('pointermove', cellDOM(view, 1, 1).firstChild!, 1, 1)
    expect(rightClick(view, kind)).toBe(false)
    const selection = view.state.selection as CellSelection
    expect(kind === 'col' ? selection.isColSelection() : selection.isRowSelection()).toBe(true)
    expect(got).toEqual([{ x: 7, y: 9, pos: kind === 'col' ? cellPos(view, 0, 1) : cellPos(view, 1, 0) }])
  })

  it('in a read-only note a handle click or right-click selects nothing and asks nothing', async () => {
    const view = await mount()
    const got = asks(view)
    mouse('pointermove', cellDOM(view, 1, 1).firstChild!, 1, 1)
    view.setProps({ editable: () => false })
    const before = view.state.selection
    handle(view, 'col').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    handle(view, 'col').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
    expect(view.state.selection).toBe(before)
    expect(got).toEqual([])
  })

  it('a handle click in a selection of whole columns keeps it; outside it, selects the one column (YAZ-3801)', async () => {
    const view = await mount(WIDE)
    selectCols(view, 0, 2)
    clickHandle(view, 'col', 1, 1)
    expect(new Set(selectedRect(view).map(([, c]) => c))).toEqual(new Set([0, 1, 2]))
    await new Promise(resolve => setTimeout(resolve, 30))
    clickHandle(view, 'col', 1, 3)
    expect(new Set(selectedRect(view).map(([, c]) => c))).toEqual(new Set([3]))
  })

  it('Shift + click on a handle grows the selection to that column or row (YAZ-3801)', async () => {
    const view = await mount(WIDE)
    // The handles follow the pointer once each 20 ms (a throttle).
    const pause = () => new Promise(resolve => setTimeout(resolve, 30))
    clickHandle(view, 'col', 1, 0)
    await pause()
    clickHandle(view, 'col', 1, 2, { shiftKey: true })
    expect(new Set(selectedRect(view).map(([, c]) => c))).toEqual(new Set([0, 1, 2]))
    await pause()
    clickHandle(view, 'row', 1, 0)
    await pause()
    clickHandle(view, 'row', 2, 0, { shiftKey: true })
    expect(new Set(selectedRect(view).map(([r]) => r))).toEqual(new Set([1, 2]))
  })
})
