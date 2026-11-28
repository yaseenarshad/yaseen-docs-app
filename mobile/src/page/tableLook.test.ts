// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://app.example/"}
import { TABLE_COLORS } from '@client/editor/table/tableComment'
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { LOOK, LOOK_CLIP, LOOK_CLIP_COMMENT, LOOK_COMMENT, LOOK_PAGE, TWO_LONG } from '../dev/tableFixtures'
import { renderPage, type PageLook } from './pageRender'
import { BORDER_PX_PHONE, INK_CONTRAST, PAGE_BG, contrast, readableInk } from './tableFile'
import { GROW_MIN, GROW_MIN_LONG, MAC_WIDTH_SCALE, columnsOf, macWidths } from './tableLayout'
import { showTable } from './tableView'

/**
 * YAZ-5482: what the table comment says of a table's look, translated for the phone. The marks and the rules are
 * checked here; the drawn look, light and dark at 375 px, in headless Chrome (`publish/proveLayout.ts`,
 * `page-table-look`, with pictures).
 */
let css = ''
// A path in a variable: Vite rewrites a literal `new URL('./x.css', import.meta.url)` into a served address.
const SHEET = './tables.css'
beforeAll(() => {
  css = readFileSync(new URL(SHEET, import.meta.url), 'utf8')
})
const look: PageLook = {
  link: (inner) => ({ label: inner, open: { kind: 'page', path: `${inner}.md` } }),
  embed: (inner) => ({ kind: 'text', text: `![[${inner}]]` }),
  asset: () => null,
  card: () => document.createElement('div'),
}
async function tables(text: string): Promise<HTMLTableElement[]> {
  const body = document.createElement('div')
  body.className = 'reader__body'
  document.body.append(body)
  await renderPage(text, look, body)
  return [...body.querySelectorAll('table')]
}
const one = async (text: string) => (await tables(text))[0]!
afterEach(() => document.querySelectorAll('.reader__body, .table-view').forEach((el) => el.remove()))

