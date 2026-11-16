// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://app.example/"}
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, READER_ID, seedReaderVault } from '../dev/readerVault'
import { TWO_LONG, WIDE_DESK_PAGE, WIDE_NOW, WIDE_PAGE } from '../dev/tableFixtures'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from '../screens/testing'
import { writeFolds } from '../store/foldPref'
import type { CommentsPort } from '../comments/bridge'
import type { WaitingComment } from '../comments/outbox'
import type { NewCommentInput } from '../comments/sender'
import { MOBILE_SETTINGS_PATH } from '../comments/mobileWrite'
import { calendarLook } from './calendarLook'
import { forgetMobileSettings } from './mobileSettings'
import { renderPage, type PageLook } from './pageRender'
import { markCalendar, placeSlotRoom, setCalendarClock, slotRoomAt } from './tableCalendar'
import { FIT_MIN, MAC_TEXT_PX, PAD, READ_WIDTH, columnWidths, columnsOf, deskWidths } from './tableLayout'

/**
 * YAZ-5658: wide tables on the phone. The cause of the one-letter Lookback: the Time in slot pill's room was a right
 * padding down the whole now-row cell (96 px of a 119 px column). Now the room is on the pill's own line only (two
 * floats), and the vault's Wide tables (`mobile.json` `fitTables`; a page's own `fit-tables` wins) picks Same as Desktop
 * (the default: each text column a readable width, Time in place) or Fit Screen (the text columns share the screen
 * by their text). jsdom has no layout: the widths are `columnWidths` (the CSS's rule in px) at the designer's 390 px
 * phone (a 356 px box); headless Chrome measures the drawn page (`publish/proveLayout.ts`, `page-wide-*`). Made-up day.
 */
const BOX_390 = 356
const TABLE_PX = 14
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
const minutes = (d: Date) => d.getHours() * 60 + d.getMinutes()
const css = readFileSync(fileURLToPath(import.meta.url).replace(/tableWide\.test\.tsx$/, 'tables.css'), 'utf8')

afterEach(() => {
  document.querySelectorAll('.reader__body').forEach((el) => el.remove())
  setCalendarClock(null)
})

