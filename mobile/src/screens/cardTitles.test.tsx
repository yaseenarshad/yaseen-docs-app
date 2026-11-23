// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from './testing'

/**
 * YAZ-5309 (YAZ-5308, decision D): Search, a card alone ("Open card") and an embedded card name a card by the title
 * on its card line. No title: the heads say "Untitled card" (the ID beside it); a link, a search row, an embed's
 * "Embedded from" and a VoiceOver label say the card's ID — as the Mac. A card file's name is `<kebab-title>-<id>.md`.
 */
const block = (text: string, line: string) => `\`\`\`card\n${text}\n\`\`\`\n<!-- card: ${line} -->`
const FILES: Record<string, string> = {
  '.yaseendocs/review.json': '{"enabled": true}',
  '.yaseendocs/ids.json': '{"enabled": true, "letters": "GEO"}',
  'Geo.md': `---\ntitle: Geo\nid: GEO-9\n---\n\n${block('Which is it?\n---\nThe {{Nile}}', 'GEO-1, title "Longest river"')}\n\n${block('Which river runs through Paris?\n---\nThe Seine', 'GEO-2')}\n`,
  'Links.md': '---\ntitle: Links\nid: GEO-10\n---\n\n![[GEO-1]]\n\n![[GEO-3]]\n\n![[GEO-4]]\n\nSee [[GEO-3]] and [[GEO-4]].\n',
  'cards/capital-of-france-geo-3.md': `---\nkind: card\n---\n\n${block('The capital is {{Paris}}.', 'GEO-3, title "Capital of France"')}\n`,
  'cards/geo-4.md': `---\nkind: card\n---\n\n${block('What is the highest peak?\n---\nEverest', 'GEO-4')}\n`,
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
async function openSearch(): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, FILES)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.search__rows, .tree') !== null)
  return x
}
const box = (x: Harness) => x.host.querySelector<HTMLInputElement>('input[type="search"]')!
/** A row as the person sees it (YAZ-5438): its name, then its icon's kind (a card's ID beside it). Tree rows and result rows. */
const rows = (x: Harness) =>
  [...x.host.querySelectorAll('.search__rows .row, .tree .tree__row')].map((r) => {
    const kind = { folder: 'folder', markdown: 'page', card: 'card' }[r.querySelector('.file-icon')?.getAttribute('data-kind') ?? ''] ?? '?'
    const side = r.querySelector('.row__side')?.textContent
    return `${r.querySelector('.row__main, .tree__label')?.textContent} | ${kind}${side ? ` · ${side}` : ''}`
  })
async function typeQuery(x: Harness, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box(x), value)
    box(x).dispatchEvent(new Event('input', { bubbles: true }))
  })
  await x.settle()
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
}

describe('Search finds a card by the title on its card line (point 3)', () => {
  it('a card in a page and a card file by their new titles; a card with no title by its ID; never by its question', async () => {
    h = await openSearch()
    await typeQuery(h, 'longest')
    // YAZ-5447: each under its page or its folder, as on the Mac.
    expect(rows(h)).toEqual(['Geo | page', 'Longest river | card · GEO-1'])
    await typeQuery(h, 'capital of fr')
    expect(rows(h)).toEqual(['cards | folder', 'Capital of France | card · GEO-3'])
    await typeQuery(h, 'which river')
    expect(rows(h)).toEqual([])
    await typeQuery(h, 'GEO-2')
    expect(rows(h)).toEqual(['Geo | page', 'GEO-2 | card · GEO-2'])
  })

  it('a card file by its new file name, `<kebab-title>-<id>.md`', async () => {
    h = await openSearch()
    await typeQuery(h, 'capital-of-france-geo-3')
    expect(rows(h)).toEqual(['cards | folder', 'GEO-3 — Capital of France | card · GEO-3'])
  })
})

