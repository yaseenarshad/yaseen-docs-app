// YAZ-5673: the card line reads ANY valid ISO 8601 UTC review time: with or without seconds, with or without
// milliseconds, `Z` or an offset. The demo vault (and the builds before YAZ-5642) wrote `2026-11-15T05:24Z good`; the
// line read only `…T05:24:00.000Z`, so it skipped those reviews and every card looked New (YAZ-5669 audit).
import { describe, expect, it } from 'vitest'
import { cardRecords, cardReviewsOf, formatCardLine, parseCardLine, withCardReview, withCardReviews, withoutCardReview } from '@shared/cardLine'
import { cardPlan, cardState } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { spliceCardLine } from '../../../mobile/src/answers/splice'

const line = (body: string) => parseCardLine(`<!-- card: ${body} -->`)!

// Four card lines as the demo vault holds them (its seed and its answers of the minute-only builds); made-up text.
const DEMO_PAGE = [
  '# Rivers',
  '',
  '```card',
  'The longest river in {{Africa}}?',
  '---',
  'The Nile',
  '```',
  '<!-- card: RIV-39, 2026-09-13T11:45Z good, 2026-09-23T15:45Z good, 2026-11-13T02:29Z good -->',
  '',
  '```card',
  'Where does the {{Danube}} start?',
  '```',
  '<!-- card: RIV-40, 2026-09-28T11:45Z good, 2026-10-05T15:45Z good, 2026-11-13T06:18Z good -->',
  '',
  '```card',
  'The river through {{Baghdad}}?',
  '```',
  '<!-- card: RIV-41, 2026-10-13T11:45Z good, 2026-11-13T02:31Z good -->',
  '',
  '```card',
  'Which sea does the {{Volga}} reach?',
  '```',
  '<!-- card: RIV-26, 2026-11-10T16:45Z again, 2026-11-10T16:46Z good, 2026-11-13T06:47Z good -->',
  '',
].join('\n')

describe("the demo vault's card lines", () => {
  it('reads every review, and no card is New', () => {
    const records = cardRecords(DEMO_PAGE)
    expect(records.map((r) => r.reviews.length)).toEqual([3, 3, 2, 3])
    expect(records[0].reviews[0]).toEqual({ at: '2026-09-13T11:45:00.000Z', rating: 'good' })
    for (const r of records) expect(cardState(r.reviews, DEFAULT_REVIEW_SETTINGS).isNew).toBe(false)
    const plan = cardPlan([{ path: '/v/rivers.md', folder: '', cards: records }], DEFAULT_REVIEW_SETTINGS, Date.UTC(2027, 5, 1, 12))
    expect(plan.queue).toHaveLength(4)
    expect(plan.queue.filter((c) => c.isNew)).toEqual([])
  })

  it('an answer keeps the old reviews as they are written; only the new one is in the full form', () => {
    const old = '<!-- card: RIV-41, 2026-10-13T11:45Z good, 2026-11-13T02:31Z good -->'
    const answered = withCardReview(parseCardLine(old)!, { at: '2026-11-16T09:00:00.123Z', rating: 'again', seconds: 3 })
    expect(formatCardLine(answered)).toBe('<!-- card: RIV-41, 2026-10-13T11:45Z good, 2026-11-13T02:31Z good, 2026-11-16T09:00:00.123Z again 3s -->')
    // The phone's splice writes the same bytes.
    expect(spliceCardLine(old, parseCardLine(old)!, answered)).toBe(formatCardLine(answered))
    // A merge that adds nothing changes no byte; one that adds a review keeps the old reviews' bytes.
    expect(formatCardLine(withCardReviews(parseCardLine(old)!, cardReviewsOf(parseCardLine(old)!)))).toBe(old)
    expect(formatCardLine(withCardReviews(parseCardLine(old)!, [{ at: '2026-11-01T00:00:00.000Z', rating: 'good' }]))).toBe(
      '<!-- card: RIV-41, 2026-10-13T11:45Z good, 2026-11-01T00:00:00.000Z good, 2026-11-13T02:31Z good -->',
    )
  })

  it('Undo names an old review by its full time', () => {
    const l = line('RIV-41, 2026-10-13T11:45Z good, 2026-11-13T02:31Z good')
    expect(formatCardLine(withoutCardReview(l, '2026-11-13T02:31:00.000Z'))).toBe('<!-- card: RIV-41, 2026-10-13T11:45Z good -->')
  })
})

describe('each ISO 8601 form', () => {
  const cases: [string, string][] = [
    ['2026-11-15T05:24Z', '2026-11-15T05:24:00.000Z'],
    ['2026-11-15T05:24:07Z', '2026-11-15T05:24:07.000Z'],
    ['2026-11-15T05:24:07.5Z', '2026-11-15T05:24:07.500Z'],
    ['2026-11-15T05:24:07.25Z', '2026-11-15T05:24:07.250Z'],
    ['2026-11-15T05:24:07.123Z', '2026-11-15T05:24:07.123Z'],
    ['2026-11-15T05:24:07.123456Z', '2026-11-15T05:24:07.123Z'],
    ['2026-11-15T05:24+05:00', '2026-11-15T00:24:00.000Z'],
    ['2026-11-15T05:24:07-07:00', '2026-11-15T12:24:07.000Z'],
    ['2026-11-15T05:24:07.123+00:00', '2026-11-15T05:24:07.123Z'],
    ['2026-11-15T01:00+05:30', '2026-11-14T19:30:00.000Z'],
  ]
  for (const [written, at] of cases)
    it(`${written} reads as ${at}, and is written back as it was`, () => {
      const text = `<!-- card: WIKI-1, ${written} good 4s -->`
      const parsed = parseCardLine(text)!
      expect(cardReviewsOf(parsed)).toEqual([{ at, rating: 'good', seconds: 4 }])
      expect(formatCardLine(parsed)).toBe(text)
    })

  it('an invalid time stays an unknown part, kept as its text', () => {
    for (const bad of [
      '2026-02-30T05:24Z',
      '2026-13-01T05:24Z',
      '2026-11-15T24:00Z',
      '2026-11-15T05:60Z',
      '2026-11-15T05:24:60Z',
      '2026-11-15T05:24',
      '2026-11-15T05:24z',
      '2026-11-15T05:24+25:00',
      '2026-11-15T05:24+05:60',
      '2026-11-15T05:24:07.Z',
      '2026-11-15',
      '2026-11-15 05:24Z',
    ]) {
      const text = `<!-- card: WIKI-1, ${bad} good, 2026-11-15T15:39:41.802Z good -->`
      const parsed = parseCardLine(text)!
      expect(parsed.parts.map((p) => p.kind), bad).toEqual(['id', 'other', 'review'])
      expect(formatCardLine(parsed)).toBe(text)
    }
  })
})
