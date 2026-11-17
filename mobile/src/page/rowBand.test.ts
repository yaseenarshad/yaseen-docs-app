// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://app.example/"}
import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TABLE_LOOK_DEFAULTS } from '@shared/tableLook'
import { CALENDAR, CALENDAR_COMMENT, FROZEN_PAGE, NARROW } from '../dev/tableFixtures'
import { renderPage, type PageLook } from './pageRender'
import { bandLookOf, bandRowOf, watchBand } from './rowBand'
import { showTable } from './tableView'
import { watchTables } from './useTables'

/**
 * YAZ-5532: the finger band. jsdom has no layout and no PointerEvent: the events are made by hand (a MouseEvent of the
 * pointer's type, as `holdFolder.test.tsx`), `elementFromPoint` is given the row under the finger, and a frame is run
 * by hand. That the band paints in the Mac's colour across the frozen cells is checked in headless Chrome too
 * (`publish/proveLayout.ts`, `page-table-band`, `folder-table-band`), and its contrast in `contrast.screens.test.tsx`.
 */
const SHEETS = ['../styles.css', './reader.css', './tables.css']
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
const fire = (el: EventTarget, type: string, x = 10, y = 10) => {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  el.dispatchEvent(e)
  return e
}
const touchMove = (el: EventTarget, x: number, y: number) => {
  const e = new Event('touchmove', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: [{ clientX: x, clientY: y }] })
  el.dispatchEvent(e)
  return e
}
const touchEnd = (el: EventTarget) => {
  const e = new Event('touchend', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: [] })
  el.dispatchEvent(e)
}
/** The frames asked for, run by hand. */
let frames: FrameRequestCallback[] = []
const runFrames = () => {
  const now = frames
  frames = []
  now.forEach((f) => f(0))
}
/** What is under the finger. */
let under: Element | null = null
const banded = (root: ParentNode) => [...root.querySelectorAll('tr[data-band]')]

let styles: HTMLStyleElement[] = []
beforeAll(() => {
  styles = SHEETS.map((path) => {
    const el = document.createElement('style')
    el.textContent = readFileSync(new URL(path, import.meta.url), 'utf8')
    document.head.append(el)
    return el
  })
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => (frames.push(f), frames.length))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  document.elementFromPoint = () => under
})
afterAll(() => {
  styles.forEach((s) => s.remove())
  vi.unstubAllGlobals()
})
afterEach(() => {
  frames = []
  under = null
  document.querySelectorAll('.reader__body, .table-view').forEach((el) => el.remove())
})

