// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TABLE_LOOK_DEFAULTS, tableLookSettings } from '@shared/tableLook'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import { closeAll } from '../explore/sheets'
import { mount, newPhone, type Harness } from '../screens/testing'
import { MAC_CALENDAR_LOOK } from './calendarLook'
import { applyTableFile } from './tableFile'
import { applyTableLook, stickyHeaderOf, tableCalendarLook } from './tableLook'

/**
 * YAZ-5487: the phone's tables read the vault's table look (`.yaseendocs/table-look.json`, the Mac's 21 table settings):
 * a page's tables take its header row, sticky header row and Text in cells where they set none, and the calendar
 * tables its calendar look. No file: the Mac's defaults, as before. Made-up vault.
 */
const table = (html: string): HTMLTableElement => {
  const box = document.createElement('div')
  box.innerHTML = html
  return box.querySelector('table')!
}
const GRID = '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>'
const VAULT = tableLookSettings({ look: { stickyHeader: false, textInCells: 'clip', headerRow: { color: 'blue', weight: 'regular' }, nowMark: 'tint', dimPast: 'off', shadeDarkness: 12 }, newTables: { dayStart: 420, dayEnd: 1200 } })

describe('YAZ-5487: the phone reads table-look.json (tableLook.ts)', () => {
  it('the calendar look: the vault\'s, each value checked; no file, the Mac\'s defaults; the Now button stays the Mac\'s', () => {
    expect(tableCalendarLook(VAULT)).toEqual({ ...MAC_CALENDAR_LOOK, nowMark: 'tint', dimPast: 'off', shadeDarkness: 12, dayStart: 420, dayEnd: 1200 })
    expect(tableCalendarLook(null)).toEqual(MAC_CALENDAR_LOOK)
    expect(tableCalendarLook(TABLE_LOOK_DEFAULTS)).toEqual(MAC_CALENDAR_LOOK)
    expect([stickyHeaderOf(VAULT), stickyHeaderOf(null)]).toEqual([false, true])
  })

  it('a table with no comment: the vault\'s header row parts (only those off the default), no frozen header row, Clip', () => {
    const t = table(GRID)
    applyTableLook(t, VAULT)
    expect([t.getAttribute('data-header-color'), t.getAttribute('data-header-weight'), t.getAttribute('data-header-strength'), t.getAttribute('data-freeze-rows')]).toEqual(['blue', 'regular', null, '0'])
    expect([...t.querySelectorAll('[data-clip]')]).toHaveLength(4)
    // No file, or the defaults: nothing changes.
    for (const look of [null, TABLE_LOOK_DEFAULTS]) {
      const plain = table(GRID)
      applyTableLook(plain, look)
      expect(plain.outerHTML).toBe(table(GRID).outerHTML)
    }
  })

  it('a table with a comment: its own parts win; its freeze and Clip are its comment\'s, over the vault\'s defaults', () => {
    const own = table(GRID)
    applyTableFile(own, 'table: header red, stickyheader, wrap', VAULT)
    applyTableLook(own, VAULT)
    expect([own.getAttribute('data-header-color'), own.getAttribute('data-header-weight'), own.getAttribute('data-freeze-rows')]).toEqual(['red', 'regular', '1'])
    expect(own.querySelector('[data-clip]')).toBeNull()
    const follows = table(GRID)
    applyTableFile(follows, 'table: stripes', VAULT)
    applyTableLook(follows, VAULT)
    expect([follows.getAttribute('data-freeze-rows'), follows.querySelectorAll('[data-clip]').length]).toEqual(['0', 4])
    const before = table(GRID)
    applyTableFile(before, 'table: stripes')
    expect([before.getAttribute('data-freeze-rows'), before.querySelectorAll('[data-clip]').length]).toEqual(['1', 0])
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
const PAGE = { 'Table page.md': '# Table page\n\n| Day | Plan |\n|---|---|\n| Mon | Run |\n| Tue | Swim |\n| Wed | Rest |\n' }
async function open(extra: Record<string, string>): Promise<HTMLTableElement> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, { ...READER_FILES, ...PAGE, ...extra })
  h = await mount({ phone })
  await h.click('Search')
  await waitFor(h, () => h!.button(/^Table page, page/) !== null)
  await h.click(/^Table page, page/)
  await waitFor(h, () => h!.host.querySelector('.reader table[data-pin-rows]') !== null)
  return h.host.querySelector<HTMLTableElement>('.reader table')!
}

describe('YAZ-5487: a page on the phone reads its vault\'s table-look.json', () => {
  it('the vault\'s look: the header row\'s colour, no frozen header row, Clip', async () => {
    const t = await open({ '.yaseendocs/table-look.json': JSON.stringify({ version: 1, look: { stickyHeader: false, textInCells: 'clip', headerRow: { color: 'teal' } } }) })
    expect([t.getAttribute('data-header-color'), t.getAttribute('data-pin-rows')]).toEqual(['teal', '0'])
    expect(t.querySelectorAll('[data-clip]').length).toBeGreaterThan(0)
  })

  it('no file: the Mac\'s defaults, as before', async () => {
    const t = await open({})
    expect([t.getAttribute('data-header-color'), t.getAttribute('data-pin-rows')]).toEqual([null, '1'])
    expect(t.querySelector('[data-clip]')).toBeNull()
  })
})