describe("the file's look on the phone (YAZ-5482)", () => {
  it('widths: proportions and floors for the long columns, the text for the short ones, never unreadable', async () => {
    const t = await one(`${TWO_LONG}\n\n<!-- table: widths 400 100 -->`)
    expect(t.dataset.widths).toBe('400 100')
    expect(macWidths(t)).toEqual([(400 * MAC_WIDTH_SCALE) / 14, (100 * MAC_WIDTH_SCALE) / 14])
    const [name, text] = columnsOf(t)
    // "Habit" is short: its text's width, not the Mac's 400 px.
    expect(name.kind).toBe('fit')
    expect(name.max).toBeLessThan(10)
    // The long column keeps its own min (its words), however narrow the Mac made it; its weight is the Mac's.
    expect(text.kind).toBe('grow')
    expect(text.min).toBeGreaterThanOrEqual(GROW_MIN)
    expect(text.weight).toBe((100 * MAC_WIDTH_SCALE) / 14)
    // Two long columns share the screen in the Mac's proportions; the Mac's width is a floor up to GROW_MIN_LONG.
    const wide = await one(`| A | B |\n| --- | --- |\n| ${'word '.repeat(30)} | ${'word '.repeat(30)} |\n\n<!-- table: widths 600 200 -->`)
    const [a, b] = columnsOf(wide)
    expect(a.min).toBe(GROW_MIN_LONG)
    expect(b.min).toBe(GROW_MIN_LONG)
    const weights = [...wide.querySelectorAll('col')].map((c) => Number((c as HTMLElement).style.getPropertyValue('--col-weight')))
    expect(weights).toEqual([0.75, 0.25])
    // `auto` is the phone's own rule.
    expect(macWidths(await one(`${TWO_LONG}\n\n<!-- table: widths auto 300 -->`))[0]).toBeNull()
  })

  it('fills and text colours: the Mac names in both themes, a custom fill as its wash, a custom ink made readable', async () => {
    const t = await one(`${LOOK}\n\n${LOOK_COMMENT}`)
    const cell = (r: number, c: number) => t.rows[r]!.cells[c]!
    expect([...t.rows[0].cells].every((c) => c.dataset.fill === 'blue')).toBe(true)
    expect(t.querySelector('[data-fill="#ff8800"]')?.textContent).toBe('Ana')
    expect((t.querySelector('[data-fill="#ff8800"]') as HTMLElement).style.getPropertyValue('--table-fill-custom')).toBe('#ff8800')
    expect(cell(3, 3).dataset.color).toBe('red')
    const ink = t.querySelector<HTMLElement>('[data-color="#1a1a40"]')!
    expect(ink.style.getPropertyValue('--cell-ink-light')).toBe('#1a1a40')
    expect(contrast(ink.style.getPropertyValue('--cell-ink-dark'), PAGE_BG.dark)).toBeGreaterThanOrEqual(INK_CONTRAST)
    // Each of the Mac's ten colours has a fill and a text rule, and a light and a dark shade.
    for (const name of TABLE_COLORS) {
      expect(css).toContain(`[data-fill='${name}'] { --cell-tint: var(--table-fill-${name}); }`)
      expect(css).toContain(`[data-color='${name}'] { color: var(--table-text-${name}); }`)
      expect(css.match(new RegExp(`--table-fill-${name}: rgba`, 'g'))?.length).toBe(2)
      expect(css.match(new RegExp(`--table-text-${name}: #`, 'g'))?.length).toBe(2)
    }
  })

  it('readableInk keeps a readable colour and moves an unreadable one just enough', () => {
    expect(readableInk('#1d5fbf', PAGE_BG.light)).toBe('#1d5fbf')
    for (const hex of ['#000000', '#1a1a40', '#333333', '#ffff00', '#ffffff', '#88ccff']) {
      for (const bg of [PAGE_BG.light, PAGE_BG.dark]) expect(contrast(readableInk(hex, bg), bg)).toBeGreaterThanOrEqual(INK_CONTRAST)
    }
  })

  it('YAZ-6692: solid custom hex fills, #rrggbbaa, auto-contrast fill-tone, readableInk on dark fills, pure black, and header/subheader hex', async () => {
    const t = await one(
      `| A | B | C |\n| - | - | - |\n| 1 | 2 | 3 |\n\n<!-- table: fill A1 #000000 B1 #434343 C1 #d9d9d9 A2 #000000 B2 #43434340, color A1:B1 #ffffff, header #11223380 text-#ffffff, subhead 2, subheader #434343 text-#eeeeee -->`,
    )
    expect(t.rows[0]!.cells[0]!.style.getPropertyValue('--cell-ink-light')).toBe('#ffffff')
    expect(t.rows[0]!.cells[0]!.style.getPropertyValue('--cell-ink-dark')).toBe('#ffffff')
    expect(t.rows[0]!.cells[1]!.style.getPropertyValue('--cell-ink-light')).toBe('#ffffff')
    expect(t.rows[0]!.cells[2]!.dataset.fillTone).toBe('light')
    expect(t.rows[1]!.cells[0]!.dataset.fillTone).toBe('dark')
    expect(t.rows[1]!.cells[1]!.hasAttribute('data-fill-tone')).toBe(false)
    expect(t.rows[1]!.cells[1]!.style.getPropertyValue('--table-fill-custom')).toBe('#43434340')
    expect(t.style.getPropertyValue('--table-header-hue')).toBe('#11223380')
    expect(t.style.getPropertyValue('--table-header-ink')).toBe('#ffffff')
    expect(t.style.getPropertyValue('--table-subheader-hue')).toBe('#434343')
    expect(t.style.getPropertyValue('--table-subheader-ink')).toBe('#eeeeee')
    expect(css).toContain("--table-fill-solid-black: #000000;")
    expect(css).toContain("[data-fill^='#'] { --cell-tint: var(--table-fill-custom); }")
    expect(css).toContain("[data-fill-tone='dark'] { color: #ffffff; }")
    expect(css).toContain("[data-fill-tone='light'] { color: #111111; }")
  })

  it("alignment: a cell's own wins over its column's; the table's vertical alignment and a cell's own", async () => {
    const t = await one(`${LOOK}\n\n${LOOK_COMMENT}`)
    expect(t.dataset.valign).toBe('middle')
    expect(t.rows[5]!.cells[0]!.style.textAlign).toBe('center')
    expect(t.rows[1]!.cells[4]!.style.verticalAlign).toBe('top')
    expect(css).toMatch(/table\[data-valign='middle'\] :is\(th, td\) \{ vertical-align: middle; \}/)
  })

  it('merged cells: colspan and rowspan, the covered cells gone; a merge the table cannot take is dropped', async () => {
    const t = await one(`${LOOK}\n\n${LOOK_COMMENT}`)
    const garden = t.rows[1]!.cells[0]!
    expect([garden.textContent, garden.rowSpan, garden.colSpan]).toEqual(['Garden', 2, 1])
    expect(t.rows[2]!.cells[0]!.textContent).toBe('Ana')
    expect(t.rows[2]!.cells.length).toBe(4)
    const total = t.rows[5]!.cells[1]!
    expect([total.textContent, total.colSpan]).toEqual(['6,300', 2])
    expect(t.rows[5]!.cells.length).toBe(4)
    // From the header row into the body: the Mac drops it on load, so does the phone.
    const bad = await one(`${LOOK}\n\n<!-- table: merge A1:A2 -->`)
    expect(bad.querySelector('[rowspan="2"]')).toBeNull()
    expect(bad.rows[1]!.cells.length).toBe(5)
  })

  it('header row: plain, a colour and strength, weight, text colour and alignment', async () => {
    const [plain, red] = await tables(LOOK_PAGE)
    expect(plain.dataset.headerStrength).toBe('off')
    expect([red.dataset.headerColor, red.dataset.headerStrength, red.dataset.headerWeight, red.dataset.headerText, red.dataset.headerAlign]).toEqual(['red', 'strong', 'regular', 'white', 'center'])
    expect(css).toContain(".page-table-box table[data-header-strength='off'] { --th-strength: 0; }")
    // White text on a colour: the colour deepened, so it reads.
    expect(css).toContain("table[data-header-text='white'][data-header-color]")
  })

  it('stripes, border (at most 2 px), row height', async () => {
    const t = await one(`${LOOK}\n\n${LOOK_COMMENT}`)
    expect(t.hasAttribute('data-stripes')).toBe(true)
    expect(t.dataset.height).toBe('compact')
    expect(t.style.getPropertyValue('--table-border-px')).toBe('2px')
    expect(t.style.getPropertyValue('--table-border-dark')).toBe('40%')
    const thick = await one(`${TWO_LONG}\n\n<!-- table: border 8px 60% -->`)
    expect(thick.style.getPropertyValue('--table-border-px')).toBe(`${BORDER_PX_PHONE}px`)
  })

  it("clip: the table's and each column's; one line cut with … in the page, the whole text full screen", async () => {
    const t = await one(`${LOOK_CLIP}\n\n${LOOK_CLIP_COMMENT}`)
    const row = t.rows[1]!
    expect([...row.cells].map((c) => c.hasAttribute('data-clip'))).toEqual([true, true, false])
    const box = row.cells[0]!.querySelector<HTMLElement>('.page-table__clip')!
    expect(box.textContent).toContain('The long walk home')
    expect(box.style.maxWidth).toMatch(/em$/)
    expect(css).toMatch(/\.table-view \.page-table__clip \{\s*max-width: none !important;\s*white-space: normal;/)
    const view = showTable(t.closest<HTMLElement>('.page-table-box')!)
    expect(view.el.querySelector('.page-table__clip')).not.toBeNull()
    view.close()
  })

  it('clipTable_columnsFitHeaderWords_whenRoom (sweep3 N-6): Clip on a narrow table cuts nothing that fits: its headers stay whole', async () => {
    const t = await one('| Fruit | Count | Ripe |\n| --- | --- | --- |\n| Apple | 12 | yes |\n| Pear | 3 | no |\n\n<!-- table: header blue strong, nowrap -->')
    expect([...t.rows[0]!.cells].every((c) => c.hasAttribute('data-clip'))).toBe(true)
    // Every column is short (FIT): as wide as its text, so no cell is cut, the headers least of all.
    expect(columnsOf(t).map((c) => c.kind)).toEqual(['fit', 'fit', 'fit'])
    expect(t.querySelectorAll('.page-table__clip')).toHaveLength(0)
    expect([...t.rows[0]!.cells].map((c) => c.textContent)).toEqual(['Fruit', 'Count', 'Ripe'])
    // A header of two words in a clipped column is one line: the column is as wide as all of it.
    const two = await one('| Ripe date | N |\n| --- | --- |\n| May | 1 |\n\n<!-- table: nowrap -->')
    expect(two.querySelectorAll('th .page-table__clip')).toHaveLength(0)
    expect(columnsOf(two)[0]!.max).toBeCloseTo(1.5 + 0.62 + 3 * 0.5 + 0.5 + 4 * 0.5, 1)
    // A text truly longer than its column is still cut (one line, "…").
    const long = await one(`${LOOK_CLIP}\n\n${LOOK_CLIP_COMMENT}`)
    expect(long.rows[1]!.cells[0]!.querySelector('.page-table__clip')).not.toBeNull()
  })

  it('a table with no comment looks as before', async () => {
    const t = await one(TWO_LONG)
    for (const name of ['data-widths', 'data-stripes', 'data-border', 'data-height', 'data-valign', 'data-header-strength']) expect(t.hasAttribute(name)).toBe(false)
    expect(t.querySelector('[data-fill], [data-color], [data-clip], [data-merged]')).toBeNull()
  })
})
