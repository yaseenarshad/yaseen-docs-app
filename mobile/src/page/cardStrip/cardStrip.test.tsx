// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedReaderVault } from '../../dev/readerVault'
import { forgetSearch } from '../../search/searchState'
import { mount, newPhone, type Harness } from '../../screens/testing'
import { DRAWER_MS } from './CardStrip'

/**
 * YAZ-5508: the Mac's card strip under the phone's card. Its parts in the Mac's order and words, closed by default; a
 * tap opens one drawer, a tap again (or another part) closes it; each drawer's content; the due line and a card file's
 * comments under it; the strip on a page's cards and card embeds (Reviews and Properties, as the Mac's); Review off:
 * none. Made-up files.
 */
const block = (text: string, line: string) => `\`\`\`card\n${text}\n\`\`\`\n<!-- card: ${line} -->`
const COMMENTS = ['comments:', '  - {id: demo0001, n: 1, at: "2026-11-10T09:00:00Z", by: sam, body: "Is the date right?"}'].join('\n')
const FILES: Record<string, string> = {
  '.yaseendocs/review.json': '{"enabled": true}',
  '.yaseendocs/ids.json': '{"enabled": true, "letters": "GEO"}',
  'Geo.md': `---\ntitle: Geography\nid: GEO-9\n---\n\nSee [[GEO-3]].\n\n${block(
    'How many islands?\n---\nA {{thousand}}',
    'GEO-1, title "Islands", level "A2", 2026-11-01T09:00Z good'
  )}\n\n![[GEO-3]]\n`,
  'trips/Lisbon.md': `---\ntitle: Lisbon\nid: GEO-10\n---\n\nThe capital card: [[GEO-3]].\n`,
  'cards/capital-of-spain-geo-3.md': `---\nkind: card\n${COMMENTS}\n---\n\n${block(
    'The capital is {{Madrid}}.',
    'GEO-3, title "Capital of Spain", tags "europe" "capitals", 2026-10-20T08:00Z good, 2026-10-24T08:00Z good, 2026-11-02T08:00Z hard'
  )}\n`,
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
async function open(files: Record<string, string>, query: string, row: RegExp): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.search__rows, .tree') !== null)
  await typeQuery(x, query)
  await x.click(row)
  await waitFor(x, () => x.host.querySelector('.card-view__card .card__body, .reader__body .card') !== null)
  return x
}
const strip = (x: Harness, at: ParentNode = x.host) => at.querySelector<HTMLElement>('.phone-strip')!
/** The bar as the person reads it: each toggle's words and count. */
const tabs = (s: HTMLElement) => [...s.querySelectorAll('.card-reviews__toggle')].map((b) => b.textContent)
const drawer = (s: HTMLElement) => s.querySelector<HTMLElement>('.phone-strip__drawer')!
const openPart = (s: HTMLElement) => [...s.querySelectorAll('.card-reviews__toggle[aria-expanded="true"]')].map((b) => b.getAttribute('data-part'))
const tap = async (x: Harness, el: Element) => {
  await act(async () => (el as HTMLElement).click())
  await x.settle()
}
const toggle = (s: HTMLElement, part: string) => s.querySelector(`.card-reviews__toggle[data-part="${part}"]`)!
const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

