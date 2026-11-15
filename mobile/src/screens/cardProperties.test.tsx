// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardInContent } from '@client/review/cardRead'
import { seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from './testing'

/**
 * YAZ-5349 (card properties on the card line) on the phone, stage one. The phone READS a card's properties with the
 * shared parser (`cardInContent` → `CardAtPage.properties`, the index's `CardRecord.properties`), as the Mac does. It
 * SHOWS none until asked: YAZ-5349 puts them in the Mac's card strip (its Properties part), which the phone's card
 * view has, closed, since YAZ-5508 (`page/cardStrip/cardStrip.test.tsx` opens it). A title with `&#44;` (YAZ-5393) reads and shows as its comma.
 */
const block = (text: string, line: string) => `\`\`\`card\n${text}\n\`\`\`\n<!-- card: ${line} -->`
const FILES: Record<string, string> = {
  '.yaseendocs/review.json': '{"enabled": true}',
  '.yaseendocs/ids.json': '{"enabled": true, "letters": "GEO"}',
  'Geo.md': `---\ntitle: Geo\nid: GEO-9\n---\n\n${block('How many?\n---\nA {{thousand}}', 'GEO-1, title "1&#44;000 islands", tags "europe" "capitals", level "A2", secret "zebra-42"')}\n`,
  'cards/capital-of-spain-geo-3.md': `---\nkind: card\n---\n\n${block('The capital is {{Madrid}}.', 'GEO-3, title "Capital of Spain", tags ["unicorn-7"], 2026-11-01T09:00Z good')}\n`,
}

let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
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
async function typeQuery(x: Harness, value: string): Promise<void> {
  const box = x.host.querySelector<HTMLInputElement>('input[type="search"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, value)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await x.settle()
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
}

describe('card properties on the phone (YAZ-5349, stage one)', () => {
  it('the reader gives each card its properties through the shared parser', () => {
    expect(cardInContent('Geo.md', FILES['Geo.md'], 'GEO-1', -1)).toMatchObject({ title: '1,000 islands', properties: { tags: ['europe', 'capitals'], level: 'A2', secret: 'zebra-42' } })
    expect(cardInContent('cards/capital-of-spain-geo-3.md', FILES['cards/capital-of-spain-geo-3.md'], 'GEO-3', -1)).toMatchObject({ title: 'Capital of Spain', properties: { tags: ['unicorn-7'] }, cardFile: true })
  })

  it('Search and the card view name the card by its title (its comma shown); no screen shows a property', async () => {
    const phone = await newPhone()
    await seedReaderVault(phone.store, phone.tokens, FILES)
    h = await mount({ phone })
    await h.click('Search')
    await waitFor(h, () => h!.host.querySelector('.search__rows, .tree') !== null)
    await typeQuery(h, '1,000')
    expect([...h.host.querySelectorAll('.search__found .tree__row:not(.tree__row--context) .tree__label')].map((r) => r.textContent)).toEqual(['1,000 islands'])
    await h.click(/^1,000 islands/)
    await waitFor(h, () => h!.host.querySelector('.card-view__card .card__body') !== null)
    expect(h.host.querySelector('.reader__title')?.textContent).toBe('1,000 islands · GEO-1')
    expect(h.text()).not.toMatch(/zebra-42|capitals|A2/)
    await h.click('Back')
    await typeQuery(h, 'capital of spain')
    await h.click(/^Capital of Spain/)
    await waitFor(h, () => h!.host.querySelector('.card-view__card .card__body') !== null)
    expect(h.host.querySelector('.reader__title')?.textContent).toBe('Capital of Spain · GEO-3')
    expect(h.text()).not.toContain('unicorn-7')
    // A property value is never searched: it is no title.
    await h.click('Back')
    await typeQuery(h, 'zebra-42')
    expect(h.host.querySelectorAll('.search__found .tree__row')).toHaveLength(0)
  })
})
