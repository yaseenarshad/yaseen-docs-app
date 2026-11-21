// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TABLE_LOOK_DEFAULTS, tableLookSettings } from '@shared/tableLook'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { closeAll } from '../explore/sheets'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from '../screens/testing'
import { applyTableFile } from './tableFile'
import { applyTableLook, tableLookVars } from './tableLook'
import { measureFreeze } from './useTables'

/**
 * YAZ-5567: the table look on the phone, as the Mac's (`table-look.json`, `shared/tableLook.ts`): subheader rows (the
 * table comment's `subhead`, `subheader`, `stickysubheads`; the vault's Subheader row and Sticky subheaders, else the
 * Mac's grey, medium, bold, sticky), bullets in cells at the cell spacing (20 px, 4 px, or the vault's), and Table
 * position Centre. jsdom has no layout: the drawing rules are read from `tables.css`. Made-up vault only.
 */
const css = readFileSync(fileURLToPath(import.meta.url).replace(/tableLook5567\.test\.tsx$/, 'tables.css'), 'utf8')
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`no rule ${selector}`)
  return css.slice(at, css.indexOf('}', at))
}
const table = (rows: number): HTMLTableElement => {
  const box = document.createElement('div')
  const body = Array.from({ length: rows - 1 }, (_, i) => `<tr><td>r${i + 1}</td><td>x</td></tr>`).join('')
  box.innerHTML = `<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody>${body}</tbody></table>`
  return box.querySelector('table')!
}
const subRows = (t: HTMLTableElement) => [...t.rows].flatMap((r, i) => (r.classList.contains('table-subhead-row') ? [i] : []))

describe('YAZ-5567: subheader rows from the table comment (the Mac\'s parser)', () => {
  it('`subhead 3 6`: those rows (1-based in the file) are subheader rows, each cell marked; the stripes start again in each section', () => {
    const t = table(9)
    applyTableFile(t, 'table: stripes, subhead 3 6')
    expect(t.hasAttribute('data-subheads')).toBe(true)
    expect(subRows(t)).toEqual([2, 5])
    expect([...t.rows[2]!.cells].every((c) => c.hasAttribute('data-subhead'))).toBe(true)
    expect(t.rows[1]!.querySelector('[data-subhead]')).toBeNull()
    // The Mac's `stripe`: the second, fourth… row of the rows above the first subheader row, and of each section.
    expect([...t.rows].flatMap((r, i) => (r.hasAttribute('data-stripe') ? [i] : []))).toEqual([4, 7])
  })

  it('the table\'s own look and sticky choice: `subheader blue strong regular muted align-center`, `nostickysubheads`', () => {
    const t = table(4)
    applyTableFile(t, 'table: subhead 2, subheader blue strong regular muted align-center, nostickysubheads')
    expect(['color', 'strength', 'weight', 'text', 'align'].map((p) => t.getAttribute(`data-subheader-${p}`))).toEqual(['blue', 'strong', 'regular', 'muted', 'center'])
    expect(t.getAttribute('data-sticky-subheaders')).toBe('off')
    // The vault's look never wins over the table's own.
    applyTableLook(t, tableLookSettings({ look: { subheaderRow: { color: 'red' }, stickySubheaders: true } }))
    expect([t.getAttribute('data-subheader-color'), t.getAttribute('data-sticky-subheaders')]).toEqual(['blue', 'off'])
  })

  it('a table with no subheader row has no mark; the header row is never one', () => {
    const t = table(4)
    applyTableFile(t, 'table: stripes')
    expect([t.hasAttribute('data-subheads'), subRows(t)]).toEqual([false, []])
  })
})

