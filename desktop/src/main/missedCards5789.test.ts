// YAZ-5789: Mochi's dates for a missed card, with every answer recorded. Rule 1: a ✓ right after a ✕, before the ✕'s
// due day, is recorded, not counted; the ✕ sets the date. Rule 2: a new card's ✕ is recorded, not counted. The history
// is the "Sahi tarah" card's (✓ Oct 30, ✓ Oct 30, ✓ Nov 3, ✕ Nov 17), in local time, fuzz off.
import { describe, expect, it } from 'vitest'
import { cardTime, type CardRating, type CardReview } from '@shared/cardLine'
import { cardHistory, cardQueue, cardState, previewAnswers } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'

const DAY = 86_400_000
const S = { ...DEFAULT_REVIEW_SETTINGS, fuzz: false }
/** A local time in 2026: month (0-based), day, hour, minute. */
const L = (m: number, d: number, h = 9, min = 0) => new Date(2026, m, d, h, min).getTime()
const r = (t: number, rating: CardRating): CardReview => ({ at: cardTime(t), rating })
const KNOWN = [r(L(9, 30), 'good'), r(L(9, 30, 9, 10), 'good'), r(L(10, 3), 'good')]
const MISS = r(L(10, 17), 'again')
/** The date FSRS gives the ✕ of Nov 17: the date every answer before it keeps. */
const MISS_DATE = Date.parse(MISS.at) + cardHistory([...KNOWN, MISS], S).at(-1)!.interval * DAY
const dueOf = (log: CardReview[]) => cardState(log, S).due!
const page = (log: CardReview[]) => ({ path: '/v/a.md', folder: '', cards: [{ id: 'V-1', off: false, next: false, reviews: log }] })
const queued = (log: CardReview[], now: number) => cardQueue([page(log)], S, now).find((q) => q.id === 'V-1')

describe('YAZ-5789 rule 1: after a miss, a ✓ before the due date is recorded, not counted', () => {
  it('the ✕ of Nov 17 waits more than a day, so the cases below fall before its date', () => {
    expect(MISS_DATE - Date.parse(MISS.at)).toBeGreaterThanOrEqual(2 * DAY)
  })

  it('✕, then ✓ 20 minutes later (the missed pass): the date stays; the ✓ is not counted; the card is done for today', () => {
    const log = [...KNOWN, MISS, r(L(10, 17, 9, 20), 'good')]
    expect(cardHistory(log, S).map((x) => x.counted)).toEqual([true, true, true, true, false])
    expect(dueOf(log)).toBe(MISS_DATE)
    expect(cardState(log, S).comesBack).toBe(false)
    expect(queued(log, L(10, 17, 9, 21))).toBeUndefined()
  })

  it('✕ on Nov 17, ✓ on Nov 18: the date stays', () => {
    const log = [...KNOWN, MISS, r(L(10, 18), 'good')]
    expect(cardHistory(log, S).at(-1)!.counted).toBe(false)
    expect(dueOf(log)).toBe(MISS_DATE)
  })

  it('✕ on Nov 17, ✓ the same day, then a second ✓ on Nov 18 (Up next): neither ✓ counts; the date stays', () => {
    const log = [...KNOWN, MISS, r(L(10, 17, 9, 20), 'good'), r(L(10, 18), 'good')]
    expect(cardHistory(log, S).map((x) => x.counted)).toEqual([true, true, true, true, false, false])
    expect(dueOf(log)).toBe(MISS_DATE)
  })

  it('✕ on Nov 17 and no answer: the card stays in Due today on Nov 18 and Nov 19 (no change)', () => {
    const log = [...KNOWN, MISS]
    for (const now of [L(10, 18, 8), L(10, 19, 8)]) expect(queued(log, now)).toMatchObject({ isNew: false })
  })

  it('✕ on Nov 17, ✓ on its date: the ✓ is counted and sets a new, later date', () => {
    const onDate = new Date(MISS_DATE).setHours(11, 0, 0, 0)
    const log = [...KNOWN, MISS, r(onDate, 'good')]
    expect(cardHistory(log, S).at(-1)!.counted).toBe(true)
    expect(dueOf(log)).toBeGreaterThan(MISS_DATE)
  })

  it('a ✕ in the missed pass counts; the ✓ after it does not; the second ✕ sets the date', () => {
    const second = r(L(10, 17, 9, 10), 'again')
    const log = [...KNOWN, MISS, second, r(L(10, 17, 9, 20), 'good')]
    expect(cardHistory(log, S).map((x) => x.counted)).toEqual([true, true, true, true, true, false])
    expect(dueOf(log)).toBe(Date.parse(second.at) + cardHistory([...KNOWN, MISS, second], S).at(-1)!.interval * DAY)
  })

  it('Undo of the ✓ that was not counted: the card is back in the missed pass', () => {
    const now = L(10, 17, 9, 21)
    expect(queued([...KNOWN, MISS, r(L(10, 17, 9, 20), 'good')], now)).toBeUndefined()
    expect(queued([...KNOWN, MISS], now)).toMatchObject({ isNew: false })
  })

  it('the Remembered button says what will happen: the ✕`s date, not a new wait', () => {
    const remembered = previewAnswers([...KNOWN, MISS], S, L(10, 17, 9, 20)).find((a) => a.review.rating === 'good')!
    expect(remembered).toMatchObject({ comesBack: false, due: MISS_DATE })
    expect(remembered.interval).toBe(Math.round((MISS_DATE - L(10, 17)) / DAY))
  })
})

describe('YAZ-5789 rule 2: a new card`s ✕ before its first ✓ is recorded, not counted', () => {
  const t = (min: number) => L(10, 17, 10, min)

  it('✕, ✓, ✓ the same day: the same schedule as ✓, ✓ alone', () => {
    const withMiss = [r(t(0), 'again'), r(t(5), 'good'), r(t(10), 'good')]
    expect(cardHistory(withMiss, S).map((x) => x.counted)).toEqual([false, true, true])
    expect(dueOf(withMiss)).toBe(dueOf(withMiss.slice(1)))
    expect(cardState(withMiss, S).interval).toBe(cardState(withMiss.slice(1), S).interval)
  })

  it('✕, ✕, ✓: the same as ✓ alone', () => {
    const log = [r(t(0), 'again'), r(t(5), 'again'), r(t(10), 'good')]
    expect(cardHistory(log, S).map((x) => x.counted)).toEqual([false, false, true])
    expect(cardState(log, S)).toMatchObject({ due: cardState(log.slice(2), S).due, comesBack: true })
  })

  it('✕ only: still a new card, it comes back in today`s new-card run, wait 0 ("later today")', () => {
    const log = [r(t(0), 'again')]
    expect(cardHistory(log, S)[0]).toMatchObject({ counted: false, comesBack: true, interval: 0 })
    expect(queued(log, t(1))).toMatchObject({ isNew: true })
  })
})
