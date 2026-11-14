import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CardRating, CardRecord } from '@shared/cardLine'
import { cardHistory, reviewedToday } from '@shared/cardSchedule'
import { FRIEND_DAYS, daysReviewed, friendStats, rememberedPercent, type FriendVault } from '@shared/friendStats'
import { indexRecord } from '@shared/indexRecord'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'

/**
 * YAZ-5069 (2C): the friends numbers from the index records of a made-up demo vault, with a fixed clock. The person's
 * time zone is New York (not UTC) for the whole file; one test moves to India, where the day turns 10.5 hours sooner.
 * Reviews are UTC minutes, as the card line holds them. 15:00Z is 10:00 in New York in November.
 */
const TZ = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
afterAll(() => {
  process.env.TZ = TZ
})

const S = DEFAULT_REVIEW_SETTINGS
/** Friday 13 November 2026, 15:00 in New York. */
const NOW = Date.parse('2026-11-13T20:00Z')

type R = [at: string, rating: CardRating, seconds?: number]
const card = (id: string | null, reviews: R[], more: Partial<CardRecord> = {}): CardRecord => ({
  id,
  off: false,
  next: false,
  reviews: reviews.map(([at, rating, seconds]) => ({ at, rating, ...(seconds !== undefined && { seconds }) })),
  ...more,
})
const vault = (cards: CardRecord[], settings: ReviewSettings = S): FriendVault => ({ pages: [{ cards }], settings })
const stats = (cards: CardRecord[], now = NOW) => friendStats([vault(cards)], now)
const dayOf = (s: ReturnType<typeof stats>, day: string) => s.days.find((d) => d.day === day)

/**
 * Card S: learned on 1 November, due 5 November; Forgot and then Remembered on 5 November; due 7 November and
 * answered then; due again today (13 November, 15:00Z). The test checks these dates first, so a change in FSRS shows here.
 */
const S_REVIEWS: R[] = [
  ['2026-11-01T15:00Z', 'good'],
  ['2026-11-01T15:02Z', 'good'],
  ['2026-11-05T15:00Z', 'again'],
  ['2026-11-05T15:05Z', 'good'],
  ['2026-11-07T15:00Z', 'good'],
]

