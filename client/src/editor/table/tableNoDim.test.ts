/**
 * "Don't dim this row" on a calendar table (YAZ-4796 demo: "a todo list on the second row and i want the ability for it
 * to not be dim"), on real editors: the right-click item (only on a calendar table's body rows), `nodim` on the row's
 * cells, saved as `nodim <row>` in the table comment, the row never gets the past look, "Dim this row again" undoes it,
 * one ⌘Z each.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { undo } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MenuAction, MenuItem, MenuSection } from '../../sidebar/menuSections'
import { getMarkdownForSave } from '../createCrepe'
import { noteMenuSections } from '../noteMenu'
import { mount, unmountAll } from '../marks/markTestKit'
import { formatTableComment, parseTableComment, plainTable } from './tableComment'
import { cellPos } from './tableTestKit'

afterEach(async () => {
  await unmountAll()
  vi.useRealTimers()
})

/** A to-do row above the times, then 9, 10 and 11 am. */
const NOTE = (part = 'calendar 60m') => ['| Time | Plan |', '| --- | --- |', '| To-do | milk |', '| 9:00 am | a |', '| 10:00 am | b |', '| 11:00 am | c |'].join('\n') + `\n\n<!-- table: ${part} -->\n`
const PLAIN = '| Time | Plan |\n| --- | --- |\n| To-do | milk |\n| 9:00 am | a |\n'

/** Mount at a wall-clock time today: only `Date` is fake, so the editor's own timers run. */
async function mountAt(hours: number, minutes: number, markdown: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 2, hours, minutes, 0))
  return mount(markdown)
}
const rowsOf = (view: EditorView) => [...view.dom.querySelectorAll<HTMLTableRowElement>('tbody[data-content-dom] > tr')]
const pastRows = (view: EditorView) => rowsOf(view).flatMap((row, i) => (row.classList.contains('table-past-row') ? [i] : []))
const all = (sections: MenuSection[]): MenuAction[] => sections.flat().flatMap((item: MenuItem) => (item.children === undefined ? [item] : item.children.flat()))
const itemAt = (view: EditorView, r: number, id: string): MenuAction | undefined => all(noteMenuSections(view, null, vi.fn(), cellPos(view, r, 0) + 2)).find((i) => i.id === id)

describe('YAZ-4796 demo: the comment part', () => {
  it('YAZ-4796 demo: `nodim 2` reads into the 0-based body rows and writes back the same, before the calendar part', () => {
    const parsed = parseTableComment('<!-- table: nodim 2, calendar 60m -->')!
    expect(parsed.nodim).toEqual([1])
    expect(formatTableComment(parsed)).toBe('<!-- table: nodim 2, calendar 60m -->')
  })

  it('YAZ-4796 demo: runs of rows read and write like fold: `nodim 2-3 5`', () => {
    const parsed = parseTableComment('<!-- table: nodim 2-3 5 -->')
    expect(parsed?.nodim).toEqual([1, 2, 4])
    expect(formatTableComment({ ...plainTable(), nodim: [1, 2, 4] })).toBe('<!-- table: nodim 2-3 5 -->')
  })
})

describe('YAZ-4796 demo: a kept row never dims', () => {
  it('YAZ-4796 demo: at noon every body row is past; with the To-do row kept out, it alone stays full colour', async () => {
    const { view } = await mountAt(12, 30, NOTE())
    expect(pastRows(view)).toEqual([1, 2, 3, 4])
    const { view: kept } = await mountAt(12, 30, NOTE('nodim 2, calendar 60m'))
    expect(pastRows(kept)).toEqual([2, 3, 4])
  })

  it("YAZ-4796 demo: \"Don't dim this row\" on the To-do row keeps it out, saves `nodim 2`, and one ⌘Z gives it back", async () => {
    const { crepe, view } = await mountAt(12, 30, NOTE())
    const before = getMarkdownForSave(crepe)
    const keep = itemAt(view, 1, 'table-nodim')
    expect(keep?.label).toBe("Don't dim this row")
    keep!.onSelect()
    expect(pastRows(view)).toEqual([2, 3, 4])
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: nodim 2, calendar 60m -->')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
    expect(pastRows(view)).toEqual([1, 2, 3, 4])
  })

  it('YAZ-4796 demo: on a kept row the item is "Dim this row again", and it takes `nodim` away', async () => {
    const { crepe, view } = await mountAt(12, 30, NOTE('nodim 2, calendar 60m'))
    expect(itemAt(view, 1, 'table-nodim')).toBeUndefined()
    const again = itemAt(view, 1, 'table-dim')
    expect(again?.label).toBe('Dim this row again')
    again!.onSelect()
    expect(pastRows(view)).toEqual([1, 2, 3, 4])
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: calendar 60m -->')
    expect(getMarkdownForSave(crepe)).not.toContain('nodim')
  })

  it('YAZ-4796 demo: the mark rides on the row: a row inserted above moves it to row 3', async () => {
    const { crepe, view } = await mountAt(12, 30, NOTE('nodim 2, calendar 60m'))
    itemAt(view, 1, 'table-insert-row-above')!.onSelect()
    expect(getMarkdownForSave(crepe)).toContain('nodim 3')
  })
})

describe('YAZ-4796 demo: only a calendar table offers it', () => {
  it("YAZ-4796 demo: a plain table has no \"Don't dim\" item; the header row of a calendar table has none either", async () => {
    const { view } = await mount(PLAIN)
    expect(itemAt(view, 1, 'table-nodim')).toBeUndefined()
    const { view: cal } = await mountAt(12, 30, NOTE())
    expect(itemAt(cal, 0, 'table-nodim')).toBeUndefined()
  })
})
