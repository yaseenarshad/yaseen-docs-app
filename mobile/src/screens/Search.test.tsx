// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, READER_ID, cardBlock, seedReaderVault, writeVaultFiles } from '../dev/readerVault'
import { ATTACK, remoteAttributes } from '../page/testing'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from './testing'

/**
 * 4C (YAZ-5079): the Search tab, a page read only and a card alone, on the real app with the real store, as 3B leaves a
 * vault after a first download (`dev/readerVault.ts`, made up). The sync is the fake: no network in any test.
 */

let h: Harness | null = null
let urls = 0
beforeEach(() => {
  urls = 0
  // jsdom has no object URLs: a stand-in that names each one.
  URL.createObjectURL = vi.fn(() => `blob:phone/${++urls}`)
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  h?.unmount()
  h = null
  forgetSearch()
})

async function openSearch(files?: Record<string, string | Uint8Array>): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, files)
  const x = await mount({ phone })
  await x.click('Search')
  // The rows build in slices (real timeouts).
  await waitFor(x, () => x.host.querySelector('.search__rows') !== null || x.text().includes('No pages yet'))
  return x
}

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}

const box = (x: Harness) => x.host.querySelector<HTMLInputElement>('input[type="search"]')!
const rows = (x: Harness) => [...x.host.querySelectorAll('.search__rows .row')].map((r) => `${r.querySelector('.row__main')?.textContent} | ${r.querySelector('.row__side')?.textContent}`)

async function typeQuery(x: Harness, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box(x), value)
    box(x).dispatchEvent(new Event('input', { bubbles: true }))
  })
  await x.settle()
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
}

describe('the Search tab (YAZ-5079)', () => {
  it('the empty box lists the pages, by name; no card file; the keyboard opens only here', async () => {
    h = await openSearch()
    expect(box(h).getAttribute('placeholder')).toBe('Search cards and pages')
    expect(h.host.querySelector('h2.section')?.textContent).toBe('Pages')
    expect(rows(h)).toEqual(['Café notes | page', 'Git cheat sheet | page', 'Spanish words | page', 'Trip plan | page'])
    expect(h.host.querySelectorAll('input, textarea, [contenteditable="true"]')).toHaveLength(1)
  })

  it('finds cards and pages in one list as each letter is typed: by title, alias and ID', async () => {
    h = await openSearch()
    await typeQuery(h, 'spa')
    expect(rows(h)).toEqual(['Spanish words | page', 'Español — Spanish words | page', 'Capital of Spain | card · DEMO-40'])
    await typeQuery(h, 'la bib')
    expect(rows(h)).toEqual(['la biblioteca | card · DEMO-12'])
    await typeQuery(h, 'demo-38')
    expect(rows(h)[0]).toBe('DEMO-38 — git pull | card · DEMO-38')
    await typeQuery(h, 'DEMO-2')
    expect(rows(h)[0]).toBe('DEMO-2 — Git cheat sheet | page')
  })

  it('regex characters, emoji and non-ASCII are plain text; no result says so', async () => {
    h = await openSearch()
    await typeQuery(h, '.*(')
    expect(h.text()).toContain('Nothing matches ".*(".')
    await typeQuery(h, 'café')
    expect(rows(h)).toEqual(['Café notes | page'])
    await typeQuery(h, '🙂')
    expect(h.text()).toContain('Nothing matches "🙂".')
    await typeQuery(h, '[[x]]')
    expect(h.text()).toContain('Nothing matches "[[x]]".')
  })

  it('the Type filter: All types, Pages, Cards; Cards lists the cards with an empty box', async () => {
    h = await openSearch()
    await h.click(/All types/)
    expect([...h.host.querySelectorAll('[role="menuitemradio"]')].map((m) => m.textContent)).toEqual(['All types✓', 'Pages', 'Cards'])
    await h.click('Cards')
    expect(h.host.querySelector('h2.section')?.textContent).toBe('Cards')
    expect(rows(h)).toEqual(['Capital of Spain | card · DEMO-40', 'git pull | card · DEMO-38', 'la biblioteca | card · DEMO-12', 'Two cards in one | card · DEMO-41'])
    await typeQuery(h, 'spanish')
    expect(rows(h)).toEqual([])
    await h.click(/Cards/)
    await h.click('Pages')
    await typeQuery(h, 'spa')
    expect(rows(h)).toEqual(['Spanish words | page', 'Español — Spanish words | page'])
  })

  it('Review off: no Cards type; a card file is a page row; a card in a page has no row', async () => {
    h = await openSearch({ ...READER_FILES, '.yaseendocs/review.json': '{"enabled": false}' })
    await h.click(/All types/)
    expect([...h.host.querySelectorAll('[role="menuitemradio"]')].map((m) => m.textContent)).toEqual(['All types✓', 'Pages'])
    await h.click('All types✓')
    expect(rows(h)).toContain('Capital of Spain | page')
    await typeQuery(h, 'biblioteca')
    expect(rows(h)).toEqual([])
  })

  it('an embedded card is found one time; the vault word for "page" is used', async () => {
    h = await openSearch({ ...READER_FILES, '.yaseendocs/unit-word.json': '{"unit": "doc"}' })
    await typeQuery(h, 'DEMO-40')
    expect(rows(h)).toEqual(['DEMO-40 — Capital of Spain | card · DEMO-40'])
  })

  it('R4: a page that a pass adds is in search after that pass', async () => {
    h = await openSearch()
    const index = await writeVaultFiles(h.store, { ...READER_FILES, 'New page.md': '---\ntitle: New page\n---\n\nHello.\n' }, {}, 'c2')
    await h.syncEmit({ type: 'changed', vault: READER_ID, settings: [], diff: { added: ['New page.md'], changed: [], removed: [], renamed: [] }, index })
    await waitFor(h, () => rows(h!).includes('New page | page'))
  })
})

