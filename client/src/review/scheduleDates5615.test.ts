/**
 * YAZ-5615 (checker c, against the YAZ-5611 rules): review dates and the schedule math. The shared code that the Mac
 * and the phone both run (`shared/cardSchedule.ts`, `cardWords.ts`, `cardInboxChip.tsx`): the next review of each
 * answer, local midnight, the day start, time zones (also the days that change the clock), with no React.
 *
 * The rules (YAZ-5611 spec, as amended by YAZ-5702 to Mochi's, YAZ-5703): FSRS gives whole days only; a new card's
 * first ✓ adds it to today's reviews and a ✕ comes back today; any other ✓ is done for today; the wait a button shows is the wait the written review gets (D13); "due" is due
 * before LOCAL midnight tonight; the day — the new-card limit, "Today: …" — is the device's local calendar day from
 * midnight, and Review does not use the tables' "Calendar day" setting (spec 21); the same log gives the same due date
 * on every device (D5). Made-up data only.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cardRecords, cardTime, type CardRating, type CardReview } from '@shared/cardLine'
import { cardHistory, cardPlan, cardState, isCardDue, previewAnswers, reviewedToday } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import { cardNextReview, cardOverdue, cardWait } from './cardWords'
import { cardStateText } from './cardInboxChip'

const DAY = 86_400_000
const S: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS }
const NO_FUZZ: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS, fuzz: false }
const FOUR: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS, buttons: 4 }
const at = (ms: number, rating: CardRating): CardReview => ({ at: cardTime(ms), rating })
/** Thursday 12 November 2026, 9:00 local time. */
const NOW = new Date(2026, 10, 12, 9, 0).getTime()
const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m, d, h, min, s, ms).getTime()
/** A known card: two ✓ long ago. */
const KNOWN = [at(Date.UTC(2026, 7, 1, 9), 'good'), at(Date.UTC(2026, 7, 2, 9), 'good')]

/** Answers `ratings` one after the other, `gap` ms apart from `start`: each step's preview, then the review written. */
function walk(ratings: CardRating[], s: ReviewSettings, start: number, gap = 20_000, from: CardReview[] = []) {
  const reviews = [...from]
  const steps: { rating: CardRating; shown: ReturnType<typeof previewAnswers>[number]; after: ReturnType<typeof cardState> }[] = []
  let now = start
  for (const rating of ratings) {
    const shown = previewAnswers(reviews, s, now).find((a) => a.review.rating === rating)!
    reviews.push(shown.review)
    steps.push({ rating, shown, after: cardState(reviews, s) })
    now += gap
  }
  return { reviews, steps }
}

