import { describe, expect, it } from 'vitest'
import type { FriendStats } from './friendStatsFormat'
import type { FriendBoardMember } from './friendsApi'
import { computeBuddyEmojis, dailyMarkOf, sevenDayChain, smartMarkSuggestion, sortLeaderboard } from './friendsBoard'

const makeStats = (day: string, cards: number, seconds: number, streak: number, done: boolean): FriendStats => ({
  v: 1,
  login: 'u',
  name: 'U',
  avatar: '',
  days: [{ day, cards, seconds, remembered: cards, forgot: 0, newCards: 1, done }],
  totals: { cards: 50, inReview: 40, newLeft: 10, mature: 20, dueLeft: done ? 0 : 4, addedThisWeek: 5, streak, bestStreak: streak, bestDay: cards, bestWeek: cards },
  at: '2026-11-21T12:00:00.000Z',
})

describe('shared/friendsBoard (YAZ-6217)', () => {
  it('sorts by Status first, then Cards (default), Time, or Streak', () => {
    const rows = [
      { name: 'Sam', mark: 'started' as const, cards: 80, seconds: 3600, streak: 50 },
      { name: 'Maya', mark: 'finished' as const, cards: 25, seconds: 1800, streak: 30 },
      { name: 'You', mark: 'finished' as const, cards: 60, seconds: 900, streak: 10 },
    ]
    expect(sortLeaderboard(rows, 'cards').map((r) => r.name)).toEqual(['You', 'Maya', 'Sam'])
    expect(sortLeaderboard(rows, 'time').map((r) => r.name)).toEqual(['Maya', 'You', 'Sam'])
    expect(sortLeaderboard(rows, 'streak').map((r) => r.name)).toEqual(['Maya', 'You', 'Sam'])
  })

  it('computes Study Buddy Emojis and Streak-at-Risk accurately', () => {
    const now = Date.parse('2026-11-21T18:00:00Z')
    const me = { stats: makeStats('2026-11-21', 30, 600, 14, true) }
    const friend: FriendBoardMember = {
      id: 2,
      login: 'sam',
      name: 'Sam',
      avatarUrl: null,
      since: '2026-09-01T00:00:00Z',
      stats: makeStats('2026-11-21', 10, 300, 9, false),
      statsAt: '2026-11-21T17:00:00Z',
      incomingMark: { kind: 'cheer', at: '2026-11-21T12:00:00Z', seenAt: null },
      outgoingMark: null,
      sharedCardCount: 12,
    }
    const emojis = computeBuddyEmojis(friend, me, [friend], now).map((e) => e.emoji)
    expect(emojis).toContain('🔥')
    expect(emojis).toContain('⏳')
    expect(emojis).toContain('💕')
    expect(dailyMarkOf(friend.stats, now)).toBe('started')
  })

  it('builds 7-day Seinfeld chain and streak-aware Cheer/Nudge suggestions', () => {
    const now = Date.parse('2026-11-21T18:00:00Z')
    const stats = makeStats('2026-11-21', 20, 400, 14, true)
    const chain = sevenDayChain(stats, now)
    expect(chain).toHaveLength(7)
    expect(chain[6]).toBe('done')

    const cheer = smartMarkSuggestion({ name: 'Maya', stats }, now)
    expect(cheer.kind).toBe('cheer')
    expect(cheer.buttonLabel).toContain('14d')

    const nudge = smartMarkSuggestion({ name: 'Sam', stats: makeStats('2026-11-21', 0, 0, 9, false) }, now)
    expect(nudge.kind).toBe('nudge')
    expect(nudge.buttonLabel).toContain('9d')
  })
})
