/**
 * YAZ-4869 S1 (YAZ-4872) on the real editor: the six-dot menu turns a table into a Super table and back (one ⌘Z each),
 * the file gets `super` and nothing else, "Turn into Super table" is off while a body cell spans rows or Time slots are
 * on, a Super table has no Time slots and no merge across rows, and the slash menu's "Table" follows Settings.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { undo } from '@milkdown/kit/prose/history'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { DEFAULT_SETTINGS } from '@shared/types'
import { storage } from '../../../lib/storage'
import { getMarkdownForSave } from '../../createCrepe'
import { mergeRect } from '../tableMerge'
import { cellPos, mountPage, unmountAll } from '../tableTestKit'
import { newTableNode } from './superTables'

afterEach(unmountAll)

const SMALL = '| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n'

const firstTable = (view: EditorView): number => {
  let pos = -1
  view.state.doc.descendants((node, p) => {
    if (pos === -1 && node.type.name === 'table') pos = p
    return pos === -1
  })
  return pos
}

/** The table's six-dot menu, opened as `tableRows.test.ts` opens it. */
async function openMenu(markdown: string) {
  const m = await mountPage(markdown)
  const handle = document.createElement('div')
  handle.className = 'milkdown-block-handle'
  const item = document.createElement('div')
  item.className = 'operation-item'
  handle.appendChild(item)
  m.view.dom.parentElement!.appendChild(handle)
  handle.getBoundingClientRect = () => ({ right: 0 }) as DOMRect
  const pos = firstTable(m.view)
  m.view.posAtCoords = () => ({ pos: pos + 1, inside: pos })
  const open = () => item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
  open()
  return { ...m, open }
}

const rows = (view: EditorView) =>
  [...view.dom.parentElement!.querySelectorAll<HTMLButtonElement>('.ctx-menu--editor .ctx-menu__item')].map((b) => `${b.textContent}${b.disabled ? ':off' : ''}${b.dataset.hint ? `:${b.dataset.hint}` : ''}`)
const click = (view: EditorView, label: string) =>
  [...view.dom.parentElement!.querySelectorAll<HTMLButtonElement>('.ctx-menu--editor .ctx-menu__item')].find((b) => b.textContent === label)!.click()

describe('YAZ-4872 S1: Super table on and off', () => {
  it('"Turn into Super table" writes `super` only; "Turn back" removes it and every view; each is one ⌘Z; the rows never change', async () => {
    const { view, crepe, open } = await openMenu(`${SMALL}\n<!-- table: stripes -->\n`)
    expect(rows(view)).toContain('Turn into Super table')
    click(view, 'Turn into Super table')
    expect(getMarkdownForSave(crepe)).toBe(`${SMALL}\n<!-- table: stripes, super -->\n`)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(`${SMALL}\n<!-- table: stripes -->\n`)

    const pos = firstTable(view)
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...view.state.doc.nodeAt(pos)!.attrs, superTable: true, views: [{ name: 'By a' }], unknownParts: [{ after: 'view', text: 'view B group' }] }))
    expect(getMarkdownForSave(crepe)).toBe(`${SMALL}\n<!-- table: stripes, super, view "By a", view B group -->\n`)
    open()
    expect(rows(view)).toContain('Turn back into a plain table')
    expect(rows(view)).toContain('Time slots: off in a Super table:off')
    click(view, 'Turn back into a plain table')
    expect(getMarkdownForSave(crepe)).toBe(`${SMALL}\n<!-- table: stripes -->\n`)
  })

  it('item 17: off while a body cell spans rows, with the reason; item 18: off while Time slots are on', async () => {
    const merged = await openMenu('| a | b |\n| - | - |\n| 1 | 2 |\n|  | 4 |\n\n<!-- table: merge A2:A3 -->\n')
    expect(rows(merged.view)).toContain('Turn into Super table:off:A cell spans rows')
    await unmountAll()
    const slots = await openMenu('| Time | Plan |\n| - | - |\n| 9:00 | x |\n\n<!-- table: calendar 30m -->\n')
    expect(rows(slots.view)).toContain('Turn into Super table:off:Time slots are on')
  })

  it('item 17: in a Super table, cells merge in one row but never across rows', async () => {
    const { view } = await mountPage(`${SMALL}\n<!-- table: super -->\n`)
    const select = (a: [number, number], b: [number, number]) => CellSelection.create(view.state.doc, cellPos(view, ...a), cellPos(view, ...b))
    expect(mergeRect(select([1, 0], [1, 1]))).not.toBeNull()
    expect(mergeRect(select([1, 0], [2, 0]))).toBeNull()
  })

  it('item 22: Settings › Tables › New tables start as: plain by default; Super makes the slash menu’s table a Super table', async () => {
    expect(DEFAULT_SETTINGS.tableNewStyle).toBe('plain')
    const { view } = await mountPage(SMALL)
    const table = view.state.doc.nodeAt(firstTable(view))!
    expect(newTableNode(table).attrs.superTable).toBe(false)
    const spy = vi.spyOn(storage, 'getSettings').mockReturnValue({ ...storage.getSettings(), tableNewStyle: 'super' })
    expect(newTableNode(table).attrs.superTable).toBe(true)
    spy.mockRestore()
  })
})
