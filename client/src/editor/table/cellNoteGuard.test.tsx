/**
 * Delete, duplicate, copy and paste with cell notes (YAZ-4206: D13, D16, D17, D18), on real editors with the note's
 * own menu host (`NoteMenu`) mounted, so each ask shows the app's sheet.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { undo } from '@milkdown/kit/prose/history'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { MenuAction, MenuItem } from '../../sidebar/menuSections'
import { getMarkdownForSave } from '../createCrepe'
import { mount, pressKey, unmountAll } from '../marks/markTestKit'
import { NoteMenu, noteMenuSections } from '../noteMenu'
import { CELL_NOTES_ATTR, pasteCellsOnly } from './cellNoteClipboard'
import { cellPos } from './tableTestKit'

let root: Root | null = null
afterEach(async () => {
  act(() => root?.unmount())
  root = null
  document.body.querySelectorAll('.confirm-overlay').forEach((el) => el.remove())
  await unmountAll()
})

/** A table with two cell notes in the Monday row and one in the Friday row, padded as the save pads them. */
const row = (a: string, b: string) => `| ${a.padEnd(18)} | ${b.padEnd(18)} |`
const NOTES = [
  row('Day', 'Plan'),
  row('------------------', '------------------'),
  row('Monday[^cell-1]', 'Flights[^cell-2]'),
  row('Tuesday', 'Museum'),
  row('Friday', 'free[^cell-3]'),
  '',
  '[^cell-1]: one',
  '',
  '[^cell-2]: two',
  '',
  '[^cell-3]: three',
  '',
  'End',
  '',
].join('\n')

async function open(markdown = NOTES) {
  const mounted = await mount(markdown)
  const host = document.createElement('div')
  document.body.append(host)
  act(() => {
    root = createRoot(host)
    root.render(<NoteMenu view={mounted.view} />)
  })
  return mounted
}

const sheet = () => document.querySelector('.confirm')
const sheetText = () => sheet()?.querySelector('.confirm__text')?.textContent ?? null
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.confirm button')].find((b) => b.textContent === label)!
const press = (label: string) => act(() => button(label).click())
const items = (view: EditorView, r: number, c: number): MenuAction[] =>
  noteMenuSections(view, null, vi.fn(), cellPos(view, r, c) + 2)
    .flat()
    .flatMap((item: MenuItem) => (item.children === undefined ? [item] : item.children.flat()))
const menu = (view: EditorView, r: number, c: number, id: string) => act(() => items(view, r, c).find((item) => item.id === `table-${id}`)!.onSelect())
const selectCells = (view: EditorView, from: [number, number], to: [number, number]) =>
  view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, ...from), cellPos(view, ...to))))
const labels = (markdown: string) => [...markdown.matchAll(/\[\^(cell-\d+)\]:/g)].map((m) => m[1])
const marks = (markdown: string) => [...markdown.matchAll(/\[\^(cell-\d+)\](?!:)/g)].map((m) => m[1])

