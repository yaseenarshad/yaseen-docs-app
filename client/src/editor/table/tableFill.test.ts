/**
 * Fill down (YAZ-3765, YAZ-3696 🔒 S4): the corner handle and the fill it writes, on the real editor in jsdom.
 * `tableTestKit` gives each cell a 100 × 30 layout px box, times the document zoom on screen.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { cellDOM, cellPos, mountNote, mountTable, mouseAt, unmountAll } from './tableTestKit'
import { fillCells, fillSource } from './tableFill'

afterEach(unmountAll)

const TABLE = '| Day | Time | N |\n| --- | --- | --- |\n| Mon | 4:00 | 1 |\n| x | 4:30 | 2 |\n| | | |\n| | | |\n'
const texts = (view: EditorView) => {
  const rows: string[][] = []
  view.state.doc.descendants((node) => {
    if (node.type.name === 'table_row' || node.type.name === 'table_header_row') rows.push(node.content.content.map((cell) => cell.textContent))
    return !node.isTextblock
  })
  return rows
}
const selectCells = (view: EditorView, from: [number, number], to: [number, number]) =>
  view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, ...from), cellPos(view, ...to))))
const cellAt = (view: EditorView, row: number, col: number) => view.state.doc.nodeAt(cellPos(view, row, col))!
const handle = (view: EditorView) => view.dom.querySelector<HTMLElement>('.table-fill-handle')
/** The screen point at the middle of cell (row, col). */
const at = (row: number, col: number, zoom: number) => [(col * 100 + 50) * zoom, (row * 30 + 15) * zoom] as const

describe('fill command', () => {
  it('down: each column continues its series; one undo step', async () => {
    const view = await mountTable(TABLE)
    selectCells(view, [1, 0], [2, 2])
    const before = view.state.doc
    view.dispatch(fillCells(view.state, fillSource(view.state)!, 'down', 2)!)
    expect(texts(view).slice(3)).toEqual([['Mon', '5:00', '3'], ['x', '5:30', '4']])
    const selection = view.state.selection as CellSelection
    expect([selection.$anchorCell.pos, selection.$headCell.pos]).toEqual([cellPos(view, 1, 0), cellPos(view, 4, 2)])
    undo(view.state, view.dispatch)
    expect(view.state.doc.eq(before)).toBe(true)
  })

  it('right: each row continues its series', async () => {
    const view = await mountTable('| a | b | c | d |\n| --- | --- | --- | --- |\n| Week 1 | | | |\n| Jan | | | |\n')
    selectCells(view, [1, 0], [2, 0])
    view.dispatch(fillCells(view.state, fillSource(view.state)!, 'right', 3)!)
    expect(texts(view).slice(1)).toEqual([['Week 1', 'Week 2', 'Week 3', 'Week 4'], ['Jan', 'Feb', 'Mar', 'Apr']])
  })

  it('stops at the last row and the last column; it never adds rows or columns', async () => {
    const view = await mountTable(TABLE)
    selectCells(view, [2, 2], [2, 2])
    view.dispatch(fillCells(view.state, fillSource(view.state)!, 'down', 10)!)
    expect(texts(view)).toHaveLength(5)
    expect(texts(view).map((row) => row[2])).toEqual(['N', '1', '2', '2', '2'])
    selectCells(view, [1, 1], [1, 1])
    view.dispatch(fillCells(view.state, fillSource(view.state)!, 'right', 10)!)
    expect(texts(view)[1]).toEqual(['Mon', '4:00', '4:00'])
    selectCells(view, [4, 2], [4, 2])
    expect(fillCells(view.state, fillSource(view.state)!, 'down', 1)).toBeNull()
  })

  it('fill and colour copy with the values, in the pattern of the source cells', async () => {
    const view = await mountTable(TABLE)
    const set = (row: number, col: number, attrs: object) => view.dispatch(view.state.tr.setNodeMarkup(cellPos(view, row, col), null, { ...cellAt(view, row, col).attrs, ...attrs }))
    set(1, 0, { fill: 'yellow', color: 'red' })
    set(2, 0, { fill: 'blue' })
    selectCells(view, [1, 0], [2, 0])
    view.dispatch(fillCells(view.state, fillSource(view.state)!, 'down', 2)!)
    expect([3, 4].map((row) => [cellAt(view, row, 0).attrs.fill, cellAt(view, row, 0).attrs.color])).toEqual([['yellow', 'red'], ['blue', null]])
  })

  it('a copied value keeps the source cell content (bold stays bold)', async () => {
    const view = await mountTable('| a |\n| --- |\n| **hi** |\n| |\n')
    selectCells(view, [1, 0], [1, 0])
    view.dispatch(fillCells(view.state, fillSource(view.state)!, 'down', 1)!)
    expect(cellAt(view, 2, 0).firstChild!.firstChild!.marks.map((mark) => mark.type.name)).toEqual(['strong'])
  })
})

