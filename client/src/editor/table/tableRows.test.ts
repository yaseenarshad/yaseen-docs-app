/**
 * Table settings on the six-dot handle (YAZ-3767, YAZ-3696 D6 / D7 / B3) through the real
 * createCrepe wiring: the handle is aimed by hand (jsdom lays nothing out), the menu opens on a
 * right-click, and the markdown is read after each pick. Each pick saves in the table comment, or,
 * for the horizontal alignment, in the GFM `:-` row; each is one undo step; read-only shows no rows. The look settings
 * are three icon strips, Look, Text and Rows (the YAZ-4163 demo); the border and Time slots stay pickers.
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
/** The strip button named `label` (its tooltip and accessible name). */
const stripButton = (view: EditorView, label: string): HTMLButtonElement => {
  const found = popupOf(view)!.querySelector<HTMLButtonElement>(`.ctx-menu__strip-button[aria-label="${label}"]`)
  if (found === null) throw new Error(`no strip button ${label}`)
  return found
}
/** Each strip as `strip:<caption>:<button>[*: lit][~: disabled]|…`. */
const stripsOf = (view: EditorView): string[] =>
  [...popupOf(view)!.querySelectorAll('.ctx-menu__strip')].map(
    (strip) =>
      `strip:${strip.querySelector('.ctx-menu__strip-caption')?.textContent}:${[...strip.querySelectorAll<HTMLButtonElement>('.ctx-menu__strip-button')]
        .map((b) => `${b.getAttribute('aria-label')}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}${b.disabled ? '~' : ''}`)
        .join('|')}`,
  )

/** Click the item named `text` in picker `label`'s list (its value button opens it first). */
function pick(view: EditorView, label: string, text: string): void {
  const picker = pickerNamed(view, label)
  picker.querySelector<HTMLButtonElement>('.block-menu-picker__value')!.click()
  const button = [...picker.querySelectorAll<HTMLButtonElement>('.document-zoom__presets button')].find((b) => b.firstElementChild?.textContent === text)
  if (button === undefined) throw new Error(`no ${text} in ${label}`)
  button.click()
}