describe('YAZ-5615: the next review of each answer (days only, as Mochi: YAZ-5702, YAZ-5703)', () => {
  it('a new card: ✕ and the first ✓ come back today ("later today"); the second ✓ gives days', () => {
    const shown = previewAnswers([], S, NOW)
    expect(shown.map((a) => [a.review.rating, a.comesBack])).toEqual([
      ['again', true],
      ['good', true],
    ])
    expect(shown.map((a) => cardWait(a.interval, a.comesBack))).toEqual(['later today', 'later today'])
    const { steps } = walk(['good', 'good'], S, NOW)
    expect(steps[1].shown.comesBack).toBe(false)
    expect(steps[1].shown.interval).toBeGreaterThanOrEqual(1)
    expect(cardWait(steps[1].shown.interval, false)).toMatch(/^\d+ days?$/)
  })

  it('a ✓ after a ✕ is done for today: days, never later today (only misses come back)', () => {
    const { steps } = walk(['good', 'again', 'good'], S, NOW)
    expect(steps.map((x) => x.after.comesBack)).toEqual([true, true, false])
    expect(steps[2].after.interval).toBeGreaterThanOrEqual(1)
    expect(isCardDue(steps[2].after.due!, NOW)).toBe(false)
  })

  it('a known card: ✕ comes back today (a lapse; FSRS gives whole days, no minutes); one ✓ then gives days', () => {
    const now = local(2026, 10, 12, 9)
    const { steps } = walk(['again', 'good'], S, now, 20_000, KNOWN)
    expect(steps[0].after).toMatchObject({ comesBack: true, lapses: 1 })
    expect(steps[0].after.interval).toBeGreaterThanOrEqual(1)
    expect(steps[1].after.comesBack).toBe(false)
    expect(steps[1].after.interval).toBeGreaterThanOrEqual(1)
    // A ✓ on the known card, not forgotten, gives more days than the ✓ after a lapse.
    const kept = previewAnswers(KNOWN, S, now).find((a) => a.review.rating === 'good')!
    expect(kept.comesBack).toBe(false)
    expect(kept.interval).toBeGreaterThan(steps[1].after.interval)
  })

  it('four buttons: Again ≤ Hard ≤ Good ≤ Easy, Again comes back today, the others give days on a known card', () => {
    const shown = previewAnswers(KNOWN, FOUR, local(2026, 10, 12, 9))
    expect(shown.map((a) => a.review.rating)).toEqual(['again', 'hard', 'good', 'easy'])
    expect(shown[0].comesBack).toBe(true)
    expect(shown.slice(1).every((a) => !a.comesBack && a.interval >= 1)).toBe(true)
    const days = shown.map((a) => a.interval)
    expect([...days].sort((a, b) => a - b)).toEqual(days)
  })

  it('Mochi`s simulator (YAZ-5703 E2), as shapes: every wait is whole days, never minutes; a ✕ gives 1 day, the ✓ after it a few days', () => {
    // Each answer on the day the card is due; a new card's first ✓ is "Added", its next review the same day.
    const run = (ratings: CardRating[]) => {
      const reviews: CardReview[] = []
      let now = NOW
      return ratings.map((rating) => {
        const shown = previewAnswers(reviews, NO_FUZZ, now).find((a) => a.review.rating === rating)!
        reviews.push(shown.review)
        const row = cardHistory(reviews, NO_FUZZ).at(-1)!
        now = shown.comesBack ? now + 20_000 : shown.due
        return shown.comesBack && rating !== 'again' ? 'Added' : row.interval
      })
    }
    const rr = run(['good', 'good'])
    expect(rr[0]).toBe('Added')
    expect(rr[1]).toBeGreaterThanOrEqual(3)
    const rrf = run(['good', 'good', 'again'])
    expect(rrf[2]).toBe(1)
    const rrfrr = run(['good', 'good', 'again', 'good', 'good'])
    expect(rrfrr[3]).toBeGreaterThanOrEqual(2)
    expect(rrfrr[4]).toBeGreaterThan(rrfrr[3] as number)
    const half = run(['good', 'again', 'good', 'good']) // half-learned: Added → 1 day → 3 days → more
    expect(half.slice(0, 2)).toEqual(['Added', 1])
    expect(half[2]).toBeGreaterThanOrEqual(2)
    expect(half[3]).toBeGreaterThan(half[2] as number)
    expect(run(['good', 'good', 'again', 'again', 'good']).slice(2, 4)).toEqual([1, 1])
    // No minutes anywhere: every wait FSRS gives is a whole number of days, at least 1.
    for (const xs of [rr, rrf, rrfrr, half]) for (const x of xs) if (x !== 'Added') expect(Number.isInteger(x) && x >= 1).toBe(true)
  })

  it('the wait a button shows is the wait the written review gets (D13), with fuzz on and off, on every step of long runs', () => {
    const runs: CardRating[][] = [
      ['good', 'good', 'good', 'good', 'good'],
      ['again', 'again', 'good', 'good', 'again', 'good', 'good'],
      ['good', 'again', 'good', 'good', 'good', 'again', 'good'],
    ]
    for (const s of [S, NO_FUZZ]) {
      for (const ratings of runs) {
        // A run over many days: each answer on the day the card is due (or 20 s later when it comes back today).
        const reviews: CardReview[] = []
        let now = NOW
        for (const rating of ratings) {
          const shown = previewAnswers(reviews, s, now).find((a) => a.review.rating === rating)!
          reviews.push(shown.review)
          const after = cardState(reviews, s)
          expect(after.due, `${ratings.join(' ')} @ ${shown.review.at}`).toBe(shown.due)
          expect(after.interval).toBe(shown.interval)
          expect(after.comesBack).toBe(shown.comesBack)
          // A card that comes back is due at its answer's time; else a wait of days is that many whole days.
          if (shown.comesBack) expect(shown.due).toBe(Date.parse(shown.review.at))
          else expect(shown.due - Date.parse(shown.review.at)).toBe(shown.interval * DAY)
          now = shown.comesBack ? now + 20_000 : shown.due
        }
        // The Reviews table replays the same dates (`cardHistory`).
        expect(cardHistory(reviews, s).at(-1)!.due).toBe(cardState(reviews, s).due)
      }
    }
  })

  it('a card that comes back (a ✕) is due now; a card with days is due on its day', () => {
    const { steps } = walk(['again'], S, NOW)
    expect(steps[0].after.comesBack).toBe(true)
    expect(isCardDue(steps[0].after.due!, NOW)).toBe(true)
    const known = cardState(KNOWN, S)
    expect(known.comesBack).toBe(false)
    expect(isCardDue(known.due!, known.due! - DAY)).toBe(false)
    expect(isCardDue(known.due!, known.due!)).toBe(true)
  })
})

