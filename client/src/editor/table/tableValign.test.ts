/**
 * Vertical alignment (YAZ-4166, YAZ-4159 D10): the table default and a cell's own `valign`, the ONE `valign` part
 * of the table comment, the six-dot "Vertical align", the table menu's Align ▸ Top · Middle · Bottom, a new row,
 * "/Calendar table"'s column A, and a copy.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { undo } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MenuAction, MenuItem } from '../../sidebar/menuSections'
import type { MenuStrip } from '../blockHandleMenu'
import { getMarkdownForSave } from '../createCrepe'
import { pageMenuSections } from '../pageMenu'
import { calendarTableNode, setTimeSlots } from './tableCalendar'
import { formatTableComment, parseTableComment, plainTable, type TableStyle } from './tableComment'
import { tableRows } from './tableRows'
import { cellPos, mountPage, unmountAll } from './tableTestKit'
import tableCss from './table.css?inline'

afterEach(unmountAll)

const style = (parts: Partial<TableStyle>): TableStyle => ({ ...plainTable(), ...parts })
const TABLE = '| h1 | h2 |\n| -- | -- |\n| a  | b  |\n| c  | d  |\n'

const firstTable = (view: EditorView): { node: ProseNode; pos: number } => {
  let out: { node: ProseNode; pos: number } | null = null
  view.state.doc.descendants((node, pos) => {
    if (out === null && node.type.name === 'table') out = { node, pos }
    return out === null
  })
  return out!
}
/** The `valign` of every cell, row by row. */
const valigns = (view: EditorView): unknown[][] => {
  const rows: unknown[][] = []
  firstTable(view).node.forEach((row) => {
    const cells: unknown[] = []
    row.forEach((cell) => cells.push(cell.attrs.valign))
    rows.push(cells)
  })
  return rows
}
const menuItem = (view: EditorView, row: number, col: number, id: string): MenuAction => {
  const items = pageMenuSections(view, null, vi.fn(), cellPos(view, row, col) + 2)
    .flat()
    .flatMap((item: MenuItem) => (item.children === undefined ? [item] : item.children.flat()))
  const found = items.find((item) => item.id === id)
  if (found === undefined) throw new Error(`no ${id}`)
  return found
}

describe('the `valign` part (one part: an optional table default, then cells as `align` writes them)', () => {
  it.each<[string, Partial<TableStyle>]>([
    ['valign middle A2:A40 top', { valignTable: 'middle', valign: new Map(Array.from({ length: 39 }, (_, i) => [`A${i + 2}`, 'top' as const])) }],
    ['valign A2:A33 middle', { valign: new Map(Array.from({ length: 32 }, (_, i) => [`A${i + 2}`, 'middle' as const])) }],
    ['valign bottom', { valignTable: 'bottom' }],
  ])('%s round-trips', (part, parts) => {
    const comment = `<!-- table: ${part} -->`
    expect(parseTableComment(comment)).toEqual(style(parts))
    expect(formatTableComment(style(parts))).toBe(comment)
  })

  it('goes right after `align` in the fixed order', () => {
    const comment = '<!-- table: fill A1 blue, align B2 center, valign middle B3 bottom, border 2px 40%, stripes -->'
    expect(formatTableComment(parseTableComment('<!-- table: stripes, valign middle B3 bottom, border 2px 40%, align B2 center, fill A1 blue -->')!)).toBe(comment)
  })

  it.each(['valign center', 'valign A2 sideways', 'valign middle A2', 'valign middle A2 left', 'valign A2', 'valign middle top'])('%s is a value it does not know: the part is kept as its text (YAZ-4176)', (part) => {
    expect(parseTableComment(`<!-- table: ${part}, stripes -->`)).toEqual(style({ stripes: true, unknown: [{ after: null, text: part }] }))
  })

  it('`valign top` is the default: no part', () => {
    expect(parseTableComment('<!-- table: valign top, stripes -->')).toEqual(style({ stripes: true }))
    expect(formatTableComment(style({ valignTable: 'top' as never }))).toBeNull()
  })
})

