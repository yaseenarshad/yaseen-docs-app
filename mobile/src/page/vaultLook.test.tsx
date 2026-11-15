// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from '../screens/testing'

/**
 * YAZ-5455 (round 2): the vault's own look in the reader, read only: its link pills (`.yaseendocs/link-pills.json`: the
 * Mac's sanitiser, CSS variables and format ends), its heading sizes (`text-formatting.json`), and "Clicking a link"
 * (`link-click.json`), which every link tap hands to the ONE door (`openLink.ts`). Made-up vault only.
 */
const opened = vi.hoisted(() => [] as { click: string; target: unknown }[])
vi.mock('./openLink', async (actual) => {
  const real = await actual<typeof import('./openLink')>()
  return {
    ...real,
    openLink: (door: Parameters<typeof real.openLink>[0], target: Parameters<typeof real.openLink>[1]) => {
      opened.push({ click: door.click, target })
      real.openLink(door, target)
    },
  }
})

let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
  opened.length = 0
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

async function openSpanish(extra: Record<string, string>): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, { ...READER_FILES, ...extra })
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.button(/^Spanish words, page/) !== null)
  await x.click(/^Spanish words, page/)
  await waitFor(x, () => x.host.querySelector('.reader__body h2') !== null && x.host.querySelector('.card-embed .card__body *') !== null)
  return x
}

describe('YAZ-5455: the vault look and the link door', () => {
  it('link-pills.json: the box and parts as the Mac\'s variables; the format\'s ends on each page link; text-formatting.json: the heading sizes', async () => {
    h = await openSpanish({
      '.yaseendocs/link-pills.json': JSON.stringify({ version: 2, format: '{name} · {id}', box: { fill: 'green', shape: 'square' } }),
      '.yaseendocs/text-formatting.json': JSON.stringify({ version: 1, h1: { size: 30 }, h2: { bold: false } }),
    })
    const reader = h.host.querySelector<HTMLElement>('.reader')!
    expect(reader.style.getPropertyValue('--pill-bg')).toContain('--table-fill-solid-green')
    expect(reader.style.getPropertyValue('--pill-radius')).toBe('0')
    expect(reader.style.getPropertyValue('--h1-size')).toBe('30px')
    expect(reader.style.getPropertyValue('--h2-weight')).toBe('400')
    const trip = [...h.host.querySelectorAll<HTMLAnchorElement>('.reader__body a.page-pill')].find((a) => a.textContent?.startsWith('Trip plan'))!
    expect(trip.dataset.open).toBe('page')
    expect([...trip.children].map((c) => c.className)).toEqual(['wikilink', 'wikilink link-pill__tail'])
    expect(trip.querySelector('.link-pill__id')?.textContent).toBe('DEMO-3')
  })

  it('no file, or a file that is not JSON: today\'s look (one link, no ends, no variables)', async () => {
    h = await openSpanish({ '.yaseendocs/link-pills.json': '{ not json' })
    expect(h.host.querySelector<HTMLElement>('.reader')!.getAttribute('style') ?? '').toBe('')
    expect(h.host.querySelector('.reader__body a.page-pill')).toBeNull()
    expect([...h.host.querySelectorAll('.reader__body a.wikilink')].some((a) => a.textContent === 'Trip plan')).toBe(true)
  })

  it('every link tap goes through the one door, which carries link-click.json ("explore")', async () => {
    h = await openSpanish({ '.yaseendocs/link-click.json': '{"click": "explore"}' })
    const trip = [...h.host.querySelectorAll<HTMLElement>('.reader__body a')].find((a) => a.textContent === 'Trip plan')!
    await act(async () => trip.click())
    await waitFor(h, () => h!.host.querySelector('.reader__title')?.textContent === 'Trip plan')
    expect(opened).toEqual([{ click: 'explore', target: { kind: 'page', path: 'Trip plan.md' } }])
    // "Linked from" goes through it too.
    await h.click(/^Linked from/)
    await waitFor(h, () => h!.host.querySelector('.linked-from__page') !== null)
    await h.click('Spanish words')
    expect(opened[1]).toEqual({ click: 'explore', target: { kind: 'page', path: 'Spanish words.md' } })
    await waitFor(h, () => h!.host.querySelector('.reader__title')?.textContent === 'Spanish words' && h!.host.querySelector('.card-embed__from') !== null)
    // An embed's "Embedded from".
    await act(async () => h!.host.querySelector<HTMLElement>('.card-embed__from')!.click())
    expect(opened[2]).toMatchObject({ click: 'explore', target: { kind: 'card', id: 'DEMO-40' } })
  })
})
