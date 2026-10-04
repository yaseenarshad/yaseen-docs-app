/**
 * `shared/schedule.ts` (YAZ-2322): the upkeep rule and the queue, against scenario tables A and B
 * of the decision record. Lives under client/src so vitest collects it; the module is shared.
 */
import { describe, expect, it } from 'vitest'
import type { ReviewEntry } from '@shared/reviews'
import { DEFAULT_REVIEW_SETTINGS as S } from '@shared/reviews'
import { dueAfter, dueAt, isInReview, reviewQueue, scheduleInWords } from '@shared/schedule'
import type { IndexRecord } from '@shared/types'

const DAY = 86_400_000
const CHANGED = Date.parse('2026-01-10T12:00:00Z')
const days = (from: number, to: number): number => (to - from) / DAY
const keep = (at: string, text = 'aaaaaaaa'): ReviewEntry => ({ at, rating: 'keep', text })
const at = (day: number): string => new Date(Date.parse('2026-03-01T12:00:00Z') + day * DAY).toISOString().replace('.000Z', 'Z')
const card = (reviews: ReviewEntry[], text = 'aaaaaaaa') => ({ mtime: CHANGED, reviews, text })

describe('dueAt (30 / 2 / 365)', () => {
  it('a notecard never reviewed is due 30 days after it last changed', () => {
    expect(days(CHANGED, dueAt(card([]), S))).toBe(30)
  })

  it('each review in a row on the same text doubles the wait, up to the longest', () => {
    const waits = [1, 2, 3, 4, 5].map((n) => {
      const reviews = Array.from({ length: n }, (_, i) => keep(at(i)))
      return days(Date.parse(at(n - 1)), dueAt(card(reviews), S))
    })
    expect(waits).toEqual([60, 120, 240, 365, 365])
  })

  it('a body edited since the last review is due 30 days after the edit', () => {
    expect(days(CHANGED, dueAt(card([keep(at(0)), keep(at(60))], 'bbbbbbbb'), S))).toBe(30)
  })

  it('the streak counts only the reviews since the text last changed', () => {
    const reviews = [keep(at(0), 'old'), keep(at(60), 'old'), keep(at(90), 'mid'), keep(at(120))]
    expect(days(Date.parse(at(120)), dueAt(card(reviews), S))).toBe(60)
  })

  it('text changed back to what the last review saw counts as unchanged', () => {
    const reviews = [keep(at(0)), keep(at(60), 'mid'), keep(at(90))]
    expect(days(Date.parse(at(90)), dueAt(card(reviews), S))).toBe(60)
  })

  it('growth of 1 is a fixed rotation', () => {
    const fixed = { ...S, baseDays: 7, growth: 1 }
    expect(days(Date.parse(at(1)), dueAt(card([keep(at(0)), keep(at(1))]), fixed))).toBe(7)
  })

  it('dueAfter is the date a review set when it was written', () => {
    const reviews = [keep(at(0), 'old'), keep(at(60), 'old'), keep(at(90))]
    expect(days(Date.parse(at(60)), dueAfter(reviews, 1, S))).toBe(120)
    expect(days(Date.parse(at(90)), dueAfter(reviews, 2, S))).toBe(60)
  })
})

describe('scheduleInWords', () => {
  it('says each wait until the longest: 30 / 2 / 365', () => {
    expect(scheduleInWords(S)).toBe('30 days, then 60, 120, 240, 365.')
  })

  it('a wait that never grows is a fixed rotation', () => {
    expect(scheduleInWords({ ...S, growth: 1 })).toBe('Every 30 days.')
    expect(scheduleInWords({ ...S, baseDays: 90, maxDays: 90 })).toBe('Every 90 days.')
  })

  it('stops listing after six waits and names the longest, so a slow growth is still one line', () => {
    expect(scheduleInWords({ ...S, growth: 1.01 })).toBe('30 days, then 30, 31, 31, 31, 32, … up to 365.')
    expect(scheduleInWords({ ...S, baseDays: 1, maxDays: 365 })).toBe('1 day, then 2, 4, 8, 16, 32, … up to 365.')
  })

  it('says a fractional wait to the nearest day, and one day as one', () => {
    expect(scheduleInWords({ ...S, growth: 1.5, maxDays: 100 })).toBe('30 days, then 45, 68, 100.')
    expect(scheduleInWords({ ...S, baseDays: 1, maxDays: 5 })).toBe('1 day, then 2, 4, 5.')
  })
})

