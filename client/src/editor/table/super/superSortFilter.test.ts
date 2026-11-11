/**
 * YAZ-4869 S4 (YAZ-4875) on the real editor: a view's Sort panel (several levels), its Filter panel (the operators of
 * the column's typed cells, the value written on Enter) and its summary row. Each pick writes the view only: the rows
 * of the table never move.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { undo } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdownForSave } from '../../createCrepe'
import { mountNote, unmountAll } from '../tableTestKit'
import { loadSuperTable } from '../tableZoomPill'
import { setActiveTab } from './superTables'

afterEach(unmountAll)

const TABLE = ['| Piece | Layer | Size |', '| - | - | - |', '| Roof | Top | 3 |', '| Wall | Middle | 12 |', '| Door | Middle | 2 |', '| Base | Ground | 1,200 |'].join('\n')
const COMMENT = (view: string) => `\n\n<!-- table: super, ${view} -->\n`

const tablePos = (view: EditorView): number => {
  let pos = -1
  view.state.doc.descendants((node, p) => {
    if (pos === -1 && node.type.name === 'table') pos = p
    return pos === -1
  })
  return pos
}
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

async function showView(view: string, name: string) {
  const m = await mountNote(TABLE + COMMENT(view))
  await loadSuperTable()
  setActiveTab(m.view, tablePos(m.view), name)
  await wait()
  return m
}

const firstColumn = (view: EditorView) => [...view.dom.querySelectorAll<HTMLElement>('.table-super-view tbody tr.super-view__row')].map((tr) => tr.querySelector('td')?.textContent)
const tool = (view: EditorView, name: string) => [...view.dom.querySelectorAll<HTMLButtonElement>('.table-super-bar__tool')].find((b) => b.getAttribute('aria-label') === name)!
const button = (view: EditorView, text: string) => [...view.dom.querySelectorAll<HTMLButtonElement>('.table-super-bar__panel button')].find((b) => b.textContent === text)!
/** Pick `option` in the picker named `label` (`ColumnPicker` and `DirectionPicker`). */
async function pick(view: EditorView, label: string, option: string) {
  view.dom.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click()
  await wait()
  ;[...view.dom.querySelectorAll<HTMLButtonElement>('.column-picker__option')].find((b) => b.textContent?.startsWith(option))!.click()
  await wait()
}
/** The table's own rows, as the file holds them. */
const fileRows = (markdown: string) => markdown.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Piece') && !l.startsWith('| -')).map((l) => l.split('|')[1]!.trim())

describe('YAZ-4875 S4: sort, filter and the summary row', () => {
  it('item 11: two sort levels, first wins; the file holds the view, its rows stay in table order', async () => {
    const { view, crepe } = await showView('view All', 'All')
    tool(view, 'Sort').click()
    await wait()
    button(view, 'Add sort').click()
    await wait()
    await pick(view, 'Sort 1 column', 'Layer')
    button(view, 'Add sort').click()
    await wait()
    await pick(view, 'Sort 2 direction', 'Z → A')
    const saved = getMarkdownForSave(crepe)
    expect(saved).toContain('<!-- table: super, view All sort Layer sort Piece desc -->')
    expect(firstColumn(view)).toEqual(['Base', 'Wall', 'Door', 'Roof'])
    expect(fileRows(saved)).toEqual(['Roof', 'Wall', 'Door', 'Base'])
  })

  it('YAZ-4869 round 2: on the base "Table" tab, Sort sorts the real rows (one ⌘Z); Group makes a new view with the rule and shows it', async () => {
    const { view, crepe } = await showView('view All', 'All')
    setActiveTab(view, tablePos(view), null)
    await wait()
    expect([...view.dom.querySelectorAll('.table-super-bar__tool')].map((b) => b.getAttribute('aria-label'))).toEqual(['Sort', 'Group', 'Filter'])
    tool(view, 'Sort').click()
    await wait()
    button(view, 'Add sort').click()
    await wait()
    await pick(view, 'Sort 1 column', 'Size')
    expect(fileRows(getMarkdownForSave(crepe))).toEqual(['Door', 'Roof', 'Wall', 'Base'])
    await pick(view, 'Sort 1 direction', 'Z → A')
    expect(fileRows(getMarkdownForSave(crepe))).toEqual(['Base', 'Wall', 'Roof', 'Door'])
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: super, view All -->')
    undo(view.state, view.dispatch)
    expect(fileRows(getMarkdownForSave(crepe))).toEqual(['Door', 'Roof', 'Wall', 'Base'])
    tool(view, 'Group').click()
    await wait()
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: super, view All, view "View 1" group Piece -->')
    expect(view.dom.querySelector('.table-super-bar .view-tab--active')?.textContent).toBe('View 1')
    expect(view.dom.querySelector('.table-super-bar__panel .super-menu--group')).not.toBeNull()
  })

  it('item 12: a filter on a number column offers the number operators; its value is written on Enter', async () => {
    const { view, crepe } = await showView('view Big', 'Big')
    tool(view, 'Filter').click()
    await wait()
    button(view, 'Add filter').click()
    await wait()
    await pick(view, 'Filter 1 column', 'Size')
    await pick(view, 'Filter 1 operator', '>')
    const box = view.dom.querySelector<HTMLInputElement>('[aria-label="Filter 1 value"]')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(box, '10')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    await wait()
    // No write per key: the file still holds the empty value, and a filter with no value hides no row.
    expect(getMarkdownForSave(crepe)).toContain('filter Size gt ""')
    expect(firstColumn(view)).toEqual(['Roof', 'Wall', 'Door', 'Base'])
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await wait()
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: super, view Big filter Size gt 10 -->')
    expect(firstColumn(view)).toEqual(['Wall', 'Base'])
  })

  it('item 13: the summary row sums a column, and a group header shows its group’s sum', async () => {
    const { view, crepe } = await showView('view Sum group Layer', 'Sum')
    const select = view.dom.querySelector<HTMLSelectElement>('[aria-label="Summary of Size"]')!
    select.value = 'sum'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await wait()
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: super, view Sum group Layer summary Size sum -->')
    expect(view.dom.querySelector('.super-view__summary-value')!.textContent).toBe('1217')
    const middle = [...view.dom.querySelectorAll('.super-view__group')].find((tr) => tr.querySelector('.view-group__value')?.textContent === 'Middle')!
    expect(middle.querySelector('.view-group__summary')!.textContent).toBe('Sum14')
  })
})
