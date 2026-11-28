/**
 * A card's tables, read (YAZ-5136, Yaseen: "even if there is a table in the editor, it doesnt render in the reader"):
 * the one render (`renderCard`) that the Inbox, Explore, the card file tab, a card embed and the card window share
 * gives a GFM table, in a box that scrolls sideways, with its hidden words; and `card.css` draws it as the page's
 * tables, from `table.css`'s rules and variables.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { beats, rules, specificity } from '../cssRules'
import { INK_CONTRAST, PAGE_BG, contrast, fillTone } from '../table/tableMarks'
import { renderCard } from './cardRender'

const TABLE = '| Urdu | Roman | English |\n|:--|:-:|--:|\n| {{آپ کو}} | {{Aap ko}} | to you |\n| {{آتی ہے}} | {{aati hai}} | is known |'

describe('renderCard: a table (YAZ-5136)', () => {
  it('is a real table in a box that scrolls sideways, its header row in `thead`, each column`s alignment kept', () => {
    const el = renderCard(`Ask politely:\n\n${TABLE}`)
    const box = el.querySelector('.card__side > .card__table')!
    expect(box).not.toBeNull()
    const table = box.querySelector(':scope > table')!
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Urdu', 'Roman', 'English'])
    expect(table.querySelectorAll('tbody tr')).toHaveLength(2)
    expect([...table.querySelectorAll('tbody tr:first-child td')].map((td) => td.getAttribute('align'))).toEqual(['left', 'center', 'right'])
  })

  it('a hidden word in a cell is a blank, Space shows it in page order, and the next one is marked', () => {
    const cells = (shown: number) => [...renderCard(TABLE, { shown }).querySelectorAll<HTMLElement>('tbody td')]
    const start = cells(0)
    expect(start.slice(0, 2).map((td) => td.firstElementChild?.className)).toEqual(['card__blank', 'card__blank'])
    expect(start[0].querySelector<HTMLElement>('[data-next]')?.dataset.hidden).toBe('0')
    const two = cells(2)
    expect(two.slice(0, 2).map((td) => td.firstElementChild?.className)).toEqual(['card__hidden', 'card__hidden'])
    expect(two[0].textContent).toBe('آپ کو')
    // The next word is the first of the second row.
    expect(two[3].querySelector<HTMLElement>('[data-next]')?.dataset.hidden).toBe('2')
    expect(cells(4).every((td) => td.querySelector('.card__blank') === null)).toBe(true)
  })

  it('stays safe: the table tags and `align` only; no handler, no form control in a cell', () => {
    const el = renderCard('<table onclick="alert(1)"><tr><td onmouseover="x()">a<input value="b"></td></tr></table>\n\n| a |\n|---|\n| <img src=x onerror=alert(1)> |')
    expect(el.querySelector('[onclick], [onmouseover], [onerror], input')).toBeNull()
    expect(el.querySelectorAll('.card__table > table')).toHaveLength(2)
  })

  it('round 2: the column widths the page editor saved (`<!-- table: widths … -->` after the table) size the read table', () => {
    const cols = (t: HTMLTableElement) => [...t.querySelectorAll<HTMLElement>(':scope > colgroup > col')].map((c) => c.style.width)
    const el = renderCard('| a | b |\n|---|---|\n| 1 | 2 |\n<!-- table: widths 300 324 -->\n\nText\n\n| x | y | z |\n|---|---|---|\n| 1 | 2 | 3 |\n\n<!-- table: widths 200 auto 150, stripes -->\n\n| p | q |\n|---|---|\n| 1 | 2 |')
    const [all, some, none] = [...el.querySelectorAll('table')]
    // Every column sized: the table is their sum, as the page's (prosemirror-tables).
    expect(cols(all)).toEqual(['300px', '324px'])
    expect([all.style.width, all.style.minWidth, all.dataset.sized]).toEqual(['624px', '', ''])
    // A column at auto: the table fills the card and is at least the sum, an auto column counted at the page's 24 px.
    expect(cols(some)).toEqual(['200px', '', '150px'])
    expect([some.style.width, some.style.minWidth, some.dataset.sized]).toEqual(['', '374px', ''])
    // No comment: no widths, the look of round 1.
    expect(none.querySelector('colgroup')).toBeNull()
    expect(none.dataset.sized).toBeUndefined()
    // The comment never shows.
    expect(el.textContent).not.toContain('widths')
  })

  it('round 2: widths in a table inside a list, and in a later side', () => {
    const el = renderCard('* item\n\n  | a | b |\n  |---|---|\n  | 1 | 2 |\n  <!-- table: widths 120 auto -->\n---\n| c |\n|---|\n| 3 |\n<!-- table: widths 90 -->')
    const widths = [...el.querySelectorAll('table')].map((t) => [...t.querySelectorAll('col')].map((c) => c.style.width))
    expect(widths).toEqual([['120px', ''], ['90px']])
  })

  it('a card with no table has no table box', () => {
    expect(renderCard('Plain {{text}}').querySelector('.card__table')).toBeNull()
  })
})

describe('renderCard: the table look the page saved (YAZ-5867)', () => {
  it('a cell centred by the comment`s `align` keeps `text-align: center`', () => {
    const el = renderCard('| a | b |\n|---|---|\n| 1 | 2 |\n<!-- table: align B2 center -->')
    const cells = [...el.querySelectorAll<HTMLElement>('tbody td')]
    expect(cells[1].style.textAlign).toBe('center')
    expect(cells[0].style.textAlign).toBe('')
  })

  const T3 = '| h1 | h2 | h3 |\n|---|---|---|\n| {{a}} | b | c |\n| d | e | f |\n| g | h | i |'
  const table = (comment: string, text = T3) => renderCard(`${text}\n<!-- table: ${comment} -->`).querySelector<HTMLTableElement>('.card__table > table')!
  const at = (t: HTMLTableElement, r: number, c: number) => t.rows[r]!.cells[c] as HTMLTableCellElement

  it('fill: a named fill and a custom solid hex fill (plus #rrggbbaa and auto-contrast tone, YAZ-6692)', () => {
    const t = table('fill A2 blue B3 #ff8800 A1 #000000 B1 #434343 C1 #d9d9d9 C2 #00000040')
    expect(at(t, 1, 0).dataset.fill).toBe('blue')
    expect(at(t, 2, 1).dataset.fill).toBe('#ff8800')
    expect(at(t, 2, 1).style.getPropertyValue('--table-fill-custom')).toBe('#ff8800')
    expect(at(t, 1, 1).hasAttribute('data-fill')).toBe(false)
    expect(at(t, 1, 0).style.getPropertyValue('--cell-fill')).toBe('var(--table-fill-blue)')
    expect(at(t, 2, 1).style.getPropertyValue('--cell-fill')).toBe('var(--table-fill-custom)')
    expect(at(t, 0, 0).dataset.fillTone).toBe('dark')
    expect(at(t, 0, 1).dataset.fillTone).toBe('dark')
    expect(at(t, 0, 2).dataset.fillTone).toBe('light')
    expect(at(t, 1, 2).hasAttribute('data-fill-tone')).toBe(false)
    expect([fillTone('#000000'), fillTone('#434343'), fillTone('#d9d9d9'), fillTone('#ffffff'), fillTone('#00000080'), fillTone('#00000040')]).toEqual(['dark', 'dark', 'light', 'light', 'dark', null])
  })

  it('text colour on a dark solid fill checks contrast against the cell fill, not PAGE_BG (YAZ-6692 D1)', () => {
    const t = table('fill A1 #000000 B1 #434343, color A1:B1 #ffffff')
    for (const col of [0, 1]) {
      const cell = at(t, 0, col)
      expect(cell.style.getPropertyValue('--cell-ink-light')).toBe('#ffffff')
      expect(cell.style.getPropertyValue('--cell-ink-dark')).toBe('#ffffff')
      expect(cell.hasAttribute('data-fill-tone')).toBe(false)
    }
  })

  it('header and subheader custom hex set --table-header-hue / --table-header-ink vars (YAZ-6692 #6)', () => {
    const t = table('header #1a2b3c80 text-#ffffff, subhead 2, subheader #434343 text-#d9d9d9')
    expect(t.style.getPropertyValue('--table-header-hue')).toBe('#1a2b3c80')
    expect(t.style.getPropertyValue('--table-header-ink')).toBe('#ffffff')
    expect(t.style.getPropertyValue('--table-subheader-hue')).toBe('#434343')
    expect(t.style.getPropertyValue('--table-subheader-ink')).toBe('#d9d9d9')
  })

  it('text colour: a name, and a custom colour made readable in light and in dark', () => {
    const t = table('color A1 red C2 #222222')
    expect(at(t, 0, 0).dataset.color).toBe('red')
    expect(at(t, 0, 0).style.getPropertyValue('--cell-ink')).toBe('var(--table-text-red)')
    expect(at(t, 1, 2).style.getPropertyValue('--cell-ink')).toBe('')
    const ink = at(t, 1, 2)
    expect(ink.dataset.color).toBe('#222222')
    expect(ink.style.getPropertyValue('--cell-ink-light')).toBe('#222222')
    const dark = ink.style.getPropertyValue('--cell-ink-dark')
    expect(dark).not.toBe('#222222')
    expect(contrast(dark, PAGE_BG.dark)).toBeGreaterThanOrEqual(INK_CONTRAST)
  })

  it('merge: the top-left cell spans the range, the covered cells go; a range past the table is dropped', () => {
    const t = table('merge B2:C3 A3:A9')
    expect([at(t, 1, 1).colSpan, at(t, 1, 1).rowSpan]).toEqual([2, 2])
    expect(at(t, 1, 1).hasAttribute('data-merged')).toBe(true)
    expect([...t.rows].map((r) => r.cells.length)).toEqual([3, 2, 1, 3])
  })

  it('the header row look, the table`s valign, stripes, border, height, Clip and subheads', () => {
    const t = table('valign middle A2 bottom, border 3px 40%, header red strong regular text-blue align-center, stripes, height tall, nowrap, subhead 3')
    expect(Object.fromEntries(['color', 'strength', 'weight', 'text', 'align'].map((p) => [p, t.getAttribute(`data-header-${p}`)]))).toEqual({
      color: 'red',
      strength: 'strong',
      weight: 'regular',
      text: 'blue',
      align: 'center',
    })
    expect([t.dataset.valign, t.dataset.height, t.hasAttribute('data-stripes'), t.hasAttribute('data-border')]).toEqual(['middle', 'tall', true, true])
    // The Mac's border as saved: a card is no phone page (2 px at most there).
    expect(t.style.getPropertyValue('--table-border-px')).toBe('3px')
    expect(t.style.getPropertyValue('--table-border-dark')).toBe('40%')
    expect(at(t, 1, 0).style.verticalAlign).toBe('bottom')
    expect(at(t, 1, 0).hasAttribute('data-clip')).toBe(true)
    expect(t.rows[2]!.classList.contains('table-subhead-row')).toBe(true)
    expect(at(t, 2, 0).hasAttribute('data-subhead')).toBe(true)
    // The variables `cardTable.css`'s header rule paints (its mapping, as values).
    expect(['hue', 'scale', 'strength', 'weight', 'ink'].map((v) => t.style.getPropertyValue(`--table-header-${v}`))).toEqual(['var(--table-fill-solid-red)', '2.5', '20', '400', 'var(--table-text-blue)'])
  })

  it('a hidden word in a styled cell is still a blank, and shows in its turn', () => {
    const blank = renderCard(`${T3}\n<!-- table: fill A2 yellow, align A2 right -->`, { shown: 0 }).querySelector<HTMLTableElement>('table')!
    expect(at(blank, 1, 0).firstElementChild?.className).toBe('card__blank')
    expect(at(blank, 1, 0).style.textAlign).toBe('right')
    const shown = renderCard(`${T3}\n<!-- table: fill A2 yellow -->`, { shown: 1 }).querySelector('tbody td')!
    expect(shown.firstElementChild?.className).toBe('card__hidden')
  })

  it('no comment and a widths-only comment: the look of before; the widths still size the table', () => {
    const none = renderCard(T3).querySelector('table')!
    expect([...none.querySelectorAll('*')].some((el) => [...el.attributes].some((a) => a.name.startsWith('data-') && a.name !== 'data-hidden'))).toBe(false)
    const widths = table('widths 100 auto 80')
    expect(widths.dataset.sized).toBe('')
    expect([...widths.attributes].map((a) => a.name).sort()).toEqual(['data-sized', 'style'])
  })

  it('merged header cells keep the widths of every column (the widths go first)', () => {
    const t = table('widths 100 120 80, merge A1:B1')
    expect([...t.querySelectorAll('col')].map((c) => c.style.width)).toEqual(['100px', '120px', '80px'])
    expect(t.rows[0]!.cells).toHaveLength(2)
  })

  it('a raw HTML table before a GFM table does not take its look', () => {
    const el = renderCard(`<table><tr><td>raw</td></tr></table>\n\n${T3}\n<!-- table: fill A2 blue -->`)
    const [raw, gfm] = [...el.querySelectorAll('table')]
    expect(raw.querySelector('[data-fill]')).toBeNull()
    expect(gfm.querySelector('td')?.dataset.fill).toBe('blue')
  })

  it('stays safe: a comment`s text never reaches the DOM as markup; only the parser`s values are set', () => {
    const el = renderCard(`${T3}\n<!-- table: fill A2 "><img src=x onerror=alert(1)>, align A2 center -->`)
    expect(el.querySelector('img, [onerror]')).toBeNull()
    expect(el.querySelector<HTMLElement>('tbody td')!.style.textAlign).toBe('center')
  })

  it('renders inline text colour, font size, and custom highlights safely on Desktop and Mobile cards (YAZ-6694 #5)', async () => {
    const { cardSafety } = await import('./cardSafety')
    const md = '<span class="text-color-red">named</span> <span style="color: #123456">hex</span> <span style="font-size: 24px">big</span> <mark style="background-color: #ff0000">solid</mark> <span style="background: url(https://evil.test/x)">safe</span>'
    const desktop = renderCard(md)
    expect(desktop.querySelector('span.text-color-red')?.textContent).toBe('named')
    expect(desktop.querySelector<HTMLElement>('span[style*="color"]')?.style.color).toBe('rgb(18, 52, 86)')
    expect(desktop.querySelector<HTMLElement>('span[style*="font-size"]')?.style.fontSize).toBe('24px')
    expect(desktop.querySelector<HTMLElement>('mark')?.style.backgroundColor).toBe('rgb(255, 0, 0)')

    cardSafety.local = true
    try {
      const mobile = renderCard(md)
      expect(mobile.querySelector('span.text-color-red')?.textContent).toBe('named')
      expect(mobile.querySelector<HTMLElement>('span[style*="color"]')?.style.color).toBe('rgb(18, 52, 86)')
      expect(mobile.querySelector<HTMLElement>('span[style*="font-size"]')?.style.fontSize).toBe('24px')
      expect(mobile.querySelector<HTMLElement>('mark')?.style.backgroundColor).toBe('rgb(255, 0, 0)')
      expect(mobile.innerHTML).not.toContain('evil.test')
    } finally {
      cardSafety.local = false
    }
  })
})

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('card.css: a card`s table looks like the page`s (YAZ-5136)', () => {
  // The Mac's table look as it loads: `cardTable.css`, then `table.css` (`tableStyle.ts`).
  const tableCss = read('../table/cardTable.css') + read('../table/table.css')
  const cardCss = read('./card.css')
  const crepeTable = read('../../../../node_modules/@milkdown/crepe/lib/theme/common/table.css')
  const frame = (name: string) => read(`../../../../node_modules/@milkdown/crepe/lib/theme/${name}/style.css`).match(/--crepe-color-outline:\s*(#[0-9a-f]+)/i)?.[1]

  it('the page`s border, header row and header Align rules are the card`s too: one rule each, not a copy', () => {
    const shared = (needle: RegExp) => rules(tableCss, '.card__side').filter((r) => r.selector.includes('.milkdown-table-block') && needle.test(r.body))
    expect(shared(/border-width:\s*var\(--table-border-width, 1px\)/)).toHaveLength(1)
    expect(shared(/--table-cell-tint:\s*color-mix/)).toHaveLength(1)
    expect(shared(/background-color:\s*var\(--table-cell-tint, transparent\)/)).toHaveLength(1)
    expect(shared(/text-align:\s*var\(--table-header-align\)/)).toHaveLength(1)
    // The line under the header row: the page's sticky header row draws it.
    expect(shared(/border-bottom-width:\s*3px/)).toHaveLength(1)
  })

  it('rounds 2 and 3: Table position is ONE rule from ONE variable: a page table block, its table and a card`s table; a card reads Card tables, falling back to the pages`', () => {
    expect(rules(tableCss, '.card__table > table').filter((r) => /margin-inline/.test(r.body))).toEqual([
      { selector: '.app :is(.milkdown-table-block, .milkdown-table-block table, .card__table > table)', body: expect.stringMatching(/^\s*margin-inline: var\(--table-inline, var\(--page-table-inline, 0\)\);\s*$/) },
    ])
    const card = rules(tableCss, '.card').filter((r) => r.selector === '.card' && /--table-inline/.test(r.body))
    expect(card).toHaveLength(1)
    expect(card[0].body).toMatch(/--table-inline:\s*var\(--card-table-inline, var\(--page-table-inline, 0\)\)/)
    expect(tableCss).not.toMatch(/data-table-position/)
    // No card rule sets a table's inline margin over it.
    expect(rules(cardCss, 'table').filter((r) => /\stable(\[[^\]]*\])?$/.test(r.selector) && /(^|[\s;])margin(-inline)?(-left|-right)?\s*:/.test(r.body))).toEqual([])
    // The card's table sits in its scroll box (`.card__table`), so a centred table wider than the card still scrolls.
    expect(rules(cardCss, '.card__sides .card__table').some((r) => /overflow-x:\s*auto/.test(r.body))).toBe(true)
  })

  it('outside a page, the border reads `--table-outline`: Crepe`s own outline colour, light and dark', () => {
    expect(tableCss).toMatch(/var\(--crepe-color-outline, var\(--table-outline\)\)/)
    const root = rules(tableCss, ':root').find((r) => r.body.includes('--table-outline'))!
    const dark = rules(tableCss, "[data-theme='dark']").find((r) => r.body.includes('--table-outline'))!
    expect(root.body).toContain(`--table-outline: ${frame('frame')}`)
    expect(dark.body).toContain(`--table-outline: ${frame('frame-dark')}`)
  })

  it('a cell`s padding is Crepe`s page cell padding, and a wide table scrolls inside the card', () => {
    const crepePad = crepeTable.match(/padding:\s*([^;]+);/)?.[1]
    expect(crepePad).toBe('4px 16px')
    const cell = rules(cardCss, '.card__sides .card__side :is(th, td)').find((r) => /padding:/.test(r.body))!
    expect(cell.body).toMatch(/padding:\s*calc\(4px \+ var\(--card-gap\)\) 16px/)
    const box = rules(cardCss, '.card__sides .card__table').find((r) => /overflow-x:\s*auto/.test(r.body))
    expect(box).toBeDefined()
    // Round 2: a table the page sized lays out as the page's: fixed.
    expect(rules(cardCss, '.card__sides .card__side table[data-sized]').some((r) => /table-layout:\s*fixed/.test(r.body))).toBe(true)
  })
})

describe('card.css: the saved look`s marks in a card`s table (YAZ-5867)', () => {
  const cardCss = read('./card.css')
  const own = rules(cardCss, '.card__table:not(.page-table) > table')

  it('each mark has its rule, inside `.card__table` and never in a phone page`s table box (its `tables.css` draws it)', () => {
    for (const mark of ['[data-fill]', '[data-color]', "[data-color^='#']", '[data-header-color]', "[data-header-align='center']", '[data-stripes]', '[data-border]', "[data-height='tall']", "[data-valign='middle']", '[data-clip]', 'td[data-subhead]'])
      expect(own.some((r) => r.selector.includes(mark)), mark).toBe(true)
    expect(rules(cardCss, '[data-fill').every((r) => r.selector.includes('.card__table:not(.page-table)'))).toBe(true)
  })

  it('a text colour reads `--cell-ink` (a name), else `--cell-ink-light`, and `--cell-ink-dark` in dark (the Mac`s and the phone`s theme marks)', () => {
    expect(own.find((r) => r.selector.endsWith('[data-color]'))?.body).toMatch(/color:\s*var\(--cell-ink, var\(--cell-ink-light\)\)/)
    const dark = own.find((r) => r.selector.includes("[data-color^='#']"))!
    expect(dark.selector).toMatch(/\[data-theme='dark'\]/)
    expect(dark.selector).toMatch(/\[data-scheme='dark'\]/)
    expect(dark.body).toMatch(/color:\s*var\(--cell-ink-dark\)/)
  })

  it('a fill beats the stripes, the subheader rows and the header row`s shade (it is later, and weighs as much or more)', () => {
    const fill = own.find((r) => r.body.includes('--table-cell-tint: var(--cell-fill)'))!
    for (const other of [own.find((r) => r.body.includes('4%'))!, own.find((r) => r.selector.endsWith('td[data-subhead]') && r.body.includes('--table-cell-tint'))!]) {
      expect(cardCss.lastIndexOf(fill.selector)).toBeGreaterThan(cardCss.indexOf(other.selector.split(',')[0]!))
      // `:where()` weighs nothing (the helper reads no `:where`).
      for (const sel of other.selector.split(',')) expect(beats(specificity(sel.trim().replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '')), specificity(fill.selector))).toBe(false)
    }
    const header = rules(read('../table/cardTable.css'), '.card__sides .card__side th').find((r) => r.body.includes('--table-cell-tint'))!
    expect(beats(specificity(fill.selector), specificity(header.selector.split(',').at(-1)!.trim()))).toBe(true)
  })
})
