import { describe, expect, it } from 'vitest'
import type { CardRating, CardRecord } from './cardLine'
import { friendStats, type FriendVault } from './friendStats'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from './reviews'

const S = DEFAULT_REVIEW_SETTINGS
const NOW = Date.parse('2026-11-13T20:00:00.000Z')

type R = [at: string, rating: CardRating, seconds?: number]
const card = (id: string | null, reviews: R[], more: Partial<CardRecord> = {}): CardRecord => ({
  id,
  off: false,
  next: false,
  reviews: reviews.map(([at, rating, seconds]) => ({ at, rating, ...(seconds !== undefined && { seconds }) })),
  ...more,
})
const vault = (cards: CardRecord[], settings: ReviewSettings = S): FriendVault => ({ pages: [{ cards }], settings })

describe('friendStats bug fixes (YAZ-6284)', () => {
  it('skips vaults with settings.enabled === false before counting cards, seconds, totals, and streak', () => {
    const disabled = vault(
      [
        card('OFF-1', [
          ['2026-11-10T15:00:00.000Z', 'good', 20],
          ['2026-11-13T15:00:00.000Z', 'good', 30],
        ]),
      ],
      { ...S, enabled: false },
    )
    const enabled = vault([card('ON-1', [['2026-11-13T15:00:00.000Z', 'good', 12]])], { ...S, enabled: true })

    const onlyDisabled = friendStats([disabled], NOW, 'UTC')
    expect(onlyDisabled.totals.cards).toBe(0)
    expect(onlyDisabled.totals.streak).toBe(0)
    expect(onlyDisabled.days[0]).toMatchObject({ day: '2026-11-13', cards: 0, seconds: 0 })

    const mixed = friendStats([disabled, enabled], NOW, 'UTC')
    expect(mixed.totals.cards).toBe(1)
    expect(mixed.days[0]).toMatchObject({ day: '2026-11-13', cards: 1, seconds: 12 })
    expect(mixed.days).toHaveLength(1)
  })

  it('deduplicates card IDs per page before counting cards[i], seconds[i], totals, and dueLeft', () => {
    const dup = card('GEO-1', [['2026-11-13T15:00:00.000Z', 'good', 15]])
    const s = friendStats([vault([dup, dup, dup])], NOW, 'UTC')
    expect(s.totals.cards).toBe(1)
    expect(s.totals.inReview).toBe(1)
    expect(s.days[0]).toMatchObject({ cards: 1, seconds: 15, remembered: 1, newCards: 1 })
  })

  it('excludes again-only New cards from undone and dueLeft (matching Inbox isNewCard 1:1)', () => {
    // Card answered ONLY 'again' 3 days ago -> still a New card, never learned -> must NOT count as dueLeft or break streak!
    const againOnly = card('NEW-1', [
      ['2026-11-10T15:00:00.000Z', 'again', 5],
      ['2026-11-10T15:01:00.000Z', 'again', 5],
    ])
    const s1 = friendStats([vault([againOnly])], NOW, 'UTC')
    expect(s1.totals.dueLeft).toBe(0)
    expect(s1.days.every((d) => d.done)).toBe(true)

    // Card answered 'again' on Nov 10, then finally learned ('good') on Nov 12 -> must NOT mark Nov 11 or Nov 12 as undone!
    const learnedLater = card('NEW-2', [
      ['2026-11-10T15:00:00.000Z', 'again', 5],
      ['2026-11-12T15:00:00.000Z', 'good', 10],
      ['2026-11-12T15:02:00.000Z', 'good', 10],
    ])
    const s2 = friendStats([vault([learnedLater])], NOW, 'UTC')
    expect(s2.days.find((d) => d.day === '2026-11-11')?.done).toBe(true)
    expect(s2.days.find((d) => d.day === '2026-11-12')?.done).toBe(true)
    expect(s2.days.find((d) => d.day === '2026-11-13')?.done).toBe(true)
    expect(s2.totals.dueLeft).toBe(0)
  })
})
