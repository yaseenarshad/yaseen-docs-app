// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://app.example/"}
import { parseTableComment } from '@client/editor/table/tableComment'
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FROZEN, FROZEN_COMMENT, FROZEN_PAGE, NARROW, SIX_WIDE, TWO_LONG } from '../dev/tableFixtures'
import { cutAt, renderPage, type PageLook } from './pageRender'
import { STICKY_HEADER_DEFAULT, applyTableFile, freezeOf, readTableComment } from './tableFile'
import { STICKY_MAX, columnsOf, gridColumns } from './tableLayout'
import { pinRanges, showTable } from './tableView'
import { PIN_COLS_MAX, PIN_ROWS_MAX, measureFreeze, watchTables } from './useTables'

/**
 * YAZ-5480: the file's frozen rows and columns (the Mac's table comment, read with the Mac's parser) and the sticky
 * header row, on the phone. jsdom has no layout and no scroll-driven animation: the marks, the rules and the measures
 * are checked here (sizes given by hand); that the parts really stay while the page and the table scroll is checked in
 * headless Chrome (`publish/proveLayout.ts`, `page-table-frozen`, `page-table-frozen-full`).
 */
const SHEETS = ['../styles.css', './reader.css', './tables.css']
const look: PageLook = {
  link: (inner) => ({ label: inner, open: { kind: 'page', path: `${inner}.md` } }),
  embed: (inner) => ({ kind: 'text', text: `![[${inner}]]` }),
  asset: () => null,
  card: () => document.createElement('div'),
}
async function draw(text: string, inScreen = false): Promise<HTMLElement> {
  const body = document.createElement('div')
  body.className = 'reader__body'
  if (inScreen) {
    const screen = document.createElement('div')
    screen.className = 'screen'
    screen.append(body)
    document.body.append(screen)
  } else document.body.append(body)
  await renderPage(text, look, body)
  return body
}
const tableOf = async (text: string) => (await draw(text)).querySelector('table')!
const set = (el: object, values: Record<string, number>) => {
  for (const [key, value] of Object.entries(values)) Object.defineProperty(el, key, { configurable: true, value })
}

let styles: HTMLStyleElement[] = []
beforeAll(() => {
  styles = SHEETS.map((path) => {
    const el = document.createElement('style')
    el.textContent = readFileSync(new URL(path, import.meta.url), 'utf8')
    document.head.append(el)
    return el
  })
})
afterAll(() => styles.forEach((s) => s.remove()))
afterEach(() => document.querySelectorAll('.reader__body, .screen, .table-view').forEach((el) => el.remove()))

describe("the table comment, read with the Mac's parser (YAZ-5480)", () => {
  it('reads the frozen rows and columns, and the sticky header, as the Mac does', () => {
    expect(readTableComment(FROZEN_COMMENT)?.freeze).toEqual({ rows: 2, cols: 1 })
    // The same parser: the Mac's, not a copy.
    expect(readTableComment('<!-- table: widths 140 auto, stripes, freeze 1 col -->')).toEqual(parseTableComment('<!-- table: widths 140 auto, stripes, freeze 1 col -->'))
    expect(readTableComment('<!-- table: nostickyheader -->')?.stickyHeader).toBe(false)
    expect(readTableComment('<!-- a note -->')).toBeNull()
  })

  it("clamps the counts inside the table, and follows the Mac's sticky header default", () => {
    expect(STICKY_HEADER_DEFAULT).toBe(true)
    expect(freezeOf(parseTableComment('<!-- table: freeze 9 rows 9 cols -->'), 3, 2)).toEqual({ rows: 3, cols: 2 })
    expect(freezeOf(parseTableComment('<!-- table: freeze 2 rows 1 col -->'), 25, 7)).toEqual({ rows: 2, cols: 1 })
    // No freeze: the header row (Settings › Tables › Sticky header row, on); the table's own word wins.
    expect(freezeOf(parseTableComment('<!-- table: stripes -->'), 5, 3)).toEqual({ rows: 1, cols: 0 })
    expect(freezeOf(null, 5, 3)).toEqual({ rows: 1, cols: 0 })
    expect(freezeOf(parseTableComment('<!-- table: nostickyheader -->'), 5, 3)).toEqual({ rows: 0, cols: 0 })
    // Its own frozen rows win over `nostickyheader`, as on the Mac.
    expect(freezeOf(parseTableComment('<!-- table: nostickyheader, freeze 3 rows -->'), 5, 3)).toEqual({ rows: 3, cols: 0 })
  })

  it('the comment after a table reaches it, with or without a blank line, in a list too; another comment does not', async () => {
    for (const text of [`${FROZEN}\n${FROZEN_COMMENT}`, `${FROZEN}\n\n${FROZEN_COMMENT}`, `- a list\n\n  ${FROZEN.split('\n').join('\n  ')}\n  ${FROZEN_COMMENT}`]) {
      const body = await draw(text)
      const table = body.querySelector('table')!
      expect(table.getAttribute('data-freeze-rows')).toBe('2')
      expect(table.getAttribute('data-freeze-cols')).toBe('1')
      expect(table.hasAttribute('data-table-file')).toBe(false)
      expect(body.textContent).not.toContain('freeze')
      body.remove()
    }
    const other = await tableOf(`${NARROW}\n\n<!-- a note about the fruit -->`)
    expect(other.hasAttribute('data-freeze-rows')).toBe(false)
  })

  it('a long page drawn in pieces never cuts between a table and its comment', () => {
    const text = `${FROZEN}\n\n${FROZEN_COMMENT}\n\nAfter.`
    const end = cutAt(text, 0, FROZEN.length)
    expect(text.slice(0, end)).toContain(FROZEN_COMMENT)
    expect(cutAt(`${FROZEN}\n\nA line.\n\nMore.`, 0, FROZEN.length)).toBe(FROZEN.length + 2)
  })

  it('a comment with no part the parser reads changes nothing', () => {
    const table = document.createElement('table')
    table.innerHTML = '<tr><td>a</td></tr>'
    expect(applyTableFile(table, 'table: zebra')).toBeNull()
    expect(table.attributes.length).toBe(0)
  })
})