async function openPage(x: Harness, title: string): Promise<void> {
  await x.click(new RegExp(`^${title}`))
  await waitFor(x, () => x.host.querySelector('.reader__body')?.childNodes.length !== 0 && x.host.querySelector('.reader__title') !== null)
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
}

describe('a page, read only (YAZ-5079)', () => {
  it('a tap opens the page read only: every block, its own card, the embedded card in place, no keyboard', async () => {
    h = await openSearch()
    await openPage(h, 'Spanish words')
    const body = h.host.querySelector('.reader__body')!
    expect(h.host.querySelector('.reader__title')?.textContent).toBe('Spanish words')
    expect([...body.querySelectorAll('h1, h2')].map((e) => e.textContent)).toEqual(['Spanish words', 'Places'])
    expect(body.querySelectorAll('.page-task')).toHaveLength(2)
    expect(body.querySelector('.page-table table')).not.toBeNull()
    expect(body.querySelector('.page-callout .page-callout__title')?.textContent).toBe('Good to know')
    expect(body.querySelector('pre code')?.textContent).toBe('git pull --rebase\n')
    // The page's own card, drawn as Review draws it (`renderCard`).
    expect(body.querySelector('.page-card[data-card-id="DEMO-12"] .card__side, .page-card[data-card-id="DEMO-12"]')?.textContent).toContain('la biblioteca')
    // Round 15, item 1: the embedded card in place, read only, under its head.
    await waitFor(h, () => body.querySelector('.card-embed__from') !== null && body.querySelector('.card-embed__body')?.textContent !== '')
    expect(body.querySelector('.card-embed__from')?.textContent).toBe('Embedded from "Capital of Spain" · DEMO-40')
    expect(body.querySelector('.card-embed__body')?.textContent).toContain('Madrid')
    expect(body.querySelector('.card-embed--missing')?.textContent).toBe('Missing card · DEMO-77')
    expect(h.host.querySelectorAll('input, textarea, [contenteditable="true"]')).toHaveLength(0)
  })

  it('a page is untrusted: its <script> and onerror= never run', async () => {
    const w = window as unknown as { readerRan?: number }
    w.readerRan = 0
    h = await openSearch()
    await openPage(h, 'Spanish words')
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))))
    expect(w.readerRan).toBe(0)
    expect(h.host.querySelector('.reader__body script')).toBeNull()
    expect(h.host.querySelector('.reader__body')!.innerHTML).not.toMatch(/onerror=/)
  })

  it('pictures: a stored one from storage; one not stored with no signal is a calm line (N3), and the text shows', async () => {
    h = await openSearch()
    await openPage(h, 'Spanish words')
    const body = h.host.querySelector('.reader__body')!
    await waitFor(h, () => body.querySelector('img[src^="blob:"]') !== null)
    expect([...body.querySelectorAll('img:not([hidden])')].map((i) => i.getAttribute('src'))).toEqual(['blob:phone/1'])
    expect(body.textContent).toContain('Picture · plaza.png · Needs a connection')
    expect(body.textContent).toContain('Words for a trip to Madrid in May.')
  })

  it("3D's media: a picture not on the phone shows the calm line with no signal, and fills in when the signal returns", async () => {
    h = await openSearch()
    let online = false
    const asked: string[] = []
    h.services.media = {
      async show(path) {
        asked.push(path)
        return online || path === 'assets/sun.png' ? { status: 'ready', path, url: `blob:3d/${path}`, type: 'image/png' } : { status: 'missing', path, why: 'offline' }
      },
    }
    await openPage(h, 'Spanish words')
    const body = h.host.querySelector('.reader__body')!
    await waitFor(h, () => body.textContent!.includes('Picture · plaza.png · Needs a connection'))
    expect(body.querySelector('img[src="blob:3d/assets/sun.png"]')).not.toBeNull()
    expect(body.textContent).toContain('Words for a trip to Madrid in May.')
    online = true
    await act(async () => void window.dispatchEvent(new Event('online')))
    await waitFor(h, () => body.querySelector('img[src="blob:3d/assets/plaza.png"]') !== null)
    expect(body.textContent).not.toContain('Needs a connection')
    // A pass that ends asks again too (no second ask for what is shown).
    const before = asked.length
    await h.syncSet({ status: 'synced' })
    expect(asked.length).toBe(before)
  })

  it('links: a page link opens that page; a broken link says so; a PDF opens in the iPhone viewer', async () => {
    h = await openSearch()
    await openPage(h, 'Spanish words')
    const opened: string[] = []
    const open = vi.spyOn(window, 'open').mockImplementation((url) => {
      opened.push(String(url))
      return {} as Window
    })
    await h.click('Missing page · Nowhere yet')
    expect(h.host.querySelector('.reader__notice')?.textContent).toBe('Missing page · Nowhere yet. It is not in the vault.')
    await h.click('Guide.pdf')
    expect(opened).toEqual([expect.stringMatching(/^blob:phone\//)])
    expect(h.host.querySelector('a[href="https://example.com/madrid"]')?.getAttribute('target')).toBe('_blank')
    await h.click('Trip plan')
    await waitFor(h, () => h!.host.querySelector('.reader__title')?.textContent === 'Trip plan')
    expect(h.text()).toContain('Madrid, May 3 to 10.')
    await h.click('‹ Back')
    await waitFor(h, () => h!.host.querySelector('.reader__title')?.textContent === 'Spanish words')
    open.mockRestore()
  })

  it('a tap on the embedded card head opens the card alone', async () => {
    h = await openSearch()
    await openPage(h, 'Spanish words')
    await waitFor(h, () => h!.host.querySelector('.card-embed__from') !== null)
    await act(async () => h!.host.querySelector<HTMLButtonElement>('.card-embed__from')!.click())
    await waitFor(h, () => h!.host.querySelector('.card-view') !== null)
    expect(h.host.querySelector('.reader__title')?.textContent).toBe('Capital of Spain · DEMO-40')
  })

  it('R3: the open page changed: it draws again in place, at the same reading place', async () => {
    h = await openSearch()
    await openPage(h, 'Trip plan')
    const screen = h.host.querySelector<HTMLElement>('.screen')!
    screen.scrollTop = 120
    const index = await writeVaultFiles(h.store, { ...READER_FILES, 'Trip plan.md': '---\ntitle: Trip plan\nid: DEMO-3\n---\n\nMadrid, May 4 to 11.\n' }, {}, 'c2')
    await h.syncEmit({ type: 'changed', vault: READER_ID, settings: [], diff: { added: [], changed: ['Trip plan.md'], removed: [], renamed: [] }, index })
    await waitFor(h, () => h!.text().includes('May 4 to 11'))
    expect(screen.scrollTop).toBe(120)
  })

  it('R6: the open page was renamed: it stays open under the new path', async () => {
    h = await openSearch()
    await openPage(h, 'Trip plan')
    const files: Record<string, string | Uint8Array> = { ...READER_FILES, 'trips/Trip plan.md': READER_FILES['Trip plan.md'] }
    delete files['Trip plan.md']
    await h.store.remove(READER_ID, 'Trip plan.md')
    const index = await writeVaultFiles(h.store, files, {}, 'c2')
    await h.syncEmit({ type: 'changed', vault: READER_ID, settings: [], diff: { added: [], changed: [], removed: [], renamed: [{ from: 'Trip plan.md', to: 'trips/Trip plan.md' }] }, index })
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))))
    expect(h.host.querySelector('.reader__title')?.textContent).toBe('Trip plan')
    expect(h.text()).toContain('Madrid, May 3 to 10.')
    expect(h.text()).not.toContain('not on the phone')
  })

  it('R5: the open page was deleted: back to the list, which says so', async () => {
    h = await openSearch()
    await openPage(h, 'Trip plan')
    const files = { ...READER_FILES }
    delete files['Trip plan.md']
    await h.store.remove(READER_ID, 'Trip plan.md')
    const index = await writeVaultFiles(h.store, files, {}, 'c2')
    await h.syncEmit({ type: 'changed', vault: READER_ID, settings: [], diff: { added: [], changed: [], removed: ['Trip plan.md'], renamed: [] }, index })
    await waitFor(h, () => h!.host.querySelector('.search') !== null)
    expect(h.host.querySelector('.search__notice')?.textContent).toBe('"Trip plan" was deleted.')
    await waitFor(h, () => !rows(h!).includes('Trip plan | page'))
  })

  it('the box and the Type are kept while a page is open', async () => {
    h = await openSearch()
    await typeQuery(h, 'trip')
    await openPage(h, 'Trip plan')
    await h.click('‹ Back')
    await waitFor(h, () => h!.host.querySelector('.search__rows') !== null)
    expect(box(h).value).toBe('trip')
    expect(rows(h)).toEqual(['Trip plan | page'])
  })
})

