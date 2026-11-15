// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5231 at a 320 px container (jsdom has no layout: the rendered structure and classes the 320 px rules act on;
 * `style.test.ts` reads the rules). Two and four buttons: one row, the answers then ⋯, each a `.review__answer`.
 */
let h: ReviewHarness | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  vi.useRealTimers()
})

describe('the answer row at 320 px', () => {
  for (const [buttons, words] of [
    [2, ['Forgot', 'Remembered']],
    [4, ['Again', 'Hard', 'Good', 'Easy']],
  ] as const)
    it(`${buttons} buttons: one row of answers, then ⋯; the arrows, the answers, then ⋯`, async () => {
      h = await reviewSetup({ '.yaseendocs/review.json': `{"buttons": ${buttons}}`, 'p.md': page('P', cardBlock('Q?\n---\n{{a}}', 'NR-1')) })
      h.host.style.width = '320px'
      // YAZ-5415: one row — ← → · the answers (round, a glyph each, named for VoiceOver) · ⋯.
      const ctrl = h.host.querySelector('.review__ctrl')!
      expect([...ctrl.children].map((k) => k.className)).toEqual(['review__arrows', 'review__answers', 'review__right'])
      const row = h.host.querySelector('.review__answers')!
      const kids = [...row.children]
      expect(kids.map((k) => k.className)).toEqual(words.map(() => 'review__answer'))
      expect(kids.map((k) => k.getAttribute('aria-label'))).toEqual([...words])
      expect(row.getAttribute('data-count')).toBe(String(buttons))
      expect([...ctrl.querySelectorAll('.review__arrow')].map((b) => b.getAttribute('aria-label'))).toEqual(['Previous card', 'Next card', 'More card actions'])
      expect(ctrl.parentElement?.className).toBe('review__dock')
    })
})
