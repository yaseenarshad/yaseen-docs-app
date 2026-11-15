// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, STICKY_FILES, STICKY_PATH, seedReaderVault } from '../dev/readerVault'
import { forgetListFolds } from '../search/ListTree'
import { forgetLists } from '../search/lists'
import { forgetSearch } from '../search/searchState'
import { forgetIdsForms } from '../search/showIds'
import { mount, newPhone, type Harness } from './testing'

/**
 * YAZ-5506: sticky folders in Search's tree, as the Mac sidebar (YAZ-3440). jsdom has no layout, so the screen's is
 * made up here: every row of a tree 44 px tall, the list 100 px below the scroller's top, the scroller 2,000 px tall
 * (the 40% rule then leaves the setting's 7 levels). Real Chrome checks the real layout (`publish/proveLayout.ts`,
 * `search-sticky`). Made-up vault (`STICKY_FILES`: nine folders deep).
 */
const ROW = 44
const LIST_TOP = 100
const scrolls = new WeakMap<Element, number>()
const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 375, width: 375, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true, get(this: Element) { return scrolls.get(this) ?? 0 }, set(this: Element, v: number) { scrolls.set(this, Math.max(0, v)) } })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: Element) { return this.classList.contains('screen') ? 2000 : 0 } })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const screen = this.closest('.screen')
    const s = screen === null ? 0 : (scrolls.get(screen) ?? 0)
    if (this.classList.contains('screen')) return rect(0, 2000)
    if (this.matches('ul.tree')) return rect(LIST_TOP - s, this.children.length * ROW)
    if (this.matches('ul.tree > li')) return rect(LIST_TOP - s + [...this.parentElement!.children].indexOf(this) * ROW, ROW)
    return rect(0, 0)
  })
})
afterEach(() => {
  h?.unmount()
  h = null
  forgetSearch()
  forgetLists()
  forgetListFolds()
  forgetIdsForms()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
})

async function waitFor(x: Harness, done: () => boolean, ms = 3000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
async function openSearch(extra: Record<string, string> = {}): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, { ...READER_FILES, ...STICKY_FILES, ...extra })
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null && x.host.querySelector('.search__fold') !== null)
  return x
}
const screen = (x: Harness) => x.host.querySelector<HTMLElement>('.screen')!
/** The rows of the tree shown, by name. */
const names = (x: Harness) => [...x.host.querySelectorAll('ul.tree > li .tree__label')].map((l) => l.textContent)
const indexOf = (x: Harness, name: string) => names(x).indexOf(name)
/** The stuck rows, top first: name and top. */
const stuck = (x: Harness) =>
  [...x.host.querySelectorAll<HTMLElement>('.tree__stuck .tree__row--stuck')].map((r) => ({ name: r.querySelector('.tree__label')?.textContent, top: parseFloat(r.style.top), open: r.querySelector('.tree__chevron--open') !== null })).sort((a, b) => a.top - b.top)