describe('frozen columns and rows in the page (YAZ-5480)', () => {
  it("the file's frozen rows and column are marked; the column stays at the left, the rows at the top", async () => {
    const table = await tableOf(FROZEN_PAGE)
    expect([table.dataset.pinRows, table.dataset.pinCols]).toEqual(['2', '1'])
    const rows = [...table.rows]
    for (const cell of [...rows[0].cells, ...rows[1].cells]) expect(cell.hasAttribute('data-pin-row')).toBe(true)
    expect([...rows[1].cells].every((c) => c.hasAttribute('data-pin-row-end'))).toBe(true)
    expect([...rows[2].cells].some((c) => c.hasAttribute('data-pin-row'))).toBe(false)
    for (const row of rows) {
      expect(row.cells[0].hasAttribute('data-pin-col')).toBe(true)
      expect(row.cells[0].hasAttribute('data-pin-col-end')).toBe(true)
      expect(row.cells[1].hasAttribute('data-pin-col')).toBe(false)
      expect(getComputedStyle(row.cells[0]).position).toBe('sticky')
    }
    // A frozen row's cell is lifted over the rows it passes, on a solid colour.
    expect(getComputedStyle(rows[1].cells[3]).position).toBe('relative')
    expect(getComputedStyle(rows[1].cells[3]).zIndex).toBe('2')
    expect(getComputedStyle(rows[0].cells[0]).zIndex).toBe('3')
  })

  it("the file's frozen columns replace the phone's first-column rule, each at most STICKY_MAX wide", async () => {
    const two = await tableOf(`${SIX_WIDE}\n\n<!-- table: freeze 3 cols -->`)
    expect(two.dataset.pinCols).toBe('3')
    expect([...two.rows[1].cells].map((c) => c.hasAttribute('data-pin-col'))).toEqual([true, true, true, false, false, false])
    expect(columnsOf(two).slice(0, 3).every((c) => c.max <= STICKY_MAX)).toBe(true)
    expect(two.rows[1].cells[2].style.getPropertyValue('--pin-left')).toBe('var(--freeze-x-2, 0px)')
    // Rows only: the phone's rule stays for the columns (the first column of three or more), none for two columns.
    expect((await tableOf(`${SIX_WIDE}\n\n<!-- table: freeze 3 rows -->`)).dataset.pinCols).toBe('1')
    expect((await tableOf(`${TWO_LONG}\n\n<!-- table: freeze 3 rows -->`)).dataset.pinCols).toBe('0')
  })

  it('no comment: the header row stays (the Mac default); `nostickyheader`: no row', async () => {
    const plain = await tableOf(SIX_WIDE)
    expect([plain.dataset.pinRows, plain.dataset.pinCols]).toEqual(['1', '1'])
    expect([...plain.rows[0].cells].every((c) => c.hasAttribute('data-pin-row') && c.hasAttribute('data-pin-row-end'))).toBe(true)
    expect([...plain.rows[1].cells].some((c) => c.hasAttribute('data-pin-row'))).toBe(false)
    const off = await tableOf(`${NARROW}\n\n<!-- table: nostickyheader -->`)
    expect(off.dataset.pinRows).toBe('0')
    expect(off.querySelector('[data-pin-row]')).toBeNull()
  })

  it('a merged cell sits in its grid column', () => {
    const table = document.createElement('table')
    table.innerHTML = '<tr><td rowspan="2">a</td><td colspan="2">b</td></tr><tr><td>c</td><td>d</td></tr>'
    const cells = [...table.querySelectorAll('td')]
    expect(cells.map((c) => gridColumns(table).get(c))).toEqual([0, 1, 1, 2])
  })

  it("measures each frozen column's offset and the rows' run, and lets neither cover the table", async () => {
    const body = await draw(`${SIX_WIDE}\n\n<!-- table: freeze 2 rows 2 cols -->`)
    const box = body.querySelector<HTMLElement>('.page-table-box')!
    const table = box.querySelector('table')!
    const scroll = box.querySelector('.page-table')!
    const [a, b] = table.rows[0].cells
    set(a, { offsetLeft: 0, offsetWidth: 90 })
    set(b, { offsetLeft: 90, offsetWidth: 80 })
    set(table.rows[0], { offsetTop: 0, offsetHeight: 40 })
    set(table.rows[1], { offsetTop: 40, offsetHeight: 60 })
    set(table, { offsetHeight: 400 })
    set(scroll, { clientWidth: 320 })
    measureFreeze(box, 700)
    expect(table.style.getPropertyValue('--freeze-x-0')).toBe('0px')
    expect(table.style.getPropertyValue('--freeze-x-1')).toBe('90px')
    expect(table.style.getPropertyValue('--pin-run')).toBe('300px')
    expect(table.hasAttribute('data-pin-cols-off')).toBe(false)
    expect(table.hasAttribute('data-pin-rows-off')).toBe(false)
    // Two columns wider than PIN_COLS_MAX of the box, rows taller than PIN_ROWS_MAX of the screen: they scroll.
    set(scroll, { clientWidth: Math.floor(170 / PIN_COLS_MAX) - 10 })
    measureFreeze(box, Math.floor(100 / PIN_ROWS_MAX) - 10)
    expect(table.hasAttribute('data-pin-cols-off')).toBe(true)
    expect(table.hasAttribute('data-pin-rows-off')).toBe(true)
  })

  it('a browser with no scroll-driven animations: the frozen rows move by the page scroll, once a frame, transform only', async () => {
    const body = await draw(FROZEN_PAGE, true)
    const screen = body.parentElement!
    const table = body.querySelector('table')!
    set(table.rows[0], { offsetTop: 0, offsetHeight: 40 })
    set(table.rows[1], { offsetTop: 40, offsetHeight: 40 })
    set(table, { offsetHeight: 1000 })
    let y = 0
    Object.defineProperty(screen, 'scrollTop', { configurable: true, get: () => y })
    const frame = body.querySelector('.page-table-frame')!
    frame.getBoundingClientRect = () => ({ top: 200 - y }) as DOMRect
    // A browser with no scroll-driven animations (jsdom says yes to any property).
    const supports = vi.spyOn(CSS, 'supports').mockReturnValue(false)
    const watch = watchTables(body)
    supports.mockRestore()
    y = 500
    screen.dispatchEvent(new Event('scroll'))
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    const head = table.rows[0].cells[0] as HTMLElement
    expect(head.style.transform).toBe('translateY(300px)')
    expect((table.rows[2].cells[0] as HTMLElement).style.transform).toBe('')
    // Past the table's end, they stop at its run.
    y = 5000
    screen.dispatchEvent(new Event('scroll'))
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    expect(head.style.transform).toBe('translateY(920px)')
    watch.stop()
  })
})