describe('YAZ-5567: the vault\'s Subheader row, Sticky subheaders, cell bullets and position', () => {
  it('the vault\'s subheader parts off the Mac\'s default, and Sticky subheaders off, on a table that sets none', () => {
    const t = table(4)
    applyTableFile(t, 'table: subhead 2')
    applyTableLook(t, tableLookSettings({ look: { subheaderRow: { color: 'green', strength: 'medium', weight: 'regular' }, stickySubheaders: false } }))
    expect(['color', 'strength', 'weight'].map((p) => t.getAttribute(`data-subheader-${p}`))).toEqual(['green', null, 'regular'])
    expect(t.getAttribute('data-sticky-subheaders')).toBe('off')
    // The Mac's defaults (or no file): nothing set; the CSS's fallbacks are the defaults.
    const plain = table(4)
    applyTableFile(plain, 'table: subhead 2')
    applyTableLook(plain, TABLE_LOOK_DEFAULTS)
    expect([...plain.attributes].map((a) => a.name).filter((n) => n.startsWith('data-subheader') || n === 'data-sticky-subheaders')).toEqual([])
  })

  it('tableLookVars: the cell bullet indent and gap and Centre, only when they differ from the Mac\'s defaults', () => {
    expect(tableLookVars(tableLookSettings({ look: { cellBulletIndent: 28, cellBulletGap: 6, position: 'center' } }))).toEqual({ '--cell-bullet-indent': '28px', '--cell-bullet-gap': '6px', '--page-table-inline': 'auto' })
    expect(tableLookVars(TABLE_LOOK_DEFAULTS)).toEqual({})
    expect(tableLookVars(null)).toEqual({})
  })
})

describe('YAZ-5567: the drawing (tables.css), with the Mac\'s defaults as fallbacks', () => {
  it('a subheader cell: grey at Medium (12%) of the text colour, bold; a part on the table changes it', () => {
    const cell = rule('.page-table-box .page-table-frame .page-table table td[data-subhead]')
    expect(cell).toMatch(/--cell-tint: color-mix\(in srgb, var\(--sub-hue, var\(--fg\)\) calc\(min\(100, var\(--sub-strength, 12\) \* var\(--sub-scale, 1\)\) \* 1%\), transparent\)/)
    expect(cell).toMatch(/font-weight: 700/)
    expect(css).toContain(".page-table-box table[data-subheader-color='blue'] { --sub-hue: var(--table-fill-solid-blue); --sub-scale: 2.5; }")
    expect(css).toContain(".page-table-box table[data-subheader-strength='strong'] { --sub-strength: 20; }")
    expect(css).toContain(".page-table-box .page-table-frame .page-table table[data-subheader-weight='regular'] td[data-subhead] { font-weight: 400; }")
    // Before the fills: a cell's own fill still wins (same weight, later rule).
    expect(css.indexOf('table td[data-subhead] {')).toBeLessThan(css.indexOf("[data-fill='red']"))
    expect(css).toMatch(/table\[data-stripes\]:not\(\[data-subheads\]\) tbody tr:nth-child\(even\) > td,\s*[^{]*table\[data-stripes\]\[data-subheads\] tr\[data-stripe\] > td \{/)
  })

  it('sticky (the default): solid over the page, under the frozen rows, moved on the frame\'s timeline by its own run; off: none', () => {
    expect(rule(".page-table-box .page-table-frame .page-table table:not([data-sticky-subheaders='off']) td[data-subhead]")).toMatch(/background-color: var\(--bg\)/)
    const pin = rule(".page-table-box .page-table-frame .page-table table:not([data-sticky-subheaders='off']) tr[data-sub-pin] > td")
    expect(pin).toMatch(/animation-timeline: --page-table-y/)
    expect(pin).toMatch(/animation-range: cover var\(--sub-from, 0px\) cover calc\(var\(--sub-from, 0px\) \+ var\(--pin-run, 0px\)\)/)
  })

  it('measureFreeze: each sticky subheader row starts under the frozen header and runs to the next one or the table\'s end', () => {
    const box = document.createElement('div')
    box.innerHTML = '<div class="page-table-frame"><div class="page-table"></div></div>'
    const t = table(8)
    applyTableFile(t, 'table: subhead 3 6')
    t.setAttribute('data-pin-rows', '1')
    box.querySelector('.page-table')!.append(t)
    // Rows 40 px tall, the table 2 px down its frame.
    const set = (el: HTMLElement, props: Record<string, number>) => {
      for (const [k, v] of Object.entries(props)) Object.defineProperty(el, k, { configurable: true, value: v })
    }
    set(t, { offsetTop: 2, offsetHeight: 320 })
    ;[...t.rows].forEach((row, i) => set(row, { offsetTop: i * 40, offsetHeight: 40 }))
    measureFreeze(box, 600)
    const [a, b] = [t.rows[2]!, t.rows[5]!]
    expect([a.hasAttribute('data-sub-pin'), a.style.getPropertyValue('--sub-from'), a.style.getPropertyValue('--pin-run')]).toEqual([true, '40px', '80px'])
    expect([b.hasAttribute('data-sub-pin'), b.style.getPropertyValue('--sub-from'), b.style.getPropertyValue('--pin-run')]).toEqual([true, '160px', '80px'])
    t.setAttribute('data-sticky-subheaders', 'off')
    measureFreeze(box, 600)
    expect(t.querySelector('[data-sub-pin]')).toBeNull()
  })

  it('bullets in a cell: the cell spacing (20 px, 4 px, or the vault\'s), a 16 px dot column; a card\'s table keeps the card\'s', () => {
    const cells = rule('.reader .page-table-box:not(.card .page-table-box) table :is(th, td)')
    expect(cells).toMatch(/--list-label-gap: var\(--cell-bullet-gap, 4px\)/)
    expect(cells).toMatch(/--list-indent: var\(--cell-bullet-indent, 20px\)/)
    expect(cells).toMatch(/--list-gutter: 16px/)
    expect(rule('.reader .page-table-box:not(.card .page-table-box) table li :is(ul, ol)')).toMatch(/margin-left: calc\(var\(--list-indent\) - var\(--list-gutter\) - var\(--list-label-gap\)\)/)
  })

  it('Table position: one rule from one variable, a card\'s own first', () => {
    expect(rule('.reader :is(.reader__body, .card-view__card) .page-table-frame')).toMatch(/margin-inline: var\(--table-inline, var\(--page-table-inline, 0\)\)/)
  })
})

let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  act(() => closeAll())
  h?.unmount()
  h = null
  forgetSearch()
})
async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
const PAGE = '# Week plan\n\n| Day | Plan |\n|---|---|\n| **Week one** | |\n| Mon | <ul><li>Run<ul><li>5 km</li></ul></li></ul> |\n| Tue | Swim |\n\n<!-- table: subhead 2 -->\n'
async function open(extra: Record<string, string>): Promise<HTMLElement> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, { ...READER_FILES, 'Week plan.md': PAGE, ...extra })
  h = await mount({ phone })
  await h.click('Search')
  await waitFor(h, () => h!.button(/^Week plan, page/) !== null)
  await h.click(/^Week plan, page/)
  await waitFor(h, () => h!.host.querySelector('.reader table[data-pin-rows]') !== null)
  return h.host.querySelector<HTMLElement>('.reader')!
}

