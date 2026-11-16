import { describe, expect, it } from 'vitest'
import {
  CARD_SECONDS_MAX,
  cardRecords,
  cardReviewKey,
  cardReviewsOf,
  changeCard,
  formatCardLine,
  formatCardReview,
  isCardSeconds,
  parseCardLine,
  settleCardCopy,
  withCardNext,
  withCardReview,
  withCardReviews,
  withoutCardReview,
  cardNextIndex,
  type CardLine,
  type CardReview,
} from '@shared/cardLine'
import { cardHistory, cardState, previewAnswers, recallChance, reviewedToday } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'

/** YAZ-5033: how long each answer took, on its review part (`2026-11-12T14:05Z good 13s`), and today's total. */

const S = { ...DEFAULT_REVIEW_SETTINGS, fuzz: false }
const line = (body: string): CardLine => parseCardLine(`<!-- card: ${body} -->`)!
const round = (text: string): string | null => formatCardLine(parseCardLine(text)!)

describe('the card line: a review part may end with its seconds (YAZ-5033)', () => {
  it('round-trips byte for byte with and without seconds, side by side, with every other part in place', () => {
    for (const text of [
      '<!-- card: WIKI-1, 2026-11-12T14:05Z good -->',
      '<!-- card: WIKI-1, 2026-11-12T14:05Z good 13s -->',
      '<!-- card: WIKI-1, off, next, notitle, 2026-11-01T09:00Z good, 2026-11-05T09:00Z again 64s, mochi x1, 2026-11-06T09:00Z easy 0s -->',
      `<!-- card: WIKI-1, 2026-11-12T14:05Z hard ${CARD_SECONDS_MAX}s -->`,
    ])
      expect(round(text)).toBe(text)
  })

  it('reads the seconds onto the review; an old part has none (no field at all, so old records stay equal)', () => {
    expect(cardReviewsOf(line('WIKI-1, 2026-11-01T09:00Z good, 2026-11-05T09:00Z again 64s, 2026-11-06T09:00Z easy 0s'))).toEqual([
      { at: '2026-11-01T09:00Z', rating: 'good' },
      { at: '2026-11-05T09:00Z', rating: 'again', seconds: 64 },
      { at: '2026-11-06T09:00Z', rating: 'easy', seconds: 0 },
    ])
    expect('seconds' in cardReviewsOf(line('2026-11-01T09:00Z good'))[0]).toBe(false)
  })

  it('any other ending is an unknown part: kept as its text, in its place, and written back as it was', () => {
    for (const part of ['2026-11-12T14:05Z good 13.5s', '2026-11-12T14:05Z good 013s', `2026-11-12T14:05Z good ${CARD_SECONDS_MAX + 1}s`, '2026-11-12T14:05Z good 13', '2026-11-12T14:05Z good 13 s', '2026-11-12T14:05Z good 13sec', '2026-11-12T14:05Z good -1s', '2026-11-12T14:05Z good 123456s', '2026-11-12T14:05Z good 13s extra']) {
      const text = `<!-- card: WIKI-1, ${part}, 2026-11-13T09:00Z good 4s -->`
      const parsed = parseCardLine(text)!
      expect(parsed.parts.map((p) => p.kind), part).toEqual(['id', 'other', 'review'])
      expect(parsed.parts[1]).toEqual({ kind: 'other', text: part })
      expect(formatCardLine(parsed)).toBe(text)
    }
  })

  it('writes the seconds only when known: a whole number from 0 to a day', () => {
    expect(formatCardReview({ at: '2026-11-12T14:05Z', rating: 'good' })).toBe('2026-11-12T14:05Z good')
    expect(formatCardReview({ at: '2026-11-12T14:05Z', rating: 'good', seconds: 13 })).toBe('2026-11-12T14:05Z good 13s')
    expect(formatCardReview({ at: '2026-11-12T14:05Z', rating: 'good', seconds: 0 })).toBe('2026-11-12T14:05Z good 0s')
    for (const seconds of [-1, 1.5, Number.NaN, CARD_SECONDS_MAX + 1]) expect(formatCardReview({ at: '2026-11-12T14:05Z', rating: 'good', seconds })).toBe('2026-11-12T14:05Z good')
    expect([0, 13, CARD_SECONDS_MAX, -1, 2.5, '13', undefined].map(isCardSeconds)).toEqual([true, true, true, false, false, false, false])
    const next = withCardReview(line('WIKI-1, 2026-11-01T09:00Z good, mochi x1'), { at: '2026-11-12T14:05Z', rating: 'again', seconds: 13 })
    expect(formatCardLine(next)).toBe('<!-- card: WIKI-1, 2026-11-01T09:00Z good, 2026-11-12T14:05Z again 13s, mochi x1 -->')
  })

  it("the index's record holds the seconds (`cardRecords`)", () => {
    const page = '```card\nQ\n```\n<!-- card: WIKI-1, 2026-11-01T09:00Z good, 2026-11-12T14:05Z again 13s -->\n'
    expect(cardRecords(page)[0].reviews).toEqual([
      { at: '2026-11-01T09:00Z', rating: 'good' },
      { at: '2026-11-12T14:05Z', rating: 'again', seconds: 13 },
    ])
  })

  it('the undo of an answer puts the page back byte for byte: the timed review out, `next` back at its place, older timed and untimed reviews kept', () => {
    const page = [
      '# Page',
      '',
      '```card',
      'Capital of {{France}}?',
      '```',
      '<!-- card: WIKI-1, mochi x1, next, 2026-11-01T09:00Z good, 2026-11-05T09:00Z again 64s -->',
      '',
    ].join('\n')
    const review: CardReview = { at: '2026-11-12T14:05Z', rating: 'good', seconds: 13 }
    let next = -1
    // `writeCardAnswer` and `undoCardAnswer` (client/src/review/cardFile.ts), on the page's bytes.
    const answered = changeCard(page, 'WIKI-1', (l) => {
      next = cardNextIndex(l)
      return withCardReview(withCardNext(l, false), review)
    })
    expect(answered).toContain('<!-- card: WIKI-1, mochi x1, 2026-11-01T09:00Z good, 2026-11-05T09:00Z again 64s, 2026-11-12T14:05Z good 13s -->')
    const undone = changeCard(answered, 'WIKI-1', (l) => withCardNext(withoutCardReview(l, review.at), true, next))
    expect(undone).toBe(page)
  })

  it('FSRS never reads the seconds: the same log with and without them gives the same schedule', () => {
    const bare: CardReview[] = [
      { at: '2026-11-01T09:00Z', rating: 'good' },
      { at: '2026-11-05T09:00Z', rating: 'again' },
      { at: '2026-11-06T09:00Z', rating: 'good' },
    ]
    const timed = bare.map((r, i) => ({ ...r, seconds: [13, 600, 0][i] }))
    const now = Date.parse('2026-11-12T09:00Z')
    expect(cardState(timed, S)).toEqual(cardState(bare, S))
    expect(recallChance(timed, S, now)).toBe(recallChance(bare, S, now))
    expect(cardHistory(timed, S).map(({ review, ...rest }) => rest)).toEqual(cardHistory(bare, S).map(({ review, ...rest }) => rest))
    expect(previewAnswers(timed, S, now).map((a) => [a.due, a.interval])).toEqual(previewAnswers(bare, S, now).map((a) => [a.due, a.interval]))
  })
})

