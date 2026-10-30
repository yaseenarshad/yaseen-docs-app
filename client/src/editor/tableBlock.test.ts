/**
 * The vendored table block (`client/vendor/milkdown-components-7.22.1-yaz1410.*`) on the real editor in jsdom:
 * mouse cell select and no redraw on a decoration change (YAZ-3696 B2, B4), column resize (D2).
 * jsdom has no layout: `tableTestKit` gives each cell a 100 × 30 px box.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Node } from '@milkdown/kit/prose/model'
import { undo } from '@milkdown/kit/prose/history'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
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
const mouse = (type: string, target: EventTarget, row: number, col: number) => mouseAt(type, target, col * 100 + 50, row * 30 + 15)
const frame = () => new Promise(resolve => requestAnimationFrame(resolve))
const cellTexts = (view: EditorView) => [1, 2].map(row => [0, 1].map(col => view.state.doc.nodeAt(cellPos(view, row, col))!.textContent))

describe('table block: select cells with the mouse (YAZ-3696 B2)', () => {
  it('a mousedown and a mousemove across two cells make a CellSelection', async () => {
    const view = await mount()
    mouse('mousedown', cellDOM(view, 1, 0).firstChild!, 1, 0)
    mouse('mousemove', cellDOM(view, 2, 1).firstChild!, 2, 1)
    mouse('mouseup', cellDOM(view, 2, 1).firstChild!, 2, 1)
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

  it('a read-only note shows no grip and does not resize', async () => {
    const view = await mount()
    view.setProps({ editable: () => false })
    dragColumnEdge(view, 0, 50)
    expect(view.dom.querySelector('.column-resize-handle')).toBeNull()
    expect(colwidths(view).flat().every(width => width === null)).toBe(true)
  })
})

const COL_MENU = [['Insert column left', 'Insert column right'], ['Align left', 'Align center', 'Align right'], ['Sort A to Z', 'Sort Z to A'], ['Clear column', 'Delete column']]
const ROW_MENU = [['Insert row above', 'Insert row below', 'Duplicate row'], ['Clear row', 'Delete row']]
const handle = (view: EditorView, kind: 'col' | 'row') => view.dom.querySelector<HTMLElement>(`.milkdown-table-block [data-role="${kind}-drag-handle"]`)!
/** The menu as the user reads it: the labels, with `|` for a separator. */
const menuLabels = (view: EditorView, kind: 'col' | 'row') =>
  Array.from(handle(view, kind).querySelector('.button-group')!.children, item => item.tagName === 'BUTTON' ? item.textContent : '|')
/** Hover the cell (row, col), then click its column or row handle: what the user does to open the menu. */
function openMenu(view: EditorView, kind: 'col' | 'row', row: number, col: number) {
  mouse('pointermove', cellDOM(view, row, col).firstChild!, row, col)
  handle(view, kind).dispatchEvent(new MouseEvent('click', { bubbles: true }))
}
/** Click a menu item (pointerdown, then the click that bubbles); answers how many transactions changed the document. */
function choose(view: EditorView, kind: 'col' | 'row', label: string): number {
  const item = Array.from(handle(view, kind).querySelectorAll('.button-group button')).find(button => button.textContent === label)!
  const dispatch = view.dispatch.bind(view)
  let changes = 0
  view.dispatch = tr => { if (tr.docChanged) changes++; dispatch(tr) }
  item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
  item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  view.dispatch = dispatch
  return changes
}
const rowsOf = (view: EditorView) => {
  const table = view.state.doc.firstChild!, rows: string[][] = []
  table.forEach(row => { const cells: string[] = []; row.forEach(cell => { cells.push(cell.textContent) }); rows.push(cells) })
  return rows
}
/** The action is one undo step: one undo gives the table from before. */
function undoesInOne(view: EditorView, before: Node) {
  undo(view.state, view.dispatch)
  expect(view.state.doc.firstChild!.eq(before)).toBe(true)
}

