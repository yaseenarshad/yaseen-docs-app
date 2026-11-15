// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, READER_ID, seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from '../screens/testing'
import { writeFolds } from '../store/foldPref'
import type { CommentsPort } from '../comments/bridge'
import type { WaitingComment } from '../comments/outbox'
import type { NewCommentInput } from '../comments/sender'
import { MOBILE_SETTINGS_PATH } from '../comments/mobileWrite'
import { forgetMobileSettings } from './mobileSettings'
import { attachFolds, HIDDEN_ATTR } from './folds'
import { landOn } from './headings'
import { coverAbove, headingShape, stickHeadings, stuckHeadings } from './stickyHeadings'

/**
 * YAZ-5591: sticky headings on the phone (Search's sticky folders' rules, `stickyFolders.ts`): the heading of the
 * section being read sticks under the top bar, with the headings that hold it above it, at most 40% of the scroller; a
 * tap on one lands on it, its fold arrow folds it; the page's ⋯ row writes `sticky-headings: true | false`; the vault's
 * `mobile.json` (YAZ-5592) decides when the page has no key of its own. jsdom has no layout, so the page's is made up
 * here: each heading 40 px tall, each other block 100 px, the page's body 100 px under the scroller's top. Real Chrome
 * checks the real layout (`publish/proveLayout.ts`, `sticky-headings`). Made-up pages only.
 */
const HEAD = 40
const BLOCK = 100
const BODY_TOP = 100
let screenHeight = 2000
const scrolls = new WeakMap<Element, number>()
const rect = (top: number, height: number) => ({ top, height, bottom: top + height, left: 0, right: 375, width: 375, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
const SCROLLER = '.screen, .test-scroller'
const blockHeight = (el: Element) => (el.hasAttribute(HIDDEN_ATTR) ? 0 : /^H[1-6]$/.test(el.tagName) ? HEAD : BLOCK)

beforeEach(() => {
  screenHeight = 2000
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true, get(this: Element) { return scrolls.get(this) ?? 0 }, set(this: Element, v: number) { scrolls.set(this, Math.max(0, v)) } })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get(this: Element) { return this.matches(SCROLLER) ? 100000 : 0 } })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get(this: Element) { return this.matches(SCROLLER) ? screenHeight : 0 } })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const scroller = this.closest(SCROLLER)
    const s = scroller === null ? 0 : (scrolls.get(scroller) ?? 0)
    if (this.matches(SCROLLER)) return rect(0, screenHeight)
    if (this.matches('.reader__body')) return rect(BODY_TOP - s, [...this.children].reduce((n, c) => n + blockHeight(c), 0))
    const parent = this.parentElement
    if (parent?.matches('.reader__body')) {
      const before = [...parent.children].slice(0, [...parent.children].indexOf(this)).reduce((n, c) => n + blockHeight(c), 0)
      return rect(BODY_TOP - s + before, blockHeight(this))
    }
    return rect(0, 0)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop
  delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
  document.body.replaceChildren()
})

const frames = () => new Promise((r) => setTimeout(r, 20))

