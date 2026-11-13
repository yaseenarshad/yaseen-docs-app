/** YAZ-5032: the Reviews table and the strip in Yaseen's words, at a fixed day. */
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { NoteCardReviewsTable, noteCardNextReview } from './noteCardParts'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('YAZ-5032: the review history in words', () => {
  it('the columns in order, a blank Gap for the first, "Same day" for 0, and the last row "Next review · <date> · in N days"', () => {
    const box = document.createElement('div')
    const root = createRoot(box)
    const reviews = [
      { at: '2026-11-01T09:00Z', rating: 'again' as const },
      { at: '2026-11-01T09:05Z', rating: 'good' as const },
      { at: '2026-11-02T09:00Z', rating: 'good' as const },
    ]
    act(() => root.render(<NoteCardReviewsTable reviews={reviews} settings={DEFAULT_REVIEW_SETTINGS} now={Date.parse('2026-11-02T10:00Z')} />))
    expect([...box.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Reviewed on', 'Answer', 'Gap', 'Time', 'Next due', ''])
    const rows = [...box.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
    expect(rows.slice(0, 3).map((r) => r.slice(0, 2))).toEqual([
      ['Nov 1, 2026', 'Forgot'],
      ['Nov 1, 2026', 'Remembered'],
      ['Nov 2, 2026', 'Remembered'],
    ])
    expect(rows.slice(0, 3).map((r) => r[2])).toEqual(['', 'Same day', '1 day'])
    expect(rows[3][0]).toMatch(/^Next review · ([A-Z][a-z]{2} \d{1,2}, \d{4} · in \d+ days?|later today|today)$/)
    act(() => root.unmount())
  })

  it('the next review in words: in 183 days, today, later today, 3 days ago', () => {
    const now = new Date(2026, 9, 27, 12).getTime()
    expect(noteCardNextReview(new Date(2027, 3, 28, 9).getTime(), false, now)).toEqual({ date: 'Apr 28, 2027', days: 183, when: 'in 183 days' })
    expect(noteCardNextReview(new Date(2026, 9, 27, 20).getTime(), false, now).when).toBe('today')
    expect(noteCardNextReview(now, true, now).when).toBe('later today')
    expect(noteCardNextReview(new Date(2026, 9, 24, 9).getTime(), true, now)).toEqual({ date: 'Oct 24, 2026', days: -3, when: '3 days ago' })
  })
})
