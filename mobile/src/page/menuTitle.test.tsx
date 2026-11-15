// @vitest-environment jsdom
import { act } from 'react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { DRAWING_FILES } from '../dev/drawingVault'
import { closeAll, openSheet } from '../explore/sheets'
import { forgetSearch } from '../search/searchState'
import { forgetLists } from '../search/lists'
import { mount, newPhone, type Harness } from '../screens/testing'
import { rulesOf } from '../screens/onTop.testing'
import { folderWords } from './menuTitle'

/**
 * YAZ-5498: when the top bar cuts the open file's title ("…"), its ⋯ menu shows at its top the whole title and, under
 * it, the folder (small, grey), as a tooltip on the Mac; when the title fits, neither. A page, a card, a card file, a
 * drawing, and an Explore sheet's ⋯. jsdom has no layout: the title's widths are set here (`scrollWidth` over
 * `clientWidth` is "cut"). Made-up data only.
 */
const LONG = 'A very long page title about the first week of the trip to Madrid in May'
const FILES: Record<string, string | Uint8Array> = {
  ...READER_FILES,
  ...DRAWING_FILES,
  'plans/deep plan.excalidraw': DRAWING_FILES['garden.excalidraw'],
  'travel/2026/Madrid week.md': `---\ntitle: ${LONG}\n---\n\n# Week\n\nDay one.\n`,
}

/** Is the measured line cut now? (The top bar's title, the Explore sheet's head.) */
let cut = false
const MEASURED = '.topbar__title, .explore-sheet__where'
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get(this: HTMLElement) { return this.matches(MEASURED) ? (cut ? 480 : 180) : 0 } })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.matches(MEASURED) ? 200 : 0 } })
})
afterAll(() => {
  // Back to jsdom's own (on `Element.prototype`).
  delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
})

let h: Harness | null = null
beforeEach(() => {
  cut = false
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
})
afterEach(async () => {
  await act(async () => closeAll())
  h?.unmount()
  h = null
  forgetSearch()
  forgetLists()
  document.body.replaceChildren()
})