describe('in the editor', () => {
  const STYLED = `${TABLE}\n<!-- table: valign middle A2 top B3 bottom -->\n`

  it('loads into the table and the cells, saves byte for byte, and shows data attributes; the cell wins', async () => {
    const { crepe, view } = await mountPage(STYLED)
    expect(getMarkdownForSave(crepe)).toBe(STYLED)
    expect(firstTable(view).node.attrs.valign).toBe('middle')
    expect(valigns(view)).toEqual([[null, null], ['top', null], [null, 'bottom']])
    const block = view.dom.querySelector<HTMLElement>('.milkdown-table-block')!
    expect(block.getAttribute('data-table-valign')).toBe('middle')
    const a2 = view.nodeDOM(cellPos(view, 1, 0)) as HTMLElement
    expect(a2.getAttribute('data-valign')).toBe('top')
    expect(a2.style.verticalAlign).toBe('top')
    expect((view.nodeDOM(cellPos(view, 1, 1)) as HTMLElement).hasAttribute('data-valign')).toBe(false)
  })

  it('table.css: the table default on the cells, and nothing else (a frozen cell keeps its position)', () => {
    const css = tableCss.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const value of ['middle', 'bottom']) {
      expect(css).toMatch(new RegExp(`\\[data-table-valign='${value}'\\] :is\\(th, td\\) \\{\\s*vertical-align: ${value};\\s*\\}`))
    }
  })

  it('a copy keeps the cell\'s own value as an inline `vertical-align`, and the table\'s on a copied table', async () => {
    const { view } = await mountPage(STYLED)
    view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, 1, 0), cellPos(view, 2, 1))))
    const box = document.createElement('div')
    box.appendChild(view.serializeForClipboard(view.state.selection.content()).dom)
    const cells = [...box.querySelectorAll<HTMLElement>('td')]
    expect(cells.map((cell) => cell.style.verticalAlign)).toEqual(['top', '', '', 'bottom'])
    // The whole table, copied as a node, gives its default to the cells with none.
    const all = document.createElement('div')
    const { node, pos } = firstTable(view)
    all.appendChild(view.serializeForClipboard(view.state.doc.slice(pos, pos + node.nodeSize)).dom)
    expect([...all.querySelectorAll<HTMLElement>('td')].map((cell) => cell.style.verticalAlign)).toEqual(['top', 'middle', 'middle', 'bottom'])
  })
})

describe('the menus, one undo step each', () => {
  it('Align ▸ has a second group Top · Middle · Bottom; a column handle\'s pick sets the whole column', async () => {
    const { crepe, view } = await mountPage(TABLE)
    const before = getMarkdownForSave(crepe)
    // YAZ-4970: Align is Format ›'s first tab; its rows lead Format's.
    const format = pageMenuSections(view, null, vi.fn(), cellPos(view, 1, 0) + 2).flat().find((item) => item.id === 'table-format')!
    expect(format.children!.slice(0, 2).map((group) => group.map((item) => item.label))).toEqual([['Left', 'Center', 'Right'], ['Top', 'Middle', 'Bottom']])
    view.dispatch(view.state.tr.setSelection(CellSelection.colSelection(view.state.doc.resolve(cellPos(view, 0, 1)))))
    menuItem(view, 0, 1, 'table-align-middle').onSelect()
    expect(valigns(view)).toEqual([[null, 'middle'], [null, 'middle'], [null, 'middle']])
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: valign B1:B3 middle -->\n`)
    // The table's own value clears the cell's: it follows the table again.
    menuItem(view, 1, 1, 'table-align-top').onSelect()
    expect(valigns(view)[1]).toEqual([null, null])
    undo(view.state, view.dispatch)
    expect(valigns(view)[1]).toEqual([null, 'middle'])
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('a row handle\'s pick sets the whole row', async () => {
    const { view } = await mountPage(TABLE)
    view.dispatch(view.state.tr.setSelection(CellSelection.rowSelection(view.state.doc.resolve(cellPos(view, 2, 0)))))
    menuItem(view, 2, 0, 'table-align-bottom').onSelect()
    expect(valigns(view)).toEqual([[null, null], [null, null], ['bottom', 'bottom']])
  })

  it('the six-dot Text strip\'s Align top / middle / bottom set the table default; Top is the default and saves no part', async () => {
    const { crepe, view } = await mountPage(TABLE)
    const before = getMarkdownForSave(crepe)
    const { pos } = firstTable(view)
    const button = (label: string) =>
      (tableRows(view, { inside: pos } as never, crepe.editor.ctx).find((item) => item.kind === 'strip' && item.label === 'Text') as MenuStrip).buttons.find((b) => b.label === label)!
    expect(button('Align top').active).toBe(true)
    button('Align middle').run()
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: valign middle -->\n`)
    expect([button('Align top').active, button('Align middle').active]).toEqual([false, true])
    button('Align top').run()
    expect(getMarkdownForSave(crepe)).toBe(before)
    undo(view.state, view.dispatch)
    expect(firstTable(view).node.attrs.valign).toBe('middle')
  })
})

