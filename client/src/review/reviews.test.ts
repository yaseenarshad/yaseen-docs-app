/**
 * `shared/reviews.ts` (YAZ-2322): a note's review log lives under the reserved frontmatter key
 * `reviews`, one line per review, and a vault's schedule numbers live in `.yaseendocs/review.json`.
 * Lives under client/src so vitest collects it; the module is shared.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REVIEW_SETTINGS,
  ReviewsShapeError,
  addReview,
  deleteReview,
  resetReviews,
  reviewEntries,
  reviewsOf,
  sanitizeReviewSettings,
  setInReview,
  textFingerprint,
} from '@shared/reviews'

const AT = '2026-10-04T14:02:11Z'
const LATER = '2026-11-03T09:00:00Z'
const BODY = '# Rates\n\nA ratio compares two quantities.\n'
const MARK = textFingerprint(BODY)

describe('textFingerprint', () => {
  it('is eight lowercase hex characters, the same for the same text', () => {
    expect(MARK).toMatch(/^[0-9a-f]{8}$/)
    expect(textFingerprint(BODY)).toBe(MARK)
  })

  it('ignores line-ending style and blank space around the text', () => {
    expect(textFingerprint(BODY.replace(/\n/g, '\r\n'))).toBe(MARK)
    expect(textFingerprint(`\n\n${BODY}\n\n  `)).toBe(MARK)
  })

  it('changes when one character changes', () => {
    expect(textFingerprint(BODY.replace('two', 'ten'))).not.toBe(MARK)
  })

  it('gives an empty body a fingerprint too', () => {
    expect(textFingerprint('')).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('addReview', () => {
  it('gives a note with no frontmatter a block holding one line per review', () => {
    expect(addReview(BODY, AT)).toBe(`---\nreviews:\n  - {at: ${AT}, rating: keep, text: ${quoted(MARK)}}\n---\n${BODY}`)
  })

  it('keeps every other byte of an existing block and appends after an existing log', () => {
    const once = addReview(`---\ntitle: Rates # mine\ntags: [math]\n---\n${BODY}`, AT)
    expect(once).toBe(`---\ntitle: Rates # mine\ntags: [math]\nreviews:\n  - {at: ${AT}, rating: keep, text: ${quoted(MARK)}}\n---\n${BODY}`)
    const twice = addReview(once, LATER)
    expect(reviewsOf(twice).map((r) => r.at)).toEqual([AT, LATER])
    expect(twice.split('\n').filter((l) => l.startsWith('  - {'))).toHaveLength(2)
  })

  it('records the fingerprint of the body it is written into', () => {
    expect(reviewsOf(addReview('Changed text\n', AT))[0].text).toBe(textFingerprint('Changed text\n'))
  })

  it('refuses a `reviews` value that is not a list, and frontmatter that does not parse', () => {
    expect(() => addReview(`---\nreviews: yes\n---\n${BODY}`, AT)).toThrow(ReviewsShapeError)
    expect(() => addReview(`---\ntitle: [unclosed\n---\n${BODY}`, AT)).toThrow(ReviewsShapeError)
  })
})

describe('reading the log', () => {
  const content = `---\nreviews:\n  - {at: ${LATER}, rating: keep, text: ${MARK}}\n  - {rating: keep}\n  - {at: not a date, rating: keep}\n  - just a string\n  - {at: ${AT}, rating: good, text: 12345678, stability: 3.2}\n---\n${BODY}`

  it('drops entries with a missing or unreadable `at` and returns the rest in time order', () => {
    expect(reviewsOf(content).map((r) => r.at)).toEqual([AT, LATER])
  })

  it('carries an unknown rating, reads a non-string `text` as empty, and leaves extra keys in the file', () => {
    expect(reviewsOf(content)[0]).toEqual({ at: AT, rating: 'good', text: '' })
  })

  it('reads a non-list as no reviews', () => {
    expect(reviewEntries('yes')).toEqual([])
    expect(reviewEntries(undefined)).toEqual([])
    expect(reviewsOf(BODY)).toEqual([])
  })
})

describe('deleteReview and resetReviews', () => {
  const two = addReview(addReview(`---\ntitle: Rates\n---\n${BODY}`, AT), LATER)

  it('removes exactly the named review and leaves the other as it was', () => {
    const one = deleteReview(two, AT)
    expect(reviewsOf(one).map((r) => r.at)).toEqual([LATER])
    expect(deleteReview(two, '2020-01-01T00:00:00Z')).toBe(two)
  })

  it('removes the key with the last review, leaving no empty list behind', () => {
    expect(deleteReview(deleteReview(two, AT), LATER)).toBe(`---\ntitle: Rates\n---\n${BODY}`)
  })

  it('a write keeps entries it does not understand and keys it does not know', () => {
    const mixed = `---\nreviews:\n  - just a string\n  - {at: ${AT}, rating: good, text: ${MARK}, stability: 3.2}\n---\n${BODY}`
    expect(deleteReview(mixed, AT)).toContain('- just a string')
    expect(addReview(mixed, LATER)).toContain(`- {at: ${AT}, rating: good, text: ${quoted(MARK)}, stability: 3.2}`)
  })

  it('reset removes the whole log', () => {
    expect(resetReviews(two)).toBe(`---\ntitle: Rates\n---\n${BODY}`)
    expect(() => resetReviews(`---\nreviews: yes\n---\n${BODY}`)).toThrow(ReviewsShapeError)
  })
})

describe('setInReview', () => {
  const on = DEFAULT_REVIEW_SETTINGS
  const off = { ...DEFAULT_REVIEW_SETTINGS, reviewByDefault: false }

  it('writes the flag only when it differs from the vault default, and keeps the log either way', () => {
    const reviewed = addReview(BODY, AT)
    expect(setInReview(reviewed, false, on)).toContain('review: false')
    expect(reviewsOf(setInReview(reviewed, false, on))).toHaveLength(1)
    expect(setInReview(setInReview(reviewed, false, on), true, on)).toBe(reviewed)
    expect(setInReview(BODY, true, off)).toBe(`---\nreview: true\n---\n${BODY}`)
    expect(setInReview(`---\nreview: true\n---\n${BODY}`, false, off)).toBe(`---\n---\n${BODY}`)
  })
})

describe('sanitizeReviewSettings', () => {
  it('gives the defaults for a missing or malformed file: upkeep is off', () => {
    for (const raw of [undefined, null, 'text', [], {}]) expect(sanitizeReviewSettings(raw)).toEqual(DEFAULT_REVIEW_SETTINGS)
    expect(DEFAULT_REVIEW_SETTINGS).toEqual({ algorithm: 'upkeep', enabled: false, baseDays: 30, growth: 2, maxDays: 365, reviewByDefault: true })
  })

  it('a review.json with no `enabled`, or one that is not true or false, is off; the other fields still fall back one by one', () => {
    expect(sanitizeReviewSettings({ baseDays: 7 })).toEqual({ ...DEFAULT_REVIEW_SETTINGS, enabled: false, baseDays: 7 })
    for (const enabled of ['true', 'yes', 1, 0, null, [], {}]) expect(sanitizeReviewSettings({ enabled, baseDays: 7, growth: 'fast' })).toEqual({ ...DEFAULT_REVIEW_SETTINGS, enabled: false, baseDays: 7 })
    expect(sanitizeReviewSettings({ enabled: true }).enabled).toBe(true)
    expect(sanitizeReviewSettings({ enabled: false }).enabled).toBe(false)
  })

  it('keeps good values and falls back field by field on bad ones', () => {
    expect(sanitizeReviewSettings({ enabled: true, baseDays: 7, growth: 1, maxDays: 90, reviewByDefault: false })).toEqual({ algorithm: 'upkeep', enabled: true, baseDays: 7, growth: 1, maxDays: 90, reviewByDefault: false })
    expect(sanitizeReviewSettings({ enabled: 'on', baseDays: 0, growth: 0.5, maxDays: 'long', reviewByDefault: 'no', algorithm: 'fsrs' })).toEqual(DEFAULT_REVIEW_SETTINGS)
    expect(sanitizeReviewSettings({ baseDays: 7.5 }).baseDays).toBe(30)
  })

  it('never lets the longest wait be shorter than the first', () => {
    expect(sanitizeReviewSettings({ baseDays: 400 }).maxDays).toBe(400)
    expect(sanitizeReviewSettings({ baseDays: 60, maxDays: 10 }).maxDays).toBe(365)
  })
})

/** YAML quotes a fingerprint that would otherwise read as a number (`12345678`, `1e5`). */
function quoted(mark: string): string {
  return /^\d+(e\d+)?$/.test(mark) ? `"${mark}"` : mark
}