describe('YAZ-5658: the widths at a 390 px phone (Time · Plan · Lookback)', () => {
  it('Same as Desktop: Time its text\'s width, Plan and Lookback each a readable line (13.5em, about 190 px); the table scrolls', async () => {
    const t = (await draw(WIDE_PAGE)).querySelector('table')!
    const cols = columnsOf(t)
    expect(cols.map((c) => c.kind)).toEqual(['fit', 'grow', 'grow'])
    const w = columnWidths(cols, BOX_390, 'scroll')
    expect(w[0]).toBe(cols[0]!.max * TABLE_PX)
    expect(w.slice(1)).toEqual([READ_WIDTH * TABLE_PX, READ_WIDTH * TABLE_PX])
    expect(w.reduce((a, b) => a + b, 0)).toBeGreaterThan(BOX_390)
  })

  it('Fit Screen: Time its text\'s width, Plan and Lookback share the rest by their text, each at least 9em (126 px); no side scroll', async () => {
    const t = (await draw(WIDE_PAGE)).querySelector('table')!
    const cols = columnsOf(t)
    const w = columnWidths(cols, BOX_390, 'fit')
    expect(w[0]).toBe(cols[0]!.max * TABLE_PX)
    for (const px of w.slice(1)) expect(px).toBeGreaterThanOrEqual(FIT_MIN * TABLE_PX)
    expect(w.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(BOX_390 - 2 + 0.01)
    // The designer's measure at 390 px (YAZ-5658, option A), within 8 px: Time 74 · Plan 142 · Lookback 138.
    expect(w.map((px) => Math.round(px))).toEqual([expect.closeTo(74, -1.2), expect.closeTo(142, -1.2), expect.closeTo(138, -1.2)])
  })

  it('Same as Desktop keeps a table of one long column inside a 320 px phone (the floor is never wider than the box)', async () => {
    const t = (await draw(TWO_LONG)).querySelector('table')!
    const cols = columnsOf(t)
    expect(cols.map((c) => c.kind)).toEqual(['fit', 'grow'])
    expect(columnWidths(cols, 286, 'scroll').reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(286)
  })

  it('no column under its min at 320 to 430 px: Same as Desktop its own min, Fit Screen its longest word and 9em', async () => {
    const t = (await draw(WIDE_PAGE)).querySelector('table')!
    const cols = columnsOf(t)
    for (const box of [286, 341, BOX_390, 396]) {
      columnWidths(cols, box, 'scroll').forEach((px, i) => expect(px + 0.01).toBeGreaterThanOrEqual(cols[i]!.min * TABLE_PX))
      columnWidths(cols, box, 'fit').forEach((px, i) => expect(px + 0.01).toBeGreaterThanOrEqual((cols[i]!.kind === 'fit' ? cols[i]!.max : Math.max(FIT_MIN, cols[i]!.hold)) * TABLE_PX))
    }
  })

  it('the CSS says the same rule (tables.css): Same as Desktop at 13.5em, Fit Screen at 9em by `--col-share`', () => {
    expect(css).toContain('clamp(var(--col-min), max(min(13.5em, calc(100cqw - var(--table-fixed, 0em) - 2px)), calc((100cqw - var(--table-fixed, 0em) - 2px) * var(--col-weight, 1))), var(--col-max))')
    expect(css).toContain("[data-wide-tables='fit'] .page-table-box col.page-table__grow {\n  width: max(9em, var(--col-hold, 0em), calc((100cqw - var(--table-fixed, 0em) - 2px) * var(--col-share, 1)));")
    expect(READ_WIDTH).toBe(13.5)
    expect(FIT_MIN).toBe(9)
  })
})

describe('YAZ-5658 round 2: Same as Desktop takes the widths saved in the file', () => {
  it('a table the Mac widened (Lookback 320 px) shows those widths on a 390 px phone, every column, scaled to the phone\'s text; it scrolls', async () => {
    const t = (await draw(WIDE_DESK_PAGE)).querySelector('table')!
    const cols = columnsOf(t)
    // Time stays a short column (it never wraps), Plan and Lookback long ones: the kinds are the text's.
    expect(cols.map((c) => c.kind)).toEqual(['fit', 'grow', 'grow'])
    const w = columnWidths(cols, BOX_390, 'scroll')
    // The Mac's 16 px text, the phone's 14 px: 96 · 176 · 320 px on the Mac are 84 · 154 · 280 px on the phone.
    expect(w).toEqual([96, 176, 320].map((mac) => (mac / MAC_TEXT_PX) * TABLE_PX))
    expect(w).toEqual([84, 154, 280])
    // Never squeezed to fit: wider than the box, it scrolls (Time pinned: `freeze 1 col`).
    expect(w.reduce((a, b) => a + b, 0)).toBeGreaterThan(BOX_390)
    expect(t.getAttribute('data-freeze-cols')).toBe('1')
    // The CSS draws it so: each col its saved width, the short column too.
    const col = [...t.querySelectorAll<HTMLElement>('col')]
    expect(col.map((c) => [c.hasAttribute('data-desk'), c.style.getPropertyValue('--col-desk')])).toEqual([[true, '6em'], [true, '11em'], [true, '20em']])
    expect(css).toContain('.page-table-box col[data-desk] {\n  width: var(--col-desk);\n}')
  })

  it('no saved widths: today\'s widths (a short column its text, a long one a readable line)', async () => {
    const cols = columnsOf((await draw(WIDE_PAGE)).querySelector('table')!)
    expect(cols.every((c) => c.desk === null)).toBe(true)
    const w = columnWidths(cols, BOX_390, 'scroll')
    expect(w).toEqual([cols[0]!.max * TABLE_PX, READ_WIDTH * TABLE_PX, READ_WIDTH * TABLE_PX])
  })

  it('one saved width: that column takes it, the others keep today\'s rule beside it', async () => {
    const t = (await draw(WIDE_DESK_PAGE.replace('widths 96 176 320', 'widths auto auto 320'))).querySelector('table')!
    const cols = columnsOf(t)
    const w = columnWidths(cols, BOX_390, 'scroll')
    expect(w[0]).toBe(cols[0]!.max * TABLE_PX)
    expect(w[1]).toBe(READ_WIDTH * TABLE_PX)
    expect(w[2]).toBe(280)
  })

  it('only a table comment\'s widths are drawn as is: a folder view\'s (no `data-desk`) stay hints', async () => {
    const t = (await draw(WIDE_DESK_PAGE)).querySelector('table')!
    expect(t.hasAttribute('data-desk')).toBe(true)
    expect(deskWidths(t)).toEqual([6, 11, 20])
    t.removeAttribute('data-desk')
    expect(deskWidths(t)).toEqual([])
  })

  it('Fit Screen leaves the saved widths: the same widths as a table with none', async () => {
    const saved = columnsOf((await draw(WIDE_DESK_PAGE)).querySelector('table')!)
    const none = columnsOf((await draw(WIDE_PAGE)).querySelector('table')!)
    expect(columnWidths(saved, BOX_390, 'fit')).toEqual(columnWidths(none, BOX_390, 'fit'))
    expect(css).toContain("[data-wide-tables='fit'] .page-table-box col[data-desk]:not(.page-table__grow) {\n  width: auto;\n}")
  })
})

describe('YAZ-5658: the pill takes room on its own line only', () => {
  it('no padding down the cell: the now row\'s Lookback keeps its column\'s whole width on every other line', async () => {
    const t = (await draw(WIDE_PAGE)).querySelector('table')!
    markCalendar(t, minutes(WIDE_NOW), calendarLook({ slotTime: 'down', slotSeconds: false }))
    const cell = t.querySelector<HTMLTableRowElement>('.table-now-row')!.cells[2] as HTMLElement
    expect(cell.classList.contains('table-slot-pad')).toBe(true)
    // The anchor (out of the flow), then the two floats, then the cell's text.
    expect([...cell.children].slice(0, 3).map((c) => c.className)).toEqual(['table-slot-anchor', 'table-slot-gap', 'table-slot-room'])
    expect(cell.textContent).toContain('Wrote the outline')
    expect(css).not.toMatch(/\.table-slot-pad\s*\{[^}]*padding-right/)
    // The narrowest Lookback (Fit Screen at 390 px) still reads at least 7 letters a line off the pill's line.
    const cols = columnsOf(t)
    const narrow = Math.min(columnWidths(cols, BOX_390, 'fit')[2]!, columnWidths(cols, BOX_390, 'scroll')[2]!)
    expect(narrow - PAD * TABLE_PX).toBeGreaterThanOrEqual(7 * 0.62 * TABLE_PX)
  })

  it('beside the pill: at least 4em of the line, else the room takes the whole line (no letters squeezed by it)', () => {
    expect(css).toContain('width: max(var(--slot-room), min(100%, calc((var(--slot-room) + 4em - 100%) * 1000)));')
  })

  it('the room follows the now line down the cell in whole lines (the lines the pill crosses), never past its text (the row never grows for it)', () => {
    // A cell 120 px tall (padding 7 px each side): 5 lines of 19.6 px.
    expect(slotRoomAt(0, 120, 7, 7, 19.6)).toEqual({ gap: 0, room: 19.6 })
    expect(slotRoomAt(0.5, 120, 7, 7, 19.6)).toEqual({ gap: 39.2, room: 39.2 })
    expect(slotRoomAt(1, 120, 7, 7, 19.6)).toEqual({ gap: 58.8, room: 39.2 })
    // One line: the room is that line.
    expect(slotRoomAt(0.8, 33.6, 7, 7, 19.6)).toEqual({ gap: 0, room: 19.6 })
  })

  it('placeSlotRoom sets the gap and the room from the cell\'s height; the pill moved away takes its floats with it', async () => {
    const t = (await draw(WIDE_PAGE)).querySelector('table')!
    const down = calendarLook({ slotTime: 'down', slotSeconds: false })
    markCalendar(t, minutes(WIDE_NOW), down)
    const cell = t.querySelector<HTMLTableRowElement>('.table-now-row')!.cells[2] as HTMLElement
    Object.defineProperty(cell, 'clientHeight', { configurable: true, value: 120 })
    cell.style.padding = '7px'
    cell.style.lineHeight = '19.6px'
    placeSlotRoom(cell)
    // 7:23 of the 7:00 slot: 0.767 down: the pill's top 75 px into the text, across its 4th and 5th lines.
    expect([cell.querySelector<HTMLElement>('.table-slot-gap')!.style.height, cell.querySelector<HTMLElement>('.table-slot-room')!.style.height]).toEqual(['58.8px', '39.2px'])
    markCalendar(t, minutes(WIDE_NOW) + 30, down)
    expect(cell.querySelector('.table-slot-gap, .table-slot-room, .table-slot-anchor')).toBeNull()
    // An empty last cell (8:00 Gym): the pill, no room.
    const empty = t.querySelector<HTMLTableRowElement>('.table-now-row')!.cells[2] as HTMLElement
    expect([empty.classList.contains('table-slot-pad'), empty.querySelector('.table-slot-room')]).toEqual([false, null])
  })
})

/* ------------------------------------------------ the vault's setting and the page's own ---------------------------- */

const md = (props: string, text: string) => `---\n${props}---\n\n${text}\n`
const FILES: Record<string, string | Uint8Array> = {
  ...READER_FILES,
  'Day one.md': md('title: Day one\n', WIDE_PAGE),
  'Day own.md': md('title: Day own\nfit-tables: false\n', WIDE_PAGE),
}

function fakePort() {
  const list: WaitingComment[] = []
  const listeners = new Set<() => void>()
  const port: CommentsPort & { list: WaitingComment[] } = {
    list,
    ready: async () => {},
    waiting: (path) => list.filter((c) => path === undefined || c.path === path),
    add: vi.fn(async (input: NewCommentInput) => {
      const c: WaitingComment = { id: `s${list.length}`, path: input.path, body: input.body, at: '2026-11-16T06:00:00Z', madeAt: 0, notBefore: 0, ...(input.setting ? { setting: input.setting } : {}) }
      list.push(c)
      for (const l of [...listeners]) l()
      return c
    }),
    undo: async () => false,
    discard: async () => false,
    subscribe(l) {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
  }
  return port
}

describe('YAZ-5658: Wide tables, the vault\'s (Settings) and the page\'s own (⋯)', () => {
  let h: Harness | null = null
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:phone/1')
    URL.revokeObjectURL = vi.fn()
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
    HTMLElement.prototype.animate = (() => ({}) as Animation) as unknown as typeof HTMLElement.prototype.animate
    for (const path of Object.keys(FILES)) writeFolds(READER_ID, path, [])
    forgetMobileSettings()
  })
  afterEach(() => {
    h?.unmount()
    h = null
    forgetSearch()
    forgetMobileSettings()
  })
  async function waitFor(x: Harness, done: () => boolean, ms = 5000): Promise<void> {
    const until = Date.now() + ms
    while (!done()) {
      if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text().slice(0, 300)}`)
      await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
    }
  }
  async function open(name: string, port: CommentsPort, mobile?: string): Promise<Harness> {
    const p = await newPhone()
    await seedReaderVault(p.store, p.tokens, mobile === undefined ? FILES : { ...FILES, [MOBILE_SETTINGS_PATH]: mobile })
    const x = await mount({ phone: p })
    ;(x.sync as unknown as { review: () => Promise<unknown> }).review = async () => ({ answers: { comments: port } })
    await x.click('Search')
    await waitFor(x, () => x.button(new RegExp(`^${name}, page`)) !== null)
    await x.click(new RegExp(`^${name}, page`))
    await waitFor(x, () => x.host.querySelector('.reader__body table') !== null)
    await x.settle()
    return x
  }
  const mode = (x: Harness) => x.host.querySelector('.reader__body')!.getAttribute('data-wide-tables')
  const choice = (x: Harness) => [...x.host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].map((r) => `${r.textContent?.trim()}${r.getAttribute('aria-checked') === 'true' ? ' ✓' : ''}`)

  it('the vault\'s default: Same as Desktop; mobile.json says Fit Screen: fit', async () => {
    h = await open('Day one', fakePort())
    await waitFor(h, () => mode(h!) === 'scroll')
    h.unmount()
    h = await open('Day one', fakePort(), '{"version":1,"fitTables":true}')
    await waitFor(h, () => mode(h!) === 'fit')
  })

  it("a page's own `fit-tables: false` wins over the vault's Fit Screen", async () => {
    h = await open('Day own', fakePort(), '{"version":1,"fitTables":true}')
    await waitFor(h, () => mode(h!) === 'scroll')
    await h.click('Page tools')
    expect(choice(h)).toEqual(['Mobile Vault Default', '✓ Same as Desktop ✓', 'Fit Screen'])
  })

  it('⋯ Wide tables on this page: Fit Screen writes `fit-tables: true` on the safe path and shows at once; Mobile Vault Default takes it away', async () => {
    const port = fakePort()
    h = await open('Day one', port)
    await waitFor(h, () => mode(h!) === 'scroll')
    await h.click('Page tools')
    expect(choice(h)).toEqual(['✓ Mobile Vault Default ✓', 'Same as Desktop', 'Fit Screen'])
    await h.click(/Fit Screen/)
    expect(port.add).toHaveBeenCalledWith({ path: 'Day one.md', body: '', setting: { key: 'fit-tables', on: true } })
    await waitFor(h, () => mode(h!) === 'fit')
    await h.click('Page tools')
    await h.click(/Mobile Vault Default/)
    expect(port.add).toHaveBeenLastCalledWith({ path: 'Day one.md', body: '', setting: { key: 'fit-tables', on: null } })
    await waitFor(h, () => mode(h!) === 'scroll')
  })

  it('Settings › This vault on mobile › Wide tables: Same as Desktop chosen; Fit Screen goes the safe path', async () => {
    const port = fakePort()
    h = await open('Day one', port)
    await h.click('Settings')
    await waitFor(h, () => h!.host.querySelector('[aria-label="Wide tables"] input:not([disabled])') !== null)
    const radio = (label: string) => [...h!.host.querySelectorAll('[aria-label="Wide tables"] label.row')].find((l) => l.textContent === label)!.querySelector<HTMLInputElement>('input')!
    expect([radio('Same as Desktop').checked, radio('Fit Screen').checked]).toEqual([true, false])
    await act(async () => radio('Fit Screen').click())
    await h.settle()
    expect(port.add).toHaveBeenCalledWith({ path: MOBILE_SETTINGS_PATH, body: '', setting: { file: 'mobile', key: 'fitTables', on: true } })
    expect(radio('Fit Screen').checked).toBe(true)
  })
})