async function waitFor(x: Harness, done: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text().slice(0, 300)}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
async function openSearch(): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, FILES)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.search__rows, .tree') !== null)
  await x.settle()
  return x
}
async function search(x: Harness, value: string): Promise<void> {
  const box = x.host.querySelector<HTMLInputElement>('input[type="search"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, value)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await x.settle()
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
}
/** Opens the top bar's ⋯; the menu's full title and folder, or null when it shows none. */
async function menuTitle(x: Harness): Promise<{ name: string; folder: string | null } | null> {
  await x.click('Page tools')
  const menu = x.host.querySelector('.page-tools__menu')!
  expect(menu).not.toBeNull()
  const top = menu.querySelector('.menu-title')
  if (top === null) return null
  // At the menu's top, before its items.
  expect(menu.firstElementChild).toBe(top)
  return { name: top.querySelector('.menu-title__name')!.textContent!, folder: top.querySelector('.menu-title__path')?.textContent ?? null }
}
const items = (x: Harness) => [...x.host.querySelectorAll('.page-tools__menu [role="menuitem"]')].map((b) => b.textContent?.trim())

describe('YAZ-5498: the ⋯ menu shows the full title when the top bar cuts it', () => {
  it('a page: cut, the full title and its folder at the top; fits, neither (measured as the menu opens)', async () => {
    h = await openSearch()
    await search(h, 'madrid week')
    await h.click(/^A very long page title/)
    await waitFor(h, () => h!.host.querySelector('.reader__body h1') !== null)
    cut = true
    expect(await menuTitle(h)).toEqual({ name: LONG, folder: 'travel / 2026' })
    expect(items(h)).toEqual(['🔍 Find in page', '☰ Headings'])
    // Closed and opened again with the title fitting (the phone turned): no title.
    await h.click('Page tools')
    cut = false
    expect(await menuTitle(h)).toBeNull()
    expect(items(h)).toEqual(['🔍 Find in page', '☰ Headings'])
  })

  it('a page at the vault\'s top: the full title, no folder line', async () => {
    h = await openSearch()
    await h.click(/^Trip plan, page/)
    await waitFor(h, () => h!.host.querySelector('.reader__body p') !== null)
    cut = true
    expect(await menuTitle(h)).toEqual({ name: 'Trip plan', folder: null })
  })

  it('a card in a page: its ⋯ (Find in page, Headings); cut, its title and its page\'s folder; fits, none', async () => {
    h = await openSearch()
    await search(h, 'la bib')
    await h.click(/^la biblioteca/)
    await waitFor(h, () => h!.host.querySelector('.card-view__card .card__body') !== null)
    cut = true
    expect(await menuTitle(h)).toEqual({ name: 'la biblioteca', folder: null })
    expect(items(h)).toEqual(['🔍 Find in page', '☰ Headings'])
    await h.click('Page tools')
    cut = false
    expect(await menuTitle(h)).toBeNull()
  })

  it('a card file: cut, its title and its folder; fits, none', async () => {
    h = await openSearch()
    await search(h, 'capital of spain')
    await h.click(/^Capital of Spain/)
    await waitFor(h, () => h!.host.querySelector('.card-view__card .card__body') !== null)
    cut = true
    expect(await menuTitle(h)).toEqual({ name: 'Capital of Spain', folder: 'cards' })
    await h.click('Page tools')
    cut = false
    expect(await menuTitle(h)).toBeNull()
  })

  it('a drawing: its ⋯ has Copy path; cut, its name and its folder at the top; fits, none', async () => {
    h = await openSearch()
    await h.click(/^plans, folder/)
    await waitFor(h, () => h!.button('deep plan, drawing') !== null)
    await h.click('deep plan, drawing')
    await waitFor(h, () => h!.host.querySelector('.topbar__title')?.textContent === 'deep plan')
    cut = true
    expect(await menuTitle(h)).toEqual({ name: 'deep plan', folder: 'plans' })
    expect(items(h)).toEqual(['⧉ Copy path'])
    await h.click('Page tools')
    cut = false
    expect(await menuTitle(h)).toBeNull()
  })

  it('an Explore sheet\'s ⋯: its head cut, the full title and the folder at the top; fits, none', async () => {
    h = await openSearch()
    await act(async () => openSheet({ kind: 'page', path: 'travel/2026/Madrid week.md' }))
    await waitFor(h, () => document.querySelector('.explore-sheet__more') !== null)
    const more = () => document.querySelector<HTMLButtonElement>('.explore-sheet__more')!
    const top = () => document.querySelector('.explore-sheet__menu .menu-title')
    cut = true
    await act(async () => more().click())
    expect(top()?.querySelector('.menu-title__name')?.textContent).toBe(LONG)
    expect(top()?.querySelector('.menu-title__path')?.textContent).toBe('travel / 2026')
    expect(document.querySelector('.explore-sheet__menu')!.firstElementChild).toBe(top())
    await act(async () => more().click())
    cut = false
    await act(async () => more().click())
    expect(document.querySelector('.explore-sheet__menu')).not.toBeNull()
    expect(top()).toBeNull()
  })

  it('the title wraps in the menu, never "…"; the folder is small and grey', () => {
    const rules = rulesOf('../page/menuTitle.css')
    const rule = (sel: string) => rules.find((r) => r.selector === sel)!.decls
    for (const sel of ['.menu-title__name', '.menu-title__path']) {
      expect(rule(sel).get('white-space')).toBe('normal')
      expect(rule(sel).get('overflow-wrap')).toBe('anywhere')
      expect(rule(sel).get('text-overflow')).toBeUndefined()
      expect(rule(sel).get('overflow')).toBeUndefined()
    }
    expect(rule('.menu-title__path').get('color')).toBe('var(--fg-muted)')
    expect(Number.parseInt(rule('.menu-title__path').get('font-size')!)).toBeLessThan(Number.parseInt(rule('.menu-title__name').get('font-size')!))
    expect(folderWords('a/b/c.md')).toBe('a / b')
    expect(folderWords('c.md')).toBe('')
  })
})
