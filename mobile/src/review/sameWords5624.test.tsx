// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { kindCount, kindCountText } from '@client/review/inboxMenu'
import { NOW, cardBlock, page, reviewSetup, type ReviewHarness } from './testing'

/**
 * YAZ-5624: the phone's review sheet and done screen say what the Mac's cards menu and done screen say. New cards'
 * count stands alone ("10", the Mac's YAZ-5434), Up next keeps "today / total", and the done title is "Inbox complete.".
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

const newCards = (n: number) => Array.from({ length: n }, (_, i) => cardBlock(`Word ${i + 1}?\n---\n{{word ${i + 1}}}`, `SW-${i + 1}`))

describe('YAZ-5624: the same New count and the same "Inbox complete." on the Mac and the phone', () => {
  it('the shared rule: New cards alone, Up next with its total', () => {
    const session = { counts: { all: 12, next: 2, due: 0, new: 10 }, limited: { new: true, next: true }, more: { new: 5, next: 3 } }
    expect(kindCountText(kindCount(session, 'new'))).toBe('10')
    expect(kindCountText(kindCount(session, 'next'))).toBe('2 / 5')
    expect(kindCountText(kindCount({ ...session, limited: { new: true, next: false } }, 'next'))).toBe('2')
  })

  it('15 new cards, 10 a day: the sheet reads "10", not "10 / 15"; the done title is "Inbox complete."', async () => {
    h = await reviewSetup({ '.yaseendocs/review.json': '{"newPerDay": 10}', 'p.md': page('P', ...newCards(15)) })
    await h.click(/Choose what to review/)
    expect((h.host.querySelector('.review__sheet-row [data-kind="new"]')?.textContent ?? '').trim()).toBe('10')
    await h.click(/^All cards$/)
    h.unmount()
    h = await reviewSetup({ '.yaseendocs/review.json': '{"newPerDay": 1}', 'p.md': page('P', ...newCards(1)) })
    // A new card needs two Remembered (its same-day steps).
    for (let i = 0; i < 2; i++) await h.click('Remembered')
    expect(h.host.querySelector('.review__done-title')?.textContent).toBe('Inbox complete.')
  })
})