describe('YAZ-5567: a page on the phone', () => {
  it('its table\'s subheader row and cell list; the vault\'s cell spacing, Centre and subheader look', async () => {
    const reader = await open({ '.yaseendocs/table-look.json': JSON.stringify({ version: 1, look: { cellBulletIndent: 24, cellBulletGap: 6, position: 'center', subheaderRow: { color: 'teal' } } }) })
    const t = reader.querySelector('table')!
    expect(subRows(t)).toEqual([1])
    expect(t.getAttribute('data-subheader-color')).toBe('teal')
    expect(t.querySelector('td ul ul')).not.toBeNull()
    expect([reader.style.getPropertyValue('--cell-bullet-indent'), reader.style.getPropertyValue('--cell-bullet-gap'), reader.style.getPropertyValue('--page-table-inline')]).toEqual(['24px', '6px', 'auto'])
  })

  it('no file: the subheader row still drawn, with the Mac\'s defaults (no variable, no part set)', async () => {
    const reader = await open({})
    const t = reader.querySelector('table')!
    expect(subRows(t)).toEqual([1])
    expect([t.getAttribute('data-subheader-color'), t.getAttribute('data-sticky-subheaders')]).toEqual([null, null])
    expect(reader.style.getPropertyValue('--cell-bullet-indent')).toBe('')
  })
})