describe('fill handle', () => {
  it('sits in the bottom-right cell of the selected cells, and in the caret cell', async () => {
    const view = await mountTable(TABLE)
    selectCells(view, [1, 0], [2, 1])
    expect(handle(view)?.parentElement).toBe(cellDOM(view, 2, 1))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 3, 2) + 2)))
    expect(handle(view)?.parentElement).toBe(cellDOM(view, 3, 2))
    expect(view.dom.querySelectorAll('.table-fill-handle')).toHaveLength(1)
  })

  it('no handle outside a table or in a read-only note', async () => {
    const view = await mountTable(`para\n\n${TABLE}`)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    expect(handle(view)).toBeNull()
    selectCells(view, [1, 0], [2, 1])
    view.setProps({ editable: () => false })
    expect(handle(view)).toBeNull()
  })

  describe.each([1, 2, 0.5])('drag at document zoom %s', (zoom) => {
    it('a drag down shows the target outline, then writes the fill once on mouseup', async () => {
      const view = await mountTable(TABLE, zoom)
      selectCells(view, [1, 1], [2, 2])
      const before = view.state.doc
      mouseAt('mousedown', handle(view)!, ...at(2, 2, zoom))
      expect(view.state.selection).toBeInstanceOf(CellSelection)
      mouseAt('mousemove', cellDOM(view, 4, 1), ...at(4, 1, zoom))
      // The cell select drag did not start: the selection is still the source cells.
      const selection = view.state.selection as CellSelection
      expect([selection.$anchorCell.pos, selection.$headCell.pos]).toEqual([cellPos(view, 1, 1), cellPos(view, 2, 2)])
      const outlined = [...view.dom.querySelectorAll('[data-fill-target]')]
      expect(outlined).toHaveLength(8)
      expect(cellDOM(view, 1, 1).getAttribute('data-fill-target')).toBe('top left')
      expect(cellDOM(view, 4, 2).getAttribute('data-fill-target')).toBe('bottom right')
      expect(view.state.doc.eq(before)).toBe(true)
      mouseAt('mouseup', cellDOM(view, 4, 1), ...at(4, 1, zoom))
      expect(texts(view).slice(3).map((row) => row.slice(1))).toEqual([['5:00', '3'], ['5:30', '4']])
      expect(view.dom.querySelectorAll('[data-fill-target]')).toHaveLength(0)
      undo(view.state, view.dispatch)
      expect(view.state.doc.eq(before)).toBe(true)
    })

    it('a drag right fills right; the pointer outside the table keeps the target', async () => {
      const view = await mountTable('| a | b | c |\n| --- | --- | --- |\n| Mon | | |\n', zoom)
      selectCells(view, [1, 0], [1, 0])
      mouseAt('mousedown', handle(view)!, ...at(1, 0, zoom))
      mouseAt('mousemove', cellDOM(view, 1, 2), ...at(1, 2, zoom))
      view.posAtCoords = () => null
      mouseAt('mousemove', view.dom, 900 * zoom, 15 * zoom)
      mouseAt('mouseup', view.dom, 900 * zoom, 15 * zoom)
      expect(texts(view)).toEqual([['a', 'b', 'c'], ['Mon', 'Tue', 'Wed']])
    })
  })

  it('a mousedown on the handle does not start a cell select drag; a drop on the source writes nothing', async () => {
    const view = await mountTable(TABLE)
    selectCells(view, [1, 0], [1, 0])
    const before = view.state.doc
    mouseAt('mousedown', handle(view)!, ...at(1, 0, 1))
    mouseAt('mousemove', cellDOM(view, 1, 0), ...at(1, 0, 1))
    mouseAt('mouseup', cellDOM(view, 1, 0), ...at(1, 0, 1))
    expect(view.state.doc.eq(before)).toBe(true)
    const selection = view.state.selection as CellSelection
    expect([selection.$anchorCell.pos, selection.$headCell.pos]).toEqual([cellPos(view, 1, 0), cellPos(view, 1, 0)])
  })
})

describe('a note closed during a drag', () => {
  it('drops the drag\'s document listeners: a later mouseup dispatches nothing', async () => {
    const { crepe, view } = await mountNote(TABLE)
    selectCells(view, [1, 1], [2, 2])
    mouseAt('mousedown', handle(view)!, ...at(2, 2, 1))
    mouseAt('mousemove', cellDOM(view, 4, 1), ...at(4, 1, 1))
    const dispatch = vi.spyOn(view, 'dispatch')
    await crepe.destroy()
    mouseAt('mouseup', document, ...at(4, 1, 1))
    expect(dispatch).not.toHaveBeenCalled()
  })
})
