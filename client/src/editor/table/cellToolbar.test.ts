/**
 * The cell toolbar (YAZ-3768, YAZ-3696 D8) on the real editor in jsdom: it shows over a
 * CellSelection of two or more cells, and hides on a single caret, on one cell, in a read-only
 * note and while a mouse drag selects. Each button acts on every selected cell, in one undo step.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdownForSave } from '../createCrepe'
import { cellPos, mountNote as mount, unmountAll } from './tableTestKit'

afterEach(unmountAll)

const TABLE = '| h1 | h2 |\n| -- | -- |\n| a  | b  |\n| c  | d  |\n'
/** The toolbar's throttle (20 ms) has run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 40))
const toolbarOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.cell-toolbar')
const shown = (view: EditorView) => toolbarOf(view)?.dataset.show === 'true'
const button = (view: EditorView, label: string) => {
  const found = toolbarOf(view)!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (found === null) throw new Error(`no button ${label}`)
  return found
}
async function select(view: EditorView, from: [number, number], to: [number, number]) {
  view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(view, ...from), cellPos(view, ...to))))
  await settle()
}
/** The colour of the bar under the icon of the button `label`. */
const barOf = (view: EditorView, label: string) => button(view, label).querySelector<SVGElement>('.cell-toolbar__bar')!.style.fill
/** The palette that the ▾ button `arrow` opens and controls. */
const paletteOf = (view: EditorView, arrow: string) => document.getElementById(button(view, arrow).getAttribute('aria-controls')!)!
const isOpen = (view: EditorView, arrow: string) => !paletteOf(view, arrow).hidden && button(view, arrow).getAttribute('aria-expanded') === 'true'
/** Open the palette of `arrow` and click its item `label`. */
function pick(view: EditorView, arrow: string, label: string) {
  button(view, arrow).click()
  const item = paletteOf(view, arrow).querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (item === null) throw new Error(`no palette item ${label}`)
  item.click()
}
const cellAttr = (view: EditorView, row: number, col: number, attr: string) => view.state.doc.nodeAt(cellPos(view, row, col))!.attrs[attr]

describe('when the toolbar shows', () => {
  it('over two or more cells, with every item named in plain words, left to right', async () => {
    const { view } = await mount(TABLE)
    await select(view, [1, 0], [2, 1])
    expect(shown(view)).toBe(true)
    const items = [...toolbarOf(view)!.querySelectorAll(':scope > *, :scope > .cell-toolbar__split > button')]
      .filter((el) => !el.classList.contains('cell-toolbar__split'))
      .map((el) => (el.tagName === 'BUTTON' ? el.getAttribute('aria-label') : el.className))
    expect(items).toEqual([
      'Fill yellow', 'Fill colours', 'Red text', 'Text colours', 'divider',
      'Bold', 'Italic', 'Strikethrough', 'divider',
      'Align left', 'Align center', 'Align right', 'divider',
      'Clear cells',
    ])
    for (const b of toolbarOf(view)!.querySelectorAll('button')) expect(b.title).toBe(b.getAttribute('aria-label'))
  })

  it('hides on a single caret and on one selected cell', async () => {
    const { view } = await mount(TABLE)
    await select(view, [1, 0], [2, 1])
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 1, 0) + 2)))
    await settle()
    expect(shown(view)).toBe(false)
    await select(view, [1, 0], [1, 0])
    expect(shown(view)).toBe(false)
  })

  it('hides in a read-only note', async () => {
    const { view } = await mount(TABLE)
    view.setProps({ editable: () => false })
    await select(view, [1, 0], [2, 1])
    expect(shown(view)).toBe(false)
  })

  it('hides while a mouse drag selects, and shows on mouseup', async () => {
    const { view } = await mount(TABLE)
    view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    await select(view, [1, 0], [2, 1])
    expect(shown(view)).toBe(false)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    await settle()
    expect(shown(view)).toBe(true)
  })
})