describe('the union of a card`s copies: a review is its time and its rating; the seconds are no part of it (YAZ-5033)', () => {
  it('the same review with and without seconds is ONE review: the timed copy is kept, wherever it comes from', () => {
    expect(cardReviewKey({ at: '2026-11-12T14:05Z', rating: 'good', seconds: 13 })).toBe(cardReviewKey({ at: '2026-11-12T14:05Z', rating: 'good' }))
    // The line holds it with no seconds; the copy has them: the line takes them, in place.
    const upgraded = withCardReviews(line('WIKI-1, 2026-11-12T14:05Z good, mochi x1'), [{ at: '2026-11-12T14:05Z', rating: 'good', seconds: 13 }])
    expect(formatCardLine(upgraded)).toBe('<!-- card: WIKI-1, 2026-11-12T14:05Z good 13s, mochi x1 -->')
    // The line holds it with seconds: it keeps its own; nothing new, the same line object.
    const held = line('WIKI-1, 2026-11-12T14:05Z good 13s')
    expect(withCardReviews(held, [{ at: '2026-11-12T14:05Z', rating: 'good' }])).toBe(held)
    expect(withCardReviews(held, [{ at: '2026-11-12T14:05Z', rating: 'good', seconds: 99 }])).toBe(held)
    // Two new copies of one review: one review, the timed one.
    const fresh = withCardReviews(line('WIKI-1'), [
      { at: '2026-11-12T14:05Z', rating: 'good' },
      { at: '2026-11-12T14:05Z', rating: 'good', seconds: 7 },
    ])
    expect(formatCardLine(fresh)).toBe('<!-- card: WIKI-1, 2026-11-12T14:05Z good 7s -->')
    // Another rating at the same minute is another review.
    expect(cardReviewsOf(withCardReviews(held, [{ at: '2026-11-12T14:05Z', rating: 'again', seconds: 2 }]))).toHaveLength(2)
  })

  it('settleCardCopy (the no-drop rule): the keeper takes the copy`s seconds before the copy`s history empties', () => {
    const keeper = { line: line('WIKI-1, 2026-11-01T09:00Z good, 2026-11-05T09:00Z again'), text: 'Q' }
    const copy = { line: line('WIKI-1, 2026-11-01T09:00Z good 13s, 2026-11-05T09:00Z again, 2026-11-06T09:00Z good 5s'), text: 'Q' }
    const settled = settleCardCopy(keeper, copy)
    expect(settled.emptied).toBe(true)
    expect(formatCardLine(settled.keeper!)).toBe('<!-- card: WIKI-1, 2026-11-01T09:00Z good 13s, 2026-11-05T09:00Z again, 2026-11-06T09:00Z good 5s -->')
    expect(cardReviewsOf(settled.copy)).toEqual([])
    // The copy holds the review with no seconds, the keeper with them: the keeper keeps its own, untouched.
    const timedKeeper = { line: line('WIKI-1, 2026-11-01T09:00Z good 13s'), text: 'Q' }
    const again = settleCardCopy(timedKeeper, { line: line('WIKI-1, 2026-11-01T09:00Z good'), text: 'Q' })
    expect(again).toMatchObject({ emptied: true })
    expect(again.keeper).toBe(timedKeeper.line)
  })
})