describe('YAZ-5615: local midnight', () => {
  const tonight = local(2026, 10, 13)

  it('due before midnight tonight is due today; due at midnight is due tomorrow, and from 00:00 it is due', () => {
    expect(isCardDue(tonight - 1, NOW)).toBe(true)
    expect(isCardDue(tonight, NOW)).toBe(false)
    expect(isCardDue(tonight, tonight - 1)).toBe(false)
    expect(isCardDue(tonight, tonight)).toBe(true)
  })

  it('a ✓ at 23:59 with a wait of 1 day is due tomorrow, not tonight; the words say "tomorrow" until midnight, then "today"', () => {
    const late = local(2026, 10, 12, 23, 59)
    const due = late + DAY
    expect(isCardDue(due, late)).toBe(false)
    expect(isCardDue(due, tonight)).toBe(true)
    expect(cardNextReview(due, false, late).when).toBe('tomorrow')
    expect(cardNextReview(due, false, tonight).when).toBe('today')
    expect(cardOverdue(due, tonight)).toBe(false)
  })

  it('a card due last night at 23:00 reads "Due · 1 day ago" this morning, and is overdue', () => {
    const last = local(2026, 10, 11, 23)
    expect(cardStateText({ isNew: false, due: last }, NOW)).toBe('Due · 1 day ago')
    expect(cardStateText({ isNew: false, due: local(2026, 10, 12, 0) }, NOW)).toBe('Due today')
    expect(cardOverdue(last, NOW)).toBe(true)
    expect(cardNextReview(last, false, NOW).when).toBe('yesterday')
  })

  it('a card that comes back, missed at 23:50, is still due after midnight, and the next morning its words say "yesterday", not "later today"', () => {
    const late = local(2026, 10, 12, 23, 50)
    const { reviews } = walk(['again'], S, late)
    const after = cardState(reviews, S)
    expect(after.comesBack).toBe(true)
    expect(isCardDue(after.due!, tonight + 60_000)).toBe(true)
    expect(cardNextReview(after.due!, true, late).when).toBe('later today')
    expect(cardNextReview(after.due!, true, local(2026, 10, 13, 8)).when).toBe('yesterday')
  })

  it("today's work (a card answered: YAZ-5710) counts from 00:00 to 24:00 local; one at 23:59:59.999 is yesterday's", () => {
    const page = (...reviews: CardReview[]) => ({ cards: [{ id: 'A-1', reviews, off: false, next: false } as never] })
    const lastSecond = at(tonight - 1, 'good')
    const firstSecond = at(tonight, 'good')
    expect(reviewedToday([page(lastSecond)], tonight - 1).cards).toBe(1)
    expect(reviewedToday([page(lastSecond)], tonight).cards).toBe(0)
    expect(reviewedToday([page(firstSecond)], tonight).cards).toBe(1)
    expect(reviewedToday([page(firstSecond)], tonight - 1).cards).toBe(0)
  })

  it('the new-card limit starts again at midnight: cards begun at 23:50 use up tonight, not tomorrow', () => {
    const late = local(2026, 10, 12, 23, 50)
    const s: ReviewSettings = { ...S, newPerDay: 2 }
    const text = (line: string) => `\`\`\`card\nQ {{a}}\n\`\`\`\n<!-- card: ${line} -->`
    const begun = (id: string) => text(`${id}, ${cardTime(late)} good`)
    const content = [begun('NEW-1'), begun('NEW-2'), text('NEW-3'), text('NEW-4'), text('NEW-5')].join('\n\n')
    const records = [{ path: '/v/P.md', folder: '', cards: cardRecords(content) }]
    const ids = (now: number) => cardPlan(records, s, now).queue.filter((c) => c.isNew).map((c) => c.id)
    expect(ids(late + 5 * 60_000)).toEqual([])
    expect(ids(tonight)).toEqual(['NEW-3', 'NEW-4'])
  })
})

