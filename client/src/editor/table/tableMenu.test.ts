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
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MenuAction, MenuItem, MenuParent, MenuSection } from '../../sidebar/menuSections'
import { getMarkdownForSave } from '../createCrepe'
import { noteMenuSections } from '../noteMenu'
import { handleKind } from './tableMenu'
import { cellDOM, cellPos, mountNote as mount, unmountAll } from './tableTestKit'
import { setStickyHeaderSetting } from './timeFormatSetting'

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
  /** Each group's top-level labels; a parent with its rows, " | " between its groups. */
  const shape = (sections: MenuSection[]) =>
    sections.filter((s) => s.length > 0).map((s) => s.map((item) => (item.children === undefined || item.panel !== undefined ? item.label : `${item.label} [${item.children.map((g) => g.map((c) => c.label).join(', ')).join(' | ')}]`)))
  const CLIPBOARD = ['Cut', 'Copy', 'Paste', 'Copy as [Plain text, Markdown | Without folded lines]', 'Paste as [Plain text, Markdown | Cells only]']
  const FREEZE = 'Freeze [Freeze up to this row, Freeze up to this column | Unfreeze rows, Unfreeze columns]'

  it('YAZ-4970: a right-click on cells: the clipboard in one group, then Insert ›, Duplicate ›, Delete ›, the cell note, Format ›, the row state, Freeze ›', async () => {
    const { view } = await mount(TABLE)
    expect(shape(sectionsAt(view, 1, 0))).toEqual([
      CLIPBOARD,
      ['Insert [Insert row above, Insert row below | Insert column left, Insert column right]', 'Duplicate [Duplicate row, Duplicate column]', 'Delete [Delete row, Delete column]', 'Clear cells', 'Merge cells'],
      ['Add cell note', 'Move to cell note'],
      ['Format', 'Sort [Sort A to Z, Sort Z to A]'],
      ['Make subheader row'],
      [FREEZE],
    ])
    // Format ›: the six-dot menu's tabbed panel, its rows the old Align ›, Fill ›, Text colour › and Text in this column ›.
    const format = sectionsAt(view, 1, 0).flat().find((item) => item.id === 'table-format') as MenuParent
    const host = document.createElement('div')
    format.panel!(host, () => undefined)
    expect([...host.querySelectorAll('.fill-target > .fill-target__opt')].map((b) => b.textContent)).toEqual(['Align', 'Fill', 'Text colour', 'Wrap'])
    expect(format.children.flat().map((item) => item.id)).toEqual(expect.arrayContaining(['table-align-left', 'table-fill-teal', 'table-color-red', 'table-text-clip']))
    // The palettes' swatches, as the cell toolbar's.
    const teal = row(view, 1, 0, 'table-fill-teal').icon as { props: { style: { background: string } } }
    expect(teal.props.style.background).toBe('var(--table-fill-solid-teal)')
  })

  it('YAZ-4970: a row handle\'s menu holds row actions only; a column handle\'s, column actions only', async () => {
    const { view } = await mount(TABLE)
    view.dispatch(view.state.tr.setSelection(CellSelection.rowSelection(view.state.doc.resolve(cellPos(view, 1, 0)))))
    expect(handleKind(view.state.selection)).toBe('row')
    expect(shape(noteMenuSections(view, null, vi.fn(), inCell(view, 1, 0), false, 'row'))).toEqual([
      CLIPBOARD,
      ['Insert row above', 'Insert row below', 'Duplicate row'],
      ['Delete row', 'Clear cells', 'Merge cells'],
      ['Format'],
      ['Make subheader row'],
      [FREEZE],
    ])
    view.dispatch(view.state.tr.setSelection(CellSelection.colSelection(view.state.doc.resolve(cellPos(view, 0, 1)))))
    expect(handleKind(view.state.selection)).toBe('column')
    expect(shape(noteMenuSections(view, null, vi.fn(), inCell(view, 0, 1), false, 'column'))).toEqual([
      CLIPBOARD,
      ['Insert column left', 'Insert column right', 'Duplicate column'],
      ['Delete column', 'Clear cells', 'Merge cells'],
      ['Format', 'Sort [Sort A to Z, Sort Z to A]', 'Header row style'],
      [FREEZE],
    ])
    // Selected cells are not words: no Add link….
    expect(all(noteMenuSections(view, null, vi.fn(), inCell(view, 0, 1), false, 'column')).map((item) => item.id)).not.toContain('add-link')
  })

  it('YAZ-4970: "Insert 3 columns left" is in Insert › of a 3-column cell selection, and inserts 3', async () => {
    const { view } = await mount('| h1 | h2 | h3 | h4 |\n| -- | -- | -- | -- |\n| a | b | c | d |\n| e | f | g | h |\n')
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, 1, 1), cellPos(view, 2, 3))))
    const insert = sectionsAt(view, 1, 1).flat().find((item) => item.id === 'table-insert') as MenuParent
    expect(insert.children.map((g) => g.map((c) => c.label))).toEqual([['Insert 2 rows above', 'Insert 2 rows below'], ['Insert 3 columns left', 'Insert 3 columns right']])
    insert.children[1]![0]!.onSelect()
    expect(texts(view)[0]).toEqual(['h1', '', '', '', 'h2', 'h3', 'h4'])
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
    expect(row(view, 0, 0, 'table-duplicate-rows').disabled).toBe(true)
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
    ['table-duplicate-rows', [['h1', 'h2'], ['a', 'b'], ['c', 'd'], ['c', 'd']]],
    ['table-duplicate-cols', [['h1', 'h2', 'h2'], ['a', 'b', 'b'], ['c', 'd', 'd']]],
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