describe('nothing loads from another host (YAZ-5208, YAZ-5209)', () => {
  it('an attack page with its own attack card and an embedded attack card file; then the card view', async () => {
    const files: Record<string, string | Uint8Array> = {
      ...READER_FILES,
      'Attack.md': `---\ntitle: Attack\nid: DEMO-90\n---\n\n${ATTACK}\n\n${cardBlock('DEMO-91', ATTACK)}\n\n![[DEMO-92]]\n`,
      'cards/attack-demo-92.md': `---\nkind: card\ntitle: Attack card\n---\n\n${cardBlock('DEMO-92', ATTACK)}\n`,
    }
    h = await openSearch(files)
    await openPage(h, 'Attack')
    const body = h.host.querySelector('.reader__body')!
    await waitFor(h, () => body.querySelector('.card-embed__body')?.childNodes.length !== 0 && body.querySelector('.card-embed__body') !== null)
    expect(remoteAttributes(h.host)).toEqual([])
    expect(body.querySelector('video, audio, source, [background], [style]:not(.card__audio *)')).toBeNull()
    expect(body.querySelectorAll('a.page-media--web').length).toBeGreaterThanOrEqual(12)
    await h.click(/^Embedded from "Attack card"/)
    await waitFor(h, () => h!.host.querySelector('.card-view__card .card__sides') !== null)
    expect(remoteAttributes(h.host)).toEqual([])
  })
})