describe("YAZ-5615: the day start — Review's day starts at midnight (the tables' Calendar day is not Review's)", () => {
  it('a review at 04:30 is today\'s work and uses today\'s new cards, not yesterday\'s', () => {
    const early = local(2026, 10, 12, 4, 30)
    const content = `\`\`\`card\nQ {{a}}\n\`\`\`\n<!-- card: NEW-1, ${cardTime(early)} good -->\n\n\`\`\`card\nQ {{b}}\n\`\`\`\n<!-- card: NEW-2 -->`
    const records = [{ path: '/v/P.md', folder: '', cards: cardRecords(content) }]
    expect(reviewedToday(records, NOW).cards).toBe(1)
    expect(reviewedToday(records, local(2026, 10, 11, 23)).cards).toBe(0)
    // One new card a day: NEW-1, begun at 04:30, is today's; NEW-2 waits for tomorrow.
    const plan = cardPlan(records, { ...S, newPerDay: 1 }, NOW)
    expect(plan.queue.map((c) => c.id)).toEqual(['NEW-1'])
    expect(plan.more.new).toBe(1)
  })
})

describe('YAZ-5615: time zones', () => {
  const was = process.env.TZ
  afterEach(() => {
    if (was === undefined) delete process.env.TZ
    else process.env.TZ = was
  })
  /** Runs `run` with the device in time zone `tz`. */
  const inZone = <T>(tz: string, run: () => T): T => {
    process.env.TZ = tz
    return run()
  }

  it('the zone switch works in this test runner', () => {
    expect(inZone('UTC', () => new Date(Date.UTC(2026, 0, 1)).getHours())).toBe(0)
    expect(inZone('Asia/Tokyo', () => new Date(Date.UTC(2026, 0, 1)).getHours())).toBe(9)
    expect(inZone('America/Denver', () => new Date(Date.UTC(2026, 0, 1)).getHours())).toBe(17)
  })

  it('the same log gives the same due date and wait on every device, wherever it is (D5)', () => {
    const t0 = Date.UTC(2026, 10, 12, 16, 0)
    const log = [at(t0, 'good'), at(t0 + 60_000, 'again'), at(t0 + 120_000, 'good'), at(t0 + 180_000, 'good'), at(t0 + 9 * DAY, 'good'), at(t0 + 40 * DAY, 'again'), at(t0 + 40 * DAY + 60_000, 'good')]
    const zones = ['UTC', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Tokyo', 'Pacific/Kiritimati']
    for (const s of [S, NO_FUZZ]) {
      const rows = zones.map((tz) => inZone(tz, () => cardHistory(log, s).map((r) => [r.due, r.interval, r.comesBack])))
      for (const row of rows) expect(row).toEqual(rows[0])
    }
  })

  it('"due today" ends at the device\'s own midnight: one due date is due tonight in Denver and tomorrow in London', () => {
    const due = Date.UTC(2026, 10, 13, 5, 0) // 22:00 on the 12th in Denver; 05:00 on the 13th in London
    const evening = Date.UTC(2026, 10, 12, 21, 0) // 14:00 in Denver; 21:00 in London
    expect(inZone('America/Denver', () => isCardDue(due, evening))).toBe(true)
    expect(inZone('Europe/London', () => isCardDue(due, evening))).toBe(false)
  })

  it("an answer at 23:30 in Denver (06:30 UTC the next day) is today's work and today's new card in Denver", () => {
    inZone('America/Denver', () => {
      const late = local(2026, 10, 12, 23, 30)
      expect(cardTime(late).slice(0, 10)).toBe('2026-11-13')
      const content = `\`\`\`card\nQ {{a}}\n\`\`\`\n<!-- card: NEW-1, ${cardTime(late)} good -->\n\n\`\`\`card\nQ {{b}}\n\`\`\`\n<!-- card: NEW-2 -->`
      const records = [{ path: '/v/P.md', folder: '', cards: cardRecords(content) }]
      const now = local(2026, 10, 12, 23, 45)
      expect(reviewedToday(records, now).cards).toBe(1)
      expect(cardPlan(records, { ...S, newPerDay: 1 }, now).queue.map((c) => c.id)).toEqual(['NEW-1'])
      // The next morning in Denver it is yesterday's.
      expect(reviewedToday(records, local(2026, 10, 13, 8)).cards).toBe(0)
      expect(cardPlan(records, { ...S, newPerDay: 1 }, local(2026, 10, 13, 8)).queue.map((c) => c.id)).toEqual(['NEW-1', 'NEW-2'])
    })
  })

  it('a day of 23 hours (the clock goes forward) and of 25 hours (back): midnight, today\'s work and the day words hold', () => {
    for (const [tz, y, m, d] of [
      ['America/Denver', 2026, 2, 8],
      ['America/Denver', 2026, 10, 1],
      ['Europe/London', 2026, 2, 29],
      ['Europe/London', 2026, 9, 25],
      ['Australia/Sydney', 2026, 3, 5],
    ] as const) {
      inZone(tz, () => {
        const start = local(y, m, d)
        const end = local(y, m, d + 1)
        expect([23, 24, 25]).toContain((end - start) / 3_600_000)
        const noon = local(y, m, d, 12)
        expect(isCardDue(end - 1, noon)).toBe(true)
        expect(isCardDue(end, noon)).toBe(false)
        const page = (ms: number) => ({ cards: [{ id: 'A-1', reviews: [at(ms, 'good')], off: false, next: false } as never] })
        expect(reviewedToday([page(start)], noon).cards).toBe(1)
        expect(reviewedToday([page(end - 1)], noon).cards).toBe(1)
        expect(reviewedToday([page(end)], noon).cards).toBe(0)
        // A card due at 08:00 the next morning is "tomorrow"; one due at 08:00 the day before is "yesterday", "1 day ago".
        expect(cardNextReview(local(y, m, d + 1, 8), false, noon).when).toBe('tomorrow')
        expect(cardNextReview(local(y, m, d - 1, 8), false, noon).when).toBe('yesterday')
        expect(cardStateText({ isNew: false, due: local(y, m, d - 1, 8) }, noon)).toBe('Due · 1 day ago')
        expect(cardNextReview(local(y, m, d + 7, 8), false, noon).when).toBe('in 7 days')
      })
    }
  })
})