function record(over: Partial<IndexRecord> & { path: string }): IndexRecord {
  const name = over.path.split('/').pop() ?? ''
  return { name, basename: name.replace(/\.md$/, ''), folder: '', ext: 'md', size: 1, ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [], text: 'aaaaaaaa', ...over }
}

describe('isInReview', () => {
  const off = { ...S, reviewByDefault: false }

  it('follows the vault default unless the notecard says true or false', () => {
    expect(isInReview(record({ path: '/v/a.md' }), S)).toBe(true)
    expect(isInReview(record({ path: '/v/a.md' }), off)).toBe(false)
    expect(isInReview(record({ path: '/v/a.md', properties: { review: false } }), S)).toBe(false)
    expect(isInReview(record({ path: '/v/a.md', properties: { review: true } }), off)).toBe(true)
    expect(isInReview(record({ path: '/v/a.md', properties: { review: 'no' } }), S)).toBe(true)
  })

  it('leaves out a notecard a review could not be written into', () => {
    expect(isInReview(record({ path: '/v/a.md', frontmatterError: 'bad yaml' }), S)).toBe(false)
    expect(isInReview(record({ path: '/v/a.md', text: undefined }), S)).toBe(false)
  })
})

describe('reviewQueue', () => {
  // Local times on purpose: "due today" is the local calendar day.
  const NOW = new Date(2026, 5, 15, 9, 0).getTime()
  const dueOn = (path: string, when: Date, over: Partial<IndexRecord> = {}): IndexRecord => record({ path, mtime: when.getTime() - S.baseDays * DAY, ...over })

  it('holds what falls due before local midnight tonight, most overdue first', () => {
    const records = [
      dueOn('/v/tonight.md', new Date(2026, 5, 15, 23, 0)),
      dueOn('/v/tomorrow.md', new Date(2026, 5, 16, 0, 30)),
      dueOn('/v/last-week.md', new Date(2026, 5, 8, 9, 0)),
      dueOn('/v/yesterday.md', new Date(2026, 5, 14, 9, 0)),
    ]
    expect(reviewQueue(records, S, NOW).map((r) => r.basename)).toEqual(['last-week', 'yesterday', 'tonight'])
  })

  it('orders equal due times by path', () => {
    const when = new Date(2026, 5, 1)
    expect(reviewQueue([dueOn('/v/b.md', when), dueOn('/v/a.md', when)], S, NOW).map((r) => r.basename)).toEqual(['a', 'b'])
  })

  it('leaves out a notecard that is not in review', () => {
    const when = new Date(2026, 5, 1)
    expect(reviewQueue([dueOn('/v/off.md', when, { properties: { review: false } }), dueOn('/v/broken.md', when, { frontmatterError: 'x' })], S, NOW)).toEqual([])
  })

  it('a folder takes its own notecards and its subfolders, not a sibling that starts the same', () => {
    const when = new Date(2026, 5, 1)
    const records = [
      dueOn('/v/root.md', when),
      dueOn('/v/notes/a.md', when, { folder: 'notes' }),
      dueOn('/v/notes/deep/b.md', when, { folder: 'notes/deep' }),
      dueOn('/v/notes-old/c.md', when, { folder: 'notes-old' }),
    ]
    expect(reviewQueue(records, S, NOW, 'notes').map((r) => r.basename)).toEqual(['a', 'b'])
    expect(reviewQueue(records, S, NOW, '')).toHaveLength(4)
    expect(reviewQueue(records, S, NOW)).toHaveLength(4)
  })
})
