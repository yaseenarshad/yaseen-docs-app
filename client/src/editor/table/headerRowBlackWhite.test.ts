/**
 * Header row Black fill and White text (YAZ-4794 demo: "option for white text and option for black fill" … "add that to
 * the tables also please not only the folder pages table"), and the page table's Header row flyout made like the folder
 * page's ("shouldnt it folow?"): Plain on top, then Fill · Text · Style tabs, Fill's Off · Light · Medium · Strong a
 * short switch (`bar`) over the colours. Both table kinds read the same choices and paint through the same attributes.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { EditorView } from '@milkdown/kit/prose/view'
import { DEFAULT_HEADER_ROW, HEADER_ROW_CHOICES, headerRowAttrs, headerRowLabel, headerRowOwn } from '@shared/types'
import { getMarkdownForSave } from '../createCrepe'
import { formatTableComment, parseTableComment, plainTable, type TableStyle } from './tableComment'
import { headerSwatch } from './colours'
import { mountPage, unmountAll } from './tableTestKit'
import { setHeaderRowSetting } from './timeFormatSetting'
import { headerRowOfView, parseViews } from '../../views/viewSchema'
import { setHeaderRowPart, shownHeaderRow } from '../../views/view/TableLookSettings'
import type { ViewDef } from '../../views/viewSchema'
import tableCss from './table.css?inline'

afterEach(async () => {
  setHeaderRowSetting(DEFAULT_HEADER_ROW)
  await unmountAll()
})

describe('YAZ-4794 demo: Black fill and White text are choices', () => {
  it('YAZ-4794 demo: Black is the last fill colour; White comes right after Full in the text colours', () => {
    expect(HEADER_ROW_CHOICES.color.at(-1)).toBe('black')
    expect(HEADER_ROW_CHOICES.text.slice(0, 3)).toEqual(['muted', 'full', 'white'])
    expect(headerRowLabel('black')).toBe('Black')
    expect(headerRowLabel('white')).toBe('White')
  })

  it('YAZ-4794 demo: headerRowOwn keeps black and white; white is no fill and black no text colour', () => {
    expect(headerRowOwn({ color: 'black', text: 'white' })).toEqual({ color: 'black', text: 'white' })
    expect(headerRowOwn({ color: 'white', text: 'black' })).toEqual({})
  })

  it('YAZ-4794 demo: the attributes both table kinds paint by', () => {
    expect(headerRowAttrs({ color: 'black', strength: 'strong', text: 'white' })).toEqual({
      'data-table-header-color': 'black',
      'data-table-header-strength': 'strong',
      'data-table-header-text': 'white',
    })
  })
})

describe('YAZ-4794 demo: a page table saves them in its comment', () => {
  const style = (parts: Partial<TableStyle>): TableStyle => ({ ...plainTable(), ...parts })

  it('YAZ-4794 demo: `header black strong text-white` reads and writes back the same', () => {
    const comment = '<!-- table: header black strong text-white -->'
    expect(parseTableComment(comment)).toEqual(style({ header: { color: 'black', strength: 'strong', text: 'white' } }))
    expect(formatTableComment(style({ header: { color: 'black', strength: 'strong', text: 'white' } }))).toBe(comment)
  })
})

describe('YAZ-4794 demo: a folder table saves them in its view', () => {
  it('YAZ-4794 demo: headerRow color black / text white read from .folder.md', () => {
    const [view] = parseViews('views:\n  - type: table\n    name: T\n    headerRow:\n      strength: strong\n      color: black\n      text: white\n').def.views
    expect(headerRowOfView(view)).toEqual({ strength: 'strong', color: 'black', text: 'white' })
  })

  it('YAZ-4794 demo: picking Black and White writes the view own parts', () => {
    const view = { type: 'table', name: 'T' } as ViewDef
    setHeaderRowPart(view, 'color', 'black')
    setHeaderRowPart(view, 'text', 'white')
    expect(view.headerRow).toEqual({ color: 'black', text: 'white' })
    expect(shownHeaderRow(view)).toMatchObject({ color: 'black', text: 'white' })
  })
})

describe('YAZ-4794 demo: table.css paints every header choice, in both table kinds', () => {
  const css = tableCss.replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = (part: string, value: string) => {
    const m = new RegExp(`:is\\(([^)]*)\\)\\[data-table-header-${part}='${value}'\\]\\s*\\{([^}]*)\\}`).exec(css)
    return m === null ? null : { scope: m[1].split(',').map((s) => s.trim()), body: m[2] }
  }

  it('YAZ-4794 demo: Black fills with the solid black, White sets the ink to white; both for a page table and a folder table', () => {
    const black = rule('color', 'black')
    expect(black?.body).toContain('--table-header-hue: var(--table-fill-solid-black)')
    expect(black?.scope).toEqual(expect.arrayContaining(['.milkdown-table-block', '.view-table']))
    const white = rule('text', 'white')
    expect(white?.body).toMatch(/--table-header-ink:\s*#fff/)
    expect(white?.scope).toEqual(expect.arrayContaining(['.milkdown-table-block', '.view-table']))
    expect(css).toMatch(/--table-fill-solid-black:/)
  })

  it.each([...HEADER_ROW_CHOICES.color.map((c) => ['color', c]), ...HEADER_ROW_CHOICES.text.map((t) => ['text', t])])('YAZ-4794 demo: header %s %s has its rule', (part, value) => {
    expect(rule(part, value), `${part} ${value}`).not.toBeNull()
  })

  it('YAZ-4794 demo: the swatch of black is the solid black', () => {
    expect(headerSwatch('black')).toBe('var(--table-fill-solid-black)')
  })
})

describe('YAZ-4794 demo: the page table Header row flyout, as the folder page', () => {
  async function openHeaderRow(markdown = '| a | b |\n| - | - |\n| 1 | 2 |\n') {
    const { crepe, view } = await mountPage(markdown)
    const handle = document.createElement('div')
    handle.className = 'milkdown-block-handle'
    const item = document.createElement('div')
    item.className = 'operation-item'
    handle.appendChild(item)
    view.dom.parentElement!.appendChild(handle)
    handle.getBoundingClientRect = () => ({ right: 0 }) as DOMRect
    let pos = -1
    view.state.doc.descendants((node, p) => {
      if (pos === -1 && node.type.name === 'table') pos = p
      return pos === -1
    })
    view.posAtCoords = () => ({ pos: pos + 1, inside: pos })
    item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    const parent = [...menuOf(view).querySelectorAll<HTMLButtonElement>('[aria-haspopup="menu"]')].find((b) => b.textContent === 'Header row')
    if (parent === undefined) throw new Error('no Header row')
    parent.click()
    return { crepe, view }
  }
  const menuOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')!
  const flyout = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu__sub')!
  const tabs = (view: EditorView) => [...flyout(view).querySelectorAll<HTMLButtonElement>('.fill-target:not(.fill-target--sub) > .fill-target__opt')]
  const bar = (view: EditorView) => [...flyout(view).querySelectorAll<HTMLButtonElement>('.fill-target--sub:not(.fill-target--switch) .fill-target__opt')]
  const items = (view: EditorView) => [...flyout(view).querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].map((b) => b.textContent)

  it('YAZ-4794 demo: Plain on top, then the Fill · Text · Style tabs; Fill is shown first', async () => {
    const { view } = await openHeaderRow()
    expect(items(view)[0]).toBe('Plain, like any row')
    expect(tabs(view).map((t) => t.textContent)).toEqual(['Fill', 'Text', 'Style'])
    expect(tabs(view).map((t) => t.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
  })

  it('YAZ-4794 demo: the flyout opens again on the tab last picked', async () => {
    const first = await openHeaderRow()
    tabs(first.view)[2].click()
    await unmountAll()
    const { view } = await openHeaderRow()
    expect(tabs(view).map((t) => t.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
    tabs(view)[0].click()
  })

  it('YAZ-4794 demo: Fill has Off · Light · Medium · Strong as a short switch (Light pressed, the default), then the colours ending in Black', async () => {
    const { view } = await openHeaderRow()
    expect(bar(view).map((b) => `${b.textContent}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`)).toEqual(['Off', 'Light*', 'Medium', 'Strong'])
    const colours = items(view).slice(1)
    expect(colours.at(-1)).toBe('Black')
    expect(colours).toHaveLength(HEADER_ROW_CHOICES.color.length)
  })

  it('YAZ-4794 demo: the Text tab shows Muted, Full, White and the colours; Style shows Weight and Align', async () => {
    const { view } = await openHeaderRow()
    tabs(view)[1].click()
    expect(items(view).slice(1, 4)).toEqual(['Muted', 'Full', 'White'])
    tabs(view)[2].click()
    expect(items(view).slice(1)).toEqual(['Bold', 'Regular', 'Follow column', 'Left', 'Center', 'Right'])
  })

  it('YAZ-4794 demo: Strong, Black and White save `header black strong text-white` in the note', async () => {
    const { crepe, view } = await openHeaderRow()
    // The flyout opens on the tab last used (an earlier test left it on Style).
    tabs(view)[0].click()
    bar(view).find((b) => b.textContent === 'Strong')!.click()
    // A pick draws the menu again (it stays open); the flyout is found afresh each time.
    const reopen = () => {
      if (view.dom.parentElement!.querySelector('.ctx-menu__sub') !== null) return
      ;[...menuOf(view).querySelectorAll<HTMLButtonElement>('[aria-haspopup="menu"]')].find((b) => b.textContent === 'Header row')!.click()
    }
    reopen()
    expect(bar(view).find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent).toBe('Strong')
    ;[...flyout(view).querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((b) => b.textContent === 'Black')!.click()
    reopen()
    // The flyout stays on the tab it was on; Text is picked by hand.
    tabs(view)[1].click()
    ;[...flyout(view).querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((b) => b.textContent === 'White')!.click()
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: header black strong text-white -->')
  })

  it('YAZ-4793 demo: "Plain, like any row" makes the header Off, Regular and Full in one pick (✓), and a second pick hands them back', async () => {
    const { crepe, view } = await openHeaderRow()
    const plain = () => [...flyout(view).querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((b) => b.textContent === 'Plain, like any row')!
    const reopen = () => {
      if (view.dom.parentElement!.querySelector('.ctx-menu__sub') !== null) return
      ;[...menuOf(view).querySelectorAll<HTMLButtonElement>('[aria-haspopup="menu"]')].find((b) => b.textContent === 'Header row')!.click()
    }
    expect(plain().dataset.hint).toBeUndefined()
    plain().click()
    const md = getMarkdownForSave(crepe)
    // Full text is a page table's own default, so it saves no part.
    expect(parseTableComment(md.slice(md.indexOf('<!--')).trim())?.header).toEqual({ strength: 'off', weight: 'regular' })
    reopen()
    expect(plain().dataset.hint).toBe('✓')
    plain().click()
    expect(getMarkdownForSave(crepe)).not.toContain('<!-- table:')
  })
})
