// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://app.example/"}
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CODE_LINKS, EIGHT_SPARSE, NARROW, NUMBERS, SIX_WIDE, TABLE_PAGE, TWO_LONG } from '../dev/tableFixtures'
import { renderPage, type PageLook } from './pageRender'
import { FIT_MAX, GROW_MAX, GROW_MIN, GROW_MIN_LONG, PAD, STICKY_MAX, columnsOf, textEm } from './tableLayout'
import { SWIPE_CLOSE, showTable } from './tableView'
import { markTable, watchTables } from './useTables'

/**
 * YAZ-5471: tables on the phone. The column widths come from the text (no layout: jsdom has none), so the rules are
 * checked on the marks they leave; the look on the computed style with the phone's real stylesheets; the ⤢ and the
 * full-screen view with the real code. The layout itself (real widths, nothing letter by letter, the sticky column) is
 * checked in headless Chrome (`publish/proveLayout.ts`, the `page-tables` fixture).
 */
const sheet = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const SHEETS = ['../styles.css', '../../../client/src/editor/card/card.css', '../../../client/src/editor/table/cardTable.css', './reader.css', './tables.css']

const look: PageLook = {
  link: (inner) => ({ label: inner, open: { kind: 'page', path: `${inner}.md` } }),
  embed: (inner) => ({ kind: 'text', text: `![[${inner}]]` }),
  asset: () => null,
  card: () => document.createElement('div'),
}

async function draw(text: string): Promise<HTMLElement> {
  const body = document.createElement('div')
  body.className = 'reader__body'
  document.body.append(body)
  await renderPage(text, look, body)
  return body
}
const tableOf = async (text: string) => (await draw(text)).querySelector('table')!
const kinds = (t: HTMLTableElement) => columnsOf(t).map((c) => c.kind)
/** The size a box reports (jsdom has no layout). */
function sized(el: HTMLElement, scrollWidth: number, clientWidth: number, scrollLeft = 0) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth })
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth })
  el.scrollLeft = scrollLeft
}

let styles: HTMLStyleElement[] = []
beforeAll(() => {
  styles = SHEETS.map((path) => {
    const el = document.createElement('style')
    el.textContent = sheet(path)
    document.head.append(el)
    return el
  })
})
afterAll(() => styles.forEach((s) => s.remove()))
afterEach(() => {
  document.querySelectorAll('.reader__body, .table-view').forEach((el) => el.remove())
})

