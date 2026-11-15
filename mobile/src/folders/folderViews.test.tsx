// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeAll } from '../explore/sheets'
import { forgetSearch } from '../search/searchState'
import type { Harness } from '../screens/testing'
import { forgetFolderTabs } from './FolderBody'
import { openFolder } from './folderTesting'

/**
 * YAZ-5460, the other views, read only and made for a phone: Cards (one card under another), Board (the Mac's columns
 * side by side, a sideways scroll), Calendar (an agenda of the days with pages, from today). A tap opens the page.
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

  it('Calendar: an agenda from today, the earlier days behind a button', async () => {
    h = await openFolder()
    await tab(h, 'Calendar')
    const days = () => [...h!.host.querySelectorAll<HTMLElement>('.folder-agenda__day')].map((d) => `${d.querySelector('.folder-agenda__date')?.textContent}: ${cards(d).join(', ')}`)
    expect(h.host.querySelector('.folder-agenda__month')?.textContent).toBe('November 2026')
    expect(days()).toEqual(['Sat, Nov 14 · Today: Lisbon weekend', 'Fri, Nov 20: Garden shed', 'Sat, Nov 28: Photo album', 'Sat, Dec 5: Kitchen paint'])
    await act(async () => h!.host.querySelector<HTMLElement>('.folder-agenda__earlier')!.click())
    expect(days()[0]).toBe('Mon, Nov 2: Bike repair')
  })
})
