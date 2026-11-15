// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { paintedFindRanges, textMatches } from '@client/editor/find/cardFind'
import { READER_FILES, cardBlock, seedReaderVault } from '../../dev/readerVault'
import { forgetSearch } from '../../search/searchState'
import { mount, newPhone, type Harness } from '../../screens/testing'
import { renderPage } from '../pageRender'

/**
 * YAZ-5456: find in page and the headings list, from the page's "⋯". Find: the Mac's matching and paint
 * (`cardFind.ts`), "2 of 7", ↑ ↓ (and Enter), each match in the upper third, ✕ or Escape closes and the paint goes.
 * Headings: the Mac's table of contents rows, a tap lands on the heading. Measured on a 2,000-line page. Made-up data only.
 */
const page = (props: string, body: string) => `---\n${props}---\n\n${body}\n`
/** A 2,000-line page: 400 sections of a heading, three lines, a blank. Every tenth line says "needle". */
const LONG = Array.from({ length: 400 }, (_, i) => `## Section ${i + 1}\nA line about apples ${i}.\nAnother line${i % 2 === 0 ? ' with a needle' : ''} here.\nThe end of part ${i + 1}.`).join('\n\n')
const FILES: Record<string, string | Uint8Array> = {
  ...READER_FILES,
  'Fruit.md': page('title: Fruit\n', ['# Fruit', 'Apples and more APPLES. An apple a day.', '## Pears', 'No apples here: pears.', '### Small pears', 'Tiny.', cardBlock('DEMO-90', 'Which fruit?\n---\nAn apple', ['title "Fruit card"'])].join('\n\n')),
  'Plain.md': page('title: Plain\n', 'No headings at all, apple.'),
  'Long.md': page('title: Long\n', `# Long\n\n${LONG}`),
}

let h: Harness | null = null
let flashed: string[] = []
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
  flashed = []
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia
  HTMLElement.prototype.animate = function (this: HTMLElement) {
    flashed.push(this.textContent ?? '')
    return {} as Animation
  } as unknown as typeof HTMLElement.prototype.animate
})
afterEach(() => {
  h?.unmount()
  h = null
  forgetSearch()
})

