/**
 * The cell toolbar (YAZ-3768, YAZ-3696 D8) on the real editor in jsdom: it shows over a
 * CellSelection of two or more cells, and hides on a single caret, on one cell, in a read-only
 * note and while a mouse drag selects. Each button acts on every selected cell, in one undo step.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import { CellSelection } from '@milkdown/kit/prose/tables'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { cellPos } from '../tableTestKit'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<{ crepe: Crepe; view: EditorView }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  view.focus()
  return { crepe, view }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

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
const cellAttr = (view: EditorView, row: number, col: number, attr: string) => view.state.doc.nodeAt(cellPos(view, row, col))!.attrs[attr]

describe('when the toolbar shows', () => {
  it('over two or more cells, with every item named in plain words, left to right', async () => {
    const { view } = await mount(TABLE)
    await select(view, [1, 0], [2, 1])
    expect(shown(view)).toBe(true)
    const items = [...toolbarOf(view)!.children].map((el) => (el.tagName === 'BUTTON' ? el.getAttribute('aria-label') : el.className))
    expect(items).toEqual([
      'cell-toolbar__label', 'Fill yellow', 'Fill green', 'Fill blue', 'Fill pink', 'No fill', 'divider',
      'cell-toolbar__label', 'Red text', 'Orange text', 'Green text', 'Blue text', 'Grey text', 'Default text colour', 'divider',
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

describe('each button acts on every selected cell, in one undo step', () => {
  it('Fill and No fill', async () => {
    const { crepe, view } = await mount(TABLE)
    const before = getMarkdownForSave(crepe)
    await select(view, [1, 0], [2, 1])
    button(view, 'Fill blue').click()
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: fill A2:B3 blue -->\n`)
    expect(view.state.selection).toBeInstanceOf(CellSelection)
    button(view, 'No fill').click()
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
    button(view, 'Red text').click()
    expect(getMarkdownForSave(crepe)).toBe(`${before}\n<!-- table: color A1:B2 red -->\n`)
    button(view, 'Default text colour').click()
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
