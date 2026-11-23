// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5716 (Mochi's breathing room): the card ends where its content ends and the hint line sits right under it, in
 * the one page that scrolls (the stage); the zoom is the text size only. Made-up data only. The px are proved in Chrome
 * (`proveLayout.ts`, Review room); jsdom has no layout.
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

const FILES = { '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('Capital of Peru?\n---\n{{Lima}}', 'RM-1, 2026-10-04T09:00:00.000Z good')) }
const q = (sel: string) => h!.host.querySelector<HTMLElement>(sel)
const tap = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    el.click()
  })
  await h!.settle()
}

describe('YAZ-5716: the card, then the hint line, in one page', () => {
  it('the hint line follows the card inside the stage (the page that scrolls); the controls stay outside it', async () => {
    h = await reviewSetup(FILES)
    const stage = q('.review__stage')!
    const card = q('.review__card')!
    const foot = q('.review__foot')!
    const hint = q('.review__hint')!
    expect(card.parentElement).toBe(stage)
    expect(foot.parentElement).toBe(stage)
    expect(hint.parentElement).toBe(foot)
    expect(card.nextElementSibling).toBe(foot)
    expect(stage.contains(q('.review__dock'))).toBe(false)
    expect(hint.textContent).toMatch(/Tap anywhere/)
  })

  it('the zoom is a font-size scale on the card (`--review-zoom`), never CSS zoom on a part', async () => {
    h = await reviewSetup(FILES)
    await tap(q('.review__more')!)
    await tap(q('.review__zoom [data-zoom="in"]')!)
    const card = q('.review__card')!
    expect(card.style.getPropertyValue('--review-zoom')).toBe('1.25')
    for (const el of [card, ...card.querySelectorAll<HTMLElement>('*')]) expect(el.style.zoom).toBe('')
  })
})