describe('the menu on a table', () => {
  it('shows the three icon strips (Look, Text, Rows; the YAZ-4163 demo), then the border and Time slots pickers, and no "Number children" (B3)', async () => {
    const { view } = await openOnTable()
    const parts = [...popupOf(view)!.children].flatMap((el) => {
      if (el.classList.contains('ctx-menu__item')) return [`row:${el.textContent}${(el as HTMLButtonElement).disabled ? ':disabled' : ''}`]
      if (el.classList.contains('block-menu-picker')) return [`${el.querySelector('.block-menu-picker__label')?.textContent}:${el.querySelector('.block-menu-picker__value')?.textContent}`]
      if (el.classList.contains('ctx-menu__strip')) return [`strip:${el.querySelector('.ctx-menu__strip-caption')?.textContent ?? el.getAttribute('aria-label')}`]
      if (el.classList.contains('ctx-menu__parent')) return [`parent:${el.querySelector('.ctx-menu__item--parent')?.textContent}`]
      return []
    })
    // YAZ-4800: a table in no bullet first has the strip that puts it on one, and Add line above / below. YAZ-4774: the
    // header row's look is the "Header row ›" flyout, after the strips (no "Shaded header row" button). YAZ-4790: "Cell note button".
    expect(parts).toEqual([
      'strip:Turn into', 'row:Add line above', 'row:Add line below',
      'strip:Look', 'strip:Text', 'strip:Rows', 'parent:Header row',
      'Border thickness:Default (1px) ▾', 'Border darkness:Default (20%) ▾', 'row:Turn into Super table', 'Time slots:Default (Off) ▾', 'Cell note button:Default (Off) ▾',
    ])
    expect(stripsOf(view).slice(1)).toEqual([
      'strip:Look:Stripes|Fit columns to the page~',
      'strip:Text:Align left*|Align center|Align right|Align top*|Align middle|Align bottom',
      'strip:Rows:Compact rows|Normal rows*|Tall rows|Wrap text*',
    ])
    // Each button is an icon (Tabler's lines) with its name as a quick tooltip (`data-tip`, drawn by CSS) and no system one.
    expect([stripButton(view, 'Stripes').dataset.tip, stripButton(view, 'Stripes').title]).toEqual(['Stripes', ''])
    expect(stripButton(view, 'Stripes').querySelector('svg')?.getAttribute('fill')).toBe('none')
  })

  it('a picker that follows the default lists "Default (…)" once, with ✓, as the line pickers (YAZ-3791)', async () => {
    const { view } = await openOnTable()
    const list = (label: string) => {
      const picker = pickerNamed(view, label)
      picker.querySelector<HTMLButtonElement>('.block-menu-picker__value')!.click()
      return [...picker.querySelectorAll<HTMLButtonElement>('.document-zoom__presets button')].map((b) => `${b.firstElementChild!.textContent}${b.lastElementChild!.textContent}`)
    }
    expect(list('Border thickness')).toEqual(['Default (1px)✓', '2px', '3px', '6px'])
    expect(list('Border darkness')).toEqual(['Default (20%)✓', '10%', '50%', '100%'])
  })

  it('a value set away from the default reads as that value', async () => {
    const { view } = await openOnTable(`${SMALL}\n<!-- table: border 3px 20%, header plain, height tall -->\n`)
    const value = (label: string) => pickerNamed(view, label).querySelector('.block-menu-picker__value')!.textContent
    expect([value('Border thickness'), value('Border darkness')]).toEqual(['3px ▾', 'Default (20%) ▾'])
    // `header plain` is the header row's Strength Off (YAZ-4774): the Header row flyout's Fill tab has Off pressed.
    popupOf(view)!.querySelector<HTMLButtonElement>('.ctx-menu__item--parent')!.click()
    expect(popupOf(view)!.querySelector('.ctx-menu__sub .fill-target--sub [aria-pressed="true"]')?.textContent).toBe('Off')
    expect(stripsOf(view).slice(1)).toEqual([
      'strip:Look:Stripes|Fit columns to the page~',
      'strip:Text:Align left*|Align center|Align right|Align top*|Align middle|Align bottom',
      'strip:Rows:Compact rows|Normal rows|Tall rows*|Wrap text*',
    ])
  })

  it('a table in a bullet shows its settings, not the bullet\'s rows: no line, no children (YAZ-3727 D13)', async () => {
    const { view } = await openOnTable(`* item\n\n  ${SMALL.trimEnd().split('\n').join('\n  ')}\n`)
    const rows = [...popupOf(view)!.querySelectorAll('.ctx-menu__item')].map((row) => row.textContent)
    expect(rows).not.toContain('Number children')
    // The strips are the table's, not the bullet's Turn into strip.
    expect(stripsOf(view).map((strip) => strip.split(':')[1])).toEqual(['Look', 'Text', 'Rows'])
    expect(stripButton(view, 'Stripes')).toBeTruthy()
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
    const labels = (view: EditorView) => [...popupOf(view)!.querySelectorAll('.ctx-menu__item, .block-menu-picker__label, .ctx-menu__strip-caption')].map((el) => el.textContent)
    // YAZ-4869 S1: "Turn into Super table" before Time slots.
    const SETTINGS = ['Look', 'Text', 'Rows', 'Header row', 'Border thickness', 'Border darkness', 'Turn into Super table', 'Time slots', 'Cell note button']

    it.each([
      ['the first header cell', firstHeader],
      ['the text in it', (view: EditorView) => firstHeader(view).querySelector('p') ?? firstHeader(view)],
    ])('a top-level table: the probe in %s opens the eight settings', async (_where, hit) => {
      const { view } = await openWithHit(SMALL, hit)
      // A table in no bullet: Add line above / below first (YAZ-4800), with the strip that puts it on a bullet.
      expect(labels(view)).toEqual(['Add line above', 'Add line below', ...SETTINGS])
    })

    it('a table in a bullet: the probe in its first header cell opens the eight settings', async () => {
      const { view } = await openWithHit(BULLET, firstHeader)
      expect(labels(view)).toEqual(SETTINGS)
    })

    it('the bullet\'s own handle (the probe on its line) shows the bullet\'s rows only, no table settings (YAZ-3727 D13)', async () => {
      const { view } = await openWithHit(BULLET, (v) => v.dom.querySelector('li p')!)
      expect(labels(view)).toEqual([])
      expect([...popupOf(view)!.querySelectorAll('.ctx-menu__strip button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Bullet list', 'Numbered list', 'Checklist', 'Text'])
    })
  })

  it('a right-click on the dot of a bullet in a cell shows that bullet\'s menu, no table settings (YAZ-3818)', async () => {
    const { view } = await mount('| a | b |\n| - | - |\n| <ul><li>one<ul><li>kid</li></ul></li></ul> | 2 |\n')
    const dot = view.dom.querySelector<HTMLElement>('td li.list-item > .label-wrapper')!
    dot.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    const popup = popupOf(view)!
    expect([...popup.querySelectorAll('.ctx-menu__item')].map((row) => row.textContent)).toContain('Collapse all')
    expect(popup.querySelectorAll('.block-menu-picker')).toHaveLength(0)
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
  ])('%s → %s writes `%s`', async (label, text, part) => {
    const { crepe, view } = await openOnTable()
    pick(view, label, text)
    // A pick keeps the menu open, drawn again from the new state (YAZ-4774 demo: "it keeps on closing").
    expect(popupOf(view)).not.toBeNull()
    expect(pickerNamed(view, label).querySelector('.block-menu-picker__value')!.textContent).toBe(`${text} ▾`)
    expect(getMarkdownForSave(crepe)).toBe(`${SMALL}\n<!-- table: ${part} -->\n`)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(SMALL)
  })

  it.each<[string, string]>([
    ['Stripes', 'stripes'],
    ['Compact rows', 'height compact'],
    ['Tall rows', 'height tall'],
    ['Wrap text', 'nowrap'],
    ['Align bottom', 'valign bottom'],
  ])('the strip button %s writes `%s` in one undo step; the menu stays open and lights it; a second click goes back', async (label, part) => {
    const { crepe, view } = await openOnTable()
    const lit = stripButton(view, label).getAttribute('aria-pressed')
    stripButton(view, label).click()
    expect(popupOf(view)).not.toBeNull()
    expect(getMarkdownForSave(crepe)).toBe(`${SMALL}\n<!-- table: ${part} -->\n`)
    // The menu is drawn again from the new state: a switch flips, a choice lights its pick.
    expect(stripButton(view, label).getAttribute('aria-pressed')).toBe(lit === 'true' ? 'false' : 'true')
    // A switch (header, stripes, wrap) turns back with a second click; a choice goes back with its default button.
    const back = { 'Compact rows': 'Normal rows', 'Tall rows': 'Normal rows', 'Align bottom': 'Align top' }[label] ?? label
    stripButton(view, back).click()
    expect(popupOf(view)).not.toBeNull()
    expect(getMarkdownForSave(crepe)).toBe(SMALL)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(`${SMALL}\n<!-- table: ${part} -->\n`)
  })

  // YAZ-4774 / YAZ-4793 / YAZ-4794 replace the "Shaded header row" button: the Header row flyout. Its pick writes the
  // header part, keeps the menu and the flyout open, and lights the pick; picking it again hands it back to Settings.
  it('Header row › "Plain, like any row" writes `header off regular` in one undo step; the flyout stays open with its ✓; a second pick goes back', async () => {
    const { crepe, view } = await openOnTable()
    const flyoutRow = (label: string) => [...popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__sub .ctx-menu__item')].find((b) => b.textContent === label)
    popupOf(view)!.querySelector<HTMLButtonElement>('.ctx-menu__item--parent')!.click()
    expect(flyoutRow('Plain, like any row')!.dataset.hint).toBeUndefined()
    flyoutRow('Plain, like any row')!.click()
    expect(getMarkdownForSave(crepe)).toBe(`${SMALL}\n<!-- table: header off regular -->\n`)
    expect(flyoutRow('Plain, like any row')!.dataset.hint).toBe('✓')
    flyoutRow('Plain, like any row')!.click()
    expect(getMarkdownForSave(crepe)).toBe(SMALL)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(`${SMALL}\n<!-- table: header off regular -->\n`)
  })

  it('several strip settings go in one visit: Stripes, Tall rows, Align center; Escape then closes the menu', async () => {
    const { crepe, view } = await openOnTable()
    stripButton(view, 'Stripes').click()
    stripButton(view, 'Tall rows').click()
    stripButton(view, 'Align center').click()
    expect(stripsOf(view).slice(1)).toEqual([
      'strip:Look:Stripes*|Fit columns to the page~',
      'strip:Text:Align left|Align center*|Align right|Align top*|Align middle|Align bottom',
      'strip:Rows:Compact rows|Normal rows|Tall rows*|Wrap text*',
    ])
    expect(getMarkdownForSave(crepe)).toBe('|  a  |  b  |\n| :-: | :-: |\n|  1  |  2  |\n\n<!-- table: stripes, height tall -->\n')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(popupOf(view)).toBeNull()
  })

  it('"Default" goes back to the default and drops the part', async () => {
    const { crepe, view, item } = await openOnTable(`${SMALL}\n<!-- table: border 3px 50%, height tall -->\n`)
    pick(view, 'Border thickness', 'Default (1px)')
    expect(getMarkdownForSave(crepe)).toBe(`${SMALL}\n<!-- table: border 1px 50%, height tall -->\n`)
    rightClick(item)
    pick(view, 'Border darkness', 'Default (20%)')
    rightClick(item)
    stripButton(view, 'Normal rows').click()
    expect(getMarkdownForSave(crepe)).toBe(SMALL)
  })

  it('Align left / center / right set every cell\'s GFM alignment, so the `:-` row holds it; no comment', async () => {
    const { crepe, view, item } = await openOnTable('| a | b |\n| :- | -: |\n| 1 | 2 |\n')
    const mixed = getMarkdownForSave(crepe)
    // Mixed columns: no alignment button is lit.
    expect(['Align left', 'Align center', 'Align right'].map((label) => stripButton(view, label).getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false'])
    stripButton(view, 'Align center').click()
    expect(getMarkdownForSave(crepe)).toBe('|  a  |  b  |\n| :-: | :-: |\n|  1  |  2  |\n')
    const cells: unknown[] = []
    view.state.doc.descendants((node) => {
      if (node.type.name === 'table_cell' || node.type.name === 'table_header') cells.push(node.attrs.alignment)
    })
    expect(cells).toEqual(['center', 'center', 'center', 'center'])
    rightClick(item)
    expect(stripButton(view, 'Align center').getAttribute('aria-pressed')).toBe('true')
    stripButton(view, 'Align left').click()
    expect(getMarkdownForSave(crepe)).toBe(SMALL)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(mixed)
    expect(mixed).toContain('| :- | -: |')
  })

  it('Align center also clears each cell\'s own alignment, in the same step (YAZ-3819)', async () => {
    const note = `${SMALL}\n<!-- table: align A1 center B2 right -->\n`
    const { crepe, view } = await openOnTable(note)
    stripButton(view, 'Align center').click()
    expect(getMarkdownForSave(crepe)).toBe('|  a  |  b  |\n| :-: | :-: |\n|  1  |  2  |\n')
    const own: unknown[] = []
    view.state.doc.descendants((node) => {
      if (node.type.name === 'table_cell' || node.type.name === 'table_header') own.push(node.attrs.align)
    })
    expect(own).toEqual([null, null, null, null])
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(note)
  })

  it.each<[string, string, string]>([
    ['a `---` table', SMALL, 'Align left'],
    ['an all-Left table (it keeps its `:-`)', '| a  | b  |\n| :- | :- |\n| 1  | 2  |\n', 'Align left'],
  ])('while a cell has its own alignment, no alignment button is lit and Align left still runs: %s (YAZ-3819)', async (_, table, text) => {
    const { crepe, view } = await openOnTable(`${table}\n<!-- table: align B2 center -->\n`)
    expect(['Align left', 'Align center', 'Align right'].map((label) => stripButton(view, label).getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false'])
    stripButton(view, text).click()
    expect(getMarkdownForSave(crepe)).toBe(table)
    expect(view.state.doc.firstChild!.child(1).child(1).attrs.align).toBeNull()
  })

  it('"Fit columns to the page" clears every width in one step', async () => {
    const note = `${SMALL}\n<!-- table: widths 140 auto, stripes -->\n`
    const { crepe, view } = await openOnTable(note)
    const fit = stripButton(view, 'Fit columns to the page')
    expect(fit.disabled).toBe(false)
    fit.click()
    expect(getMarkdownForSave(crepe)).toBe(`${SMALL}\n<!-- table: stripes -->\n`)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe(note)
  })
})
