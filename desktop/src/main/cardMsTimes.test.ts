// YAZ-5642: each review time is ISO 8601 UTC to the millisecond (`2026-11-15T15:39:12.345Z`), the ONE form the card
// line writes and reads. Two answers never share a time, so the merge keeps both and Undo names exactly one.
import { describe, expect, it } from 'vitest'
import { uniteCardLines } from '@shared/cardMerge'
import { cardReviewsOf, cardTime, formatCardLine, pageCards, parseCardLine, settleCardCopy, withCardReview, withCardReviews, withoutCardReview, type CardLine } from '@shared/cardLine'
import { cardState, previewAnswers, reviewedToday } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'

const line = (body: string): CardLine => parseCardLine(`<!-- card: ${body} -->`)!
const page = (body: string) => `# Words\n\n\`\`\`card\nQ\n---\nA\n\`\`\`\n<!-- card: ${body} -->\nThe end.\n`
const PHONE = '2026-11-15T15:39:12.345Z'
const MAC = '2026-11-15T15:39:41.802Z'

describe('the writer: the full ISO 8601 UTC time to the millisecond', () => {
  it('cardTime is `toISOString`: the date, the time, the milliseconds and `Z`', () => {
    expect(cardTime(Date.UTC(2026, 10, 15, 15, 39, 12, 345))).toBe(PHONE)
    expect(cardTime(Date.UTC(2026, 0, 2, 3, 4, 5, 6))).toBe('2026-01-02T03:04:05.006Z')
  })

  it('an answer button writes its review at `now` to the millisecond, and the line holds it as written', () => {
    const now = Date.UTC(2026, 10, 15, 15, 39, 12, 345)
    const [first] = previewAnswers([], DEFAULT_REVIEW_SETTINGS, now)
    expect(first.review.at).toBe(PHONE)
    const written = withCardReview(line('NC-1'), { ...first.review, seconds: 4 })
    expect(formatCardLine(written)).toBe(`<!-- card: NC-1, ${PHONE} again 4s -->`)
  })
})

describe('the reader: the written form, and any other valid ISO 8601 time (YAZ-5673, cardShortTimes.test.ts)', () => {
  it('reads a millisecond time as a review; every other part keeps its bytes', () => {
    const text = `<!-- card: WIKI-1, title "Capital", off, ${PHONE} again 4s, ${MAC} good, mochi x1 -->`
    const parsed = parseCardLine(text)!
    expect(cardReviewsOf(parsed)).toEqual([
      { at: PHONE, rating: 'again', seconds: 4 },
      { at: MAC, rating: 'good' },
    ])
    expect(formatCardLine(parsed)).toBe(text)
  })

  it('a time that is no valid ISO 8601 UTC time is an unknown part, kept as its text: a bad second, a small `z`, no zone', () => {
    for (const part of ['2026-11-15T15:39:60.000Z good', '2026-11-15T15:39:12.345z good', '2026-11-15T15:39:12.345 good']) {
      const text = `<!-- card: WIKI-1, ${part}, ${MAC} good -->`
      const parsed = parseCardLine(text)!
      expect(parsed.parts.map((p) => p.kind), part).toEqual(['id', 'other', 'review'])
      expect(formatCardLine(parsed)).toBe(text)
    }
  })

  it('a converted line (`:00.000Z`) schedules as the minute-only line does', () => {
    // The minute-only line `…T09:00Z good, …` (YAZ-5673 reads it) and its converted form: the same instants, so the
    // same due date and wait. The wait is FSRS's whole days (YAZ-5702: no learning steps; replaces the 3 days the
    // one-minute steps gave here before).
    const converted = cardState(cardReviewsOf(line('NC-1, 2026-10-20T09:00:00.000Z good, 2026-10-24T09:00:00.000Z good, 2026-11-03T09:00:00.000Z good, 2026-11-15T15:39:00.000Z again, 2026-11-15T15:41:00.000Z good')), DEFAULT_REVIEW_SETTINGS)
    const minutes = cardState(cardReviewsOf(line('NC-1, 2026-10-20T09:00Z good, 2026-10-24T09:00Z good, 2026-11-03T09:00Z good, 2026-11-15T15:39Z again, 2026-11-15T15:41Z good')), DEFAULT_REVIEW_SETTINGS)
    expect(new Date(converted.due!).toISOString()).toBe(new Date(minutes.due!).toISOString())
    expect(converted.interval).toBe(minutes.interval)
    expect(new Date(converted.due!).toISOString()).toBe('2026-11-19T15:41:00.000Z')
    expect(converted.interval).toBe(4)
  })
})

