/**
 * The right-click menu's Table part (YAZ-3769, YAZ-3696 D5 / S3) on the real editor in jsdom: the
 * rows through `noteMenuSections` (the pointer is the document position right-clicked), what each
 * does, one undo step each, freeze save and reload, and the freeze counts clamped to the table.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MenuAction, MenuItem, MenuSection } from '../../sidebar/menuSections'
import { getMarkdownForSave } from '../createCrepe'
import { noteMenuSections } from '../noteMenu'
import { cellPos, mountNote as mount, unmountAll } from './tableTestKit'

afterEach(unmountAll)

const TABLE = '| h1 | h2 |\n| -- | -- |\n| a  | b  |\n| c  | d  |\n'
/** The position inside the text of the cell at (row, col): where a right-click there lands. */
const inCell = (view: EditorView, row: number, col: number) => cellPos(view, row, col) + 2
const sectionsAt = (view: EditorView, row: number, col: number) => noteMenuSections(view, null, vi.fn(), inCell(view, row, col))
const all = (sections: MenuSection[]): MenuAction[] => sections.flat().flatMap((item: MenuItem) => (item.children === undefined ? [item] : item.children.flat()))
const row = (view: EditorView, r: number, c: number, id: string) => {
  const found = all(sectionsAt(view, r, c)).find((item) => item.id === id)
  if (found === undefined) throw new Error(`no ${id}`)
  return found
}
const texts = (view: EditorView): string[][] => {
  const out: string[][] = []
  view.state.doc.descendants((node) => {
    if (node.type.name === 'table_header_row' || node.type.name === 'table_row') out.push([])
    if (node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell') out.at(-1)!.push(node.textContent)
    return !node.isTextblock
  })
  return out
}
const tableAttrs = (view: EditorView) => {
  let attrs: Record<string, unknown> = {}
  view.state.doc.descendants((node) => {
    if (node.type.name === 'table') attrs = node.attrs
    return node.type.name !== 'table'
  })
  return attrs
}

describe('the Table part', () => {
  it('shows after the paste rows when the right-click is in a cell, in three groups', async () => {
    const { view } = await mount(TABLE)
    const sections = sectionsAt(view, 1, 0).filter((s) => s.length > 0)
    const labels = sections.map((s) => s.map((item) => (item.children === undefined ? item.label : `${item.label} [${item.children.map((g) => g.map((c) => c.label).join(', ')).join(' | ')}]`)))
    expect(labels.slice(-3)).toEqual([
      ['Insert row above', 'Insert row below', 'Insert column left', 'Insert column right'],
      ['Delete row', 'Delete column', 'Clear cells', 'Fill [Yellow, Green, Blue, Pink | None]'],
      ['Freeze up to this row', 'Freeze up to this column', 'Unfreeze rows', 'Unfreeze columns'],
    ])
    expect(labels.at(-4)?.[0]).toBe('Paste')
  })

  it('is absent outside a table and in a read-only note', async () => {
    const { crepe, view } = await mount(`text\n\n${TABLE}`)
    const ids = (pointer: number) => all(noteMenuSections(view, null, vi.fn(), pointer)).map((item) => item.id)
    expect(ids(2)).not.toContain('table-insert-row-above')
    crepe.setReadonly(true)
    expect(ids(inCell(view, 1, 0))).not.toContain('table-insert-row-above')
  })

  it('on the header row: no row above it, and it cannot be deleted', async () => {
    const { view } = await mount(TABLE)
    expect(row(view, 0, 0, 'table-insert-row-above').disabled).toBe(true)
    expect(row(view, 0, 0, 'table-delete-row').disabled).toBe(true)
    expect(row(view, 0, 0, 'table-insert-row-below').disabled).toBeFalsy()
  })
})

describe('each row, on the clicked cell, one undo step', () => {
  it.each<[string, string[][]]>([
    ['table-insert-row-above', [['h1', 'h2'], ['a', 'b'], ['', ''], ['c', 'd']]],
    ['table-insert-row-below', [['h1', 'h2'], ['a', 'b'], ['c', 'd'], ['', '']]],
    ['table-insert-col-left', [['h1', '', 'h2'], ['a', '', 'b'], ['c', '', 'd']]],
    ['table-insert-col-right', [['h1', 'h2', ''], ['a', 'b', ''], ['c', 'd', '']]],
    ['table-delete-row', [['h1', 'h2'], ['a', 'b']]],
    ['table-delete-col', [['h1'], ['a'], ['c']]],
    ['table-clear', [['h1', 'h2'], ['a', 'b'], ['c', '']]],
  ])('%s', async (id, after) => {
    const { crepe, view } = await mount(TABLE)
    const before = getMarkdownForSave(crepe)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inCell(view, 1, 0))))
    row(view, 2, 1, id).onSelect()
    expect(texts(view)).toEqual(after)
    expect(view.state.selection).toBeInstanceOf(TextSelection)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('a column inserted left of a filled cell moves its fill; the save writes the new address', async () => {
    const { crepe, view } = await mount(`${TABLE}\n<!-- table: fill B2 blue -->\n`)
    row(view, 1, 0, 'table-insert-col-left').onSelect()
    expect(view.state.doc.nodeAt(cellPos(view, 1, 2))!.attrs.fill).toBe('blue')
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: fill C2 blue -->')
  })

  it('acts on the selected cells when there is a CellSelection', async () => {
    const { view } = await mount(TABLE)
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, 1, 0), cellPos(view, 2, 1))))
    row(view, 1, 0, 'table-clear').onSelect()
    expect(texts(view)).toEqual([['h1', 'h2'], ['', ''], ['', '']])
  })

  it('Fill ▸ a colour, then None', async () => {
    const { crepe, view } = await mount(TABLE)
    const before = getMarkdownForSave(crepe)
    row(view, 1, 1, 'table-fill-blue').onSelect()
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: fill B2 blue -->\n`)
    row(view, 1, 1, 'table-fill-none').onSelect()
    expect(getMarkdownForSave(crepe)).toBe(before)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toContain('fill B2 blue')
  })
})

describe('freeze (S3)', () => {
  it('freezes up to the clicked row and column, saves, reloads, and unfreezes', async () => {
    const { crepe, view } = await mount(TABLE)
    const before = getMarkdownForSave(crepe)
    row(view, 1, 0, 'table-freeze-rows').onSelect()
    row(view, 2, 0, 'table-freeze-cols').onSelect()
    expect(tableAttrs(view)).toMatchObject({ freezeRows: 2, freezeCols: 1 })
    const saved = getMarkdownForSave(crepe)
    expect(saved).toBe(`${before}\n<!-- table: freeze 2 rows 1 col -->\n`)
    const again = await mount(saved)
    expect(tableAttrs(again.view)).toMatchObject({ freezeRows: 2, freezeCols: 1 })
    expect(getMarkdownForSave(again.crepe)).toBe(saved)
    row(view, 1, 0, 'table-unfreeze-rows').onSelect()
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: freeze 1 col -->\n`)
    row(view, 1, 0, 'table-unfreeze-cols').onSelect()
    expect(getMarkdownForSave(crepe)).toBe(before)
    expect(row(view, 1, 0, 'table-unfreeze-rows').disabled).toBe(true)
    undo(view.state, view.dispatch)
    expect(tableAttrs(view)).toMatchObject({ freezeRows: 0, freezeCols: 1 })
  })

  it('the page shows a freeze at once, and an unfreeze clears it at once (no edit needed)', async () => {
    const { view } = await mount(TABLE)
    const frozenRows = () => [...view.dom.querySelectorAll('tbody[data-content-dom] > tr')].map((tr) => tr.classList.contains('table-frozen-row'))
    const frozenCols = () => [...view.dom.querySelectorAll('tbody[data-content-dom] > tr:nth-child(3) > *')].map((cell) => cell.classList.contains('table-frozen-col'))
    row(view, 1, 0, 'table-freeze-rows').onSelect()
    expect(frozenRows()).toEqual([true, true, false])
    row(view, 2, 1, 'table-freeze-cols').onSelect()
    expect(frozenCols()).toEqual([true, true])
    row(view, 1, 0, 'table-unfreeze-rows').onSelect()
    expect(frozenRows()).toEqual([false, false, false])
    row(view, 1, 0, 'table-unfreeze-cols').onSelect()
    expect(view.dom.querySelector('.table-frozen-row, .table-frozen-col')).toBeNull()
  })

  // YAZ-3804 (4F): the menu shows where the freeze ends; a click on the checked item unfreezes.
  it('a check on the row and the column where the freeze ends; a click on it unfreezes that direction', async () => {
    const { view } = await mount(TABLE)
    const label = (r: number, c: number, id: string) => row(view, r, c, id).label
    expect(label(1, 0, 'table-freeze-rows')).toBe('Freeze up to this row')
    expect(label(1, 0, 'table-freeze-cols')).toBe('Freeze up to this column')
    expect(row(view, 1, 0, 'table-unfreeze-rows').disabled).toBe(true)
    expect(row(view, 1, 0, 'table-unfreeze-cols').disabled).toBe(true)
    row(view, 1, 0, 'table-freeze-rows').onSelect()
    row(view, 1, 0, 'table-freeze-cols').onSelect()
    expect(label(1, 0, 'table-freeze-rows')).toBe('✓ Frozen up to this row')
    expect(label(1, 0, 'table-freeze-cols')).toBe('✓ Frozen up to this column')
    expect(label(2, 1, 'table-freeze-rows')).toBe('Freeze up to this row')
    expect(label(2, 1, 'table-freeze-cols')).toBe('Freeze up to this column')
    expect(label(0, 0, 'table-freeze-rows')).toBe('Freeze up to this row')
    expect(row(view, 2, 1, 'table-unfreeze-rows').disabled).toBe(false)
    row(view, 1, 1, 'table-freeze-rows').onSelect()
    expect(tableAttrs(view)).toMatchObject({ freezeRows: 0, freezeCols: 1 })
    row(view, 2, 0, 'table-freeze-cols').onSelect()
    expect(tableAttrs(view)).toMatchObject({ freezeRows: 0, freezeCols: 0 })
    // One undo step each.
    undo(view.state, view.dispatch)
    expect(tableAttrs(view)).toMatchObject({ freezeRows: 0, freezeCols: 1 })
  })

  it('a row or column delete keeps the count inside the table', async () => {
    const { crepe, view } = await mount(`${TABLE}\n<!-- table: freeze 3 rows 2 cols -->\n`)
    row(view, 2, 1, 'table-delete-row').onSelect()
    row(view, 1, 1, 'table-delete-col').onSelect()
    expect(tableAttrs(view)).toMatchObject({ freezeRows: 2, freezeCols: 1 })
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: freeze 2 rows 1 col -->')
    // One undo step each: the clamp joins the delete.
    undo(view.state, view.dispatch)
    expect(tableAttrs(view)).toMatchObject({ freezeRows: 2, freezeCols: 2 })
  })

  it('a count bigger than the table in the file loads clamped', async () => {
    const { crepe, view } = await mount(`${TABLE}\n<!-- table: freeze 9 rows 5 cols -->\n`)
    expect(tableAttrs(view)).toMatchObject({ freezeRows: 3, freezeCols: 2 })
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: freeze 3 rows 2 cols -->')
  })
})