describe('D16: a delete that would take a cell note asks first', () => {
  it('Delete row: the sheet names the count; Cancel changes nothing; Delete takes the row and its notes in one step; ⌘Z brings both back', async () => {
    const { crepe, view } = await open()
    const before = getMarkdownForSave(crepe)
    menu(view, 1, 0, 'delete-row')
    expect(sheetText()).toBe('Delete this row and its 2 cell notes?')
    expect(button('Delete').className).toContain('confirm__btn--danger')
    press('Cancel')
    expect(sheet()).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe(before)
    menu(view, 1, 0, 'delete-row')
    press('Delete')
    const after = getMarkdownForSave(crepe)
    expect(after).not.toContain('Monday')
    expect(labels(after)).toEqual(['cell-3'])
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('Delete column, Clear cells (menu and toolbar keys) with notes ask; with none they run at once', async () => {
    const { crepe, view } = await open()
    const before = getMarkdownForSave(crepe)
    menu(view, 1, 1, 'delete-col')
    expect(sheetText()).toBe('Delete this column and its 2 cell notes?')
    press('Cancel')
    selectCells(view, [1, 0], [2, 1])
    menu(view, 1, 0, 'clear')
    expect(sheetText()).toBe('Clear these cells and their 2 cell notes?')
    press('Delete')
    expect(labels(getMarkdownForSave(crepe))).toEqual(['cell-3'])
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
    // No note in the Tuesday row: no sheet.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 2, 0) + 2)))
    menu(view, 2, 0, 'delete-row')
    expect(sheet()).toBeNull()
    expect(getMarkdownForSave(crepe)).not.toContain('Tuesday')
  })

  it('Delete and Backspace on selected cells ask; Delete on a whole table asks; Cut never asks', async () => {
    const { crepe, view } = await open()
    selectCells(view, [3, 1], [3, 1])
    let handled = false
    act(() => void (handled = pressKey(crepe, 'Delete')))
    expect(handled).toBe(true)
    expect(sheetText()).toBe('Clear this cell and its cell note?')
    press('Delete')
    expect(labels(getMarkdownForSave(crepe))).toEqual(['cell-1', 'cell-2'])
    undo(view.state, view.dispatch)
    // Cells with no note: the key is tableEditing's own, with no sheet.
    selectCells(view, [2, 0], [2, 1])
    act(() => void pressKey(crepe, 'Backspace'))
    expect(sheet()).toBeNull()
    // A whole table.
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)))
    act(() => void (handled = pressKey(crepe, 'Backspace')))
    expect(handled).toBe(true)
    expect(sheetText()).toBe('Delete this table and its 3 cell notes?')
    press('Delete')
    expect(getMarkdownForSave(crepe)).toBe('End\n')
  })
})

describe('D17: a duplicate asks how', () => {
  it('Copy with notes: new labels and cloned notes, never one note for two cells; Cells only: no marks', async () => {
    const { crepe, view } = await open()
    const before = getMarkdownForSave(crepe)
    menu(view, 1, 0, 'duplicate-rows')
    expect(sheetText()).toBe('This row has 2 cell notes.')
    press('Copy with notes')
    let saved = getMarkdownForSave(crepe)
    expect(marks(saved)).toEqual(['cell-1', 'cell-2', 'cell-4', 'cell-5', 'cell-3'])
    expect(labels(saved).sort()).toEqual(['cell-1', 'cell-2', 'cell-3', 'cell-4', 'cell-5'])
    expect(saved).toContain('[^cell-4]: one')
    undo(view.state, view.dispatch)
    menu(view, 1, 0, 'duplicate-rows')
    press('Cells only')
    saved = getMarkdownForSave(crepe)
    expect(marks(saved)).toEqual(['cell-1', 'cell-2', 'cell-3'])
    expect(saved.match(/Monday/g)).toHaveLength(2)
    // Esc is Cancel: nothing.
    undo(view.state, view.dispatch)
    menu(view, 1, 0, 'duplicate-rows')
    press('Cancel')
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('Duplicate column asks the same; a row with no note duplicates at once', async () => {
    const { crepe, view } = await open()
    menu(view, 1, 1, 'duplicate-cols')
    expect(sheetText()).toBe('This column has 2 cell notes.')
    press('Copy with notes')
    expect(labels(getMarkdownForSave(crepe)).sort()).toEqual(['cell-1', 'cell-2', 'cell-3', 'cell-4', 'cell-5'])
    undo(view.state, view.dispatch)
    menu(view, 2, 0, 'duplicate-rows')
    expect(sheet()).toBeNull()
    expect(getMarkdownForSave(crepe).match(/Tuesday/g)).toHaveLength(2)
  })
})

/** What a copy of the current selection puts on the clipboard. */
const copy = (view: EditorView) => {
  const { dom, text } = view.serializeForClipboard(view.state.selection.content())
  return { html: dom.innerHTML, text, notes: dom.querySelector(`[${CELL_NOTES_ATTR}]`)?.getAttribute(CELL_NOTES_ATTR) ?? null }
}
const clipboard = (html: string, text: string) => ({ clipboardData: { getData: (t: string) => (t === 'text/html' ? html : t === 'text/plain' ? text : '') }, preventDefault() {} }) as unknown as ClipboardEvent
const caretIn = (view: EditorView, r: number, c: number) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, r, c) + 2)))

