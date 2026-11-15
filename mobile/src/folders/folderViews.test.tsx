// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAll } from '../explore/sheets'
import { forgetSearch } from '../search/searchState'
import type { Harness } from '../screens/testing'
import { forgetFolderTabs } from './FolderBody'
import { openFolder } from './folderTesting'
import { calendarFiles } from '../dev/folderVault'

/**
 * YAZ-5460, the other views, read only and made for a phone: Cards (one card under another), Board (the Mac's columns
 * side by side, a sideways scroll), Calendar (an agenda of the days with pages, the month of today). A tap opens the page.
 */
let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 14, 9))
})
afterEach(async () => {
  vi.useRealTimers()
  await act(async () => closeAll())
  h?.unmount()
  h = null
  forgetSearch()
  forgetFolderTabs()
  document.body.replaceChildren()
})

const tab = async (x: Harness, name: string) => {
  await act(async () => [...x.host.querySelectorAll<HTMLElement>('.folder-tabs__tab')].find((t) => t.textContent === name)!.click())
  await x.settle()
}
const cards = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('.folder-card')].map((c) => [c.querySelector('.folder-card__title')?.textContent, ...[...c.querySelectorAll('.folder-card__field')].map((f) => f.textContent)].join(' / '))

describe('cards, board and calendar (YAZ-5460)', () => {
  it('Cards: each page a card, its fields with their labels, in the view order', async () => {
    h = await openFolder()
    await tab(h, 'Cards')
    expect(cards(h.host)).toEqual([
      'Bike repair / StatusDone / OwnerSam',
      'Garden shed / StatusDoing / OwnerSam',
      'Kitchen paint / StatusIdea / OwnerAna',
      'Photo album / StatusIdea / OwnerLee',
      // No sort: the index's order, as on the Mac (the subfolder's page after the folder's own).
      'Lisbon weekend / StatusDoing / OwnerLee',
    ])
    await act(async () => h!.host.querySelectorAll<HTMLElement>('.folder-card')[2].click())
    await h.waitText('Pick a soft green.')
  })

  it('Board: a column for each option with its cards, side by side', async () => {
    h = await openFolder()
    await tab(h, 'Board')
    const columns = [...h.host.querySelectorAll<HTMLElement>('.folder-board__column')]
    expect(columns.map((c) => c.querySelector('.folder-board__head')?.textContent)).toEqual(['Idea 2', 'Doing 2', 'Done 1'])
    expect(cards(columns[1])).toEqual(['Garden shed / OwnerSam / DueNov 20, 2026', 'Lisbon weekend / OwnerLee / DueNov 14, 2026'])
  })

  it('Calendar: the list, on the month that holds today (the Mac default Month), its count, No date kept', async () => {
    h = await openFolder()
    await tab(h, 'Calendar')
    expect(h.host.querySelector('.folder-cal__title')?.textContent).toBe('November 2026')
    expect(h.host.querySelector('.folder-agenda__month')?.textContent).toBe('November 2026')
    expect(days(h)).toEqual(['Mon, Nov 2: Bike repair', 'Sat, Nov 14 · Today: Lisbon weekend', 'Fri, Nov 20: Garden shed', 'Sat, Nov 28: Photo album'])
    expect(h.host.querySelector('.folder-agenda .folder-view__count')?.textContent).toBe('4 of 5 pages')
  })
})

const days = (x: Harness) => [...x.host.querySelectorAll<HTMLElement>('.folder-agenda__day')].map((d) => `${d.querySelector('.folder-agenda__date')?.textContent}: ${cards(d).map((c) => c.split(' / ')[0]).join(', ')}${[...d.querySelectorAll('.folder-agenda__until')].map((u) => ` (${u.textContent})`).join('')}`)
const press = async (x: Harness, name: string) => {
  const b = [...x.host.querySelectorAll<HTMLButtonElement>('.folder-agenda button')].find((el) => el.getAttribute('aria-label') === name || el.textContent === name)!
  expect(b.disabled).toBe(false)
  await act(async () => b.click())
  await x.settle()
}
const title = (x: Harness) => x.host.querySelector('.folder-cal__title')?.textContent
const pressed = (x: Harness) => x.host.querySelector('.folder-cal__modes [aria-pressed="true"]')?.textContent
const count = (x: Harness) => x.host.querySelector('.folder-agenda .folder-view__count')?.textContent
const undated = (x: Harness) => [...[...x.host.querySelectorAll('.folder-agenda__block')].at(-1)!.querySelectorAll('.folder-card__title')].map((t) => t.textContent)

/**
 * YAZ-5597: the Mac's header over the same list: the title, ‹ ›, Today, and Month / Week / Rolling, which pick the
 * days the list holds. The made-up Events folder: pages from September to January around Sunday, Nov 15, 2026, a ski
 * trip from Fri Nov 13 to Wed Nov 18, two with no date.
 */