describe('YAZ-5591: the stack (pure)', () => {
  // Beds (H2) > North bed (H3); Watering (H2) > Cans (H3); the page ends at 900.
  const shape = headingShape(
    [
      { top: 140, height: 40, level: 2 },
      { top: 280, height: 40, level: 3 },
      { top: 520, height: 40, level: 2 },
      { top: 660, height: 40, level: 3 },
    ],
    900,
  )
  it('each heading knows the heading that holds it and where its section ends', () => {
    expect(shape.map((h) => [h.parent, h.end])).toEqual([
      [-1, 520],
      [0, 520],
      [-1, 900],
      [2, 900],
    ])
  })
  it('none at the top; the section and its parent stick, the shallower on top, each one slot under its parent', () => {
    expect(stuckHeadings(shape, 0, 800)).toEqual([])
    expect(stuckHeadings(shape, 150, 800)).toEqual([{ index: 0, depth: 0, top: 0, slot: 0 }])
    expect(stuckHeadings(shape, 300, 800)).toEqual([
      { index: 0, depth: 0, top: 0, slot: 0 },
      { index: 1, depth: 1, top: 40, slot: 40 },
    ])
  })
  it('the section that ends pushes its headings up and out; the next one sticks after it', () => {
    expect(stuckHeadings(shape, 470, 800).map((s) => s.top)).toEqual([0, 10])
    // North bed goes with Beds: the next section's heading is under the line, and Beds (on top) covers it.
    expect(stuckHeadings(shape, 500, 800).map((s) => s.top)).toEqual([-20])
    expect(stuckHeadings(shape, 520, 800)).toEqual([])
    // A pixel of slack: a heading within a pixel of the line is at its own place.
    expect(stuckHeadings(shape, 521, 800)).toEqual([])
    expect(stuckHeadings(shape, 522, 800).map((s) => s.index)).toEqual([2])
    expect(stuckHeadings(shape, 700, 800).map((s) => s.index)).toEqual([2, 3])
  })
  it('never more than the room (40% of the screen): the heading that would pass it does not stick', () => {
    expect(stuckHeadings(shape, 300, 60).map((s) => s.index)).toEqual([0])
    expect(stuckHeadings(shape, 300, 30)).toEqual([])
  })
  it('a landing covers the headings that hold the target', () => {
    expect(coverAbove(shape, 1, 800)).toBe(40)
    expect(coverAbove(shape, 0, 800)).toBe(0)
  })
})

/** A drawn page in a scroller: the title, then Beds > North bed, Watering > Cans (as `PageView` lays it out). */
function page(scrollerClass = 'screen', title = 'Garden plan') {
  const scroller = document.createElement('div')
  scroller.className = scrollerClass
  const article = document.createElement('article')
  const layer = document.createElement('div')
  layer.className = 'reader__stuck'
  const body = document.createElement('div')
  body.className = 'reader__body'
  body.innerHTML = [`<h1>${title}</h1>`, '<p>Intro.</p>', '<h2>Beds</h2>', '<p>Soil.</p>', '<h3>North bed</h3>', '<p>Tomatoes.</p>', '<p>Basil.</p>', '<h2>Watering</h2>', '<p>Early.</p>', '<h3>Cans</h3>', '<p>Two.</p>', '<p>End.</p>'].join('')
  article.append(layer, body)
  scroller.append(article)
  document.body.append(scroller)
  return { scroller, layer, body }
}
const stuck = (layer: Element) => [...layer.querySelectorAll<HTMLElement>('.reader__stuck-row')].map((r) => ({ text: r.textContent, top: parseFloat(r.style.top) })).sort((a, b) => a.top - b.top)
async function scrollTo(scroller: HTMLElement, y: number) {
  scroller.scrollTop = y
  scroller.dispatchEvent(new Event('scroll'))
  await frames()
}

