// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedReaderVault } from '../dev/readerVault'
import { closeAll, openSheet, sheetStack } from '../explore/sheets'
import { forgetSearch } from '../search/searchState'
import { mount, newPhone, type Harness } from './testing'

/**
 * YAZ-5499: the left-edge Back in the WHOLE app (Shell, Frame, PageView with its foot arrows, its ⋯ tools and its
 * properties tab), not the hook alone. A finger goes down at the left edge on the page's own text and moves right.
 */
let h: Harness | null = null
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:phone/1')
  URL.revokeObjectURL = vi.fn()
  // An iPhone's width: jsdom draws no layout, so the frame's width is the window's.
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
  // A tab that just opened the app: its entry holds nothing of ours.
  history.replaceState(null, '')
})
afterEach(async () => {
  await act(async () => closeAll())
  h?.unmount()
  h = null
  forgetSearch()
  document.body.replaceChildren()
  Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true })
})

async function waitFor(x: Harness, done: () => boolean, ms = 8000): Promise<void> {
  const until = Date.now() + ms
  while (!done()) {
    if (Date.now() > until) throw new Error(`Timed out. Screen: ${x.text()}`)
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))))
  }
}

async function openPage(standalone: boolean): Promise<Harness> {
  Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true })
  const phone = await newPhone()
  await seedReaderVault(phone.store, phone.tokens)
  const x = await mount({ phone })
  await x.click('Search')
  await waitFor(x, () => x.host.querySelector('.tree') !== null)
  await x.click(/^Trip plan/)
  await waitFor(x, () => x.host.querySelector('.reader__body') !== null && x.button('Back') !== null)
  return x
}

let stamp = 0
function touch(el: Element, type: string, x: number, y = 300): void {
  const e = new Event(type, { bubbles: true, cancelable: true })
  stamp += type === 'touchmove' ? 16 : 10
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] })
  Object.defineProperty(e, 'timeStamp', { value: stamp })
  el.dispatchEvent(e)
}
async function swipe(el: Element, from = 5, to = 200): Promise<void> {
  await act(async () => {
    touch(el, 'touchstart', from)
    for (let x = from + 15; x <= to; x += 15) touch(el, 'touchmove', x)
    touch(el, 'touchmove', to)
    touch(el, 'touchend', to)
  })
  // The short slide, then Back.
  await act(async () => void (await new Promise((r) => setTimeout(r, 250))))
}
const onSearch = (x: Harness) => x.host.querySelector('.tree') !== null && x.button('Back') === null

describe('YAZ-5499: the left-edge swipe goes back in the whole app', { timeout: 20_000 }, () => {
  it('the Home Screen app: a swipe from x = 5 to 200 on a page from Search shows Search again', async () => {
    h = await openPage(true)
    await swipe(h.host.querySelector('.reader__body p') ?? h.host.querySelector('.reader__body')!)
    await waitFor(h, () => onSearch(h!))
  })

  it('a Safari tab: opening the page pushed a history entry, and the browser\'s Back (Safari\'s own edge swipe) shows Search again', async () => {
    h = await openPage(false)
    const entries = history.length
    await act(async () => {
      history.back()
      await new Promise((r) => setTimeout(r, 50))
    })
    await waitFor(h, () => onSearch(h!))
    expect(history.length).toBe(entries)
  })

  it('a Safari tab: the app\'s own swipe stays off (no double Back); its Back button steps the history once', async () => {
    h = await openPage(false)
    const app = h.host.querySelector('.app')!
    await swipe(app)
    expect(h.button('Back')).not.toBeNull()
    await h.click('Back')
    await waitFor(h, () => onSearch(h!))
    // One Back, one screen: no second pop is waiting to take Search away.
    await act(async () => void (await new Promise((r) => setTimeout(r, 100))))
    expect(onSearch(h)).toBe(true)
  })

  it('a Safari tab: with an Explore sheet open, the browser\'s Back closes the top sheet and the page stays', async () => {
    h = await openPage(false)
    await act(async () => openSheet({ kind: 'page', path: 'Spanish words.md' }))
    await waitFor(h, () => document.querySelectorAll('.explore-sheet').length === 1)
    await act(async () => {
      history.back()
      await new Promise((r) => setTimeout(r, 50))
    })
    await waitFor(h, () => sheetStack().length === 0)
    await act(async () => void (await new Promise((r) => setTimeout(r, 400))))
    expect(h.button('Back')).not.toBeNull()
    expect(h.host.querySelector('.topbar__title')?.textContent).toBe('Trip plan')
    // The page's entry came back: the next browser Back shows Search.
    await act(async () => {
      history.back()
      await new Promise((r) => setTimeout(r, 50))
    })
    await waitFor(h, () => onSearch(h!))
  })
})