async function scrollTo(x: Harness, y: number): Promise<void> {
  await act(async () => {
    screen(x).scrollTop = y
    screen(x).dispatchEvent(new Event('scroll'))
    await new Promise((r) => setTimeout(r, 20))
  })
}
/** Scrolls so the row `name` stands `levels` rows below the top (under that many stuck rows), 1 px further. */
const under = (x: Harness, name: string, levels: number) => scrollTo(x, LIST_TOP + (indexOf(x, name) - levels) * ROW + 1)
async function typeQuery(x: Harness, value: string): Promise<void> {
  const box = x.host.querySelector<HTMLInputElement>('input[type="search"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, value)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await x.settle()
  await act(async () => void (await new Promise((r) => setTimeout(r, 30))))
}

describe('sticky folders in Search’s tree (YAZ-5506)', () => {
  it('scrolled to the deepest pages of a tree nine folders deep: the open folders stick, one row apart, the cap of 7', async () => {
    h = await openSearch()
    await h.click('Expand all folders')
    expect(stuck(h)).toEqual([])
    await under(h, 'Number 12 note 1', 7)
    expect(stuck(h).map((s) => s.name)).toEqual(STICKY_PATH.slice(0, 7))
    expect(stuck(h).map((s) => s.top)).toEqual([0, 1, 2, 3, 4, 5, 6].map((d) => d * ROW))
    expect(stuck(h).every((s) => s.open)).toBe(true)
    // The layer is hidden from VoiceOver: the rows are in the list.
    expect(h.host.querySelector('.tree__stuck')?.getAttribute('aria-hidden')).toBe('true')
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('at depth %i: the folders above it stick (never more than 7)', async (depth) => {
    h = await openSearch()
    await h.click('Expand all folders')
    // The first page of the folder `depth` levels down.
    await under(h, `${STICKY_PATH[depth - 1]} note 1`, Math.min(depth, 7))
    expect(stuck(h).map((s) => s.name)).toEqual(STICKY_PATH.slice(0, Math.min(depth, 7)))
  })

  it('scrolling: a folder leaves with its last row; back at the top, nothing sticks', async () => {
    h = await openSearch()
    await h.click('Expand all folders')
    await under(h, 'Number 12 note 1', 7)
    expect(stuck(h)).toHaveLength(7)
    // Past Atlas's own pages: only the rows below Atlas remain, and Atlas leaves with its last page.
    await scrollTo(h, LIST_TOP + indexOf(h, 'Atlas note 4') * ROW + 10)
    expect(stuck(h)).toEqual([{ name: 'Atlas', top: -10, open: true }])
    await scrollTo(h, LIST_TOP + (indexOf(h, 'Atlas note 4') + 1) * ROW)
    expect(stuck(h)).toEqual([])
    await under(h, 'Spain note 1', 3)
    expect(stuck(h).map((s) => s.name)).toEqual(['Atlas', 'Europe', 'Spain'])
    await scrollTo(h, 0)
    expect(stuck(h)).toEqual([])
  })

  it('a tap on a stuck folder scrolls back to it, under the rows stuck above it; nothing folds', async () => {
    h = await openSearch()
    await h.click('Expand all folders')
    await under(h, 'Number 12 note 1', 7)
    const spain = h.host.querySelector<HTMLElement>('.tree__stuck [data-stuck="' + indexOf(h, 'Spain') + '"] .tree__label')!
    await act(async () => spain.click())
    expect(screen(h).scrollTop).toBe(LIST_TOP + (indexOf(h, 'Spain') - 2) * ROW)
    expect(h.button(/^Spain, folder/)?.closest('li')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('a tap on the chevron of a stuck folder closes it, then scrolls it in', async () => {
    h = await openSearch()
    await h.click('Expand all folders')
    await under(h, 'Number 12 note 1', 7)
    const seville = indexOf(h, 'Seville')
    const chevron = h.host.querySelector<HTMLElement>(`.tree__stuck [data-stuck="${seville}"] .tree__chevron`)!
    await act(async () => {
      chevron.click()
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(h.button(/^Seville, folder/)?.closest('li')?.getAttribute('aria-expanded')).toBe('false')
    expect(names(h)).not.toContain('Triana')
    expect(screen(h).scrollTop).toBe(LIST_TOP + (seville - 4) * ROW)
  })

  it('typing: the found tree’s open folders stick too', async () => {
    h = await openSearch()
    await typeQuery(h, 'number 12 note 4')
    await waitFor(h, () => h!.host.querySelector('.search__found') !== null)
    expect(names(h).slice(0, 9)).toEqual(STICKY_PATH)
    await under(h, 'Number 12 note 4', 7)
    expect(stuck(h).map((s) => s.name)).toEqual(STICKY_PATH.slice(0, 7))
  })

  it('Favorites: a favorite folder’s open folders stick', async () => {
    h = await openSearch({ '.yaseendocs/favorites.json': JSON.stringify({ version: 1, favorites: ['Atlas/Europe/Spain'] }) })
    await h.click('Favorites')
    await waitFor(h, () => h!.host.querySelector('[role="tree"][aria-label="Favorites"]') !== null)
    await h.click('Expand all folders')
    await under(h, 'Seville note 1', 3)
    expect(stuck(h).map((s) => s.name)).toEqual(['Spain', 'Andalusia', 'Seville'])
  })
})