describe('D13: copy and paste carry cell notes; D18: Paste as › Cells only does not', () => {
  it('the copy holds the notes in one attribute only: no note words in its text or its HTML text', async () => {
    const { view } = await open()
    selectCells(view, [1, 0], [1, 1])
    const out = copy(view)
    expect(out.notes).toContain('[^cell-1]: one')
    expect(out.notes).toContain('[^cell-2]: two')
    expect(out.text).not.toMatch(/one|two/)
    const template = document.createElement('template')
    template.innerHTML = out.html
    expect(template.content.textContent).not.toMatch(/\bone\b|\btwo\b/)
  })

  it('a paste into another table of the same note: the notes come with new labels', async () => {
    const { crepe, view } = await open(`${NOTES}\n| a | b |\n| - | - |\n| x | y |\n`)
    selectCells(view, [1, 0], [1, 1])
    const out = copy(view)
    // The second table's body cell.
    let second = -1
    view.state.doc.descendants((node, pos) => {
      if (second < 0 && node.type.name === 'table_cell' && node.textContent === 'x') second = pos
      return second < 0
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, second + 2)))
    view.pasteHTML(out.html, clipboard(out.html, out.text))
    const saved = getMarkdownForSave(crepe)
    expect(labels(saved).sort()).toEqual(['cell-1', 'cell-2', 'cell-3', 'cell-4', 'cell-5'])
    expect(saved).toContain('[^cell-4]: one')
    expect(saved).toContain('[^cell-5]: two')
  })

  it('a paste into a second editor keeps the labels it can; Cells only brings no marks and no notes; HTML with marks and no notes drops them', async () => {
    const first = await open()
    selectCells(first.view, [1, 0], [1, 1])
    const out = copy(first.view)
    const second = await mount('| h1 | h2 |\n| -- | -- |\n| a  | b  |\n')
    caretIn(second.view, 1, 0)
    second.view.pasteHTML(out.html, clipboard(out.html, out.text))
    const saved = getMarkdownForSave(second.crepe)
    expect(labels(saved)).toEqual(['cell-1', 'cell-2'])
    expect(saved).toContain('[^cell-1]: one')
    const third = await mount('| h1 | h2 |\n| -- | -- |\n| a  | b  |\n')
    caretIn(third.view, 1, 0)
    pasteCellsOnly(third.view, out.html, out.text)
    expect(getMarkdownForSave(third.crepe)).not.toContain('cell-')
    expect(getMarkdownForSave(third.crepe)).toContain('Monday')
    const fourth = await mount('| h1 | h2 |\n| -- | -- |\n| a  | b  |\n')
    caretIn(fourth.view, 1, 0)
    const template = document.createElement('template')
    template.innerHTML = out.html
    template.content.querySelectorAll(`[${CELL_NOTES_ATTR}]`).forEach((el) => el.removeAttribute(CELL_NOTES_ATTR))
    const bare = template.innerHTML
    expect(bare).not.toContain(CELL_NOTES_ATTR)
    fourth.view.pasteHTML(bare, clipboard(bare, out.text))
    expect(getMarkdownForSave(fourth.crepe)).not.toContain('cell-')
  })

  it('Cells only is off outside a table, on in one', async () => {
    const { view } = await open(`Text\n\n${NOTES}`)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    const pasteCells = () => noteMenuSections(view, null, vi.fn()).flat().flatMap((item: MenuItem) => (item.children === undefined ? [item] : item.children.flat())).find((item) => item.id === 'paste-cells')!
    expect(pasteCells().disabled).toBe(true)
    caretIn(view, 1, 0)
    expect(pasteCells().disabled).toBe(false)
  })
})
