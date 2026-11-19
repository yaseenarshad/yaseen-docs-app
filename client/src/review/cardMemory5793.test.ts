/**
 * YAZ-5793: `cardMemory` — what the Card table shows of a card's memory (Wait time, Times forgotten, Recall chance) —
 * from ONE cached replay of its reviews. It must say what the schedule's own readers say (`cardState`'s interval and
 * lapses, `recallChance`), and a second read of the same reviews with the same settings must not replay them again.
 * Made-up data only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FSRS } from 'ts-fsrs'
import { cardTime, type CardRating, type CardReview } from '@shared/cardLine'
import { cardMemory, cardState, recallChance } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'

const DAY = 86_400_000
/** Noon local, so the local days are the same in any time zone. */
const noon = (m: number, d: number) => new Date(2026, m, d, 12, 0).getTime()
const at = (ms: number, rating: CardRating): CardReview => ({ at: cardTime(ms), rating })
const NOW = new Date(2026, 10, 18, 9, 0).getTime()

const HISTORIES: Record<string, CardReview[]> = {
  'one ✓': [at(noon(9, 1), 'good')],
  'learned, then a lapse': [at(noon(9, 1), 'good'), at(noon(9, 1) + 3_600_000, 'good'), at(noon(9, 5), 'good'), at(noon(9, 15), 'again'), at(noon(9, 17), 'good')],
  'only ✕': [at(noon(10, 1), 'again'), at(noon(10, 2), 'again')],
  'long and mixed': [at(noon(4, 1), 'good'), at(noon(4, 2), 'hard'), at(noon(4, 9), 'good'), at(noon(5, 1), 'again'), at(noon(5, 2), 'easy'), at(noon(6, 20), 'again'), at(noon(6, 21), 'good'), at(noon(8, 1), 'good')],
}

afterEach(() => vi.restoreAllMocks())

describe('YAZ-5793: cardMemory', () => {
  it('null for a card with no review', () => {
    expect(cardMemory([], { ...DEFAULT_REVIEW_SETTINGS }, NOW)).toBeNull()
  })

  for (const fuzz of [false, true]) {
    for (const [name, reviews] of Object.entries(HISTORIES)) {
      it(`${name}, fuzz ${fuzz ? 'on' : 'off'}: the same wait, lapses and recall chance as cardState and recallChance`, () => {
        const s: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS, fuzz }
        const state = cardState(reviews, s)
        for (const now of [NOW, NOW + 30 * DAY, Date.parse(reviews.at(-1)!.at) + DAY]) {
          expect(cardMemory(reviews, s, now)).toEqual({ wait: state.interval, forgotten: state.lapses, recall: recallChance(reviews, s, now) })
        }
      })
    }
  }

  // The last ✓ is on the ✕'s due day (Oct 17), so FSRS counts it (YAZ-5789 rule 1). Due Oct 23.
  it('a known history, fuzz off: waits 6 days, forgotten once, 87% three days past due', () => {
    const s: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS, fuzz: false }
    const memory = cardMemory(HISTORIES['learned, then a lapse'], s, noon(9, 26))!
    expect([memory.wait, memory.forgotten, Math.round(100 * memory.recall)]).toEqual([6, 1, 87])
  })

  it('a second read of the same reviews (a new array, the same log) replays nothing; another `now` reads the same replay; a changed log replays', () => {
    const s: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS } // a new settings object: an empty cache
    const reviews = HISTORIES['long and mixed']
    // FSRS steps only the answers it counts (YAZ-5789): 6 of these 8 (the ✓ the day after each ✕ is not counted).
    const counted = 6
    const next = vi.spyOn(FSRS.prototype, 'next')
    const first = cardMemory(reviews, s, NOW)
    expect(next).toHaveBeenCalledTimes(counted)
    // The index hands new objects on each snapshot: the cache is keyed by the log, not the array.
    const again = cardMemory(reviews.map((r) => ({ ...r })), s, NOW)
    expect(again).toEqual(first)
    const later = cardMemory(reviews, s, NOW + 20 * DAY)!
    expect(next).toHaveBeenCalledTimes(counted)
    expect(later.wait).toBe(first!.wait)
    expect(later.recall).toBeLessThan(first!.recall)
    // One more review: a new log, replayed once.
    cardMemory([...reviews, at(NOW, 'good')], s, NOW)
    expect(next).toHaveBeenCalledTimes(2 * counted + 1)
    // Other settings: their own cache.
    cardMemory(reviews, { ...s }, NOW)
    expect(next).toHaveBeenCalledTimes(3 * counted + 1)
  })
})
