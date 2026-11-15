// @vitest-environment jsdom
import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { READER_FILES, seedReaderVault } from '../dev/readerVault'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from '../screens/testing'
import { FADE_MS, ScrollJump } from './ScrollJump'

/**
 * YAZ-5467: the ⤒ ⤓ pill. It shows while the scroller moves and fades 1.5 s after; a tap glides the SCROLLER (never the
 * document) to its top or its end, at once with Reduce Motion; a text under two screens has none. The page and the card
 * view mount it on their `.screen`, Review on its card box. Made-up data only.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let h: Harness | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  h?.unmount()
  h = null
  forgetSearch()
  vi.useRealTimers()
})

/** A scroller of `height` px showing `view` px, with `scrollTo` recorded. */
function sized(el: HTMLElement, height: number, view: number) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: height })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: view })
  const to = vi.fn<(o: ScrollToOptions) => void>()
  el.scrollTo = to as unknown as typeof el.scrollTo
  return to
}

function Box() {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div className="screen" ref={ref}>
      <ScrollJump scroller={ref} />
    </div>
  )
}

function draw(): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(<Box />))
  return host
}

const scroll = (el: Element) => act(() => void el.dispatchEvent(new Event('scroll')))
const motion = (reduce: boolean) =>
  (window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia)

describe('YAZ-5467: jump to the top or the bottom', () => {
  it('a long text: shows while scrolling, fades after 1.5 s; each button glides the scroller', () => {
    vi.useFakeTimers()
    motion(false)
    const host = draw()
    const screen = host.querySelector<HTMLElement>('.screen')!
    const to = sized(screen, 3000, 600)
    expect(host.querySelector('.scroll-jump')).toBeNull()
    scroll(screen)
    const pill = host.querySelector('.scroll-jump')!
    expect(pill.hasAttribute('data-on')).toBe(true)
    expect([...pill.querySelectorAll('button')].map((b) => [b.getAttribute('aria-label'), b.textContent])).toEqual([
      ['Go to top', '⤒'],
      ['Go to bottom', '⤓'],
    ])
    act(() => vi.advanceTimersByTime(FADE_MS - 100))
    expect(pill.hasAttribute('data-on')).toBe(true)
    // Another move starts the time again.
    scroll(screen)
    act(() => vi.advanceTimersByTime(FADE_MS - 100))
    expect(pill.hasAttribute('data-on')).toBe(true)
    act(() => vi.advanceTimersByTime(200))
    expect(host.querySelector('.scroll-jump')!.hasAttribute('data-on')).toBe(false)
    scroll(screen)
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Go to bottom"]')!.click())
    expect(to).toHaveBeenLastCalledWith({ top: 2400, behavior: 'smooth' })
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Go to top"]')!.click())
    expect(to).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('Reduce Motion: the jump is at once', () => {
    motion(true)
    const host = draw()
    const screen = host.querySelector<HTMLElement>('.screen')!
    const to = sized(screen, 3000, 600)
    scroll(screen)
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Go to bottom"]')!.click())
    expect(to).toHaveBeenLastCalledWith({ top: 2400, behavior: 'auto' })
  })

  it('a short text (under two screens) has no pill', () => {
    const host = draw()
    const screen = host.querySelector<HTMLElement>('.screen')!
    sized(screen, 1100, 600)
    scroll(screen)
    expect(host.querySelector('.scroll-jump')).toBeNull()
  })

  it('the page view mounts it on its .screen (the document never scrolls)', async () => {
    motion(false)
    const phone = await newPhone()
    await seedReaderVault(phone.store, phone.tokens, READER_FILES)
    URL.createObjectURL = vi.fn(() => 'blob:phone/1')
    URL.revokeObjectURL = vi.fn()
    h = await mount({ phone })
    await h.click('Search')
    for (let i = 0; i < 100 && h.button(/^Trip plan, page/) === null; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
    await h.click(/^Trip plan, page/)
    for (let i = 0; i < 100 && h.host.querySelector('.reader__body p') === null; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
    const screen = h.host.querySelector<HTMLElement>('.screen--reader')!
    const to = sized(screen, 5000, 700)
    await act(async () => void screen.dispatchEvent(new Event('scroll')))
    await h.click('Go to bottom')
    expect(to).toHaveBeenLastCalledWith({ top: 4300, behavior: 'smooth' })
  })
})

describe('YAZ-5467 in Review: a long card', () => {
  it('the pill moves the card box (the card scrolls inside itself); its tap is the screen\'s own, never a step', async () => {
    motion(false)
    const { reviewSetup, cardBlock, page } = await import('../review/testing')
    const r = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('Q1?\n---\n{{w1}}', 'GD-1, 2026-01-01T09:00Z good'), cardBlock('Q2?\n---\n{{w2}}', 'GD-2, 2026-01-01T09:00Z good')) })
    try {
      const box = r.host.querySelector<HTMLElement>('.review__card')!
      const to = sized(box, 4000, 500)
      await act(async () => void box.dispatchEvent(new Event('scroll')))
      const before = r.cardText()
      await act(async () => r.host.querySelector<HTMLButtonElement>('[aria-label="Go to bottom"]')!.click())
      expect(to).toHaveBeenLastCalledWith({ top: 3500, behavior: 'smooth' })
      expect(r.cardText()).toBe(before)
    } finally {
      r.unmount()
    }
  })
})
