/**
 * The cell toolbar (YAZ-3768, YAZ-3696 D8) on the real editor in jsdom: it shows over a
 * CellSelection of two or more cells, and hides on a single caret, on one cell, in a read-only
 * note and while a mouse drag selects. Each button acts on every selected cell, in one undo step.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    const items = [...toolbarOf(view)!.querySelectorAll(':scope > *, :scope > .cell-toolbar__colours > :is(button, .cell-toolbar__label)')]
      .filter((el) => !el.classList.contains('cell-toolbar__colours'))
      .map((el) => (el.tagName === 'BUTTON' ? el.getAttribute('aria-label') : el.classList.contains('cell-toolbar__label') ? `label ${el.textContent}` : el.className))
    expect(items).toEqual([
      'label Fill', 'Fill yellow', 'Fill green', 'Fill blue', 'Fill colours',
      'label Text', 'Red text', 'Blue text', 'Green text', 'Text colours', 'divider',
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

const NAMES = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey', 'brown']
/** The custom colour input: what the system picker writes into (one per page, made on the first pick). */
const customInput = () => document.querySelector<HTMLInputElement>('input.table-colour-input')!

describe('quick colours, the palette and custom colours (YAZ-3817)', () => {
  it('three fixed quick swatches each, in their colours; each click is one undo step', async () => {
    const { crepe, view } = await mount(TABLE)
    const before = getMarkdownForSave(crepe)
    await select(view, [1, 0], [2, 1])
    const fillOf = (label: string) => button(view, label).querySelector<HTMLElement>('.cell-toolbar__swatch')!.style.background
    expect(['Fill yellow', 'Fill green', 'Fill blue'].map(fillOf)).toEqual(['yellow', 'green', 'blue'].map((c) => `var(--table-fill-solid-${c})`))
    const letterOf = (label: string) => button(view, label).querySelector('text')!.getAttribute('fill')
    expect(['Red text', 'Blue text', 'Green text'].map(letterOf)).toEqual(['red', 'blue', 'green'].map((c) => `var(--table-text-${c})`))
    button(view, 'Fill green').click()
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: fill A2:B3 green -->\n`)
    button(view, 'Blue text').click()
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: fill A2:B3 green, color A2:B3 blue -->\n`)
    expect(view.state.selection).toBeInstanceOf(CellSelection)
    // A palette pick changes no quick swatch: they stay in the same place every time.
    pick(view, 'Fill colours', 'Purple')
    expect(toolbarOf(view)!.querySelector('button[aria-label="Fill purple"]')).toBeNull()
    for (let i = 0; i < 3; i++) undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('each palette: the clear item, the 10 named colours in a 5 × 2 grid, then Custom colour…', async () => {
    const { view } = await mount(TABLE)
    await select(view, [1, 0], [2, 1])
    const items = (arrow: string) => [...paletteOf(view, arrow).querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
    const capitals = NAMES.map((n) => n[0].toUpperCase() + n.slice(1))
    expect(items('Fill colours')).toEqual(['No fill', ...capitals, 'Custom colour…'])
    expect(items('Text colours')).toEqual(['Default colour', ...capitals, 'Custom colour…'])
    for (const arrow of ['Fill colours', 'Text colours']) {
      const palette = paletteOf(view, arrow)
      expect(palette.querySelector('.cell-toolbar__swatches')!.children).toHaveLength(10)
      expect(palette.querySelector('button')!.textContent).toBe(arrow === 'Fill colours' ? 'No fill' : 'Default colour')
      expect(palette.querySelector(':scope > button:last-child')!.textContent).toBe('Custom colour…')
    }
    const swatch = (arrow: string, label: string) =>
      paletteOf(view, arrow).querySelector<HTMLElement>(`button[aria-label="${label}"] .cell-toolbar__swatch`)!.style.background
    expect(swatch('Fill colours', 'Teal')).toBe('var(--table-fill-solid-teal)')
    expect(swatch('Text colours', 'Brown')).toBe('var(--table-text-brown)')
  })

  it.each(NAMES)('the palette colour %s saves its name for fill and text, one undo step each', async (name) => {
    const { crepe, view } = await mount(TABLE)
    const before = getMarkdownForSave(crepe)
    await select(view, [1, 0], [2, 1])
    const label = name[0].toUpperCase() + name.slice(1)
    pick(view, 'Fill colours', label)
    expect(isOpen(view, 'Fill colours')).toBe(false)
    pick(view, 'Text colours', label)
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: fill A2:B3 ${name}, color A2:B3 ${name} -->\n`)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: fill A2:B3 ${name} -->\n`)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('No fill and Default colour clear the cells', async () => {
    const { crepe, view } = await mount(`${TABLE}\n<!-- table: fill A2:B3 teal, color A2:B3 #ff8800 -->\n`)
    await select(view, [1, 0], [2, 1])
    pick(view, 'Fill colours', 'No fill')
    pick(view, 'Text colours', 'Default colour')
    expect(getMarkdownForSave(crepe)).toBe(TABLE)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toContain('color A2:B3 #ff8800')
  })

  it('Custom colour… opens the system picker; its change saves `#rrggbb`, in one undo step, and reloads', async () => {
    const { crepe, view } = await mount(TABLE)
    const before = getMarkdownForSave(crepe)
    await select(view, [1, 0], [2, 1])
    const opened = vi.spyOn(HTMLInputElement.prototype, 'click')
    pick(view, 'Fill colours', 'Custom colour…')
    expect(opened).toHaveBeenCalledOnce()
    opened.mockRestore()
    const input = customInput()
    expect(isOpen(view, 'Fill colours')).toBe(false)
    // The picker's live `input` events change nothing; its `change` is the pick.
    input.value = '#FF8800'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(getMarkdownForSave(crepe)).toBe(before)
    input.dispatchEvent(new Event('change', { bubbles: true }))
    pick(view, 'Text colours', 'Custom colour…')
    const text = customInput()
    text.value = '#1a2b3c'
    text.dispatchEvent(new Event('change', { bubbles: true }))
    const saved = getMarkdownForSave(crepe)
    expect(saved).toBe(`${before}\n<!-- table: fill A2:B3 #ff8800, color A2:B3 #1a2b3c -->\n`)
    const again = await mount(saved)
    expect(cellAttr(again.view, 1, 0, 'fill')).toBe('#ff8800')
    expect(cellAttr(again.view, 2, 1, 'color')).toBe('#1a2b3c')
    expect(getMarkdownForSave(again.crepe)).toBe(saved)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: fill A2:B3 #ff8800 -->\n`)
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  /** Open Custom colour… of `arrow` on the selected cells, and pick `color` in the system picker. */
  function pickCustom(view: EditorView, arrow: string, color: string) {
    pick(view, arrow, 'Custom colour…')
    customInput().value = color
    customInput().dispatchEvent(new Event('change', { bubbles: true }))
  }

  it('the picker opens on the cells\' own custom colour, else on black, so the same colour picked again still applies', async () => {
    const { view } = await mount(TABLE)
    await select(view, [1, 0], [2, 1])
    pick(view, 'Fill colours', 'Custom colour…')
    expect(customInput().value).toBe('#000000')
    customInput().value = '#ff8800'
    customInput().dispatchEvent(new Event('change', { bubbles: true }))
    await select(view, [1, 0], [1, 1])
    pick(view, 'Fill colours', 'Custom colour…')
    expect(customInput().value).toBe('#ff8800')
    // Other cells: the picker starts on black again, so the same pick is a change and applies.
    await select(view, [0, 0], [0, 1])
    pickCustom(view, 'Fill colours', '#ff8800')
    expect([cellAttr(view, 0, 0, 'fill'), cellAttr(view, 0, 1, 'fill')]).toEqual(['#ff8800', '#ff8800'])
  })

  it('a pick goes to the cells chosen when the picker opened, through later edits and a new selection', async () => {
    const { view } = await mount(TABLE)
    await select(view, [1, 0], [1, 1])
    pick(view, 'Text colours', 'Custom colour…')
    // While the system picker is open: an edit above the cells moves them, and the user selects other cells.
    view.dispatch(view.state.tr.insertText('more ', cellPos(view, 0, 0) + 2))
    await select(view, [2, 0], [2, 1])
    customInput().value = '#1a2b3c'
    customInput().dispatchEvent(new Event('change', { bubbles: true }))
    expect([1, 2].map((r) => [0, 1].map((c) => cellAttr(view, r, c, 'color')))).toEqual([['#1a2b3c', '#1a2b3c'], [null, null]])
    // The pick is spent: a second change applies nothing.
    const after = view.state.doc
    customInput().value = '#445566'
    customInput().dispatchEvent(new Event('change', { bubbles: true }))
    expect(view.state.doc).toBe(after)
  })

  it('a pick does nothing when its cells are gone or the note is closed, with no error; a removed input comes back', async () => {
    const errors: unknown[] = []
    const onError = (e: ErrorEvent) => errors.push(e.error)
    window.addEventListener('error', onError)
    const { view } = await mount(`para\n\n${TABLE}`)
    await select(view, [1, 0], [1, 1])
    pick(view, 'Fill colours', 'Custom colour…')
    let table = -1
    view.state.doc.forEach((node, pos) => { if (node.type.name === 'table') table = pos })
    view.dispatch(view.state.tr.delete(table, table + view.state.doc.nodeAt(table)!.nodeSize))
    const gone = view.state.doc
    customInput().value = '#ff8800'
    customInput().dispatchEvent(new Event('change', { bubbles: true }))
    expect(view.state.doc).toBe(gone)
    // The input left the page: the next open puts it back.
    customInput().remove()
    const other = await mount(TABLE)
    await select(other.view, [1, 0], [1, 1])
    pick(other.view, 'Fill colours', 'Custom colour…')
    expect(customInput().isConnected).toBe(true)
    // ⌘W while the picker is open: the view is destroyed, and the pick is dropped.
    other.view.destroy()
    customInput().value = '#ff8800'
    customInput().dispatchEvent(new Event('change', { bubbles: true }))
    window.removeEventListener('error', onError)
    expect(errors).toEqual([])
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

  it('Align sets the selected cells only; the column alignment stays (YAZ-3819)', async () => {
    const { crepe, view } = await mount('| h1 | h2 | h3 |\n| -- | -: | -- |\n| a | b | c |\n| d | e | f |\n')
    const before = getMarkdownForSave(crepe)
    // A row: the cells of row 2 only, not every column.
    await select(view, [1, 0], [1, 2])
    button(view, 'Align center').click()
    const grid = (attr: string) => [0, 1, 2].map((row) => [0, 1, 2].map((col) => cellAttr(view, row, col, attr)))
    expect(grid('align')).toEqual([[null, null, null], ['center', 'center', 'center'], [null, null, null]])
    expect(grid('alignment')).toEqual([[null, 'right', null], [null, 'right', null], [null, 'right', null]])
    expect(view.state.selection).toBeInstanceOf(CellSelection)
    const saved = getMarkdownForSave(crepe)
    expect(saved).toBe(`${before}\n<!-- table: align A2:C2 center -->\n`)
    const again = await mount(saved)
    expect(cellAttr(again.view, 1, 1, 'align')).toBe('center')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('a pick equal to the column\'s alignment clears the cell\'s own: the cell follows its column (YAZ-3819)', async () => {
    const { crepe, view } = await mount('| h1 | h2 | h3 |\n| -- | -: | -- |\n| a | b | c |\n\n<!-- table: align A2:C2 center -->\n')
    await select(view, [1, 0], [1, 2])
    const own = () => [0, 1, 2].map((col) => cellAttr(view, 1, col, 'align'))
    button(view, 'Align right').click()
    expect(own()).toEqual(['right', null, 'right'])
    // No `align` column (`--`) counts as left.
    button(view, 'Align left').click()
    expect(own()).toEqual([null, 'left', null])
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: align B2 left -->')
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
