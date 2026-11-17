// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZOOM_STEPS } from '@client/editor/zoomSteps'
import { REVIEW_ZOOM_KEY } from '../store/reviewZoomPref'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5706: the ⋯ menu's Zoom row (− 100% +): the card bigger or smaller on the Mac's Review zoom steps (50–400%), kept
 * on this phone; a tap on the percent goes back to 100%; the menu stays open while zooming. Made-up data only.
 */
let h: ReviewHarness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
})
afterEach(() => {
  h?.unmount()
  h = undefined
  vi.useRealTimers()
  localStorage.clear()
})

const FILES = { '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('Capital of Peru?\n---\n{{Lima}}', 'ZM-1, 2026-10-04T09:00:00.000Z good')) }
const q = <T extends HTMLElement = HTMLElement>(sel: string) => h!.host.querySelector<T>(sel)
const tap = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    el.click()
  })
  await h!.settle()
}
const openMenu = async () => {
  await tap(q('.review__more')!)
  expect(q('.review__menu--more')).not.toBeNull()
}
const zoomOut = () => q<HTMLButtonElement>('.review__zoom [data-zoom="out"]')!
const zoomIn = () => q<HTMLButtonElement>('.review__zoom [data-zoom="in"]')!
const percent = () => q<HTMLButtonElement>('.review__zoom [data-zoom="reset"]')!
const cardZoom = () => q('.review__card')!.style.getPropertyValue('--review-zoom')

describe('YAZ-5706: zoom the card from the ⋯ menu', () => {
  it('the menu has a Zoom row last, − 100% +, each a touch-sized button', async () => {
    h = await reviewSetup(FILES)
    await openMenu()
    const row = q('.review__zoom')!
    expect(row).not.toBeNull()
    expect(row.getAttribute('role')).toBe('group')
    expect(row.getAttribute('aria-label')).toBe('Card zoom')
    expect(q('.review__menu--more')!.lastElementChild).toBe(row)
    expect(row.querySelector('.review__zoom-label')?.textContent).toBe('Zoom')
    expect([zoomOut(), percent(), zoomIn()].map((b) => b.textContent)).toEqual(['−', '100%', '+'])
    expect([zoomOut(), percent(), zoomIn()].map((b) => b.getAttribute('aria-label'))).toEqual(['Zoom the card out', 'Card zoom 100%. Tap for 100%', 'Zoom the card in'])
    expect(cardZoom()).toBe('')
  })

  it('+ walks the Mac\'s steps all the way in, the menu staying open; at 400% + is off', async () => {
    h = await reviewSetup(FILES)
    await openMenu()
    const up = ZOOM_STEPS.filter((s) => s > 100)
    for (const step of up) {
      await tap(zoomIn())
      expect(q('.review__menu--more')).not.toBeNull()
      expect(percent().textContent).toBe(`${step}%`)
      expect(cardZoom()).toBe(String(step / 100))
    }
    expect(up.at(-1)).toBe(400)
    // Zoomed in, the row over the card wraps (review.css): the card says so.
    expect(q('.review__card')!.dataset.zoom).toBe('in')
    expect(zoomIn().disabled).toBe(true)
    expect(zoomOut().disabled).toBe(false)
    expect(h.cardText()).toBe('Capital of Peru?')
  })

  it('− walks all the way out to 50%, then − is off; a tap on the percent is 100% again', async () => {
    h = await reviewSetup(FILES)
    await openMenu()
    for (const step of ZOOM_STEPS.filter((s) => s < 100).reverse()) {
      await tap(zoomOut())
      expect(percent().textContent).toBe(`${step}%`)
    }
    expect(percent().textContent).toBe('50%')
    expect(zoomOut().disabled).toBe(true)
    expect(cardZoom()).toBe('0.5')
    expect(q('.review__card')!.dataset.zoom).toBeUndefined()
    await tap(percent())
    expect(percent().textContent).toBe('100%')
    expect(cardZoom()).toBe('')
    expect(q('.review__menu--more')).not.toBeNull()
  })

  it('kept on this phone: the next Review starts at the zoom last set', async () => {
    h = await reviewSetup(FILES)
    await openMenu()
    await tap(zoomIn())
    await tap(zoomIn())
    expect(localStorage.getItem(REVIEW_ZOOM_KEY)).toBe('150')
    h.unmount()
    h = await reviewSetup(FILES)
    expect(cardZoom()).toBe('1.5')
    await openMenu()
    expect(percent().textContent).toBe('150%')
  })

  it('with the vault\'s Card text size, the zoom multiplies it (the text size stays on the card, the zoom on its parts)', async () => {
    h = await reviewSetup({ ...FILES, '.yaseendocs/card-look.json': JSON.stringify({ version: 1, textSize: 20 }) })
    await openMenu()
    await tap(zoomIn())
    const card = q('.review__card')!
    expect(card.style.getPropertyValue('--card-text-size')).toBe('20px')
    expect(card.style.getPropertyValue('--review-zoom')).toBe('1.25')
  })
})