describe('a new row takes the valign of the cell above it, in each column', () => {
  const SET = `${TABLE}\n<!-- table: valign A2 middle B3 bottom -->\n`

  it.each<[string, number, unknown[]]>([
    ['table-insert-row-below', 1, ['middle', null]],
    ['table-insert-row-below', 2, [null, 'bottom']],
    ['table-insert-row-above', 2, ['middle', null]],
    // Above the first body row: that row's own, not the header's (YAZ-4173 12C).
    ['table-insert-row-above', 1, ['middle', null]],
  ])('%s on row %i', async (id, at, row) => {
    const { view } = await mountPage(SET)
    menuItem(view, at, 0, id).onSelect()
    const index = id === 'table-insert-row-below' ? at + 1 : at
    expect(valigns(view)[index]).toEqual(row)
  })

  it('Insert row above the first body row of a calendar table: the new time is Middle, as its column (YAZ-4173 12C)', async () => {
    const { view } = await mountPage('| Time | Plan |\n| - | - |\n| 9:00 am | x |\n| 9:30 am | y |\n\n<!-- table: valign A2:A3 middle, calendar 30m -->\n')
    menuItem(view, 1, 0, 'table-insert-row-above').onSelect()
    expect(valigns(view)[1]).toEqual(['middle', null])
  })

  it('Duplicate row keeps its own', async () => {
    const { view } = await mountPage(SET)
    menuItem(view, 2, 0, 'table-duplicate-rows').onSelect()
    expect(valigns(view)[3]).toEqual([null, 'bottom'])
  })

  it('Time slots: a new grid row takes the cells above it', async () => {
    const { view } = await mountPage('| Time | Plan |\n| - | - |\n| 9:00 am | x |\n| 10:00 am | y |\n\n<!-- table: valign A2:A3 middle B3 bottom, calendar 60m -->\n')
    setTimeSlots(view, firstTable(view).pos, 30)
    const texts: string[] = []
    firstTable(view).node.forEach((row) => texts.push(row.firstChild!.textContent))
    expect(texts).toEqual(['Time', '9:00 am', '9:30 am', '10:00 am'])
    expect(valigns(view)).toEqual([[null, null], ['middle', null], ['middle', null], ['middle', 'bottom']])
  })
})

describe('"/Calendar table" (D10)', () => {
  it('sets column A\'s body cells to middle', async () => {
    const { view } = await mountPage(TABLE)
    const table = calendarTableNode(view.state.schema, 'h:mm a')
    const column: unknown[] = []
    table.forEach((row) => column.push(row.firstChild!.attrs.valign))
    expect(column[0]).toBeNull()
    expect(column.slice(1).every((value) => value === 'middle')).toBe(true)
    expect(table.lastChild!.child(1).attrs.valign).toBeNull()
  })
})
