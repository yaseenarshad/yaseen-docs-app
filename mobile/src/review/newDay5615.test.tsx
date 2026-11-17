// @vitest-environment jsdom
/**
 * YAZ-5615 (checker c, against the YAZ-5611 rules) on the phone: review dates and a new day. The real Review screen
 * on the real engine and answer list (`reviewSetup`). Spec 21: the day is the phone's local calendar day from
 * midnight. A phone app in the background runs no timer: when it comes back after midnight, the new day shows (its
 * due cards, "Today: …" back to none; YAZ-5684 counts as Mochi). The review the phone writes gives the wait the shared schedule shows (D13).
 * Made-up data only.
 */
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cardState } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

let h: ReviewHarness
let visible: DocumentVisibilityState = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible })
const setVisible = async (state: DocumentVisibilityState) => {
  visible = state
  await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
}
afterEach(() => {
  h?.unmount()
  visible = 'visible'
  vi.useRealTimers()
})

const card = (n: number, line = '') => cardBlock(`Card ${n}?\n---\n{{answer ${n}}}`, `ND-${n}${line}`)
/** ND-1 was answered on 10 November with a wait of 4 days: due on Saturday 14, not on Friday 13. */
const DUE_14 = ', 2026-11-10T09:00:00.000Z good, 2026-11-10T09:15:00.000Z good'

describe('YAZ-5615: the phone comes back after midnight (spec 21)', () => {
  it('the app slept in the background over midnight (no timer ran): back on screen, the new day shows', async () => {
    const late = new Date(2026, 10, 13, 23, 50).getTime()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    vi.setSystemTime(late)
    h = await reviewSetup({ '.yaseendocs/review.json': '{"newPerDay": 1, "fuzz": false}', 'p.md': page('P', card(1, DUE_14), card(2)) })
    // Friday: only the new card. Two ✓ end it.
    expect(h.head()).toBe('ND-2')
    await h.click('Remembered')
    vi.setSystemTime(late + 30_000)
    await h.click('Remembered')
    expect(h.text()).toContain('Inbox complete')
    expect(h.text()).toContain('Today: 1 learned · 0 reviews')
    // The phone goes to the background; it comes back on Saturday at 8:00. Its midnight timer never ran.
    await setVisible('hidden')
    vi.setSystemTime(new Date(2026, 10, 14, 8, 0).getTime())
    await setVisible('visible')
    await h.settle()
    expect(h.text()).not.toContain('Today: 1 learned · 0 reviews')
    expect(h.button(/^Review cards \d+$/)?.textContent).toBe('Review cards 1')
    await h.click('Review cards 1')
    expect(h.head()).toBe('ND-1')
  })
})

describe('YAZ-5615: the next review of each answer, as the phone writes it', () => {
  it("a new card's two ✓: each review is written at the time its buttons showed, and the second gives days", async () => {
    // The clock runs (a person's taps take time): the card comes back for its second ✓ (YAZ-5610) at once.
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
    h = await reviewSetup({ '.yaseendocs/review.json': '{"fuzz": false}', 'p.md': page('P', card(1)) })
    expect(h.head()).toBe('ND-1')
    await h.click('Remembered')
    await h.click('Remembered')
    const reviews = h.answers
      .waiting()
      .filter((w) => w.op.kind === 'review' && w.op.id === 'ND-1')
      .map((w) => (w.op as { review: { at: string; rating: 'good' } }).review)
    expect(reviews.map((r) => r.rating)).toEqual(['good', 'good'])
    expect(Date.parse(reviews[0].at)).toBeGreaterThanOrEqual(NOW)
    expect(Date.parse(reviews[1].at)).toBeGreaterThan(Date.parse(reviews[0].at))
    const after = cardState(reviews, { ...DEFAULT_REVIEW_SETTINGS, fuzz: false })
    expect(after.inSteps).toBe(false)
    expect(after.interval).toBeGreaterThanOrEqual(1)
    expect(after.due).toBe(Date.parse(reviews[1].at) + after.interval * 86_400_000)
  })
})