describe("today's total (YAZ-5033): the reviews of the local day across the index", () => {
  it('counts the cards answered today (once each), the reviews, and their seconds; an old review counts 0 s; yesterday and tomorrow are out', () => {
    const now = new Date(2026, 10, 13, 15, 30).getTime()
    const at = (h: number, m = 0, day = 13) => new Date(2026, 10, day, h, m).toISOString().slice(0, 16) + 'Z'
    const rec = (...reviews: CardReview[]) => ({ id: 'X', off: false, next: false, reviews })
    const pages = [
      { cards: [rec({ at: at(0, 0), rating: 'again', seconds: 40 }, { at: at(0, 5), rating: 'good', seconds: 20 }), rec({ at: at(23, 59, 12), rating: 'good', seconds: 999 })] },
      { cards: [rec({ at: at(9), rating: 'good' }), rec({ at: at(0, 0, 14), rating: 'good', seconds: 999 }), rec()] },
      {},
      { cards: [{ ...rec({ at: at(23, 59), rating: 'easy', seconds: 4 }), off: true }] },
    ]
    expect(reviewedToday(pages, now)).toEqual({ cards: 3, reviews: 4, seconds: 64 })
    expect(reviewedToday([], now)).toEqual({ cards: 0, reviews: 0, seconds: 0 })
  })
})