describe('a card alone ("Open card") and an embedded card', () => {
  /** YAZ-5913: with Review on, the head shows the card's title rule after its review state ("New" for these cards). */
  // YAZ-5965: Title mark in the card head is Only if different by default: these cards follow the vault, so no title mark.
  const RULE = ''

  it('YAZ-5437: the page Geo shows each card\'s title band under its head; a card with no title has none', async () => {
    h = await openSearch()
    await openPage(h, 'Geo')
    await waitFor(h, () => h!.host.querySelectorAll('.page-card').length === 2)
    const cards = [...h.host.querySelectorAll('.page-card')]
    // YAZ-5913 / YAZ-5915 (one head for every card): the ID, then the marks — Review is on: "New" and the title rule.
    expect(cards.map((c) => c.querySelector('.card__head')?.textContent)).toEqual(['GEO-1New' + RULE, 'GEO-2New' + RULE])
    expect(cards.map((c) => c.querySelector('.card-band')?.textContent ?? null)).toEqual(['Longest river', null])
  })

  async function openPage(x: Harness, name: string) {
    await typeQuery(x, name)
    await x.click(new RegExp(`^${name}`))
    await waitFor(x, () => x.host.querySelector('.reader__title') !== null)
  }

  it('the embeds (YAZ-5437, the Mac\'s `cardEmbed.ts`): the head "↗ Embedded from <name> · ID", then the title band; no title: no band', async () => {
    h = await openSearch()
    await openPage(h, 'Links')
    await waitFor(h, () => h!.host.querySelectorAll('.card-embed__from').length === 3 && [...h!.host.querySelectorAll('.card-embed__body')].every((b) => b.textContent !== ''))
    const embeds = [...h.host.querySelectorAll('.card-embed')]
    expect(embeds.map((e) => e.querySelector('.card__head')?.textContent)).toEqual(['↗Embedded from "Geo"·GEO-1New' + RULE, '↗Embedded from "Capital of France"·GEO-3New' + RULE, '↗Embedded from "GEO-4"·GEO-4New' + RULE])
    expect(embeds.map((e) => e.querySelector('.card-band')?.textContent ?? null)).toEqual(['Longest river', 'Capital of France', null])
    // The links show the title, else the ID (as the Mac's pills).
    expect(h.text()).toContain('See Capital of France and GEO-4.')
  })

  it('a card file with a title: "Title · ID"; with none: "Untitled card · ID", and VoiceOver hears the ID', async () => {
    h = await openSearch()
    await typeQuery(h, 'capital of fr')
    await h.click(/^Capital of France/)
    await waitFor(h, () => h!.host.querySelector('.card-view') !== null && h!.host.querySelector('.card-view__card .card__body') !== null)
    expect(h.host.querySelector('.reader__title')?.textContent).toBe('Capital of France · GEO-3')
    expect(h.host.querySelector('.topbar__title')?.textContent).toBe('Capital of France')
    expect(h.host.querySelector('.card-view__card')?.textContent).toContain('The capital is')
    // YAZ-5437: the card's box as the Mac's card window: the head (ID), then the title band.
    expect(h.host.querySelector('.card-view__card .card__head')?.textContent).toBe('GEO-3New' + RULE)
    expect(h.host.querySelector('.card-view__card .card-band')?.textContent).toBe('Capital of France')
    await h.click('Back')
    await typeQuery(h, 'GEO-4')
    await h.click(/^geo-4|^GEO-4/)
    await waitFor(h, () => h!.host.querySelector('.card-view') !== null && h!.host.querySelector('.card-view__card .card__body') !== null)
    expect(h.host.querySelector('.reader__title')?.textContent).toBe('Untitled card · GEO-4')
    expect(h.host.querySelector('.card-view')?.getAttribute('aria-label')).toBe('GEO-4')
    // No title: no band; the ID in the head names it (the Mac's rule).
    expect(h.host.querySelector('.card-view__card .card-band')).toBeNull()
    expect(h.host.querySelector('.card-view__card .card__head')?.textContent).toBe('GEO-4New' + RULE)
    // The question is the card's text, never its title.
    expect(h.host.querySelector('.card-view__card')?.textContent).toContain('What is the highest peak?')
  })

  it('a card in a page with no title: "Untitled card · ID", in its page', async () => {
    h = await openSearch()
    await typeQuery(h, 'GEO-2')
    await h.click(/^GEO-2/)
    await waitFor(h, () => h!.host.querySelector('.card-view') !== null && h!.host.querySelector('.card-view__card .card__body') !== null)
    expect(h.host.querySelector('.reader__title')?.textContent).toBe('Untitled card · GEO-2')
    expect(h.host.querySelector('.card-view__in')?.textContent).toBe('in Geo')
  })
})
