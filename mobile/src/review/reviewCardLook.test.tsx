// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5484: Review draws its card with the vault's card look (`.yaseendocs/card-look.json`): the Mac's card variables on
 * the card (text and title size, the hidden-word look, the next mark and its colour, the spacing, the width as a max).
 * No file: none, the phone's look before. Made-up data only.
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

const CARDS = { '.yaseendocs/review.json': '{}', 'p.md': page('P', cardBlock('Capital of Peru?\n---\n{{Lima}}', 'LK-1, 2026-10-04T09:00:00.000Z good')) }
const vars = (el: HTMLElement | null) => ['--shown-hidden-words', '--mark-next-hidden', '--card-next-hidden', '--card-text-size', '--card-title-size', '--card-line-height', '--card-text-width'].map((name) => el?.style.getPropertyValue(name))

describe('YAZ-5484: Review wears the vault\'s card look', () => {
  it('card-look.json: the Mac\'s variables on the card', async () => {
    h = await reviewSetup({ ...CARDS, '.yaseendocs/card-look.json': JSON.stringify({ version: 1, hiddenWords: 'box', nextColour: '#aa3399', textSize: 20, titleSize: 24, spacing: 'custom', custom: { line: 2 }, width: 520 }) })
    const card = h.host.querySelector<HTMLElement>('.review__card')
    expect(card).not.toBeNull()
    expect(vars(card)).toEqual(['box', 'on', '#aa3399', '20px', '24px', '2', '520px'])
  })

  it('the next mark off, and a bad field dropped alone', async () => {
    h = await reviewSetup({ ...CARDS, '.yaseendocs/card-look.json': JSON.stringify({ version: 1, markNext: false, nextColour: 'red', textSize: 99 }) })
    expect(vars(h.host.querySelector<HTMLElement>('.review__card'))).toEqual(['highlight', 'off', 'initial', 'initial', 'initial', 'initial', 'initial'])
  })

  it('no file, or one that is not JSON: no variable, the look before', async () => {
    h = await reviewSetup(CARDS)
    expect(vars(h.host.querySelector<HTMLElement>('.review__card'))).toEqual(['', '', '', '', '', '', ''])
    h.unmount()
    h = await reviewSetup({ ...CARDS, '.yaseendocs/card-look.json': '{ nope' })
    expect(vars(h.host.querySelector<HTMLElement>('.review__card'))).toEqual(['', '', '', '', '', '', ''])
  })
})