describe('friendStats (YAZ-5069)', () => {
  it('the schedule of card S is as the streak tests expect', () => {
    const rows = cardHistory(card('GEO-1', S_REVIEWS).reviews, S)
    expect(rows.map((r) => new Date(r.due).toISOString().slice(0, 10))).toEqual(['2026-11-01', '2026-11-05', '2026-11-05', '2026-11-07', '2026-11-13'])
    expect(rows.at(-1)!.inSteps).toBe(false)
  })

  it('a day`s numbers: each card one time, every answer in remembered and forgot, the seconds, and the new cards; today is `reviewedToday`', () => {
    const cards = [
      // New today, answered three times: one card, one new card.
      card('GEO-1', [
        ['2026-11-13T14:00Z', 'again', 5],
        ['2026-11-13T14:01Z', 'good', 7],
        ['2026-11-13T14:03Z', 'good', 4],
      ]),
      card('GEO-2', [
        ['2026-11-10T15:00Z', 'good', 10],
        ['2026-11-10T15:02Z', 'good'],
        ['2026-11-13T16:00Z', 'good', 6],
      ]),
      card('GEO-3', []),
      // Archived: its answers were made, so they count in the day; it is not in review and not a new card left.
      card('GEO-4', [['2026-11-13T17:00Z', 'hard', 3]], { off: true }),
    ]
    const s = stats(cards)
    expect(s.days.map((d) => d.day)).toEqual(['2026-11-13', '2026-11-12', '2026-11-11', '2026-11-10'])
    expect(s.days[0]).toEqual({ day: '2026-11-13', cards: 3, seconds: 25, remembered: 4, forgot: 1, newCards: 2, done: true })
    expect(dayOf(s, '2026-11-10')).toEqual({ day: '2026-11-10', cards: 1, seconds: 10, remembered: 2, forgot: 0, newCards: 1, done: true })
    expect(dayOf(s, '2026-11-11')).toMatchObject({ cards: 0, seconds: 0, newCards: 0 })
    const mac = reviewedToday([{ cards }], NOW)
    expect([s.days[0].cards, s.days[0].seconds]).toEqual([mac.cards, mac.seconds])
    expect(s.totals).toMatchObject({ cards: 4, inReview: 2, newLeft: 1 })
    expect(s.v).toBe(1)
    expect(s.at).toBe('2026-11-13T20:00:00.000Z')
    expect('mark' in s || 'reads' in s).toBe(false)
  })

  it('`mature`: the next gap is 21 days or more', () => {
    const old: R[] = [
      ['2026-09-01T15:00Z', 'good'],
      ['2026-09-01T15:02Z', 'good'],
      ['2026-09-04T15:00Z', 'good'],
      ['2026-09-14T15:00Z', 'good'],
      ['2026-10-10T15:00Z', 'good'],
    ]
    expect(cardHistory(card('A', old).reviews, S).at(-1)!.interval).toBeGreaterThanOrEqual(21)
    expect(cardHistory(card('B', S_REVIEWS).reviews, S).at(-1)!.interval).toBeLessThan(21)
    expect(stats([card('GEO-1', old), card('GEO-2', S_REVIEWS), card('GEO-3', old, { off: true })]).totals.mature).toBe(1)
  })

  it('the streak goes on across days with no due card, and an unfinished today does not stop it', () => {
    const s = stats([card('GEO-1', S_REVIEWS)])
    // 8 to 12 November: no due card, so finished. Today: card S is due and not answered.
    for (const day of ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']) expect(dayOf(s, day)).toMatchObject({ cards: 0, done: true })
    expect(s.days.every((d) => d.done || d.day === '2026-11-13')).toBe(true)
    expect(s.days[0]).toMatchObject({ day: '2026-11-13', done: false })
    expect(s.totals).toMatchObject({ dueLeft: 1, streak: 12, bestStreak: 12 })
  })

  it('today counts once its due cards are finished', () => {
    const s = stats([card('GEO-1', [...S_REVIEWS, ['2026-11-13T16:00Z', 'good']])])
    expect(s.days[0]).toMatchObject({ done: true, cards: 1, newCards: 0 })
    expect(s.totals).toMatchObject({ dueLeft: 0, streak: 13, bestStreak: 13 })
  })

  it('a missed day stops the streak', () => {
    // Learned on 9 November and due on 12 November (checked); not answered on the 12th, answered today.
    const reviews: R[] = [
      ['2026-11-09T15:00Z', 'good'],
      ['2026-11-09T15:02Z', 'good'],
    ]
    expect(new Date(cardHistory(card('T', reviews).reviews, S).at(-1)!.due).toISOString().slice(0, 10)).toBe('2026-11-12')
    const s = stats([card('GEO-1', [...reviews, ['2026-11-13T15:00Z', 'good']])])
    expect(s.days.map((d) => [d.day, d.done])).toEqual([
      ['2026-11-13', true],
      ['2026-11-12', false],
      ['2026-11-11', true],
      ['2026-11-10', true],
      ['2026-11-09', true],
    ])
    expect(s.totals).toMatchObject({ streak: 1, bestStreak: 3, dueLeft: 0 })
  })

  it('a due card that comes back in the same session counts in `dueLeft` until it is answered', () => {
    const forgot = stats([card('GEO-1', [...S_REVIEWS, ['2026-11-13T15:00Z', 'again']])])
    expect(forgot.totals.dueLeft).toBe(1)
    expect(forgot.days[0].done).toBe(false)
    const back = stats([card('GEO-1', [...S_REVIEWS, ['2026-11-13T15:00Z', 'again'], ['2026-11-13T15:05Z', 'good']])])
    expect(back.totals.dueLeft).toBe(0)
    expect(back.days[0].done).toBe(true)
  })

  it('the daily is the due cards only: no new card, no Up next card that is not due, no archived card, nothing while review is off', () => {
    const notDue: R[] = [
      ['2026-11-12T15:00Z', 'good'],
      ['2026-11-12T15:02Z', 'good'],
    ]
    const s = stats([
      card('GEO-1', []),
      // First answered today and left in its steps: a new card of today, not a due card.
      card('GEO-2', [['2026-11-13T15:00Z', 'again']]),
      card('GEO-3', notDue, { next: true }),
      card('GEO-4', S_REVIEWS, { off: true }),
      // No ID yet: the Inbox does not show it.
      card(null, S_REVIEWS),
    ])
    expect(s.totals.dueLeft).toBe(0)
    expect(s.days.every((d) => d.done)).toBe(true)
    const off = friendStats([vault([card('GEO-1', S_REVIEWS)], { ...S, enabled: false })], NOW)
    expect(off.totals.dueLeft).toBe(0)
    expect(off.totals.streak).toBe(13)
  })

  it('two copies of one ID on a page count one time in `dueLeft`, as the Inbox shows one', () => {
    expect(stats([card('GEO-1', S_REVIEWS), card('GEO-1', S_REVIEWS)]).totals.dueLeft).toBe(1)
  })

  it('the local day turns at midnight in the person`s time zone', () => {
    const cards = [card('GEO-1', [['2026-11-12T18:00Z', 'good']]), card('GEO-2', [['2026-11-12T19:00Z', 'good']])]
    // New York: both at 13:00 and 14:00 on 12 November.
    expect(dayOf(stats(cards), '2026-11-12')).toMatchObject({ cards: 2 })
    process.env.TZ = 'Asia/Kolkata'
    try {
      // India: 23:30 on 12 November, then 00:30 on 13 November.
      const now = Date.parse('2026-11-13T06:30Z')
      const s = stats(cards, now)
      expect(s.days.map((d) => [d.day, d.cards])).toEqual([
        ['2026-11-13', 1],
        ['2026-11-12', 1],
      ])
      expect(s.days[0].cards).toBe(reviewedToday([{ cards }], now).cards)
    } finally {
      process.env.TZ = 'America/New_York'
    }
  })

  it('keeps the newest 90 days; the streak and the bests look at the whole history', () => {
    // Answered first 200 days ago; a card in its steps never ends, so no day is ever finished after its first.
    const s = stats([card('GEO-1', [['2026-04-27T15:00Z', 'good']]), card('GEO-2', [['2026-04-27T15:00Z', 'good']])])
    expect(s.days).toHaveLength(FRIEND_DAYS)
    expect(s.days[0].day).toBe('2026-11-13')
    expect(s.days[FRIEND_DAYS - 1].day).toBe('2026-08-16')
    expect(s.totals).toMatchObject({ bestDay: 2, bestWeek: 2, streak: 0, bestStreak: 1, dueLeft: 2 })
  })

  it('`addedThisWeek`, `bestDay` and `bestWeek` use local weeks from Monday', () => {
    const s = stats([
      card('GEO-1', [
        ['2026-11-08T15:00Z', 'good'],
        ['2026-11-08T15:02Z', 'good'],
        ['2026-11-10T15:00Z', 'good'],
      ]),
      card('GEO-2', [
        ['2026-11-08T16:00Z', 'good'],
        ['2026-11-08T16:02Z', 'good'],
      ]),
      card('GEO-3', [
        ['2026-11-09T15:00Z', 'good'],
        ['2026-11-09T15:02Z', 'good'],
      ]),
      card('GEO-4', [
        ['2026-11-12T15:00Z', 'good'],
        ['2026-11-12T15:02Z', 'good'],
      ]),
    ])
    // Sunday 8 November is last week: 2 cards. This week (from Monday 9 November): 1 + 1 + 1 cards, 2 of them new.
    expect(s.totals).toMatchObject({ addedThisWeek: 2, bestDay: 2, bestWeek: 3 })
  })

  it('"Remembered %" and "days reviewed" use the last 30 days only', () => {
    const s = stats([
      card('GEO-1', [
        ['2026-10-01T15:00Z', 'again'],
        ['2026-10-01T15:01Z', 'again'],
        ['2026-10-01T15:02Z', 'again'],
      ]),
      card('GEO-2', [
        ['2026-10-15T15:00Z', 'good'],
        ['2026-11-10T15:00Z', 'again'],
        ['2026-11-10T15:05Z', 'good'],
        ['2026-11-12T15:00Z', 'good'],
        ['2026-11-13T15:00Z', 'easy'],
      ]),
    ])
    // 15 October to 13 November: 4 remembered and 1 forgot. The three Forgot of 1 October are older.
    expect(rememberedPercent(s.days)).toBe(80)
    expect(daysReviewed(s.days)).toBe(4)
    expect(rememberedPercent([])).toBeNull()
  })

  it('numbers only: the JSON holds no card text and no title; a card file embedded on a page counts one time', () => {
    const cardFile = indexRecord(
      { path: '/v/capital-geo-140.md', name: 'capital-geo-140.md', basename: 'capital-geo-140', folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1 },
      ['---', 'kind: card', 'title: Secret capital', '---', '```card', 'Which city is lovely?', '---', 'Paris', '```', '<!-- card: GEO-140, 2026-11-13T15:00Z good 9s -->', ''].join('\n'),
    )
    const pageCard = indexRecord(
      { path: '/v/trip.md', name: 'trip.md', basename: 'trip', folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1 },
      ['Trip notes', '', '![[GEO-140]]', '', '```card', 'Hidden question', '---', 'Hidden answer', '```', '<!-- card: GEO-141, 2026-11-13T15:10Z again 4s -->', ''].join('\n'),
    )
    const otherPage = indexRecord({ path: '/v/b.md', name: 'b.md', basename: 'b', folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1 }, '![[GEO-140]] and ![[GEO-140]] again\n')
    const s = friendStats([{ pages: [cardFile, pageCard, otherPage], settings: S }], NOW)
    expect(s.totals.cards).toBe(2)
    expect(s.days[0]).toMatchObject({ cards: 2, seconds: 13 })
    const json = JSON.stringify(s)
    for (const text of ['Secret', 'capital', 'Which city', 'lovely', 'Paris', 'Hidden', 'Trip', 'GEO-', 'trip', '/v/']) expect(json).not.toContain(text)
  })
})