describe('the finger band (YAZ-5532)', () => {
  it('pointerdown bands the whole row, its frozen cells too, in the band rule; never the header or the frozen rows', async () => {
    const body = await draw(FROZEN_PAGE)
    const watch = watchTables(body, undefined, {}, bandLookOf(null))
    const table = body.querySelector('table')!
    // `freeze 2 rows 1 col`: the header and the first body row stay; the third row is the first that bands.
    const row = table.tBodies[0].rows[1]
    expect(row.cells[0].hasAttribute('data-pin-col')).toBe(true)
    const down = fire(row.cells[2], 'pointerdown')
    expect(down.defaultPrevented).toBe(false)
    expect(banded(body)).toEqual([row])
    // Every cell of the row, the frozen one included, takes the band's colour (the frozen cell's `--bg` loses).
    for (const cell of row.cells) expect(getComputedStyle(cell).backgroundColor).toMatch(/color-mix\(in srgb, var\(--table-band-colour, var\(--accent\)\) var\(--table-band-strength, 10%\), var\(--bg\)\)/)
    expect(getComputedStyle(table.tBodies[0].rows[2].cells[0]).backgroundColor).not.toMatch(/table-band/)
    // The header row and a frozen row do not band; the band stays where it was.
    fire(table.tHead!.rows[0].cells[1], 'pointerdown')
    fire(table.tBodies[0].rows[0].cells[1], 'pointerdown')
    expect(banded(body)).toEqual([row])
    // Watched again (the vault's look came): the band stays on its row; with the band Off it goes.
    watch.stop()
    expect(banded(body)).toEqual([row])
    const again = watchBand(body)
    expect(again.row()).toBe(row)
    again.stop()
    watchBand(body, bandLookOf({ ...TABLE_LOOK_DEFAULTS, tableRowBand: 'off' })).stop()
    expect(banded(body)).toEqual([])
  })

  it('the finger moves: the band follows, once a frame; it stays after the lift; another touch moves it', async () => {
    const body = await draw(['# Fruit', NARROW, 'After.'].join('\n\n'))
    const band = watchBand(body)
    const rows = [...body.querySelector('table')!.tBodies[0].rows]
    fire(rows[0].cells[0], 'pointerdown')
    expect(band.row()).toBe(rows[0])
    // Moves within one frame: one hit test, at the last place.
    under = rows[2].cells[1]
    expect(touchMove(rows[0].cells[0], 10, 80).defaultPrevented).toBe(false)
    fire(rows[0].cells[0], 'pointermove', 10, 90)
    expect(frames).toHaveLength(1)
    expect(band.row()).toBe(rows[0])
    runFrames()
    expect(banded(body)).toEqual([rows[2]])
    // The page scrolls under a finger that stays.
    under = rows[3].cells[0]
    document.dispatchEvent(new Event('scroll'))
    runFrames()
    expect(banded(body)).toEqual([rows[3]])
    // The lift: the band stays; later moves and scrolls do nothing.
    touchEnd(rows[3])
    fire(window, 'pointerup')
    under = rows[1].cells[0]
    document.dispatchEvent(new Event('scroll'))
    runFrames()
    expect(banded(body)).toEqual([rows[3]])
    // A touch on another row moves it there (only one band).
    fire(rows[1].cells[2], 'pointerdown')
    expect(banded(body)).toEqual([rows[1]])
    // A touch outside the tables leaves it.
    fire(body.querySelector('p')!, 'pointerdown')
    expect(banded(body)).toEqual([rows[1]])
    band.stop()
  })

  it('a selection being dragged keeps the band where it is', async () => {
    const body = await draw(NARROW)
    const band = watchBand(body)
    const rows = [...body.querySelector('table')!.tBodies[0].rows]
    fire(rows[0].cells[0], 'pointerdown')
    const range = document.createRange()
    range.selectNodeContents(rows[0].cells[0])
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    under = rows[2].cells[0]
    touchMove(body, 10, 80)
    runFrames()
    expect(band.row()).toBe(rows[0])
    document.getSelection()!.removeAllRanges()
    band.stop()
  })

  it('copying: the cells are selectable, the table between them is not; no band handler cancels selectstart or the hold', async () => {
    const body = await draw(NARROW)
    const band = watchBand(body)
    const table = body.querySelector('table')!
    const cell = table.tBodies[0].rows[1].cells[0]
    expect(getComputedStyle(cell).userSelect).toBe('text')
    expect(getComputedStyle(table.tHead!.rows[0].cells[0]).userSelect).toBe('text')
    expect(getComputedStyle(table).userSelect).toBe('none')
    // The hold: down, a while, then the phone's selection starts.
    const down = fire(cell, 'pointerdown')
    const touch = new Event('touchstart', { bubbles: true, cancelable: true })
    cell.dispatchEvent(touch)
    const select = new Event('selectstart', { bubbles: true, cancelable: true })
    cell.firstChild!.dispatchEvent(select)
    const menu = fire(cell, 'contextmenu')
    expect([down.defaultPrevented, touch.defaultPrevented, select.defaultPrevented, menu.defaultPrevented]).toEqual([false, false, false, false])
    expect(band.row()).toBe(cell.parentElement)
    band.stop()
  })

  it("the vault's look: Off bands nothing; Calendar tables only the calendar; its colour and strength go on the row", async () => {
    expect(bandLookOf(null)).toEqual({ on: 'all', colour: null, strength: null })
    const off = { ...TABLE_LOOK_DEFAULTS, tableRowBand: 'off' as const }
    const cal = { ...TABLE_LOOK_DEFAULTS, tableRowBand: 'calendar' as const, tableBandColour: 'green', tableBandStrength: 24 }
    expect(bandLookOf(cal)).toEqual({ on: 'calendar', colour: 'var(--table-fill-solid-green)', strength: '24%' })
    const body = await draw([NARROW, CALENDAR, CALENDAR_COMMENT].join('\n\n'))
    const [plain, calendar] = [...body.querySelectorAll('table')]
    expect(bandRowOf(plain.tBodies[0].rows[0].cells[0], body, bandLookOf(off))).toBeNull()
    expect(bandRowOf(plain.tBodies[0].rows[0].cells[0], body, bandLookOf(cal))).toBeNull()
    const band = watchBand(body, bandLookOf(cal))
    const row = calendar.tBodies[0].rows[3]
    fire(row.cells[1], 'pointerdown')
    expect(band.row()).toBe(row)
    expect(row.style.getPropertyValue('--table-band-colour')).toBe('var(--table-fill-solid-green)')
    expect(row.style.getPropertyValue('--table-band-strength')).toBe('24%')
    band.clear()
    band.stop()
    expect(row.hasAttribute('data-band')).toBe(false)
    expect(row.getAttribute('style') ?? '').toBe('')
  })

  it('full screen: the copy keeps the page band, a finger moves it there, and it goes with the view', async () => {
    const body = await draw(FROZEN_PAGE)
    const page = watchBand(body)
    const row = body.querySelector('table')!.tBodies[0].rows[2]
    fire(row.cells[1], 'pointerdown')
    fire(window, 'pointerup')
    const view = showTable(body.querySelector<HTMLElement>('.page-table-box')!)
    const copy = view.el.querySelector('table')!
    expect(banded(view.el)).toEqual([copy.tBodies[0].rows[2]])
    const other = copy.tBodies[0].rows[4]
    fire(other.cells[0], 'pointerdown')
    expect(banded(view.el)).toEqual([other])
    // The page's own band is the page's.
    expect(banded(body)).toEqual([row])
    view.close()
    expect(document.querySelector('.table-view')).toBeNull()
    page.stop()
  })

  it('the table leaves the screen: the band goes', async () => {
    let seen: ((entries: Partial<IntersectionObserverEntry>[]) => void) | null = null
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: (entries: Partial<IntersectionObserverEntry>[]) => void) {
        seen = cb
      }
      observe() {}
      disconnect() {}
    })
    const body = await draw(NARROW)
    const band = watchBand(body)
    const table = body.querySelector('table')!
    fire(table.tBodies[0].rows[1].cells[0], 'pointerdown')
    seen!([{ isIntersecting: true, target: table }])
    expect(band.row()).not.toBeNull()
    seen!([{ isIntersecting: false, target: table }])
    expect(band.row()).toBeNull()
    expect(banded(body)).toEqual([])
    band.stop()
    vi.stubGlobal('IntersectionObserver', undefined)
  })
})