describe('the merge: two answers in one minute (or one second) on two devices are two reviews', () => {
  const base = page('NC-1, 2026-11-03T09:00:00.000Z good')
  it('the phone and the Mac each answer ✕ 29 s apart: the merge keeps both, and the next date counts both', () => {
    const phone = base.replace('good -->', `good, ${PHONE} again -->`)
    const mac = base.replace('good -->', `good, ${MAC} again -->`)
    const [t, m] = uniteCardLines(base, phone, mac)
    expect(t).toBe(m)
    expect(cardReviewsOf(pageCards(t)[0].line).map((r) => r.at)).toEqual(['2026-11-03T09:00:00.000Z', PHONE, MAC])
  })

  it('two answers in ONE second: still two', () => {
    const later = '2026-11-15T15:39:12.346Z'
    const [t] = uniteCardLines(base, base.replace('good -->', `good, ${PHONE} again -->`), base.replace('good -->', `good, ${later} again -->`))
    expect(cardReviewsOf(pageCards(t)[0].line).map((r) => r.at)).toEqual(['2026-11-03T09:00:00.000Z', PHONE, later])
  })

  it('the same review on both sides (identical time and rating) is ONE review', () => {
    const both = base.replace('good -->', `good, ${PHONE} again -->`)
    expect(cardReviewsOf(withCardReviews(pageCards(both)[0].line, cardReviewsOf(pageCards(both)[0].line)))).toHaveLength(2)
    const [t] = uniteCardLines(base, both, both.replace('-->', ', fix -->'))
    expect(cardReviewsOf(pageCards(t)[0].line).map((r) => r.at)).toEqual(['2026-11-03T09:00:00.000Z', PHONE])
  })

  it('the no-drop rule: the keeper takes both answers of one minute from the copy', () => {
    const settled = settleCardCopy({ line: line(`NC-1, ${PHONE} again`), text: 'Q' }, { line: line(`NC-1, ${PHONE} again, ${MAC} again`), text: 'Q' })
    expect(settled.emptied).toBe(true)
    expect(cardReviewsOf(settled.keeper!).map((r) => r.at)).toEqual([PHONE, MAC])
  })

  it('both ✕ count: the card is due sooner than with one ✕ (one ✕ lost gives the wrong date)', () => {
    // FSRS in whole days (YAZ-5702): two ✕ then ✓ give 3 days, one ✕ then ✓ gives 6.
    const before = 'NC-1, 2026-10-20T09:00:00.000Z good, 2026-10-24T09:00:00.000Z good, 2026-11-03T09:00:00.000Z good'
    const due = (h: string) => new Date(cardState(cardReviewsOf(line(h)), DEFAULT_REVIEW_SETTINGS).due!).toISOString()
    expect(due(`${before}, ${PHONE} again, ${MAC} again, 2026-11-15T15:41:05.120Z good`)).toBe('2026-11-18T15:41:05.120Z')
    expect(due(`${before}, ${PHONE} again, 2026-11-15T15:41:05.120Z good`)).toBe('2026-11-21T15:41:05.120Z')
  })
})

describe('Undo and remove: the exact review by its full time', () => {
  it('removes the one review at `at`, never the other answer of that minute', () => {
    const l = line(`NC-1, ${PHONE} again 4s, ${MAC} again 3s, next`)
    expect(formatCardLine(withoutCardReview(l, PHONE))).toBe(`<!-- card: NC-1, ${MAC} again 3s, next -->`)
    expect(formatCardLine(withoutCardReview(l, MAC))).toBe(`<!-- card: NC-1, ${PHONE} again 4s, next -->`)
    expect(withoutCardReview(l, '2026-11-15T15:39:12.344Z')).toBe(l)
  })
})

describe("today's counts: the day's bounds as card times", () => {
  it('a review in the first and the last millisecond of the local day is today; midnight after is not', () => {
    const now = new Date(2026, 10, 15, 12).getTime()
    const at = (h: number, m: number, s: number, ms: number, day = 15) => cardTime(new Date(2026, 10, day, h, m, s, ms).getTime())
    const rec = (a: string) => ({ id: a, off: false, next: false, reviews: [{ at: a, rating: 'good' as const }] })
    const pages = [{ cards: [rec(at(0, 0, 0, 0)), rec(at(23, 59, 59, 999)), rec(at(0, 0, 0, 0, 16)), rec(at(23, 59, 59, 999, 14))] }]
    expect(reviewedToday(pages, now)).toEqual({ cards: 2, seconds: 0 })
  })
})