// YAZ-3801 (2E): the labels count the selected rows and columns, as in Sheets; insert N inserts N.
const WIDE = '| h1 | h2 | h3 | h4 |\n| -- | -- | -- | -- |\n| a | b | c | d |\n| e | f | g | h |\n| i | j | k | l |\n'
const selectCells = (view: EditorView, from: [number, number], to: [number, number]) =>
  view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, ...from), cellPos(view, ...to))))
/** The Table part's insert, delete, clear and fill rows. */
const labelsOf = (view: EditorView, r: number, c: number) =>
  sectionsAt(view, r, c).flat().filter((item) => item.id.startsWith('table-') && !item.id.includes('freeze')).map((item) => item.label)

describe('the labels count the selection (YAZ-3801)', () => {
  it('one cell: the labels as before', async () => {
    const { view } = await mount(WIDE)
    expect(labelsOf(view, 1, 0)).toEqual(['Insert row above', 'Insert row below', 'Insert column left', 'Insert column right', 'Delete row', 'Delete column', 'Clear cells', 'Fill'])
  })

  it.each<[[number, number], [number, number], string[]]>([
    [[1, 0], [2, 1], ['Insert 2 rows above', 'Insert 2 rows below', 'Insert 2 columns left', 'Insert 2 columns right', 'Delete 2 rows', 'Delete 2 columns', 'Clear cells', 'Fill']],
    [[1, 1], [1, 3], ['Insert row above', 'Insert row below', 'Insert 3 columns left', 'Insert 3 columns right', 'Delete row', 'Delete 3 columns', 'Clear cells', 'Fill']],
  ])('cells %j to %j', async (from, to, labels) => {
    const { view } = await mount(WIDE)
    selectCells(view, from, to)
    expect(labelsOf(view, ...from)).toEqual(labels)
  })

  it.each<[string, [number, number], [number, number], string[]]>([
    ['table-insert-row-above', [1, 0], [2, 0], ['h1', '', '', 'a', 'e', 'i']],
    ['table-insert-row-below', [1, 0], [2, 0], ['h1', 'a', 'e', '', '', 'i']],
    ['table-delete-row', [1, 0], [2, 0], ['h1', 'i']],
  ])('%s on 2 rows: 2 rows, one undo step', async (id, from, to, firstColumn) => {
    const { crepe, view } = await mount(WIDE)
    const before = getMarkdownForSave(crepe)
    selectCells(view, from, to)
    row(view, ...from, id).onSelect()
    expect(texts(view).map((r) => r[0])).toEqual(firstColumn)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it.each<[string, string[]]>([
    ['table-insert-col-left', ['h1', '', '', '', 'h2', 'h3', 'h4']],
    ['table-insert-col-right', ['h1', 'h2', 'h3', 'h4', '', '', '']],
    ['table-delete-col', ['h1']],
  ])('%s on 3 columns: 3 columns, one undo step', async (id, header) => {
    const { crepe, view } = await mount(WIDE)
    const before = getMarkdownForSave(crepe)
    selectCells(view, [1, 1], [1, 3])
    row(view, 1, 1, id).onSelect()
    expect(texts(view)[0]).toEqual(header)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('the guards stay: the header row, every body row, every column', async () => {
    const { view } = await mount(WIDE)
    selectCells(view, [0, 0], [1, 3])
    expect(row(view, 0, 0, 'table-insert-row-above').disabled).toBe(true)
    expect(row(view, 0, 0, 'table-delete-row').disabled).toBe(true)
    expect(row(view, 0, 0, 'table-delete-col').disabled).toBe(true)
    selectCells(view, [1, 0], [3, 0])
    expect(row(view, 1, 0, 'table-delete-row').label).toBe('Delete 3 rows')
    expect(row(view, 1, 0, 'table-delete-row').disabled).toBe(true)
  })
})
