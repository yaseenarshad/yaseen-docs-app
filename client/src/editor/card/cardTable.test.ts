/**
 * A card's tables, read (YAZ-5136, Yaseen: "even if there is a table in the editor, it doesnt render in the reader"):
 * the one render (`renderCard`) that the Inbox, Explore, the card file tab, a card embed and the card window share
 * gives a GFM table, in a box that scrolls sideways, with its hidden words; and `card.css` draws it as the page's
 * tables, from `table.css`'s rules and variables.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { rules } from '../cssRules'
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

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('card.css: a card`s table looks like the page`s (YAZ-5136)', () => {
  const tableCss = read('../table/table.css')
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