describe('YAZ-5591: the stuck headings on a drawn page', () => {
  it('stick as the page scrolls, under the top bar, with their parents; the title never; nothing in the page moves', async () => {
    const { scroller, layer, body } = page()
    const off = stickHeadings(scroller, body, layer, { title: 'Garden plan' })
    expect(stuck(layer)).toEqual([])
    const before = body.innerHTML
    await scrollTo(scroller, BODY_TOP + 300)
    expect(stuck(layer)).toEqual([
      { text: 'Beds', top: 0 },
      { text: 'North bed', top: 40 },
    ])
    // Copies: the page's own headings are where they were, and VoiceOver hears no second copy.
    expect(body.innerHTML).toBe(before)
    expect(layer.querySelector('[id]')).toBeNull()
    await scrollTo(scroller, BODY_TOP + 700)
    expect(stuck(layer).map((s) => s.text)).toEqual(['Watering', 'Cans'])
    await scrollTo(scroller, 0)
    expect(stuck(layer)).toEqual([])
    off()
    await scrollTo(scroller, BODY_TOP + 300)
    expect(layer.children).toHaveLength(0)
  })

  it('a tap on a stuck heading lands on it, right under the heading that holds it', async () => {
    const { scroller, layer, body } = page()
    stickHeadings(scroller, body, layer, { title: 'Garden plan' })
    await scrollTo(scroller, BODY_TOP + 400)
    const north = [...layer.querySelectorAll<HTMLElement>('.reader__stuck-row')].find((r) => r.textContent === 'North bed')!
    north.click()
    // North bed (280 into the page) lands 40 px under the top: under Beds, which stays stuck.
    expect(scroller.scrollTop).toBe(BODY_TOP + 280 - 40)
    scroller.dispatchEvent(new Event('scroll'))
    await frames()
    expect(stuck(layer).map((s) => s.text)).toEqual(['Beds'])
  })

  it('the fold arrow of a stuck heading folds the heading (the page\'s own arrow), then lands on it', async () => {
    const { scroller, layer, body } = page()
    const folds = attachFolds(body, { title: 'Garden plan' })
    folds.apply()
    stickHeadings(scroller, body, layer, { title: 'Garden plan' })
    await scrollTo(scroller, BODY_TOP + 300)
    const beds = [...layer.querySelectorAll<HTMLElement>('.reader__stuck-row')].find((r) => r.textContent === 'Beds')!
    const arrow = beds.querySelector<HTMLButtonElement>('.fold-btn')!
    expect(arrow).not.toBeNull()
    expect(arrow.tabIndex).toBe(-1)
    arrow.click()
    await frames()
    const real = [...body.querySelectorAll('h2')].find((h) => h.textContent === 'Beds')!
    expect(real.querySelector('.fold-btn')?.getAttribute('aria-expanded')).toBe('false')
    expect([...body.children].filter((c) => c.hasAttribute(HIDDEN_ATTR)).map((c) => c.textContent)).toEqual(['Soil.', 'North bed', 'Tomatoes.', 'Basil.'])
    // Beds lands at the top (nothing holds it), and nothing sticks now: its section is folded away.
    expect(scroller.scrollTop).toBe(BODY_TOP + 140)
    await scrollTo(scroller, scroller.scrollTop)
    expect(stuck(layer)).toEqual([])
  })

  it('never covers more than 40% of the screen', async () => {
    screenHeight = 150
    const { scroller, layer, body } = page()
    stickHeadings(scroller, body, layer, { title: 'Garden plan' })
    await scrollTo(scroller, BODY_TOP + 300)
    expect(stuck(layer).map((s) => s.text)).toEqual(['Beds'])
  })

  it('a long page drawn in slices: the headings of a slice drawn later stick too', async () => {
    const { scroller, layer, body } = page()
    stickHeadings(scroller, body, layer, { title: 'Garden plan' })
    body.insertAdjacentHTML('beforeend', '<h2>Costs</h2><p>Seeds.</p><p>Tools.</p>')
    await frames()
    await scrollTo(scroller, BODY_TOP + 960)
    expect(stuck(layer).map((s) => s.text)).toEqual(['Costs'])
  })

  it('an Explore panel: its own scroller', async () => {
    const { scroller, layer, body } = page('explore-sheet__body test-scroller')
    stickHeadings(scroller, body, layer, { title: 'Garden plan' })
    await scrollTo(scroller, BODY_TOP + 300)
    expect(stuck(layer).map((s) => s.text)).toEqual(['Beds', 'North bed'])
  })

  it('a landing (the Headings list, a link to #North bed) lands under the headings that will stick above it', async () => {
    const { scroller, layer, body } = page()
    stickHeadings(scroller, body, layer, { title: 'Garden plan' })
    const north = [...body.querySelectorAll<HTMLElement>('h3')].find((h) => h.textContent === 'North bed')!
    landOn(north, scroller)
    expect(scroller.scrollTop).toBe(BODY_TOP + 280 - 40)
  })

  it('the look: a zero-height sticky layer under the top bar, opaque rows in the page\'s colour with the thin line', () => {
    const css = readFileSync(fileURLToPath(import.meta.url).replace(/stickyHeadings\.test\.tsx$/, 'reader.css'), 'utf8')
    expect(css).toMatch(/\.reader__stuck \{[^}]*position: sticky;[^}]*top: -12px;[^}]*height: 0;/)
    expect(css).toMatch(/\.reader__stuck-row \{[^}]*position: absolute;[^}]*background: var\(--bg\);[^}]*box-shadow: 0 1px 0 var\(--border\);/)
  })
})

