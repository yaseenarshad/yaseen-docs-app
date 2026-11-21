// @vitest-environment jsdom
import { searchCandidates } from '@client/search/searchCandidates'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardBlock, seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import { ALL_TYPES, buildRows, findRows, searchRecords } from '../search/searchRun'
import { phoneRecord } from '../sync/phoneIndex'
import { mount, newPhone, type Harness } from '../screens/testing'

/**
 * YAZ-5556: a card file holds its ID on its card line (`<!-- card: NC-40, title "…" -->`), not in its front matter
 * (decision D, YAZ-5308), so its index record has no `id`. On the phone its ID still finds it in search (as the Mac's
 * `cardFileId`), a `[[NC-40]]` link in a page opens it (with words after `|` too, as the Mac's click), and its top bar
 * shows its ID chip as a page with an ID does (YAZ-5450). Made-up vault only.
 */
const page = (props: string, body: string) => `---\n${props}---\n\n${body}\n`
const FILES: Record<string, string> = {
  'Trip.md': page('title: Trip\nid: NC-1\n', ['# Trip', 'The card: [[NC-40]].', 'In words: [[NC-40|the capital]].', 'A page: [[Packing]].'].join('\n\n')),
  'Packing.md': page('title: Packing\nid: NC-2\n', 'Socks.'),
  'cards/capital-of-france-nc-40.md': page('kind: card\n', cardBlock('NC-40', 'Paris\n---\nOn the Seine.', ['title "Capital of France"'])),
  '.yaseendocs/review.json': '{"enabled": true}',
  '.yaseendocs/ids.json': '{"enabled": true, "letters": "NC"}',
}
const CARD_FILE = 'cards/capital-of-france-nc-40.md'

const records = (files: Record<string, string>) => searchRecords(Object.fromEntries(Object.entries(files).filter(([path]) => path.endsWith('.md')).map(([path, text]) => [path, phoneRecord(path, text.length, text, { ctime: 1, mtime: 1 })])))

describe('YAZ-5556: search finds a card file by its card ID', () => {
  it('the record holds no id; NC-40 in each form the Mac reads, and the number alone, find the card file, as on the Mac', async () => {
    const recs = records(FILES)
    expect(recs.find((r) => r.path === CARD_FILE)?.id).toBeUndefined()
    const rows = (await buildRows({ records: recs, letters: ['NC'], cards: true }))!
    expect(rows).toEqual(searchCandidates(recs, ['NC'], true))
    for (const q of ['NC-40', 'nc-40', 'nc40', 'nc 40', '[[NC-40]]', '40', '#40']) {
      const found = (await findRows(rows, q, ALL_TYPES))!
      expect([q, found[0]?.path, found[0]?.id, found[0]?.card]).toEqual([q, CARD_FILE, 'NC-40', true])
    }
    // A number of no ID finds nothing by ID.
    expect((await findRows(rows, 'NC-41', ALL_TYPES))!.map((r) => r.path)).toEqual([])
  })

  it('Review off: a card file is a page row with no ID (the Mac\'s `searchCandidates` too); its title still finds it', async () => {
    const recs = records(FILES)
    const rows = (await buildRows({ records: recs, letters: ['NC'], cards: false }))!
    expect(rows).toEqual(searchCandidates(recs, ['NC'], false))
    expect((await findRows(rows, 'NC-40', ALL_TYPES))!.map((r) => r.path)).toEqual([])
    expect((await findRows(rows, 'Capital of France', ALL_TYPES))!.map((r) => r.path)).toEqual([CARD_FILE])
  })
})

let h: Harness | null = null
const write = vi.fn<(text: string) => Promise<void>>()
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
  HTMLElement.prototype.animate = function () {
    return {} as Animation
  } as unknown as typeof HTMLElement.prototype.animate
  write.mockReset()
  write.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } })
})
afterEach(() => {
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
const link = (x: Harness, text: string) => [...x.host.querySelectorAll<HTMLElement>('.reader__body a')].find((a) => a.textContent === text)!
const chip = (x: Harness) => x.host.querySelector('.topbar .page-id')

async function openTrip(files: Record<string, string> = FILES): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.button(/^Trip, page/) !== null)
  await x.click(/^Trip, page/)
  await waitFor(x, () => x.host.querySelector('.reader__body h1') !== null)
  return x
}

async function backToTrip(x: Harness): Promise<void> {
  await x.click('Back')
  await waitFor(x, () => x.host.querySelector('.reader__body h1') !== null && chip(x)?.textContent === 'NC-1')
}

describe('YAZ-5556: a link to a card file opens it; its top bar shows its ID', () => {
  it('[[NC-40]] and [[NC-40|the capital]] open the card file in the card view, with the NC-40 chip that copies its path', async () => {
    h = await openTrip()
    expect(chip(h)?.textContent).toBe('NC-1')
    // The ID link shows the card's title, and is a card link.
    // The Mac's card pill (YAZ-5792, `cardPill`) inside the link: the title with the card icon.
    expect(link(h, 'Capital of France').className).toBe('page-pill')
    expect(link(h, 'Capital of France').querySelector('.wikilink--card')?.textContent).toBe('Capital of France')
    expect(link(h, 'the capital').querySelector('.wikilink--card')?.textContent).toBe('the capital')
    for (const words of ['Capital of France', 'the capital']) {
      await act(async () => link(h!, words).click())
      await waitFor(h, () => h!.host.querySelector('.card-view') !== null && chip(h!) !== null)
      expect(h.host.querySelector('.topbar__title')?.textContent).toBe('Capital of France')
      expect(chip(h)?.textContent).toBe('NC-40')
      expect(chip(h)?.getAttribute('aria-label')).toBe('NC-40. Copy the path')
      await backToTrip(h)
    }
    await act(async () => link(h!, 'Capital of France').click())
    await waitFor(h, () => chip(h!)?.textContent === 'NC-40')
    await h.click('NC-40. Copy the path')
    expect(write).toHaveBeenCalledWith(CARD_FILE)
  })

  it('no chip for the card file in a vault with no IDs', async () => {
    h = await openTrip({ ...FILES, '.yaseendocs/ids.json': '{"enabled": false}' })
    await act(async () => link(h!, 'Capital of France').click())
    await waitFor(h, () => h!.host.querySelector('.topbar__title')?.textContent === 'Capital of France' && h!.text().includes('On the Seine.'))
    expect(chip(h)).toBeNull()
  })
})