describe('Align ▸, Fill ▸, Text colour ▸ and Sort (YAZ-3820)', () => {
  it('Align ▸ sets the target cells\' own alignment, one undo step (YAZ-3819)', async () => {
    const { crepe, view } = await mount(TABLE)
    const before = getMarkdownForSave(crepe)
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, 1, 0), cellPos(view, 1, 1))))
    row(view, 1, 0, 'table-align-right').onSelect()
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: align A2:B2 right -->\n`)
    expect(view.state.doc.nodeAt(cellPos(view, 1, 0))!.attrs.alignment).toBeNull()
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('Align ▸ the column\'s own alignment clears the cell\'s: it follows its column again (YAZ-3819)', async () => {
    const { crepe, view } = await mount('| h1 | h2 |\n| -- | -: |\n| a | b |\n\n<!-- table: align B2 center -->\n')
    row(view, 1, 1, 'table-align-right').onSelect()
    expect(view.state.doc.nodeAt(cellPos(view, 1, 1))!.attrs.align).toBeNull()
    expect(getMarkdownForSave(crepe)).not.toContain('<!--')
  })

  it('Text colour ▸ a name, then Default colour', async () => {
    const { crepe, view } = await mount(TABLE)
    const before = getMarkdownForSave(crepe)
    row(view, 2, 1, 'table-color-purple').onSelect()
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: color B3 purple -->\n`)
    row(view, 2, 1, 'table-color-none').onSelect()
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  /** The table menu's colour box, on the page's body. */
  const menuBox = () => document.querySelector<HTMLElement>('body > .table-colour-box')
  /** Type `color` into the box's R G B fields and press Enter: one finished pick. */
  const pickInBox = (color: string) => {
    const fields = ['Red', 'Green', 'Blue'].map((name) => menuBox()!.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!)
    const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
    fields.forEach((field, i) => {
      field.value = String(rgb[i])
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    fields[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  }

  it('Custom colour… opens the colour box under the clicked cell, never the system picker; each pick sets that cell, one undo step', async () => {
    const { crepe, view } = await mount(TABLE)
    const before = getMarkdownForSave(crepe)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 2, 0) + 3)))
    const caret = view.state.selection
    const cell = view.nodeDOM(cellPos(view, 1, 1)) as HTMLElement
    cell.getBoundingClientRect = () => new DOMRect(100, 30, 100, 30)
    const opened = vi.spyOn(HTMLInputElement.prototype, 'click')
    row(view, 1, 1, 'table-fill-custom').onSelect()
    expect(opened).not.toHaveBeenCalled()
    opened.mockRestore()
    expect(document.querySelector('input[type="color"]')).toBeNull()
    expect(menuBox()!.hidden).toBe(false)
    expect([menuBox()!.style.top, menuBox()!.style.left]).toEqual(['64px', '100px'])
    pickInBox('#00aa55')
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: fill B2 #00aa55 -->\n`)
    // The box stays open for the next pick; the note keeps its own selection.
    expect(menuBox()!.hidden).toBe(false)
    expect(view.state.selection.eq(caret)).toBe(true)
    pickInBox('#112233')
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: fill B2 #112233 -->\n`)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: fill B2 #00aa55 -->\n`)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('Custom colour… goes to the clicked cell even after an edit above it moved it', async () => {
    const { view } = await mount(TABLE)
    row(view, 2, 1, 'table-fill-custom').onSelect()
    view.dispatch(view.state.tr.insertText('more ', cellPos(view, 0, 0) + 2))
    pickInBox('#00aa55')
    expect([1, 2].map((r) => [0, 1].map((c) => view.state.doc.nodeAt(cellPos(view, r, c))!.attrs.fill))).toEqual([[null, null], [null, '#00aa55']])
  })

  it('the box opens on the cells\' own custom colour; Escape and a mousedown outside close it; with its cells gone it goes', async () => {
    const { view } = await mount(`${TABLE}\n<!-- table: color B2 #1a2b3c -->\n`)
    row(view, 1, 1, 'table-color-custom').onSelect()
    const red = menuBox()!.querySelector<HTMLInputElement>('input[aria-label="Red"]')!
    expect(red.value).toBe(String(0x1a))
    red.focus()
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    red.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(menuBox()!.hidden).toBe(true)
    expect(view.hasFocus()).toBe(true)
    row(view, 1, 1, 'table-color-custom').onSelect()
    menuBox()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(menuBox()!.hidden).toBe(false)
    view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(menuBox()!.hidden).toBe(true)
    // A pick once closed does nothing.
    const after = view.state.doc
    pickInBox('#445566')
    expect(view.state.doc).toBe(after)
    row(view, 1, 1, 'table-color-custom').onSelect()
    let table = -1
    view.state.doc.forEach((node, pos) => {
      if (node.type.name === 'table') table = pos
    })
    view.dispatch(view.state.tr.delete(table, table + view.state.doc.nodeAt(table)!.nodeSize))
    expect(menuBox()!.hidden).toBe(true)
  })

  const SORT = '| Fruit | Id |\n| --- | --- |\n| pear | 10 |\n|  | 2 |\n| apple | 9 |\n| Pear | 100 |\n| banana |  |\n'
  it.each<[string, number, string[]]>([
    ['table-sort-asc', 0, ['apple', 'banana', 'pear', 'Pear', '']],
    ['table-sort-desc', 0, ['pear', 'Pear', 'banana', 'apple', '']],
    ['table-sort-asc', 1, ['', 'apple', 'pear', 'Pear', 'banana']],
  ])('%s by column %i: the header stays first, empty cells last, equal cells keep their order, whole rows move', async (id, col, fruit) => {
    const { crepe, view } = await mount(SORT)
    const before = getMarkdownForSave(crepe)
    row(view, 2, col, id).onSelect()
    expect(texts(view).slice(1).map((r) => r[0])).toEqual(fruit)
    expect(texts(view)[0]).toEqual(['Fruit', 'Id'])
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('Sort moves the same row nodes, so each cell keeps its fill, colour and own alignment', async () => {
    const { view } = await mount(`${SORT}\n<!-- table: fill A3 blue, color B3 red, align B3 center -->\n`)
    const body = () => { const out: ProseNode[] = []; view.state.doc.firstChild!.forEach((r, _, i) => { if (i > 0) out.push(r) }); return out }
    const byFruit = new Map(body().map((r) => [r.child(0).textContent, r]))
    row(view, 2, 0, 'table-sort-asc').onSelect()
    // The same nodes, in the new order: none was made again.
    const order = ['apple', 'banana', 'pear', 'Pear', '']
    body().forEach((r, i) => expect(r).toBe(byFruit.get(order[i]!)))
    // The empty-fruit row (row 3 before) is last now, with its attributes.
    const last = view.state.doc.firstChild!.lastChild!
    expect(last.child(0).attrs.fill).toBe('blue')
    expect([last.child(1).attrs.color, last.child(1).attrs.align]).toEqual(['red', 'center'])
  })

  it('Sort reads a cell with bullets as its words joined with a space (YAZ-3818)', async () => {
    const { view } = await mount('| Words |\n| --- |\n| abb |\n| <ul><li>ab</li><li>c</li></ul> |\n')
    row(view, 1, 0, 'table-sort-asc').onSelect()
    // "ab c" before "abb"; read without the space, "abc" came after it.
    expect(texts(view).slice(1).map((r) => r[0])).toEqual(['abc', 'abb'])
  })

  it('Sort by the selected column keeps the cells selected', async () => {
    const { view } = await mount(SORT)
    view.dispatch(view.state.tr.setSelection(CellSelection.colSelection(view.state.doc.resolve(cellPos(view, 0, 0)))))
    row(view, 0, 0, 'table-sort-asc').onSelect()
    expect(texts(view).slice(1).map((r) => r[0])).toEqual(['apple', 'banana', 'pear', 'Pear', ''])
    expect((view.state.selection as CellSelection).isColSelection()).toBe(true)
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
    setStickyHeaderSetting(true)
    expect(getMarkdownForSave(crepe)).toBe(before)
    expect(row(view, 1, 0, 'table-unfreeze-rows').disabled).toBe(true)
    undo(view.state, view.dispatch)
    expect(tableAttrs(view)).toMatchObject({ freezeRows: 0, freezeCols: 1 })
  })

  it('the page shows a freeze at once, and an unfreeze clears it at once (no edit needed)', async () => {
    // Settings › Sticky header row Off (YAZ-4899 round 2): with it On, an unfreeze keeps the header row frozen.
    setStickyHeaderSetting(false)
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
/** The Table part's insert, delete, clear and fill rows: not its cell note rows. Insert ›, Duplicate ›, Delete › and Sort › by their rows (YAZ-4970). */
const labelsOf = (view: EditorView, r: number, c: number) =>
  sectionsAt(view, r, c)
    .flat()
    .filter((item) => item.id.startsWith('table-') && !item.id.includes('freeze') && !item.id.includes('note'))
    .flatMap((item) => (item.children === undefined || item.id === 'table-format' ? [item.label] : item.children.flat().map((child) => child.label)))

describe('whole rows and whole columns count what is selected, as any cells (the YAZ-4163 demo)', () => {
  const selectRows = (view: EditorView, from: number, to: number) =>
    view.dispatch(view.state.tr.setSelection(CellSelection.rowSelection(view.state.doc.resolve(cellPos(view, from, 0)), view.state.doc.resolve(cellPos(view, to, 0)))))

  it('rows 2 to 3 of a 4-column table: 2 rows and 4 columns; Insert 4 columns right adds 4', async () => {
    const { view } = await mount(WIDE)
    selectRows(view, 1, 2)
    expect(labelsOf(view, 1, 1)).toEqual(['Insert 2 rows above', 'Insert 2 rows below', 'Insert 4 columns left', 'Insert 4 columns right', 'Duplicate 2 rows', 'Duplicate 4 columns', 'Delete 2 rows', 'Delete 4 columns', 'Clear cells', 'Merge cells', 'Format', 'Sort A to Z', 'Sort Z to A', 'Fold 2 rows', 'Make 2 subheader rows'])
    row(view, 1, 1, 'table-insert-col-right').onSelect()
    expect(texts(view)[0]).toEqual(['h1', 'h2', 'h3', 'h4', '', '', '', ''])
  })
})

describe('the labels count the selection (YAZ-3801)', () => {
  it('one cell: the labels as before', async () => {
    const { view } = await mount(WIDE)
    expect(labelsOf(view, 1, 0)).toEqual(['Insert row above', 'Insert row below', 'Insert column left', 'Insert column right', 'Duplicate row', 'Duplicate column', 'Delete row', 'Delete column', 'Clear cells', 'Merge cells', 'Format', 'Sort A to Z', 'Sort Z to A', 'Make subheader row'])
  })

  it.each<[[number, number], [number, number], string[]]>([
    [[1, 0], [2, 1], ['Insert 2 rows above', 'Insert 2 rows below', 'Insert 2 columns left', 'Insert 2 columns right', 'Duplicate 2 rows', 'Duplicate 2 columns', 'Delete 2 rows', 'Delete 2 columns', 'Clear cells', 'Merge cells', 'Format', 'Sort A to Z', 'Sort Z to A', 'Fold 2 rows', 'Make 2 subheader rows']],
    [[1, 1], [1, 3], ['Insert row above', 'Insert row below', 'Insert 3 columns left', 'Insert 3 columns right', 'Duplicate row', 'Duplicate 3 columns', 'Delete row', 'Delete 3 columns', 'Clear cells', 'Merge cells', 'Format', 'Sort A to Z', 'Sort Z to A', 'Make subheader row']],
  ])('cells %j to %j', async (from, to, labels) => {
    const { view } = await mount(WIDE)
    selectCells(view, from, to)
    expect(labelsOf(view, ...from)).toEqual(labels)
  })

  it.each<[string, [number, number], [number, number], string[]]>([
    ['table-insert-row-above', [1, 0], [2, 0], ['h1', '', '', 'a', 'e', 'i']],
    ['table-insert-row-below', [1, 0], [2, 0], ['h1', 'a', 'e', '', '', 'i']],
    ['table-delete-row', [1, 0], [2, 0], ['h1', 'i']],
    ['table-duplicate-rows', [1, 0], [2, 0], ['h1', 'a', 'e', 'a', 'e', 'i']],
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

  // YAZ-4168: the copies go right of the selected columns, with every cell attribute and the GFM alignment.
  it('Duplicate 2 columns: the copies go right of them, with text, fill, colour, align, valign, width and the GFM alignment; one undo step', async () => {
    const { crepe, view } = await mount(`| h1 | h2 | h3 | h4 |\n| -- | :-: | -: | -- |\n| a | b | c | d |\n| e | f | g | h |\n\n<!-- table: widths 140 auto 90 auto, fill B2 blue, color C3 red, align B3 right, valign C2 bottom -->\n`)
    const before = getMarkdownForSave(crepe)
    selectCells(view, [1, 1], [1, 2])
    expect(row(view, 1, 1, 'table-duplicate-cols').label).toBe('Duplicate 2 columns')
    row(view, 1, 1, 'table-duplicate-cols').onSelect()
    expect(texts(view)).toEqual([['h1', 'h2', 'h3', 'h2', 'h3', 'h4'], ['a', 'b', 'c', 'b', 'c', 'd'], ['e', 'f', 'g', 'f', 'g', 'h']])
    expect(getMarkdownForSave(crepe)).toBe(
      '| h1 |  h2 | h3 |  h2 | h3 | h4 |\n| -- | :-: | -: | :-: | -: | -- |\n| a  |  b  |  c |  b  |  c | d  |\n| e  |  f  |  g |  f  |  g | h  |\n\n' +
        '<!-- table: widths 140 auto 90 auto 90 auto, fill B2 D2 blue, color C3 E3 red, align B3 D3 right, valign C2 E2 bottom -->\n',
    )
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('the guards stay: the header row, every body row, every column', async () => {
    const { view } = await mount(WIDE)
    selectCells(view, [0, 0], [1, 3])
    expect(row(view, 0, 0, 'table-insert-row-above').disabled).toBe(true)
    expect(row(view, 0, 0, 'table-delete-row').disabled).toBe(true)
    // Every column: the whole table (whole rows and whole columns at once, so every item shows).
    selectCells(view, [0, 0], [3, 3])
    expect(row(view, 0, 0, 'table-delete-col').disabled).toBe(true)
    selectCells(view, [1, 0], [3, 0])
    expect(row(view, 1, 0, 'table-delete-row').label).toBe('Delete 3 rows')
    expect(row(view, 1, 0, 'table-delete-row').disabled).toBe(true)
  })
})

describe('Text in this column › (YAZ-4900): the target columns\' own Wrap or Clip', () => {
  it('Clip writes `text 2:clip` and puts it on every cell of the column, one undo step; ✓ at what the column shows; Table\'s choice clears it', async () => {
    const { crepe, view } = await mount(TABLE)
    const before = getMarkdownForSave(crepe)
    expect(row(view, 1, 1, 'table-text-table').radio?.on).toBe(true)
    row(view, 1, 1, 'table-text-clip').onSelect()
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: text 2:clip -->\n`)
    expect([0, 1, 2].map((r) => view.state.doc.nodeAt(cellPos(view, r, 1))!.attrs.text)).toEqual(['clip', 'clip', 'clip'])
    expect([0, 1, 2].map((r) => view.state.doc.nodeAt(cellPos(view, r, 0))!.attrs.text)).toEqual([null, null, null])
    expect(cellDOM(view, 2, 1).getAttribute('data-cell-text')).toBe('clip')
    expect(cellDOM(view, 2, 0).hasAttribute('data-cell-text')).toBe(false)
    expect(row(view, 2, 1, 'table-text-clip').radio?.on).toBe(true)
    expect(row(view, 2, 0, 'table-text-table').radio?.on).toBe(true)
    // Mixed columns light no pick, and the label counts them.
    selectCells(view, [1, 0], [1, 1])
    // YAZ-4970: the Format panel's Wrap tab names the columns.
    const format = sectionsAt(view, 1, 0).flat().find((item) => item.id === 'table-format') as MenuParent
    const host = document.createElement('div')
    format.panel!(host, () => undefined)
    ;[...host.querySelectorAll('button')].find((b) => b.textContent === 'Wrap')!.click()
    expect(host.querySelector('.ctx-menu__heading')?.textContent).toBe('Text in these columns')
    expect([row(view, 1, 0, 'table-text-table'), row(view, 1, 0, 'table-text-clip')].map((r) => r.radio?.on)).toEqual([false, false])
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inCell(view, 1, 1))))
    row(view, 1, 1, 'table-text-table').onSelect()
    expect(getMarkdownForSave(crepe)).toBe(before)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: text 2:clip -->\n`)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('stays on its column: a column inserted left moves it, a new row takes it in the same undo step, a duplicate keeps it, a delete takes it', async () => {
    const { crepe, view } = await mount(`${TABLE}\n<!-- table: text 2:clip -->\n`)
    expect(view.state.doc.nodeAt(cellPos(view, 2, 1))!.attrs.text).toBe('clip')
    row(view, 1, 0, 'table-insert-col-left').onSelect()
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: text 3:clip -->')
    row(view, 2, 2, 'table-insert-row-below').onSelect()
    expect(texts(view)).toHaveLength(4)
    expect(view.state.doc.nodeAt(cellPos(view, 3, 2))!.attrs.text).toBe('clip')
    expect(view.state.doc.nodeAt(cellPos(view, 3, 1))!.attrs.text).toBeNull()
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: text 3:clip -->')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(texts(view)).toHaveLength(3)
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: text 3:clip -->')
    row(view, 1, 2, 'table-duplicate-cols').onSelect()
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: text 3:clip 4:clip -->')
    row(view, 1, 3, 'table-delete-col').onSelect()
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: text 3:clip -->')
    row(view, 1, 2, 'table-delete-col').onSelect()
    expect(getMarkdownForSave(crepe)).not.toContain('<!-- table:')
  })
})
