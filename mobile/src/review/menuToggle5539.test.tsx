// @vitest-environment jsdom
import { act } from 'react'
import { flushSync } from 'react-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5539: a second tap on the button that opened a menu closes it — the deck button at the top ("▣ All cards ▾ 1 / 2")
 * and its drawer, and ⋯ and its menu. A tap is a finger's whole run, as a phone sends it: `pointerdown` (the screen's
 * tap-outside listener) and then `click`. Before, the screen's own click handler closed the menu and the button's click,
 * drawn after it, opened it again. Made-up data only.
 */
let h: ReviewHarness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  h = undefined
  vi.useRealTimers()
})
const OLD = '2026-10-04T09:00Z good'
const FILES = { '.yaseendocs/review.json': '{}', 'p.md': page('P', ...[1, 2].map((n) => cardBlock(`Q${n}?\n---\n{{w${n}}}`, `MT-${n}, ${OLD}`))) }

/**
 * A finger's tap on `el`: down, then the click, as the phone's browser runs them. A real tap's listeners each run
 * from an empty stack, so the browser drains the microtasks between them, and React draws what its CAPTURE listener
 * set before the target's own click runs (`el.click()` from a test never drains them). `flushSync` at the target
 * is that drain: the draw lands where the browser lands it.
 */
async function fingerTap(el: Element) {
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const was = env.IS_REACT_ACT_ENVIRONMENT
  env.IS_REACT_ACT_ENVIRONMENT = false
  const drain = () => flushSync(() => undefined)
  el.addEventListener('click', drain)
  try {
    el.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    ;(el as HTMLElement).click()
    await new Promise((r) => setTimeout(r, 0))
  } finally {
    el.removeEventListener('click', drain)
    env.IS_REACT_ACT_ENVIRONMENT = was
  }
  await act(async () => undefined)
  await h!.settle()
}
const q = (sel: string) => h!.host.querySelector<HTMLElement>(sel)

describe('YAZ-5539: tap the button again to close its menu', () => {
  it('the deck button: the first tap opens the drawer, the second closes it, a third opens it again', async () => {
    h = await reviewSetup(FILES)
    const deck = () => q('.review__count-btn')!
    await fingerTap(deck())
    expect(q('.review__sheet')).not.toBeNull()
    expect(deck().getAttribute('aria-expanded')).toBe('true')
    await fingerTap(deck())
    expect(q('.review__sheet')).toBeNull()
    expect(deck().getAttribute('aria-expanded')).toBe('false')
    await fingerTap(deck())
    expect(q('.review__sheet')).not.toBeNull()
    // The card never stepped on the way.
    expect(h.cardText()).toBe('Q1?')
  })

  it('⋯: the first tap opens its menu, the second closes it', async () => {
    h = await reviewSetup(FILES)
    const more = () => q('.review__more')!
    await fingerTap(more())
    expect(q('.review__menu--more')).not.toBeNull()
    await fingerTap(more())
    expect(q('.review__menu--more')).toBeNull()
    expect(more().getAttribute('aria-expanded')).toBe('false')
    expect(h.cardText()).toBe('Q1?')
  })

  it('a tap outside still closes a menu and does nothing else; one menu\'s button opens it over the other', async () => {
    h = await reviewSetup(FILES)
    await fingerTap(q('.review__more')!)
    await fingerTap(q('.review__card')!)
    expect(q('.review__menu--more')).toBeNull()
    expect(h.cardText()).toBe('Q1?')
    await fingerTap(q('.review__more')!)
    await fingerTap(q('.review__count-btn')!)
    expect(q('.review__menu--more')).toBeNull()
    expect(q('.review__sheet')).not.toBeNull()
  })
})