describe('the card strip on the phone (YAZ-5508)', () => {
  it("a card file: the Mac's four parts, closed; one drawer at a time; the due line and the comments under it", async () => {
    h = await open(FILES, 'capital of spain', /^Capital of Spain/)
    await waitFor(h, () => h!.host.querySelector('.page-comments') !== null)
    const s = strip(h)
    expect(tabs(s)).toEqual(['3 Reviews', 'Properties1', 'Linked mentions2', 'Embedded in1'])
    expect(toggle(s, 'properties').getAttribute('aria-label')).toBe('Properties, 1')
    // Closed by default: no drawer content, nothing open.
    expect(openPart(s)).toEqual([])
    expect(drawer(s).hasAttribute('data-open')).toBe(false)
    expect(s.querySelector('.card-view__table')).toBeNull()

    // Reviews: the review table, one row for each answer.
    await tap(h, toggle(s, 'reviews'))
    expect(openPart(s)).toEqual(['reviews'])
    expect(drawer(s).hasAttribute('data-open')).toBe(true)
    expect([...s.querySelectorAll('.card-view__table tbody tr')].map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^Oct 20, 2026Remembered/),
      expect.stringMatching(/^Oct 24, 2026Remembered/),
      expect.stringMatching(/^Nov 2, 2026/),
    ])
    // A tap again closes it; the content goes once the drawer has slid shut.
    await tap(h, toggle(s, 'reviews'))
    expect(openPart(s)).toEqual([])
    expect(drawer(s).hasAttribute('data-open')).toBe(false)
    await wait(DRAWER_MS + 30)
    expect(s.querySelector('.card-view__table')).toBeNull()

    // Properties: the card's own, in the properties panel's rows.
    await tap(h, toggle(s, 'properties'))
    expect([...s.querySelectorAll('.props__row')].map((r) => `${r.querySelector('.props__key')?.textContent}=${r.querySelector('.props__value')?.textContent}`)).toEqual(['tags=europecapitals'])
    // Another part closes the open one.
    await tap(h, toggle(s, 'links'))
    expect(openPart(s)).toEqual(['links'])
    expect(s.querySelector('.props__row')).toBeNull()
    expect([...s.querySelectorAll('.card-backlinks__page')].map((b) => b.textContent)).toEqual(['Geography', 'Lisbontrips'])
    await tap(h, toggle(s, 'embeds'))
    expect([...s.querySelectorAll('.card-backlinks__page')].map((b) => b.textContent)).toEqual(['Geography'])
    // A tap on a page opens it.
    await tap(h, s.querySelector('.card-backlinks__page')!)
    await waitFor(h, () => h!.host.querySelector('.reader__title')?.textContent === 'Geography')
  })

  it('the order under the card: the strip, the due line, then the comments', async () => {
    h = await open(FILES, 'capital of spain', /^Capital of Spain/)
    await waitFor(h, () => h!.host.querySelector('.page-comments') !== null)
    const view = h.host.querySelector('.card-view')!
    const order = [...view.querySelectorAll('.card-view__card, .phone-strip, .card-view__facts, .page-comments')].map((el) =>
      el.className.split(' ').find((c) => ['card-view__card', 'phone-strip', 'card-view__facts', 'page-comments'].includes(c))
    )
    expect(order).toEqual(['card-view__card', 'phone-strip', 'card-view__facts', 'page-comments'])
    expect(view.querySelector('.card-view__card')!.nextElementSibling).toBe(strip(h))
    expect(view.querySelector('.card-view__facts')?.textContent).toMatch(/^Due .* chance you remember it$/)
  })

  it('a card in a page: Reviews, Properties, Linked mentions (no "Embedded in", as the Mac\'s card window)', async () => {
    h = await open(FILES, 'islands', /^Islands/)
    const s = strip(h)
    expect(tabs(s)).toEqual(['1 Review', 'Properties1', 'Linked mentions0'])
    expect(toggle(s, 'links').hasAttribute('data-empty')).toBe(true)
    await tap(h, toggle(s, 'links'))
    expect(s.textContent).toContain('No page links to this card yet.')
    await tap(h, toggle(s, 'properties'))
    expect(s.querySelector('.props__row')?.textContent).toBe('levelA2')
  })

  it("a page's card and a card embed: the Mac's strip (Reviews, Properties), closed; a tap in it is no link tap", async () => {
    h = await open(FILES, 'geography', /^Geography/)
    await waitFor(h, () => h!.host.querySelectorAll('.reader__body .phone-strip').length === 2)
    const [own, embed] = [...h.host.querySelectorAll<HTMLElement>('.reader__body .phone-strip')]
    expect(own.closest('.card')?.classList.contains('page-card')).toBe(true)
    expect(embed.closest('.card')?.classList.contains('card-embed')).toBe(true)
    expect(tabs(own)).toEqual(['1 Review', 'Properties1'])
    expect(tabs(embed)).toEqual(['3 Reviews', 'Properties1'])
    expect(openPart(own)).toEqual([])
    await tap(h, toggle(embed, 'reviews'))
    expect(embed.querySelectorAll('.card-view__table tbody tr')).toHaveLength(3)
    expect(h.host.querySelector('.reader__title')?.textContent).toBe('Geography')
  })

  it('Review off: no strip, as the Mac', async () => {
    h = await open({ ...FILES, '.yaseendocs/review.json': '{"enabled": false}' }, 'capital of spain', /^Capital of Spain/)
    expect(h.host.querySelector('.phone-strip')).toBeNull()
    await h.click('Back')
    await typeQuery(h, 'geography')
    await h.click(/^Geography/)
    await waitFor(h, () => h!.host.querySelector('.reader__body .card-embed .card__body') !== null)
    await wait(50)
    expect(h.host.querySelector('.phone-strip')).toBeNull()
  })
})
