// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5713 (Yaseen's screenshot: "NEW CARDS TEST / HISTORY / …", the page lost): the phone's crumb folds from the START,
 * "… / History / History cards", by the Mac's rule (`foldedParts`). jsdom has no layout: each part is 8 px a letter here,
 * the crumb's room set per test. The real widths are measured by `proveLayout.ts` ("Review crumb"). Made-up data.
 */
const FILES = {
  '.yaseendocs/review.json': '{}',
  'New cards test/History/history-cards.md': page('History cards', cardBlock('The year the US declared independence?\n---\n{{1776}}', 'NC-1')),
}

let h: ReviewHarness | undefined
let room = 1000
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = this.matches('[data-fold], [data-fold-more]') ? (this.textContent ?? '').length * 8 : 0
    return { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: width, width, height: 0, toJSON: () => ({}) } as DOMRect
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('review__crumb') ? room : 0
  })
})
afterEach(() => {
  h?.unmount()
  h = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** The crumb as it reads: the parts not folded away. */
const shown = () =>
  [...h!.host.querySelector('.review__crumb')!.children]
    .filter((e) => (e as HTMLElement).style.display !== 'none')
    .map((e) => e.textContent)
    .join('')

describe('YAZ-5713: the phone`s crumb folds from the start', () => {
  it('a path that fits shows whole', async () => {
    room = 1000
    h = await reviewSetup(FILES)
    expect(shown()).toBe('New cards test / History / History cards')
  })

  it('too long: the first folder gives way to "…", the page stays', async () => {
    // 136 + 80 + 104 = 320 px; at 240, "… / " (32) + 80 + 104 = 216 fits.
    room = 240
    h = await reviewSetup(FILES)
    expect(shown()).toBe('… / History / History cards')
    // The full path is still the crumb's title.
    expect(h.host.querySelector('.review__crumb')?.getAttribute('title')).toBe('New cards test / History / History cards')
  })

  it('narrower still: only "…" and the page', async () => {
    room = 150
    h = await reviewSetup(FILES)
    expect(shown()).toBe('… / History cards')
  })

  it('a tap on the crumb keeps its tap: the card does not move on', async () => {
    room = 240
    h = await reviewSetup(FILES)
    const before = h.cardText()
    h.host.querySelector<HTMLElement>('.review__crumb [data-fold-more]')!.click()
    h.host.querySelector<HTMLElement>('.review__crumb b')!.click()
    await h.settle()
    expect(h.cardText()).toBe(before)
  })
})
