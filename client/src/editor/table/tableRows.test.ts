/**
 * Table settings on the six-dot handle (YAZ-3767, YAZ-3696 D6 / D7 / B3) through the real
 * createCrepe wiring: the handle is aimed by hand (jsdom lays nothing out), the menu opens on a
 * right-click, and the markdown is read after each pick. Each pick saves in the table comment, or,
 * for "Align all columns", in the GFM `:-` row; each is one undo step; read-only shows no rows.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<{ crepe: Crepe; view: EditorView; item: HTMLElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  const handle = document.createElement('div')
  handle.className = 'milkdown-block-handle'
  const item = document.createElement('div')
  item.className = 'operation-item'
  handle.appendChild(item)
  view.dom.parentElement!.appendChild(handle)
  handle.getBoundingClientRect = () => ({ right: 0 }) as DOMRect
  return { crepe, view, item }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

const SMALL = '| a | b |\n| - | - |\n| 1 | 2 |\n'

const tablePos = (view: EditorView): number => {
  let pos = -1
  view.state.doc.descendants((node, p) => {
    if (pos === -1 && node.type.name === 'table') pos = p
    return pos === -1
  })
  return pos
}
const rightClick = (item: HTMLElement) =>
  item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')

/** Open the table's handle menu: the probe lands on the table, as Crepe's handle aims it. */
async function openOnTable(markdown = SMALL) {
  const m = await mount(markdown)
  const pos = tablePos(m.view)
  m.view.posAtCoords = () => ({ pos: pos + 1, inside: pos })
  rightClick(m.item)
  return m
}

const pickerNamed = (view: EditorView, label: string): HTMLElement => {
  const found = [...popupOf(view)!.querySelectorAll<HTMLElement>('.block-menu-picker')].find((p) => p.querySelector('.block-menu-picker__label')?.textContent === label)
  if (found === undefined) throw new Error(`no picker ${label}`)
  return found
}
/** Click the item named `text` in picker `label`'s list (its value button opens it first). */
function pick(view: EditorView, label: string, text: string): void {
  const picker = pickerNamed(view, label)
  picker.querySelector<HTMLButtonElement>('.block-menu-picker__value')!.click()
  const button = [...picker.querySelectorAll<HTMLButtonElement>('.document-zoom__presets button')].find((b) => b.firstElementChild?.textContent === text)
  if (button === undefined) throw new Error(`no ${text} in ${label}`)
  button.click()
}

describe('the menu on a table', () => {
  it('shows the eight settings, in order, and no "Number children" (B3)', async () => {
    const { view } = await openOnTable()
    const parts = [...popupOf(view)!.children].flatMap((el) => {
      if (el.classList.contains('ctx-menu__item')) return [`row:${el.textContent}${(el as HTMLButtonElement).disabled ? ':disabled' : ''}`]
      if (el.classList.contains('block-menu-picker')) return [`${el.querySelector('.block-menu-picker__label')?.textContent}:${el.querySelector('.block-menu-picker__value')?.textContent}`]
      return []
    })
    expect(parts).toEqual([
      'Border thickness:1px ▾',
      'Border darkness:20% ▾',
      'Header row:Shaded ▾',
      'Align all columns:Left ▾',
      'row:Fit columns to the page:disabled',
      'Stripes:Off ▾',
      'Row height:Normal ▾',
      'Wrap text:On ▾',
    ])
  })

  it('a table in a bullet keeps "Number children"', async () => {
    const { view } = await openOnTable(`* item\n\n  ${SMALL.trimEnd().split('\n').join('\n  ')}\n`)
    expect(popupOf(view)!.querySelector('.ctx-menu__item')?.textContent).toBe('Number children')
    expect(pickerNamed(view, 'Stripes')).toBeTruthy()
  })

  it('a read-only note shows no rows', async () => {
    const { view, item } = await mount(SMALL)
    view.setProps({ editable: () => false })
    const pos = tablePos(view)
    view.posAtCoords = () => ({ pos: pos + 1, inside: pos })
    rightClick(item)
    expect(popupOf(view)).toBeNull()
  })
})

describe('each setting saves in the comment, one undo step each', () => {
  it.each<[string, string, string]>([
    ['Border thickness', '3px', 'border 3px 20%'],
    ['Border darkness', '50%', 'border 1px 50%'],
    ['Header row', 'Plain', 'header plain'],
    ['Stripes', 'On', 'stripes'],
    ['Row height', 'Compact', 'height compact'],
    ['Row height', 'Tall', 'height tall'],
    ['Wrap text', 'Off', 'nowrap'],
  ])('%s → %s writes `%s`', async (label, text, part) => {
    const { crepe, view } = await openOnTable()
    pick(view, label, text)
    expect(popupOf(view)).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe(`${SMALL}\n<!-- table: ${part} -->\n`)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(SMALL)
  })

  it('"Default" goes back to the default and drops the part', async () => {
    const { crepe, view, item } = await openOnTable(`${SMALL}\n<!-- table: border 3px 50%, height tall -->\n`)
    pick(view, 'Border thickness', 'Default (1px)')
    expect(getMarkdownForSave(crepe)).toBe(`${SMALL}\n<!-- table: border 1px 50%, height tall -->\n`)
    rightClick(item)
    pick(view, 'Border darkness', 'Default (20%)')
    rightClick(item)
    pick(view, 'Row height', 'Default (Normal)')
    expect(getMarkdownForSave(crepe)).toBe(SMALL)
  })

  it('"Align all columns" sets every cell\'s GFM alignment, so the `:-` row holds it; no comment', async () => {
    const { crepe, view, item } = await openOnTable('| a | b |\n| :- | -: |\n| 1 | 2 |\n')
    const mixed = getMarkdownForSave(crepe)
    expect(pickerNamed(view, 'Align all columns').querySelector('.block-menu-picker__value')!.textContent).toBe('Default (Left) ▾')
    pick(view, 'Align all columns', 'Center')
    expect(getMarkdownForSave(crepe)).toBe('|  a  |  b  |\n| :-: | :-: |\n|  1  |  2  |\n')
    const cells: unknown[] = []
    view.state.doc.descendants((node) => {
      if (node.type.name === 'table_cell' || node.type.name === 'table_header') cells.push(node.attrs.alignment)
    })
    expect(cells).toEqual(['center', 'center', 'center', 'center'])
    rightClick(item)
    pick(view, 'Align all columns', 'Default (Left)')
    expect(getMarkdownForSave(crepe)).toBe(SMALL)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(mixed)
    expect(mixed).toContain('| :- | -: |')
  })

  it('"Fit columns to the page" clears every width in one step', async () => {
    const note = `${SMALL}\n<!-- table: widths 140 auto, stripes -->\n`
    const { crepe, view } = await openOnTable(note)
    const fit = [...popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((b) => b.textContent === 'Fit columns to the page')!
    expect(fit.disabled).toBe(false)
    fit.click()
    expect(getMarkdownForSave(crepe)).toBe(`${SMALL}\n<!-- table: stripes -->\n`)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(note)
  })
})