describe('the top bar and Back (YAZ-5210, YAZ-5211)', () => {
  it("YAZ-5210: a page and a card show the page's name, the sync dot and the gear", async () => {
    h = await openSearch()
    await openPage(h, 'Trip plan')
    expect(h.host.querySelector('.topbar__title')?.textContent).toBe('Trip plan')
    expect(h.host.querySelector('.topbar .sync-status')).not.toBeNull()
    expect(h.button('Settings')).not.toBeNull()
    await h.click('‹ Back')
    await typeQuery(h, 'capital')
    await h.click(/^Capital of Spain/)
    await waitFor(h, () => h!.host.querySelector('.card-view') !== null)
    expect(h.host.querySelector('.topbar__title')?.textContent).toBe('Capital of Spain')
    expect(h.host.querySelector('.topbar .sync-status')).not.toBeNull()
  })

  it('YAZ-5211: Back shows the list at the same place, with the same rows shown', async () => {
    const files: Record<string, string | Uint8Array> = { ...READER_FILES }
    for (let i = 0; i < 300; i++) files[`many/Page ${String(i).padStart(3, '0')}.md`] = `---\ntitle: Page ${String(i).padStart(3, '0')}\n---\n\nText ${i}.\n`
    h = await openSearch(files)
    await h.click('Show more')
    const count = rows(h).length
    expect(count).toBeGreaterThan(100)
    const screen = () => h!.host.querySelector<HTMLElement>('.screen')!
    screen().scrollTop = 900
    screen().dispatchEvent(new Event('scroll'))
    await h.click(/^Page 250/)
    await waitFor(h, () => h!.host.querySelector('.reader__body')?.childNodes.length !== 0)
    await h.click('‹ Back')
    await waitFor(h, () => h!.host.querySelector('.search__rows') !== null)
    await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
    expect(rows(h)).toHaveLength(count)
    expect(screen().scrollTop).toBe(900)
  })

  it('YAZ-5211: Back from a linked page shows the first page at its reading place', async () => {
    h = await openSearch()
    await openPage(h, 'Spanish words')
    const screen = () => h!.host.querySelector<HTMLElement>('.screen')!
    screen().scrollTop = 300
    screen().dispatchEvent(new Event('scroll'))
    await h.click('Trip plan')
    await waitFor(h, () => h!.host.querySelector('.reader__title')?.textContent === 'Trip plan')
    expect(screen().scrollTop).toBe(0)
    await h.click('‹ Back')
    await waitFor(h, () => h!.host.querySelector('.reader__title')?.textContent === 'Spanish words')
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))))
    expect(screen().scrollTop).toBe(300)
  })
})