// The last colours live in the module for the window, so this block runs first in the file: it reads the start values.
describe('the Fill and Text buttons and their palettes (YAZ-3803, demo round 1 decisions 1 and 12)', () => {
  it('start with yellow and red; the icon applies the last colour, in one undo step', async () => {
    const { crepe, view } = await mount(TABLE)
    const before = getMarkdownForSave(crepe)
    await select(view, [1, 0], [2, 1])
    expect(barOf(view, 'Fill yellow')).toBe('var(--table-fill-solid-yellow)')
    expect(barOf(view, 'Red text')).toBe('var(--table-text-red)')
    button(view, 'Fill yellow').click()
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: fill A2:B3 yellow -->\n`)
    button(view, 'Red text').click()
    expect(getMarkdownForSave(crepe)).toContain('color A2:B3 red')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: fill A2:B3 yellow -->\n`)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('each palette lists its clear item first, labeled, then solid swatches', async () => {
    const { view } = await mount(TABLE)
    await select(view, [1, 0], [2, 1])
    const items = (arrow: string) => [...paletteOf(view, arrow).querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
    expect(items('Fill colours')).toEqual(['No fill', 'Yellow', 'Green', 'Blue', 'Pink'])
    expect(items('Text colours')).toEqual(['Default colour', 'Red', 'Orange', 'Green', 'Blue', 'Grey'])
    expect(paletteOf(view, 'Fill colours').querySelector('button')!.textContent).toBe('No fill')
    expect(paletteOf(view, 'Text colours').querySelector('button')!.textContent).toBe('Default colour')
    const swatch = (arrow: string, label: string) =>
      paletteOf(view, arrow).querySelector<HTMLElement>(`button[aria-label="${label}"] .cell-toolbar__swatch`)!.style.background
    expect(swatch('Fill colours', 'Pink')).toBe('var(--table-fill-solid-pink)')
    expect(swatch('Text colours', 'Grey')).toBe('var(--table-text-grey)')
  })

  it('a palette item applies its colour and becomes the last colour; the clear items do not change it', async () => {
    const { crepe, view } = await mount(TABLE)
    const before = getMarkdownForSave(crepe)
    await select(view, [1, 0], [2, 1])
    pick(view, 'Fill colours', 'Green')
    expect(isOpen(view, 'Fill colours')).toBe(false)
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: fill A2:B3 green -->\n`)
    expect(barOf(view, 'Fill green')).toBe('var(--table-fill-solid-green)')
    pick(view, 'Fill colours', 'No fill')
    expect(getMarkdownForSave(crepe)).toBe(before)
    button(view, 'Fill green').click()
    expect(getMarkdownForSave(crepe)).toContain('fill A2:B3 green')
    pick(view, 'Text colours', 'Blue')
    expect(barOf(view, 'Blue text')).toBe('var(--table-text-blue)')
    pick(view, 'Text colours', 'Default colour')
    expect(getMarkdownForSave(crepe)).not.toContain('color')
    expect(barOf(view, 'Blue text')).toBe('var(--table-text-blue)')
    // One undo step per click: Default colour, Blue, Fill green, No fill, Green.
    for (let i = 0; i < 5; i++) undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('one palette open at a time; it closes on Escape, on a second click of ▾ and when the toolbar hides', async () => {
    const { view } = await mount(TABLE)
    await select(view, [1, 0], [2, 1])
    button(view, 'Fill colours').click()
    expect(isOpen(view, 'Fill colours')).toBe(true)
    button(view, 'Text colours').click()
    expect(isOpen(view, 'Fill colours')).toBe(false)
    expect(isOpen(view, 'Text colours')).toBe(true)
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    view.dom.dispatchEvent(escape)
    expect(isOpen(view, 'Text colours')).toBe(false)
    expect(escape.defaultPrevented).toBe(true)
    expect(view.state.selection).toBeInstanceOf(CellSelection)
    button(view, 'Fill colours').click()
    button(view, 'Fill colours').click()
    expect(isOpen(view, 'Fill colours')).toBe(false)
    button(view, 'Fill colours').click()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos(view, 1, 0) + 2)))
    await settle()
    expect(isOpen(view, 'Fill colours')).toBe(false)
  })
})

describe('each button acts on every selected cell, in one undo step', () => {
  it('Fill and No fill', async () => {
    const { crepe, view } = await mount(TABLE)
    const before = getMarkdownForSave(crepe)
    await select(view, [1, 0], [2, 1])
    pick(view, 'Fill colours', 'Blue')
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: fill A2:B3 blue -->\n`)
    expect(view.state.selection).toBeInstanceOf(CellSelection)
    pick(view, 'Fill colours', 'No fill')
    expect(getMarkdownForSave(crepe)).toBe(before)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toContain('fill A2:B3 blue')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('Text colour and Default text colour', async () => {
    const { crepe, view } = await mount(TABLE)
    const before = getMarkdownForSave(crepe)
    await select(view, [0, 0], [1, 1])
    pick(view, 'Text colours', 'Red')
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: color A1:B2 red -->\n`)
    pick(view, 'Text colours', 'Default colour')
    expect(getMarkdownForSave(crepe)).toBe(before)
    undo(view.state, view.dispatch)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it.each([
    ['Bold', '**'],
    ['Italic', '*'],
    ['Strikethrough', '~~'],
  ])('%s: on when any cell lacks it, off when all have it', async (label, md) => {
    const { crepe, view } = await mount(`| h1 | h2 |\n| -- | -- |\n| ${md}a${md} | b |\n| c | d |\n`)
    const before = getMarkdownForSave(crepe)
    await select(view, [1, 0], [2, 1])
    button(view, label).click()
    const on = getMarkdownForSave(crepe)
    for (const text of ['a', 'b', 'c', 'd']) expect(on).toContain(`${md}${text}${md}`)
    expect(on).not.toContain(`${md}h1${md}`)
    button(view, label).click()
    const off = getMarkdownForSave(crepe)
    for (const text of ['a', 'b', 'c', 'd']) expect(off).not.toContain(`${md}${text}${md}`)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(on)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('Align sets the alignment of each selected column, every row of it', async () => {
    const { crepe, view } = await mount('| h1 | h2 | h3 |\n| -- | -- | -- |\n| a | b | c |\n| d | e | f |\n')
    const before = getMarkdownForSave(crepe)
    await select(view, [1, 1], [2, 2])
    button(view, 'Align right').click()
    expect([0, 1, 2].map((row) => [0, 1, 2].map((col) => cellAttr(view, row, col, 'alignment')))).toEqual([
      [null, 'right', 'right'], [null, 'right', 'right'], [null, 'right', 'right'],
    ])
    expect(getMarkdownForSave(crepe)).toContain('| -- | -: | -: |')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('Clear cells empties the text and keeps the attributes', async () => {
    const { crepe, view } = await mount(`${TABLE}\n<!-- table: fill A2 green -->\n`)
    const before = getMarkdownForSave(crepe)
    await select(view, [1, 0], [2, 1])
    button(view, 'Clear cells').click()
    expect([1, 2].map((row) => [0, 1].map((col) => view.state.doc.nodeAt(cellPos(view, row, col))!.textContent))).toEqual([['', ''], ['', '']])
    expect(cellAttr(view, 1, 0, 'fill')).toBe('green')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })
})