describe('frozen rows and columns full screen (YAZ-5480)', () => {
  it('the ranges follow the scale: the rows move by the scroll over the scale, from the table top, until its end', () => {
    const box = { top: 1, left: 1, width: 800, height: 1000, rows: 80, cols: 120, padTop: 12, padLeft: 12 }
    const r = pinRanges(box, 0.5, { width: 375, height: 600 })
    expect(r).toEqual({ '--tv-y-from': '12.5px', '--tv-y-to': '472.5px', '--tv-y-run': '920px', '--tv-x-from': '12.5px', '--tv-x-to': '352.5px', '--tv-x-run': '680px' })
    // A frozen block too big for the view does not move.
    expect(pinRanges({ ...box, rows: 700 }, 1, { width: 375, height: 600 })['--tv-y-run']).toBe('0px')
  })

  it('the view keeps the frozen marks and sets its ranges', async () => {
    const body = await draw(FROZEN_PAGE)
    const box = body.querySelector<HTMLElement>('.page-table-box')!
    box.querySelector('table')!.setAttribute('data-pin-rows-off', '')
    const view = showTable(box)
    const table = view.el.querySelector('table')!
    expect(table.dataset.pinRows).toBe('2')
    expect(table.hasAttribute('data-pin-rows-off')).toBe(false)
    expect(table.querySelectorAll('[data-pin-row]').length).toBe(14)
    const content = view.el.querySelector<HTMLElement>('.table-view__content')!
    for (const name of ['--tv-y-from', '--tv-y-to', '--tv-y-run', '--tv-x-from', '--tv-x-to', '--tv-x-run']) expect(content.style.getPropertyValue(name)).toMatch(/px$/)
    view.close()
  })
})
