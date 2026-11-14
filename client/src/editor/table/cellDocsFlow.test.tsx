/**
 * The one end-to-end flow of YAZ-3818's verification plan (YAZ-4262), on ONE real editor (`createCrepe`) with the
 * page's own menu host (`PageMenu`) mounted for the sheets, as `cellNoteGuard.test.tsx` does. Each step checks the
 * saved Markdown or the doc: `- ` in a cell makes a bullet; Tab makes it a child; a fold; a reload (`setMarkdown`, the
 * outside-change path) keeps the fold; a cell note gets bullets in its card; closing hides it; a reload keeps it under
 * its table and its mark in the cell; ⌘F on a word in it opens its card; Duplicate row › Copy with notes gives a new
 * label and a cloned note; Delete row asks, and Delete takes the row and its note; ⌘Z brings both back.
 */
import { afterEach, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Crepe } from '@milkdown/crepe'
import type { MenuAction, MenuItem } from '../../sidebar/menuSections'
import { getMarkdownForSave, setMarkdown } from '../createCrepe'
import { createFindChannel } from '../find/findChannel'
import { mount, pressKey, typeText, unmountAll } from '../marks/markTestKit'
import { PageMenu, pageMenuSections } from '../pageMenu'
import { getOutlineFoldKey } from '../outline/outlineFoldKeys'
import { OUTLINE_FOLDED_ATTR, OUTLINE_TOGGLE_CLASS } from '../outline/outlineFolding'
import { isCellNoteHidden, openCellNoteLabel } from './cellNotes'
import { cellPos } from './tableTestKit'

let root: Root | null = null
afterEach(async () => {
  act(() => root?.unmount())
  root = null
  document.body.querySelectorAll('.confirm-overlay').forEach((el) => el.remove())
  await unmountAll()
})

const START = ['Intro', '', '| Day    | Plan    |', '| ------ | ------- |', '| Monday | Flights |', '| Friday | free    |', '', 'End', ''].join('\n')

