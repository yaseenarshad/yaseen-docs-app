// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { followAnswers } from './followAnswers'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/** 4B: time. The answer timer stops in the background (round 10, addition 5); the day changes at local midnight. */
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

const cards = (n: number) => Array.from({ length: n }, (_, i) => cardBlock(`Card ${i + 1}?\n---\n{{answer ${i + 1}}}`, `TM-${i + 1}`))

describe('Review: the app goes to the background and comes back (round 10, addition 5; decision 4)', () => {
  it('the answer timer counts no time in the background; the waiting answers are sent at once when hidden', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(2)) })
    const unfollow = followAnswers(h.answers) // the shell's wiring (app/lazySync.ts)
    await h.click('Remembered') // TM-1: one answer waits
    expect(h.head()).toBe('Card 2? · TM-2 · in P')
    expect(h.commits()).toBe(0)

    // TM-2 shows at NOW. 5 s of work, then 100 s in the background, then 3 s of work.
    vi.setSystemTime(NOW + 5_000)
    await setVisible('hidden')
    await h.settle()
    // Decision 4: hidden → the list is sent at once, not 5 s later.
    expect(h.commits()).toBe(1)
    expect((await h.remoteLines())['TM-1']).toMatch(/good 0s -->$/)
    vi.setSystemTime(NOW + 105_000)
    await setVisible('visible')
    vi.setSystemTime(NOW + 108_000)
    await h.click('Remembered')
    const review = h.answers.waiting().find((w) => w.op.id === 'TM-2')!.op
    expect(review).toMatchObject({ kind: 'review', review: { rating: 'good', seconds: 8 } })
    unfollow()
  })

  it('the shell wires the list: `online` sends at once (the background send is the test above)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...cards(2)) })
    const unfollow = followAnswers(h.answers)
    h.s.github.offline = true
    await h.click('Remembered')
    await h.wait(5_000)
    expect(h.commits()).toBe(0)
    h.s.github.offline = false
    await act(async () => void window.dispatchEvent(new Event('online')))
    await h.wait(0)
    expect(h.commits()).toBe(1)
    unfollow()
  })
})

describe('Review: the day changes at local midnight during a session (decision 9)', () => {
  it("today's work starts again; a card due tomorrow is due now, and the done screen offers it", async () => {
    // 23:59 on Friday 13 November. TM-1 was answered 3 days ago and is due on Saturday 14 (its gap is 4 days).
    const late = new Date(2026, 10, 13, 23, 59, 0).getTime()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    vi.setSystemTime(late)
    const due14 = '2026-11-10T09:00Z good, 2026-11-10T09:15Z good'
    h = await reviewSetup({ '.yaseendocs/review.json': '{"newPerDay": 1, "fuzz": false}', 'p.md': page('P', cardBlock('Old?\n---\n{{old}}', `TM-1, ${due14}`), ...cards(2).slice(1)) })
    // Only the new card is due before midnight; two Remembered end it.
    expect(h.head()).toBe('Card 2? · TM-2 · in P')
    await h.click('Remembered')
    vi.setSystemTime(late + 30_000)
    await h.click('Remembered')
    expect(h.text()).toContain('Inbox complete')
    expect(h.text()).toContain('Today: 1 card')
    // Midnight: the review's own timer moves the day.
    await act(async () => void vi.advanceTimersByTime(60_000))
    await h.settle()
    expect(h.text()).not.toContain('Today: 1 card')
    const due = h.button(/^Review \d+ more$/)
    expect(due?.textContent).toBe('Review 1 more')
    await h.click('Review 1 more')
    expect(h.head()).toBe('Old? · TM-1 · in P')
  })
})