describe('the calendar header and modes (YAZ-5597)', () => {
  beforeEach(() => vi.setSystemTime(new Date(2026, 10, 15, 9)))
  const events = (extra: Record<string, string> = {}) => openFolder('Events', { ...calendarFiles('2026-11-15'), ...extra })

  it('Month: that month only; ‹ › a month back or on; Today back; an empty month says so', async () => {
    h = await events()
    expect(pressed(h)).toBe('Month')
    expect(title(h)).toBe('November 2026')
    expect(days(h)).toEqual([
      'Tue, Nov 3: Choir night',
      'Thu, Nov 12: Dentist',
      'Fri, Nov 13: Ski trip (until Wed, Nov 18)',
      'Sun, Nov 15 · Today: Team lunch',
      'Mon, Nov 16: Yoga class',
      'Thu, Nov 19: Piano lesson',
      'Tue, Nov 24: Car service',
    ])
    // Today's date ringed.
    expect(h.host.querySelector('.folder-agenda__day--today .folder-agenda__day-name')?.textContent).toBe('Sun, Nov 15')
    expect(count(h)).toBe('9 of 14 pages')
    expect(undated(h)).toEqual(['Gift ideas', 'Reading list'])
    await press(h, 'Previous month')
    expect(title(h)).toBe('October 2026')
    expect(days(h)).toEqual(['Tue, Oct 6: Book club'])
    await press(h, 'Next month')
    await press(h, 'Next month')
    expect(title(h)).toBe('December 2026')
    expect(days(h)).toEqual(['Sat, Dec 5: Family dinner', 'Fri, Dec 18: Concert'])
    await press(h, 'Next month')
    expect(title(h)).toBe('January 2027')
    expect(days(h)).toEqual(['Fri, Jan 1: New year party'])
    await press(h, 'Next month')
    expect(days(h)).toEqual([])
    expect(h.text()).toContain('Nothing in February 2027')
    expect(undated(h)).toEqual(['Gift ideas', 'Reading list'])
    await press(h, 'Today')
    expect(title(h)).toBe('November 2026')
    expect(days(h)).toHaveLength(7)
  })

  it('Week: that week, Sunday first (the Mac default); a page begun before it on its first day; ‹ › a week', async () => {
    h = await events()
    await press(h, 'Week')
    expect(pressed(h)).toBe('Week')
    expect(title(h)).toBe('Nov 15 – Nov 21, 2026')
    expect(days(h)).toEqual(['Sun, Nov 15 · Today: Ski trip, Team lunch (since Fri, Nov 13, until Wed, Nov 18)', 'Mon, Nov 16: Yoga class', 'Thu, Nov 19: Piano lesson'])
    expect(count(h)).toBe('6 of 14 pages')
    await press(h, 'Next week')
    expect(title(h)).toBe('Nov 22 – Nov 28, 2026')
    expect(days(h)).toEqual(['Tue, Nov 24: Car service'])
    await press(h, 'Next week')
    expect(title(h)).toBe('Nov 29 – Dec 5, 2026')
    expect(days(h)).toEqual(['Sat, Dec 5: Family dinner'])
    await press(h, 'Previous week')
    await press(h, 'Previous week')
    await press(h, 'Previous week')
    expect(title(h)).toBe('Nov 8 – Nov 14, 2026')
    expect(days(h)).toEqual(['Thu, Nov 12: Dentist', 'Fri, Nov 13: Ski trip (until Wed, Nov 18)'])
    await press(h, 'Today')
    expect(title(h)).toBe('Nov 15 – Nov 21, 2026')
  })

  it('Week: Sunday first, the Mac default (its "Week starts on" is personal, never in folder-pages.json); an empty week says so', async () => {
    // A file that names a week start is not read: the Mac never writes it there.
    h = await events({ '.yaseendocs/folder-pages.json': '{"version": 1, "weekStartsOn": "monday"}' })
    await press(h, 'Week')
    expect(title(h)).toBe('Nov 15 – Nov 21, 2026')
    await press(h, 'Previous week')
    await press(h, 'Previous week')
    expect(title(h)).toBe('Nov 1 – Nov 7, 2026')
    expect(days(h)).toEqual(['Tue, Nov 3: Choir night'])
    await press(h, 'Previous week')
    expect(title(h)).toBe('Oct 25 – Oct 31, 2026')
    expect(days(h)).toEqual([])
    expect(h.text()).toContain('Nothing in Oct 25 – Oct 31, 2026')
  })

  it('opens on Week when the view says Week (the Mac calendarScale)', async () => {
    const files = calendarFiles('2026-11-15')
    h = await openFolder('Events', { ...files, 'Events/.folder.md': (files['Events/.folder.md'] as string).replace('      name: Calendar\n', '      name: Calendar\n      calendarScale: week\n') })
    expect(pressed(h)).toBe('Week')
    expect(title(h)).toBe('Nov 15 – Nov 21, 2026')
  })

  it('Rolling: every page in one list, opening at today; ‹ › go to the month heading before or after; Today back', async () => {
    h = await events()
    await press(h, 'Rolling')
    expect(pressed(h)).toBe('Rolling')
    expect(title(h)).toBe('November 2026')
    expect([...h.host.querySelectorAll('.folder-agenda__month')].map((m) => m.textContent)).toEqual(['September 2026', 'October 2026', 'November 2026', 'December 2026', 'January 2027', 'No date'])
    expect(days(h)).toHaveLength(12)
    expect(count(h)).toBe('14 pages')
    await press(h, 'Next month')
    expect(title(h)).toBe('December 2026')
    await press(h, 'Next month')
    expect(title(h)).toBe('January 2027')
    // The last month heading: no › past it.
    expect(h.host.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!.disabled).toBe(true)
    await press(h, 'Today')
    expect(title(h)).toBe('November 2026')
    await press(h, 'Previous month')
    await press(h, 'Previous month')
    expect(title(h)).toBe('September 2026')
    expect(h.host.querySelector<HTMLButtonElement>('[aria-label="Previous month"]')!.disabled).toBe(true)
    // Back to Month keeps the place: September.
    await press(h, 'Month')
    expect(title(h)).toBe('September 2026')
    expect(days(h)).toEqual(['Sun, Sep 6: Winter fair'])
  })
})