describe('column widths from the text (YAZ-5471)', () => {
  it('short columns (a word, numbers, check marks) fit and never wrap; numbers align right', async () => {
    const table = await tableOf(NARROW)
    expect(kinds(table)).toEqual(['fit', 'fit', 'fit'])
    for (const col of columnsOf(table)) expect(col.max).toBeLessThanOrEqual(FIT_MAX)
    const cells = [...table.tBodies[0].rows].map((r) => [...r.cells])
    expect(cells.every((row) => row.every((c) => c.hasAttribute('data-fit')))).toBe(true)
    expect(cells.map((row) => row[1].hasAttribute('data-num'))).toEqual([true, true, true, true])
    expect(cells[0][0].hasAttribute('data-num')).toBe(false)
    // Nothing wraps in a short column; a number is right aligned, in even digits.
    expect(getComputedStyle(cells[0][0]).whiteSpace).toBe('nowrap')
    expect(getComputedStyle(cells[0][1]).textAlign).toBe('end')
    // An all-short table gets no grow column, so no share of the screen.
    expect(table.querySelectorAll('col.page-table__grow')).toHaveLength(0)
  })

  it('a long column wraps between its min and max (7 to 22 em); a column of paragraphs has a wider min', async () => {
    const table = await tableOf(TWO_LONG)
    const [name, text] = columnsOf(table)
    expect(name.kind).toBe('fit')
    expect(text.kind).toBe('grow')
    expect(text.max).toBe(GROW_MAX)
    expect(text.min).toBe(GROW_MIN_LONG)
    const col = table.querySelectorAll('col')[1] as HTMLElement
    expect(col.className).toBe('page-table__grow')
    expect(col.style.getPropertyValue('--col-min')).toBe(`${GROW_MIN_LONG}em`)
    expect(col.style.getPropertyValue('--col-max')).toBe(`${GROW_MAX}em`)
    expect(col.style.getPropertyValue('--col-weight')).toBe('1')
    expect(table.style.getPropertyValue('--table-fixed')).toBe(`${name.max}em`)
    // Two columns: nothing sticks.
    expect(table.hasAttribute('data-sticky')).toBe(false)
    // The CSS shares the box's width by weight, between the min and the max.
    expect(sheet('./tables.css')).toMatch(/col\.page-table__grow \{[^}]*width: clamp\(var\(--col-min\), calc\(\(100cqw - var\(--table-fixed, 0em\) - 2px\) \* var\(--col-weight, 1\)\), var\(--col-max\)\);/)
  })

  it('wraps by words, never letter by letter: a long column is never narrower than its longest word (up to its min cap)', async () => {
    const body = await draw(TABLE_PAGE)
    for (const table of body.querySelectorAll('table')) {
      columnsOf(table).forEach((col, c) => {
        if (col.kind !== 'grow') return
        const words = [...table.rows].flatMap((r) => (r.cells[c]?.textContent ?? '').split(/\s+/))
        const longest = Math.max(...words.map((w) => textEm(w)))
        expect(col.min).toBeGreaterThanOrEqual(Math.min(longest + PAD, GROW_MIN_LONG, col.max) - 0.1)
        expect(col.min).toBeGreaterThanOrEqual(Math.min(GROW_MIN, col.max))
        expect(col.max).toBeLessThanOrEqual(GROW_MAX)
      })
    }
    // Before (the bug): a cell took the reader's `overflow-wrap: anywhere` in an auto column, squeezed to one letter.
    // Now an auto (short) column is `nowrap`, and a long one has a min width, so `anywhere` only breaks a word longer than its column.
    const cell = body.querySelector('td[data-fit]')!
    expect(getComputedStyle(cell).overflowWrap).toBe('normal')
  })

  it('six columns and more: widths for each, the first column sticky and at most 11 em', async () => {
    const six = await tableOf(SIX_WIDE)
    expect(kinds(six)).toEqual(['fit', 'fit', 'grow', 'fit', 'grow', 'grow'])
    expect(six.hasAttribute('data-sticky')).toBe(true)
    const eight = await tableOf(EIGHT_SPARSE)
    const cols = columnsOf(eight)
    expect(cols[0].kind).toBe('grow')
    expect(cols[0].max).toBeLessThanOrEqual(STICKY_MAX)
    expect(cols.slice(1).every((c) => c.kind === 'fit')).toBe(true)
    // Empty cells change nothing: an empty column of marks is still short.
    expect(eight.querySelectorAll('col')).toHaveLength(8)
  })

  it('numbers: right aligned unless the Markdown aligns the column; a link and code count as their text', async () => {
    const nums = await tableOf(NUMBERS)
    const row = nums.tBodies[0].rows[0].cells
    expect([...row].map((c) => c.hasAttribute('data-num'))).toEqual([false, true, true, true, false])
    expect(row[4].getAttribute('align')).toBe('center')
    const code = await tableOf(CODE_LINKS)
    const [command, what, more] = columnsOf(code)
    expect(command.kind).toBe('grow')
    expect(what.kind).toBe('grow')
    expect(more.kind).toBe('grow')
    // A long address with no spaces: the column keeps its cap, the address breaks in it (a last resort).
    expect(more.min).toBeLessThanOrEqual(GROW_MIN_LONG)
  })

  it('a table the Mac sized keeps its widths; a table is laid out once', async () => {
    const table = await tableOf(NARROW)
    const before = table.outerHTML
    const { layoutTable } = await import('./tableLayout')
    layoutTable(table)
    expect(table.outerHTML).toBe(before)
    const sized = document.createElement('table')
    sized.setAttribute('data-sized', '')
    sized.innerHTML = '<tr><td>a</td></tr>'
    layoutTable(sized)
    expect(sized.hasAttribute('data-cols')).toBe(false)
  })
})