/* ---------------------------------------------------------------- the page view ---------------------------------- */

// The page view puts its properties' box after the title (a 100 px block here), so North bed passes the top at 380.
const md = (props: string, text: string) => `---\n${props}---\n\n${text}\n`
const GARDEN = ['# Garden', 'Intro.', '## Beds', 'Soil.', '### North bed', 'Tomatoes.', 'Basil.', '## Watering', 'Early.'].join('\n\n')
const FILES: Record<string, string | Uint8Array> = {
  ...READER_FILES,
  'Garden.md': md('title: Garden\n', GARDEN),
  'Own on.md': md('title: Own on\nsticky-headings: true\nfolding: true\n', GARDEN.replace('# Garden', '# Own on')),
  'Own off.md': md('title: Own off\nsticky-headings: false\n', GARDEN.replace('# Garden', '# Own off')),
}

function fakePort() {
  const list: WaitingComment[] = []
  const listeners = new Set<() => void>()
  const port: CommentsPort & { list: WaitingComment[] } = {
    list,
    ready: async () => {},
    waiting: (path) => list.filter((c) => path === undefined || c.path === path),
    add: vi.fn(async (input: NewCommentInput) => {
      const c: WaitingComment = { id: `s${list.length}`, path: input.path, body: input.body, at: '2026-11-15T06:00:00Z', madeAt: 0, notBefore: 0, ...(input.setting ? { setting: input.setting } : {}) }
      list.push(c)
      for (const l of [...listeners]) l()
      return c
    }),
    undo: async () => false,
    discard: async () => false,
    subscribe(l) {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
  }
  return port
}

describe('YAZ-5591 / YAZ-5592: the page view, its ⋯ row, the vault\'s mobile settings', () => {
  let h: Harness | null = null
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:phone/1')
    URL.revokeObjectURL = vi.fn()
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
    HTMLElement.prototype.animate = (() => ({}) as Animation) as unknown as typeof HTMLElement.prototype.animate
    for (const path of Object.keys(FILES)) writeFolds(READER_ID, path, [])
    forgetMobileSettings()
  })
  afterEach(() => {
    h?.unmount()
    h = null
    forgetSearch()
    forgetMobileSettings()
  })
  async function waitFor(x: Harness, done: () => boolean, ms = 5000): Promise<void> {
    const until = Date.now() + ms
    while (!done()) {
      if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text().slice(0, 300)}`)
      await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
    }
  }
  async function open(name: string, port: CommentsPort, mobile?: string): Promise<Harness> {
    const p = await newPhone()
    await seedReaderVault(p.store, p.tokens, mobile === undefined ? FILES : { ...FILES, [MOBILE_SETTINGS_PATH]: mobile })
    const x = await mount({ phone: p })
    ;(x.sync as unknown as { review: () => Promise<unknown> }).review = async () => ({ answers: { comments: port } })
    await x.click('Search')
    await waitFor(x, () => x.button(new RegExp(`^${name}, page`)) !== null)
    await x.click(new RegExp(`^${name}, page`))
    await waitFor(x, () => x.host.querySelector('.reader__body h2') !== null)
    await x.settle()
    return x
  }
  const screen = (x: Harness) => x.host.querySelector<HTMLElement>('.screen')!
  const layer = (x: Harness) => x.host.querySelector<HTMLElement>('.reader__stuck')!
  const row = (x: Harness) => [...x.host.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find((r) => /Sticky headings on this page/.test(r.textContent ?? '')) ?? null
  async function stuckAt(x: Harness, y: number) {
    await act(async () => {
      screen(x).scrollTop = y
      screen(x).dispatchEvent(new Event('scroll'))
      await frames()
    })
    return stuck(layer(x)).map((s) => s.text)
  }

  it('on by default: Beds and North bed stick; ⋯ "Sticky headings on this page" off writes `sticky-headings: false` on the safe path, and at once nothing sticks; on again', async () => {
    const port = fakePort()
    h = await open('Garden', port)
    expect(layer(h).getAttribute('aria-hidden')).toBe('true')
    expect(await stuckAt(h, BODY_TOP + 400)).toEqual(['Beds', 'North bed'])
    await h.click('Page tools')
    expect(row(h)?.getAttribute('aria-checked')).toBe('true')
    await h.click(/Sticky headings on this page/)
    expect(port.add).toHaveBeenCalledWith({ path: 'Garden.md', body: '', setting: { key: 'sticky-headings', on: false } })
    expect(await stuckAt(h, BODY_TOP + 410)).toEqual([])
    await h.click('Page tools')
    expect(row(h)?.getAttribute('aria-checked')).toBe('false')
    await h.click(/Sticky headings on this page/)
    expect(port.add).toHaveBeenLastCalledWith({ path: 'Garden.md', body: '', setting: { key: 'sticky-headings', on: true } })
    expect(await stuckAt(h, BODY_TOP + 400)).toEqual(['Beds', 'North bed'])
  })

  it('the vault says off (mobile.json): no sticky headings, no fold arrows; the rows say so', async () => {
    h = await open('Garden', fakePort(), '{"version":1,"folding":false,"stickyHeadings":false}')
    expect(h.host.querySelectorAll('.reader__body .fold-btn')).toHaveLength(0)
    expect(await stuckAt(h, BODY_TOP + 400)).toEqual([])
    await h.click('Page tools')
    expect(row(h)?.getAttribute('aria-checked')).toBe('false')
  })

  it("a page's own setting wins over the vault's, both ways", async () => {
    h = await open('Own on', fakePort(), '{"version":1,"folding":false,"stickyHeadings":false}')
    expect(h.host.querySelectorAll('.reader__body .fold-btn').length).toBeGreaterThan(0)
    expect(await stuckAt(h, BODY_TOP + 400)).toEqual(['Beds', 'North bed'])
    h.unmount()
    h = await open('Own off', fakePort())
    expect(await stuckAt(h, BODY_TOP + 400)).toEqual([])
  })

  it('Settings › "This vault on mobile": Folding and Sticky headings, on; a change shows at once and goes the safe path', async () => {
    const port = fakePort()
    h = await open('Garden', port)
    await h.click('Settings')
    await waitFor(h, () => /This vault on mobile/.test(h!.text()) && h!.host.querySelector('input[type="checkbox"]:not([disabled])') !== null)
    const box = (label: string) => [...h!.host.querySelectorAll('label.row')].find((l) => l.textContent === label)!.querySelector<HTMLInputElement>('input')!
    expect(box('Folding').checked).toBe(true)
    expect(box('Sticky headings').checked).toBe(true)
    await act(async () => box('Sticky headings').click())
    await h.settle()
    expect(port.add).toHaveBeenCalledWith({ path: MOBILE_SETTINGS_PATH, body: '', setting: { file: 'mobile', key: 'stickyHeadings', on: false } })
    expect(box('Sticky headings').checked).toBe(false)
    expect(box('Folding').checked).toBe(true)
  })
})