describe('table block: labeled row and column menus (YAZ-3696 D9)', () => {
  it('a click on a column handle selects the column and opens the labeled menu', async () => {
    const view = await mount()
    openMenu(view, 'col', 1, 1)
    const selection = view.state.selection as CellSelection
    expect(selection).toBeInstanceOf(CellSelection)
    expect(selection.isColSelection()).toBe(true)
    expect(selection.$headCell.pos === cellPos(view, 0, 1) || selection.$anchorCell.pos === cellPos(view, 0, 1)).toBe(true)
    expect(handle(view, 'col').querySelector('.button-group')!.getAttribute('data-show')).toBe('true')
    expect(menuLabels(view, 'col')).toEqual(COL_MENU.flatMap((group, i) => i === 0 ? group : ['|', ...group]))
  })

  it('a click on a row handle selects the row and opens the labeled menu; the header row has none', async () => {
    const view = await mount()
    openMenu(view, 'row', 1, 0)
    expect((view.state.selection as CellSelection).isRowSelection()).toBe(true)
    expect(handle(view, 'row').querySelector('.button-group')!.getAttribute('data-show')).toBe('true')
    expect(menuLabels(view, 'row')).toEqual(ROW_MENU.flatMap((group, i) => i === 0 ? group : ['|', ...group]))
    await new Promise(resolve => setTimeout(resolve, 30))
    handle(view, 'row').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    openMenu(view, 'row', 0, 0)
    expect(handle(view, 'row').querySelector('.button-group')!.getAttribute('data-show')).toBe('false')
  })

  it.each([
    ['Insert column left', [['h1', '', 'h2'], ['a', '', 'b'], ['c', '', 'd']]],
    ['Insert column right', [['h1', 'h2', ''], ['a', 'b', ''], ['c', 'd', '']]],
    ['Clear column', [['h1', ''], ['a', ''], ['c', '']]],
    ['Delete column', [['h1'], ['a'], ['c']]],
  ])('%s: one transaction, one undo step', async (label, rows) => {
    const view = await mount()
    const before = view.state.doc.firstChild!
    openMenu(view, 'col', 1, 1)
    expect(choose(view, 'col', label)).toBe(1)
    expect(rowsOf(view)).toEqual(rows)
    expect(handle(view, 'col').querySelector('.button-group')!.getAttribute('data-show')).toBe('false')
    undoesInOne(view, before)
  })

  it.each(['left', 'center', 'right'])('Align %s sets the alignment of each cell of the column', async align => {
    const view = await mount('| h1 | h2 |\n| :-: | --- |\n| a | b |\n| c | d |\n')
    const before = view.state.doc.firstChild!
    openMenu(view, 'col', 1, 1)
    expect(choose(view, 'col', `Align ${align}`)).toBe(1)
    expect([0, 1, 2].map(row => view.state.doc.nodeAt(cellPos(view, row, 1))!.attrs.alignment)).toEqual([align, align, align])
    expect(view.state.doc.nodeAt(cellPos(view, 1, 0))!.attrs.alignment).toBe('center')
    undoesInOne(view, before)
  })

  const SORT = '| Fruit | Id |\n| --- | --- |\n| pear | 10 |\n|  | 2 |\n| apple | 9 |\n| Pear | 100 |\n| banana |  |\n'
  it.each([
    ['Sort A to Z', 0, ['apple', 'banana', 'pear', 'Pear', '']],
    ['Sort Z to A', 0, ['pear', 'Pear', 'banana', 'apple', '']],
    ['Sort A to Z', 1, ['', 'apple', 'pear', 'Pear', 'banana']],
  ])('%s on column %i: the header stays first, empty cells last, equal cells keep their order, whole rows move', async (label, col, fruit) => {
    const view = await mount(SORT)
    const before = view.state.doc.firstChild!
    const byFruit = new Map<string, Node>()
    before.forEach((row, _, i) => { if (i > 0) byFruit.set(row.firstChild!.textContent, row) })
    openMenu(view, 'col', 1, col)
    expect(choose(view, 'col', label)).toBe(1)
    const table = view.state.doc.firstChild!
    expect(table.firstChild!.eq(before.firstChild!)).toBe(true)
    expect(rowsOf(view).slice(1).map(row => row[0])).toEqual(fruit)
    // The same row nodes in a new order: each cell keeps its attributes.
    table.forEach((row, _, i) => { if (i > 0) expect(row).toBe(byFruit.get(row.firstChild!.textContent)) })
    expect((view.state.selection as CellSelection).isColSelection()).toBe(true)
    undoesInOne(view, before)
  })

  it.each([
    ['Insert row above', [['h1', 'h2'], ['', ''], ['a', 'b'], ['c', 'd']]],
    ['Insert row below', [['h1', 'h2'], ['a', 'b'], ['', ''], ['c', 'd']]],
    ['Duplicate row', [['h1', 'h2'], ['a', 'b'], ['a', 'b'], ['c', 'd']]],
    ['Clear row', [['h1', 'h2'], ['', ''], ['c', 'd']]],
    ['Delete row', [['h1', 'h2'], ['c', 'd']]],
  ])('%s: one transaction, one undo step', async (label, rows) => {
    const view = await mount()
    const before = view.state.doc.firstChild!
    openMenu(view, 'row', 1, 0)
    expect(choose(view, 'row', label)).toBe(1)
    expect(rowsOf(view)).toEqual(rows)
    expect(handle(view, 'row').querySelector('.button-group')!.getAttribute('data-show')).toBe('false')
    undoesInOne(view, before)
  })

  it('in a read-only note a handle click opens no menu, and an open menu changes nothing', async () => {
    const view = await mount()
    openMenu(view, 'col', 1, 1)
    view.setProps({ editable: () => false })
    const before = view.state.doc
    expect(choose(view, 'col', 'Delete column')).toBe(0)
    expect(view.state.doc).toBe(before)
    handle(view, 'col').querySelector('.button-group')!.setAttribute('data-show', 'false')
    handle(view, 'col').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(handle(view, 'col').querySelector('.button-group')!.getAttribute('data-show')).toBe('false')
  })
})