describe('a card alone (YAZ-5079; round 12 item 10)', () => {
  it('a card in a page: the card, its history, and "Open page" lands on it', async () => {
    h = await openSearch()
    await typeQuery(h, 'la bib')
    await h.click(/^la biblioteca/)
    await waitFor(h, () => h!.host.querySelector('.card-view__card')?.textContent !== '')
    expect(h.host.querySelector('.reader__title')?.textContent).toBe('la biblioteca · DEMO-12')
    expect(h.text()).toContain('in Spanish words')
    expect(h.host.querySelector('.card-view__card')?.textContent).toContain('the library')
    expect(h.text()).toContain('2 Reviews')
    expect([...h.host.querySelectorAll('.card-view__table tbody tr')]).toHaveLength(2)
    expect(h.host.querySelector('.card-view__facts')?.textContent).toMatch(/^Due /)
    await h.click('Open page')
    await waitFor(h, () => h!.host.querySelector('.reader__title')?.textContent === 'Spanish words')
  })

  it('a card file: its title, its ID, no "Open page" (it has no other page)', async () => {
    h = await openSearch()
    await typeQuery(h, 'capital')
    await h.click(/^Capital of Spain/)
    await waitFor(h, () => h!.host.querySelector('.card-view__card')?.textContent !== '')
    expect(h.host.querySelector('.reader__title')?.textContent).toBe('Capital of Spain · DEMO-40')
    expect(h.host.querySelector('.card-view__card')?.textContent).toContain('Manzanares')
    expect(h.text()).toContain('3 Reviews')
    expect(h.button('Open page')).toBeNull()
    expect(h.text()).not.toContain('needs a fix')
  })

  it('a card file that is not valid: the first card and "This card file needs a fix on the Mac."', async () => {
    h = await openSearch()
    await typeQuery(h, 'two cards')
    await h.click(/^Two cards in one/)
    await waitFor(h, () => h!.host.querySelector('.card-view__card')?.textContent !== '')
    expect(h.text()).toContain('This card file needs a fix on the Mac.')
    expect(h.host.querySelector('.card-view__card')?.textContent).toContain('One')
    expect(h.host.querySelector('.card-view__card')?.textContent).not.toContain('Two')
  })

  it('a page with every block type and a card file with no card: both still show', async () => {
    h = await openSearch({ ...READER_FILES, 'cards/empty-demo-50.md': '---\nkind: card\ntitle: Empty card\n---\n\nJust text, no card.\n', 'Blocks.md': `---\ntitle: Blocks\n---\n\n${cardBlock('DEMO-60', 'Front')}\n` })
    await typeQuery(h, 'empty card')
    await h.click(/^Empty card/)
    await waitFor(h, () => h!.text().includes('needs a fix'))
    expect(h.text()).toContain('This card file needs a fix on the Mac.')
  })
})