describe('the look (YAZ-5471)', () => {
  it('the sticky first column sticks at the left on a solid colour; nothing else sticks', async () => {
    const body = await draw(`${SIX_WIDE}\n\n${TWO_LONG}`)
    const [six, two] = [...body.querySelectorAll('table')]
    for (const row of six.rows) {
      expect(getComputedStyle(row.cells[0]).position).toBe('sticky')
      // YAZ-5480: at its column's measured offset, the first column's 0 (jsdom does not resolve the variable).
      expect(getComputedStyle(row.cells[0]).left).toBe('var(--pin-left, 0px)')
      expect(row.cells[0].style.getPropertyValue('--pin-left')).toBe('var(--freeze-x-0, 0px)')
      expect(getComputedStyle(row.cells[1]).position).not.toBe('sticky')
    }
    for (const row of two.rows) expect(getComputedStyle(row.cells[0]).position).not.toBe('sticky')
  })

  it('the box scrolls sideways; the header is bold on a soft shade; rows have light lines, columns none', async () => {
    const body = await draw(SIX_WIDE)
    const box = body.querySelector('.page-table-box')!
    expect(box.querySelector(':scope > .page-table-frame > .page-table > table')).not.toBeNull()
    expect(getComputedStyle(box.querySelector('.page-table')!).overflowX).toBe('auto')
    const th = box.querySelector('th')!
    expect(getComputedStyle(th).fontWeight).toBe('600')
    expect(getComputedStyle(th).backgroundColor).not.toBe('')
    const td = box.querySelector('td')!
    expect(getComputedStyle(td).borderBottomStyle).toBe('solid')
    expect(getComputedStyle(td).borderRightStyle).not.toBe('solid')
    expect(sheet('./tables.css')).toMatch(/:root:where\(\[data-scheme='dark'\]\) \{/)
  })

  it("a card's table in a page gets the same frame and widths", async () => {
    const card: PageLook = {
      ...look,
      card: () => {
        const f = document.createElement('div')
        const sides = document.createElement('div')
        sides.className = 'card__sides'
        sides.innerHTML = '<div class="card__side"><div class="card__table"><table><thead><tr><th>A</th><th>B</th><th>C</th></tr></thead><tbody><tr><td>1</td><td>two</td><td>three</td></tr></tbody></table></div></div>'
        f.append(sides)
        return f
      },
    }
    const body = document.createElement('div')
    body.className = 'reader__body'
    document.body.append(body)
    await renderPage('```card\nQ\n---\nA\n```', card, body)
    const scroll = body.querySelector('.page-table-box > .page-table-frame > .card__table.page-table > table[data-cols="3"]')
    expect(scroll).not.toBeNull()
  })
})

describe('⤢ and the full-screen view (YAZ-5471)', () => {
  it('⤢ shows only on a table wider than its box; the shadows show the sides with more', async () => {
    const body = await draw(`${NARROW}\n\n${SIX_WIDE}`)
    const [narrow, wide] = [...body.querySelectorAll<HTMLElement>('.page-table-box')]
    sized(narrow.querySelector('.page-table')!, 300, 300)
    sized(wide.querySelector('.page-table')!, 900, 340)
    markTable(narrow)
    markTable(wide)
    expect(narrow.hasAttribute('data-wide')).toBe(false)
    expect(wide.hasAttribute('data-wide')).toBe(true)
    expect(getComputedStyle(narrow.querySelector('.page-table__bar')!).display).toBe('none')
    expect(getComputedStyle(wide.querySelector('.page-table__bar')!).display).toBe('flex')
    const frame = wide.querySelector('.page-table-frame')!
    expect([frame.hasAttribute('data-more-left'), frame.hasAttribute('data-more-right')]).toEqual([false, true])
    sized(wide.querySelector('.page-table')!, 900, 340, 200)
    markTable(wide)
    expect([frame.hasAttribute('data-more-left'), frame.hasAttribute('data-more-right')]).toEqual([true, true])
    sized(wide.querySelector('.page-table')!, 900, 340, 560)
    markTable(wide)
    expect([frame.hasAttribute('data-more-left'), frame.hasAttribute('data-more-right')]).toEqual([true, false])
    expect(wide.querySelector('[data-table-open]')!.getAttribute('aria-label')).toBe('Open the table full screen')
    // YAZ-5479: ⤢ at the TOP right: the box's first child, right-aligned, ABOVE the frame (never over the sticky first column
    // or the header text), and 44 px to tap.
    const bar = wide.querySelector<HTMLElement>('.page-table__bar')!
    expect(wide.firstElementChild).toBe(bar)
    expect(bar.nextElementSibling).toBe(frame)
    expect(frame.contains(bar)).toBe(false)
    expect(getComputedStyle(bar).justifyContent).toBe('flex-end')
    const tap = getComputedStyle(wide.querySelector('[data-table-open]')!)
    expect([tap.minWidth, tap.minHeight]).toEqual(['var(--tap)', 'var(--tap)']) // --tap: 44px (styles.css)
  })

  it('a tap on ⤢ opens the whole table full screen (its own chunk); ✕ closes it and the focus goes back', async () => {
    const body = await draw(SIX_WIDE)
    const loads: string[] = []
    const watch = watchTables(body, async () => (loads.push('tableView'), import('./tableView')))
    let pageTaps = 0
    document.body.addEventListener('click', () => pageTaps++)
    const open = body.querySelector<HTMLElement>('[data-table-open]')!
    open.click()
    await new Promise((r) => setTimeout(r, 20))
    expect(loads).toEqual(['tableView'])
    expect(pageTaps).toBe(0)
    const view = document.querySelector<HTMLElement>('.table-view')!
    expect(view.getAttribute('role')).toBe('dialog')
    expect(view.querySelector('.table-view__name')!.textContent).toBe('5 rows · 6 columns')
    expect(view.querySelectorAll('.table-view__pane table tbody tr')).toHaveLength(5)
    expect(view.querySelector('[data-table-open]')).not.toBeNull() // the copy's own ⤢ is hidden by the view's CSS
    expect(getComputedStyle(view.querySelector('.page-table__bar')!).display).toBe('none')
    expect(document.activeElement).toBe(view.querySelector('.table-view__close'))
    view.querySelector<HTMLElement>('.table-view__close')!.click()
    expect(document.querySelector('.table-view')).toBeNull()
    expect(document.activeElement).toBe(open)
    watch.stop()
  })

  it('Escape closes it; a swipe down from the top closes it; a short or sideways swipe does not', async () => {
    const body = await draw(SIX_WIDE)
    const box = body.querySelector<HTMLElement>('.page-table-box')!
    showTable(box)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.querySelector('.table-view')).toBeNull()

    const touch = (view: Element, type: string, x: number, y: number, fingers = 1) => {
      const e = new Event(type)
      const t = { clientX: x, clientY: y }
      Object.assign(e, { touches: type === 'touchend' ? [] : Array(fingers).fill(t), changedTouches: [t] })
      view.dispatchEvent(e)
    }
    const swipe = (dx: number, dy: number) => {
      const view = showTable(box).el
      touch(view, 'touchstart', 100, 100)
      touch(view, 'touchmove', 100 + dx / 2, 100 + dy / 2)
      touch(view, 'touchend', 100 + dx, 100 + dy)
      const closed = !view.isConnected
      if (!closed) view.querySelector<HTMLElement>('.table-view__close')!.click()
      return closed
    }
    expect(swipe(0, SWIPE_CLOSE + 20)).toBe(true)
    expect(swipe(0, SWIPE_CLOSE - 30)).toBe(false)
    expect(swipe(SWIPE_CLOSE + 40, SWIPE_CLOSE + 20)).toBe(false)
    expect(swipe(0, -(SWIPE_CLOSE + 20))).toBe(false)
  })

  it('pinch and double tap zoom; it turns with the phone; the page closing closes it', async () => {
    const body = await draw(SIX_WIDE)
    const watch = watchTables(body, () => import('./tableView'))
    body.querySelector<HTMLElement>('[data-table-open]')!.click()
    await new Promise((r) => setTimeout(r, 20))
    const view = document.querySelector<HTMLElement>('.table-view')!
    const pane = view.querySelector<HTMLElement>('.table-view__pane')!
    const start = Number(view.getAttribute('data-scale'))
    pane.dispatchEvent(new MouseEvent('dblclick', { clientX: 10, clientY: 10 }))
    const zoomed = Number(view.getAttribute('data-scale'))
    expect(zoomed).toBeGreaterThan(start)
    // Two fingers apart: bigger.
    const finger = (type: string, id: number, x: number) => pane.dispatchEvent(Object.assign(new MouseEvent(type, { clientX: x, clientY: 50 }), { pointerId: id }))
    finger('pointerdown', 1, 100)
    finger('pointerdown', 2, 120)
    finger('pointermove', 2, 160)
    expect(Number(view.getAttribute('data-scale'))).toBeGreaterThan(zoomed)
    finger('pointerup', 1, 100)
    finger('pointerup', 2, 160)
    window.dispatchEvent(new Event('resize'))
    expect(view.isConnected).toBe(true)
    watch.stop()
    expect(view.isConnected).toBe(false)
  })
})