async function waitFor(x: Harness, done: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text().slice(0, 300)}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}
async function openPage(name: string, ready = '.reader__body h1'): Promise<Harness> {
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens, FILES)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.button(new RegExp(`^${name}, page`)) !== null)
  await x.click(new RegExp(`^${name}, page`))
  await waitFor(x, () => x.host.querySelector(ready) !== null)
  return x
}
async function type(x: Harness, value: string): Promise<void> {
  const box = x.host.querySelector<HTMLInputElement>('.find-line__input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, value)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => void (await new Promise((r) => setTimeout(r, 120))))
}
const count = (x: Harness) => x.host.querySelector('.find-line__count')?.textContent
const active = () => paintedFindRanges().find((r) => r.active)?.text

async function openFind(x: Harness): Promise<void> {
  await x.click('Page tools')
  await x.click(/Find in page/)
  await waitFor(x, () => x.host.querySelector('.find-line__input') !== null)
}

describe('YAZ-5456: find in page', () => {
  it('"⋯" → Find in page: matches painted, "1 of 5", steps that wrap, Enter, Escape closes and clears the paint', async () => {
    h = await openPage('Fruit')
    expect(h.host.querySelector('.find-line')).toBeNull()
    await openFind(h)
    expect(document.activeElement).toBe(h.host.querySelector('.find-line__input'))
    await type(h, 'apple')
    // Case-insensitive, literal; the card's drawn text counts ("An apple"), its ID and head do not.
    expect(count(h)).toBe('1 of 5')
    expect(paintedFindRanges().map((r) => r.text)).toEqual(['Apple', 'APPLE', 'apple', 'apple', 'apple'])
    expect(active()).toBe('Apple')
    await h.click('Next match')
    expect(count(h)).toBe('2 of 5')
    await h.click('Previous match')
    await h.click('Previous match')
    expect(count(h)).toBe('5 of 5')
    const box = h.host.querySelector<HTMLInputElement>('.find-line__input')!
    await act(async () => void box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(count(h)).toBe('1 of 5')
    await act(async () => void box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })))
    expect(count(h)).toBe('5 of 5')
    await type(h, 'zebra')
    expect(count(h)).toBe('0 of 0')
    expect(h.button('Next match')!.disabled).toBe(true)
    await act(async () => void box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(h.host.querySelector('.find-line')).toBeNull()
    expect(paintedFindRanges()).toEqual([])
  })

  it('✕ closes; each step puts its match in the upper third of the screen', async () => {
    h = await openPage('Fruit')
    const screen = h.host.querySelector<HTMLElement>('.screen--reader')!
    Object.defineProperty(screen, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(screen, 'scrollHeight', { configurable: true, value: 6000 })
    screen.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    // jsdom draws nothing: each range says where it is.
    const tops = [900, 1500, 2100, 2700, 3300]
    let n = 0
    Range.prototype.getBoundingClientRect = function () {
      return { top: tops[n++ % tops.length] - screen.scrollTop } as DOMRect
    }
    await openFind(h)
    await type(h, 'apple')
    expect(screen.scrollTop).toBe(900 - 200)
    await h.click('Next match')
    expect(screen.scrollTop).toBe(1500 - 200)
    await h.click('Close find')
    expect(h.host.querySelector('.find-line')).toBeNull()
    delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect
  })

  it('a 2,000-line page: the find is quick, every match found', async () => {
    const el = document.createElement('div')
    const look = { link: () => ({ label: '', open: null }), embed: () => ({ kind: 'text' as const, text: '' }), asset: () => null, card: () => document.createElement('div') }
    await renderPage(`# Long\n\n${LONG}`, look, el)
    expect(LONG.split('\n').length).toBeGreaterThanOrEqual(1999)
    const t0 = performance.now()
    const found = textMatches(el, 'needle')
    const ms = performance.now() - t0
    const t1 = performance.now()
    const common = textMatches(el, 'e')
    const msCommon = performance.now() - t1
    console.log(`[YAZ-5456] find on a 2,000-line page: "needle" ${found.length} matches in ${ms.toFixed(1)} ms; "e" ${common.length} matches in ${msCommon.toFixed(1)} ms (jsdom)`)
    expect(found).toHaveLength(200)
    expect(ms).toBeLessThan(250)
  })
})

describe('YAZ-5456: the headings list', () => {
  it('"⋯" → Headings: the Mac\'s rows (H1 to H5, by level; none from a card); a tap closes the sheet and lands on the heading', async () => {
    h = await openPage('Fruit')
    await h.click('Page tools')
    await h.click(/Headings/)
    await waitFor(h, () => h!.host.querySelector('.headings-sheet__row') !== null)
    expect([...h.host.querySelectorAll<HTMLElement>('.headings-sheet__row')].map((r) => `${r.dataset.level}:${r.textContent}`)).toEqual(['1:Fruit', '2:Pears', '3:Small pears'])
    await h.click('Small pears')
    expect(h.host.querySelector('.headings-sheet')).toBeNull()
    expect(flashed).toEqual(['Small pears'])
  })

  it('a tap outside closes it; a page with no headings says so', async () => {
    h = await openPage('Plain', '.reader__body p')
    await h.click('Page tools')
    await h.click(/Headings/)
    await waitFor(h, () => h!.host.querySelector('.headings-sheet') !== null)
    expect(h.host.querySelector('.headings-sheet__none')?.textContent).toBe('This page has no headings to list.')
    await act(async () => h!.host.querySelector<HTMLElement>('.headings-sheet')!.click())
    expect(h.host.querySelector('.headings-sheet')).toBeNull()
  })

  it('a 2,000-line page: 401 rows, read at once', async () => {
    h = await openPage('Long')
    await waitFor(h, () => h!.host.querySelectorAll('.reader__body h2').length === 400, 15000)
    const t0 = performance.now()
    await h.click('Page tools')
    await h.click(/Headings/)
    await waitFor(h, () => h!.host.querySelector('.headings-sheet__row') !== null)
    const ms = performance.now() - t0
    console.log(`[YAZ-5456] headings of a 2,000-line page: ${h.host.querySelectorAll('.headings-sheet__row').length} rows, opened in ${ms.toFixed(0)} ms (jsdom, with the chunk)`)
    expect(h.host.querySelectorAll('.headings-sheet__row')).toHaveLength(401)
    await h.click('Section 400')
    expect(flashed).toEqual(['Section 400'])
  }, 30000)
})