/** Typed text as the DOM input path gives it: an input rule's, else the plain insert. */
const type = (crepe: Crepe, view: EditorView, text: string) => {
  for (const ch of text) if (!typeText(crepe, ch)) view.dispatch(view.state.tr.insertText(ch))
}
/** The caret in the first text that holds `text`, `offset` characters into it. */
const caretAt = (view: EditorView, text: string, offset = 0) => {
  let pos = -1
  view.state.doc.descendants((node, at) => {
    if (pos < 0 && node.isText && node.text!.includes(text)) pos = at + node.text!.indexOf(text) + offset
    return pos < 0
  })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
}
/** ⌘.: a real keyboard reads its keyCode (`zoom.test.ts`). */
const cmdPeriod = (crepe: Crepe) =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const event = new KeyboardEvent('keydown', { key: '.', keyCode: 190, metaKey: true, bubbles: true, cancelable: true })
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  })
const toggle = (host: HTMLElement, label: string) => [...host.querySelectorAll<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)].find((b) => b.getAttribute('aria-label')?.endsWith(` ${label}`))!
const folded = (host: HTMLElement) => host.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`).length
const sheetText = () => document.querySelector('.confirm .confirm__text')?.textContent ?? null
const press = (label: string) => act(() => [...document.querySelectorAll<HTMLButtonElement>('.confirm button')].find((b) => b.textContent === label)!.click())
const menu = (view: EditorView, r: number, c: number, id: string) =>
  act(() =>
    pageMenuSections(view, null, () => {}, cellPos(view, r, c) + 2)
      .flat()
      .flatMap((item: MenuItem): MenuAction[] => (item.children === undefined ? [item] : item.children.flat()))
      .find((item) => item.id === `table-${id}`)!
      .onSelect(),
  )
/** The cell note's position in the doc, or -1. */
const pagePos = (view: EditorView, label: string) => {
  let pos = -1
  view.state.doc.forEach((node, at) => {
    if (node.type.name === 'cell_note' && node.attrs.label === label) pos = at
  })
  return pos
}

it('a cell doc and a cell note from start to end: bullet, child, fold, reload, note, find, duplicate, delete, undo (YAZ-4262)', async () => {
  // Editor.tsx's fold wiring: the reload seeds the folds from the keys the change callback last wrote.
  let foldKeys: readonly string[] = []
  const find = createFindChannel()
  const { crepe, root: host, view } = await mount(START, {
    folding: { seedCollapsedKeys: () => new Set(foldKeys), onCollapsedKeysChange: (keys) => (foldKeys = keys) },
    find,
    zoom: { title: () => 'Notes', onZoom: () => {} },
  })
  act(() => {
    const el = document.createElement('div')
    document.body.append(el)
    root = createRoot(el)
    root.render(<PageMenu view={view} />)
  })

  // 1. `- ` at the start of a cell makes a bullet; Enter a second one; Tab makes it a child.
  caretAt(view, 'Flights')
  type(crepe, view, '- ')
  expect(view.state.doc.nodeAt(cellPos(view, 1, 1))!.firstChild!.type.name).toBe('bullet_list')
  caretAt(view, 'Flights', 'Flights'.length)
  pressKey(crepe, 'Enter')
  type(crepe, view, 'Gate 4')
  expect(pressKey(crepe, 'Tab')).toBe(true)
  let saved = getMarkdownForSave(crepe)
  expect(saved).toContain('<ul><li>Flights<ul><li>Gate 4</li></ul></li></ul>')

  // 2. Fold it; a reload keeps the fold.
  act(() => toggle(host, 'Flights').click())
  expect(foldKeys).toEqual([getOutlineFoldKey('Flights', 0)])
  expect(folded(host)).toBe(1)
  setMarkdown(crepe, saved)
  expect(getMarkdownForSave(crepe)).toBe(saved)
  expect(toggle(host, 'Flights').getAttribute('aria-expanded')).toBe('false')
  expect(folded(host)).toBe(1)

  // 3. ⌘. on the Monday cell makes its cell note and opens the card; bullets typed there; Esc closes (hidden).
  caretAt(view, 'Monday', 'Monday'.length)
  expect(cmdPeriod(crepe)).toBe(true)
  expect(openCellNoteLabel(view.state)).toBe('cell-1')
  type(crepe, view, '- pack')
  pressKey(crepe, 'Enter')
  type(crepe, view, 'passport')
  expect(pressKey(crepe, 'Escape')).toBe(true)
  expect(openCellNoteLabel(view.state)).toBeNull()
  expect(isCellNoteHidden(view.state, pagePos(view, 'cell-1'))).toBe(true)
  saved = getMarkdownForSave(crepe)
  expect(saved).toContain('| Monday[^cell-1] |')
  // The note right under its table, before the next block.
  expect(saved.indexOf('| Friday')).toBeLessThan(saved.indexOf('[^cell-1]:'))
  expect(saved.indexOf('[^cell-1]:')).toBeLessThan(saved.indexOf('End'))
  expect(saved).toMatch(/\[\^cell-1\]: [*-] pack\n\s+[*-] passport\n/)

  // 4. A reload keeps the note, hidden, its mark, and the fold.
  setMarkdown(crepe, saved)
  expect(getMarkdownForSave(crepe)).toBe(saved)
  expect(isCellNoteHidden(view.state, pagePos(view, 'cell-1'))).toBe(true)
  expect(folded(host)).toBe(1)

  // 5. ⌘F on a word in the note: the step onto it opens the card; closing find leaves the caret in it.
  find.open()
  find.setQuery('passport')
  expect(find.getState()).toMatchObject({ total: 1, activeIndex: 0 })
  expect(openCellNoteLabel(view.state)).toBe('cell-1')
  find.close()
  expect(view.state.selection.$from.node(1).type.name).toBe('cell_note')
  pressKey(crepe, 'Escape')
  expect(openCellNoteLabel(view.state)).toBeNull()

  // 6. Duplicate row › Copy with notes: the copy's mark gets a new label and a cloned note; the fold stays.
  menu(view, 1, 0, 'duplicate-rows')
  expect(sheetText()).toBe('This row has 1 cell note.')
  press('Copy with notes')
  const duplicated = getMarkdownForSave(crepe)
  expect(duplicated).toContain('| Monday[^cell-2] |')
  expect(duplicated).toMatch(/\[\^cell-2\]: [*-] pack\n\s+[*-] passport\n/)
  expect(duplicated.match(/<ul><li>Flights<ul><li>Gate 4<\/li><\/ul><\/li><\/ul>/g)).toHaveLength(2)
  expect(toggle(host, 'Flights').getAttribute('aria-expanded')).toBe('false')

  // 7. Delete row asks; Delete takes the row and its cell note in one step.
  menu(view, 1, 0, 'delete-row')
  expect(sheetText()).toBe('Delete this row and its cell note?')
  press('Delete')
  const deleted = getMarkdownForSave(crepe)
  expect(deleted).not.toContain('cell-1')
  expect(deleted).toContain('| Monday[^cell-2] |')
  expect(deleted.match(/Monday/g)).toHaveLength(1)

  // 8. ⌘Z brings the row and its note back.
  expect(pressKey(crepe, 'z', { mod: true })).toBe(true)
  expect(getMarkdownForSave(crepe)).toBe(duplicated)
})
