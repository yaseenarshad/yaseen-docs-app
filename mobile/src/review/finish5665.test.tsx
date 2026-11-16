// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5665 (Yaseen: "on the completion screen can we show it?"): every finish screen shows today's time, whatever
 * Settings › Review › Time so far says. No ⏱ to tap. The setting is for DURING the review (the sheet's line).
 */
let h: ReviewHarness
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => {
  h?.unmount()
  vi.useRealTimers()
})

/** A review made 40 days ago: the card is due today. */
const OLD = '2026-10-04T09:00:00.000Z good'
const due = (n: number) => Array.from({ length: n }, (_, i) => cardBlock(`Due ${i + 1}?\n---\n{{due ${i + 1}}}`, `FS-${i + 1}, ${OLD}`))
const fresh = (n: number) => Array.from({ length: n }, (_, i) => cardBlock(`New ${i + 1}?\n---\n{{new ${i + 1}}}`, `FN-${i + 1}`))

/** Each card answered after 20 s of work. */
async function answerAll(n: number) {
  for (let i = 0; i < n; i++) {
    vi.setSystemTime(Date.now() + 20_000)
    await h.click('Remembered')
  }
}
const stopwatch = () => h.button(/time so far/i) ?? [...h.host.querySelectorAll('button')].find((b) => b.textContent === '⏱') ?? null
const todayLine = () => (h.host.querySelector('.review__done-today')?.textContent ?? '').replace(/\s+/g, ' ')

describe('YAZ-5665: the finish screens always show the time on the phone', () => {
  it.each(['hidden', 'off'] as const)('Time so far %s: "Inbox complete." says "Today: 2 cards · 40 s", no ⏱', async (time) => {
    h = await reviewSetup({ '.yaseendocs/review.json': JSON.stringify({ timeSoFar: time }), 'p.md': page('P', ...due(2)) })
    await answerAll(2)
    expect(h.text()).toContain('Due today is done.')
    expect(todayLine()).toBe('Today: 2 cards · 40 s')
    expect(stopwatch()).toBeNull()
  })

  it('"Due today is done." with "Learn new cards" shows the time too', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...due(1), ...fresh(2)) })
    await h.click(/Choose what to review/)
    await h.click(/Due today/)
    await answerAll(1)
    expect(h.button(/^Learn new cards/)).not.toBeNull()
    expect(todayLine()).toBe('Today: 1 card · 20 s')
    expect(stopwatch()).toBeNull()
  })

  it('a filter done with other cards left ("No new cards left.") shows the time too', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...due(1), ...fresh(1)) })
    await h.click(/Choose what to review/)
    await h.click(/New cards/)
    await answerAll(1)
    expect(h.text()).toContain('No new cards left.')
    expect(todayLine()).toBe('Today: 1 card · 20 s')
  })

  it('during the review the setting still hides the time behind ⏱ (the sheet)', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{}', 'p.md': page('P', ...due(2)) })
    await answerAll(1)
    await h.click(/Choose what to review/)
    expect(h.host.querySelector('.review__sheet-today')?.textContent).toBe('Today: 1 card · ⏱')
  })
})
