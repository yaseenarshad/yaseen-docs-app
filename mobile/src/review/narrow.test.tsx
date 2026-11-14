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
    it(`${buttons} buttons: one row of answers, then ⋯; each answer can shrink and its icon can go`, async () => {
      h = await reviewSetup({ '.yaseendocs/review.json': `{"buttons": ${buttons}}`, 'p.md': page('P', cardBlock('Q?\n---\n{{a}}', 'NR-1')) })
      h.host.style.width = '320px'
      const row = h.host.querySelector('.review__answers')!
      const kids = [...row.children]
      expect(kids.map((k) => k.className)).toEqual([...words.map(() => 'review__answer'), 'review__more'])
      expect(kids.slice(0, -1).map((k) => k.textContent?.trim())).toEqual([...words])
      for (const k of kids.slice(0, -1)) expect(k.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
      expect(row.parentElement?.className).toBe('review__dock')
    })
})
