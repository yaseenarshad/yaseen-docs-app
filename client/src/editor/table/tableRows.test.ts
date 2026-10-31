/**
 * Table settings on the six-dot handle (YAZ-3767, YAZ-3696 D6 / D7 / B3) through the real
 * createCrepe wiring: the handle is aimed by hand (jsdom lays nothing out), the menu opens on a
 * right-click, and the markdown is read after each pick. Each pick saves in the table comment, or,
 * for "Align all columns", in the GFM `:-` row; each is one undo step; read-only shows no rows.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { undo } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import { getMarkdownForSave } from '../createCrepe'
import { mountNote, unmountAll } from './tableTestKit'

async function mount(markdown: string): Promise<{ crepe: Crepe; view: EditorView; item: HTMLElement }> {
  const { crepe, view } = await mountNote(markdown)
  const handle = document.createElement('div')
  handle.className = 'milkdown-block-handle'
  const item = document.createElement('div')
  item.className = 'operation-item'
  handle.appendChild(item)
  view.dom.parentElement!.appendChild(handle)
  handle.getBoundingClientRect = () => ({ right: 0 }) as DOMRect
  return { crepe, view, item }
}

afterEach(unmountAll)

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
      'Border thickness:Default (1px) ▾',
      'Border darkness:Default (20%) ▾',
      'Header row:Default (Shaded) ▾',
      'Align all columns:Default (Left) ▾',
      'row:Fit columns to the page:disabled',
      'Stripes:Default (Off) ▾',
      'Row height:Default (Normal) ▾',
      'Wrap text:Default (On) ▾',
    ])
  })

  it('a picker that follows the default lists "Default (…)" once, with ✓, as the line pickers (YAZ-3791)', async () => {
    const { view } = await openOnTable()
    const list = (label: string) => {
      const picker = pickerNamed(view, label)
      picker.querySelector<HTMLButtonElement>('.block-menu-picker__value')!.click()
      return [...picker.querySelectorAll<HTMLButtonElement>('.document-zoom__presets button')].map((b) => `${b.firstElementChild!.textContent}${b.lastElementChild!.textContent}`)
    }
    expect(list('Header row')).toEqual(['Default (Shaded)✓', 'Plain'])
    expect(list('Stripes')).toEqual(['Default (Off)✓', 'On'])
    expect(list('Row height')).toEqual(['Default (Normal)✓', 'Compact', 'Tall'])
    expect(list('Wrap text')).toEqual(['Default (On)✓', 'Off'])
    expect(list('Border thickness')).toEqual(['Default (1px)✓', '2px', '3px', '6px'])
    expect(list('Border darkness')).toEqual(['Default (20%)✓', '10%', '50%', '100%'])
  })

  it('a value set away from the default reads as that value', async () => {
    const { view } = await openOnTable(`${SMALL}\n<!-- table: border 3px 20%, header plain, height tall -->\n`)
    const value = (label: string) => pickerNamed(view, label).querySelector('.block-menu-picker__value')!.textContent
    expect([value('Border thickness'), value('Border darkness'), value('Header row'), value('Row height')]).toEqual(['3px ▾', 'Default (20%) ▾', 'Plain ▾', 'Tall ▾'])
  })

  it('a table in a bullet keeps "Number children"', async () => {
    const { view } = await openOnTable(`* item\n\n  ${SMALL.trimEnd().split('\n').join('\n  ')}\n`)
    expect(popupOf(view)!.querySelector('.ctx-menu__item')?.textContent).toBe('Number children')
    expect(pickerNamed(view, 'Stripes')).toBeTruthy()
  })

  describe('a right-click on any point of the six dots (YAZ-3795)', () => {
    // The real probe: `handleTargetPos` and ProseMirror's own `posAtCoords`. Only the browser's hit test is given,
    // as jsdom lays nothing out: below the table's top 9 px, the probe right of the handle hits the first header cell.
    const BULLET = `* item\n\n  ${SMALL.trimEnd().split('\n').join('\n  ')}\n`
    async function openWithHit(markdown: string, hit: (view: EditorView) => Element) {
      const m = await mount(markdown)
      delete (m.view as Partial<EditorView>).posAtCoords
      const at = hit(m.view)
      Object.assign(document, { elementFromPoint: () => at })
      try {
        rightClick(m.item)
      } finally {
        delete (document as Partial<Document>).elementFromPoint
      }
      return m
    }
    const firstHeader = (view: EditorView) => view.dom.querySelector('th')!
    const labels = (view: EditorView) => [...popupOf(view)!.querySelectorAll('.ctx-menu__item, .block-menu-picker__label')].map((el) => el.textContent)
    const SETTINGS = ['Border thickness', 'Border darkness', 'Header row', 'Align all columns', 'Fit columns to the page', 'Stripes', 'Row height', 'Wrap text']

    it.each([
      ['the first header cell', firstHeader],
      ['the text in it', (view: EditorView) => firstHeader(view).querySelector('p') ?? firstHeader(view)],
    ])('a top-level table: the probe in %s opens the eight settings', async (_where, hit) => {
      const { view } = await openWithHit(SMALL, hit)
      expect(labels(view)).toEqual(SETTINGS)
    })

    it('a table in a bullet: the probe in its first header cell opens the bullet\'s row and the eight settings', async () => {
      const { view } = await openWithHit(BULLET, firstHeader)
      expect(labels(view)).toEqual(['Number children', ...SETTINGS])
    })

    it('the bullet\'s own handle (the probe on its line) shows the bullet\'s row only, no table settings', async () => {
      const { view } = await openWithHit(BULLET, (v) => v.dom.querySelector('li p')!)
      expect(labels(view)).toEqual(['Number children'])
    })
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
    expect(pickerNamed(view, 'Align all columns').querySelector('.block-menu-picker__value')!.textContent).toBe('Center ▾')
    pick(view, 'Align all columns', 'Default (Left)')
    expect(getMarkdownForSave(crepe)).toBe(SMALL)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(mixed)
    expect(mixed).toContain('| :- | -: |')
  })

  it('"Align all columns" also clears each cell\'s own alignment, in the same step (YAZ-3819)', async () => {
    const note = `${SMALL}\n<!-- table: align A1 center B2 right -->\n`
    const { crepe, view } = await openOnTable(note)
    pick(view, 'Align all columns', 'Center')
    expect(getMarkdownForSave(crepe)).toBe('|  a  |  b  |\n| :-: | :-: |\n|  1  |  2  |\n')
    const own: unknown[] = []
    view.state.doc.descendants((node) => {
      if (node.type.name === 'table_cell' || node.type.name === 'table_header') own.push(node.attrs.align)
    })
    expect(own).toEqual([null, null, null, null])
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(note)
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
