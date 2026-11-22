import { describe, expect, it } from 'vitest'
import type { FriendDay, FriendStats } from './friendStatsFormat'
import {
  average7Day,
  buildPeriodGoalHero,
  computeBuddyStreak,
  computeGroupStreak,
  dailyMarkOf,
  displayNameFor,
  firstNameOf,
  periodConsistency,
  periodContext,
  sinceDayKey,
  sortLeaderboard,
} from './friendsBoard'

function makeDay(day: string, done: boolean, cards = done ? 20 : 0): FriendDay {
  return { day, cards, seconds: cards * 25, remembered: cards, forgot: 0, newCards: 2, done }
}

function makeStats(day: string, cards: number, seconds: number, streak: number, done: boolean): FriendStats {
  return {
    v: 1,
    login: 'u',
    name: 'U',
    avatar: '',
    days: [{ day, cards, seconds, remembered: cards, forgot: 0, newCards: 2, done }],
    totals: { cards: 100, inReview: 80, newLeft: 20, mature: 40, dueLeft: done ? 0 : 4, addedThisWeek: 5, streak, bestStreak: streak, bestDay: cards, bestWeek: cards },
    at: `${day}T12:00:00Z`,
  }
}

describe('friendsBoard shared helpers (YAZ-6200, YAZ-6222)', () => {
  const now = Date.parse('2026-11-21T18:00:00Z')

  it('sorts leaderboard by Status (✓ → ◐ → ○) then active metric (Cards | Time | Streak)', () => {
    const rows = [
      { id: 1, login: 'a', name: 'A', avatarUrl: null, isMe: false, stats: makeStats('2026-11-21', 50, 900, 3, false), mark: dailyMarkOf(makeStats('2026-11-21', 50, 900, 3, false), now), cards: 50, seconds: 900, streak: 3 },
      { id: 2, login: 'b', name: 'B', avatarUrl: null, isMe: false, stats: makeStats('2026-11-21', 25, 1800, 21, true), mark: 'finished' as const, cards: 25, seconds: 1800, streak: 21 },
      { id: 3, login: 'c', name: 'C', avatarUrl: null, isMe: true, stats: makeStats('2026-11-21', 42, 1080, 14, true), mark: 'finished' as const, cards: 42, seconds: 1080, streak: 14 },
    ]
    expect(sortLeaderboard(rows, 'cards').map((r) => r.name)).toEqual(['C', 'B', 'A'])
    expect(sortLeaderboard(rows, 'time').map((r) => r.name)).toEqual(['B', 'C', 'A'])
    expect(sortLeaderboard(rows, 'streak').map((r) => r.name)).toEqual(['B', 'C', 'A'])
  })

  it('computeBuddyStreak counts consecutive mutually done days and preserves streak when today is still open', () => {
    const me = [makeDay('2026-11-21', true), makeDay('2026-11-20', true), makeDay('2026-11-19', true)]
    const friendDoneToday = [makeDay('2026-11-21', true), makeDay('2026-11-20', true), makeDay('2026-11-19', true)]
    expect(computeBuddyStreak(me, friendDoneToday, now)).toBe(3)

    const friendOpenToday = [makeDay('2026-11-21', false, 5), makeDay('2026-11-20', true), makeDay('2026-11-19', true)]
    expect(computeBuddyStreak(me, friendOpenToday, now)).toBe(2)

    const friendMissedYesterday = [makeDay('2026-11-21', false, 0), makeDay('2026-11-20', false, 0), makeDay('2026-11-19', true)]
    expect(computeBuddyStreak(me, friendMissedYesterday, now)).toBe(0)
  })

  it('computeBuddyStreak & computeGroupStreak stay timezone-safe across UTC-7 vs UTC+0 date rollover', () => {
    // UTC+0 friend already rolled over into 2026-11-22 (not finished yet),
    // while UTC-7 friend is still on 2026-11-21 (finished 11/21, 11/20, 11/19).
    const utc0 = [makeDay('2026-11-22', false, 0), makeDay('2026-11-21', true), makeDay('2026-11-20', true), makeDay('2026-11-19', true)]
    const utcMinus7 = [makeDay('2026-11-21', true), makeDay('2026-11-20', true), makeDay('2026-11-19', true)]
    expect(computeBuddyStreak(utcMinus7, utc0, Date.parse('2026-11-22T02:00:00Z'))).toBe(3)

    // Both friends haven't finished their own "today" yet across a date boundary (11/22 open vs 11/21 open),
    // but both finished 11/20 and 11/19 -> streak stays alive at 2!
    const utcMinus7Open = [makeDay('2026-11-21', false, 4), makeDay('2026-11-20', true), makeDay('2026-11-19', true)]
    const utc0Open = [makeDay('2026-11-22', false, 0), makeDay('2026-11-21', true), makeDay('2026-11-20', true), makeDay('2026-11-19', true)]
    expect(computeBuddyStreak(utcMinus7Open, utc0Open, Date.parse('2026-11-22T02:00:00Z'))).toBe(2)

    // Group streak across 3 members spanning UTC-7, UTC+0, and UTC+9
    const utcPlus9 = [makeDay('2026-11-22', true), makeDay('2026-11-21', true), makeDay('2026-11-20', true), makeDay('2026-11-19', true)]
    expect(computeGroupStreak([utcMinus7, utc0, utcPlus9], Date.parse('2026-11-22T02:00:00Z'))).toBe(3)
    expect(computeGroupStreak([utcMinus7Open, utc0Open, utcPlus9], Date.parse('2026-11-22T02:00:00Z'))).toBe(2)
  })

  it('average7Day divides by actual calendar span and excludes unstarted today when prior days exist', () => {
    const base = makeStats('2026-11-21', 14, 350, 1, true)
    // Brand new user (1 day) -> divides by 1, not 7
    expect(average7Day(base, now)).toEqual({ cards: 14, seconds: 350 })

    // 3 days of history, today unstarted (cards: 0, done: false) -> excludes today, divides by 3
    const unstartedToday: FriendStats = {
      ...base,
      days: [
        makeDay('2026-11-21', false, 0),
        makeDay('2026-11-20', true, 30),
        makeDay('2026-11-19', true, 20),
        makeDay('2026-11-18', true, 10),
      ],
    }
    expect(average7Day(unstartedToday, now)).toEqual({ cards: 20, seconds: 500 })

    // 3 prior days + today started -> includes today, divides by 4
    const startedToday: FriendStats = {
      ...base,
      days: [
        makeDay('2026-11-21', false, 20),
        makeDay('2026-11-20', true, 30),
        makeDay('2026-11-19', true, 20),
        makeDay('2026-11-18', true, 10),
      ],
    }
    expect(average7Day(startedToday, now)).toEqual({ cards: 20, seconds: 500 })

    // 8 prior days + today unstarted -> excludes today, caps span at 7 prior days
    const longHistory: FriendStats = {
      ...base,
      days: [
        makeDay('2026-11-21', false, 0),
        makeDay('2026-11-20', true, 10),
        makeDay('2026-11-19', true, 10),
        makeDay('2026-11-18', true, 10),
        makeDay('2026-11-17', true, 10),
        makeDay('2026-11-16', true, 10),
        makeDay('2026-11-15', true, 10),
        makeDay('2026-11-14', true, 10),
        makeDay('2026-11-13', true, 100),
      ],
    }
    expect(average7Day(longHistory, now)).toEqual({ cards: 10, seconds: 250 })
  })

  it('sinceDayKey parses ISO timestamps and YYYY-MM-DD keys safely', () => {
    expect(sinceDayKey('2026-11-15')).toBe('2026-11-15')
    expect(sinceDayKey('2026-11-15T18:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(sinceDayKey(null)).toBeNull()
    expect(sinceDayKey('not-a-date')).toBeNull()
  })

  it('firstNameOf clips multi-word names, trims whitespace, and falls back to login (YAZ-6298)', () => {
    expect(firstNameOf('Yaseen Arshad', 'yaseen')).toBe('Yaseen')
    expect(firstNameOf('Maya', 'maya-gh')).toBe('Maya')
    expect(firstNameOf('   Samir   Patel   ', 'samir')).toBe('Samir')
    expect(firstNameOf('Elena\tRodriguez', 'elena')).toBe('Elena')
    expect(firstNameOf('', 'yaseen')).toBe('yaseen')
    expect(firstNameOf('   ', 'yaseen')).toBe('yaseen')
    expect(firstNameOf(null, 'yaseen')).toBe('yaseen')
    expect(firstNameOf(undefined, 'yaseen')).toBe('yaseen')
  })

  it('displayNameFor preserves custom nickname as-typed and falls back to firstNameOf (YAZ-6298)', () => {
    expect(displayNameFor('Yaseen A.', 'Yaseen Arshad', 'yaseen')).toBe('Yaseen A.')
    expect(displayNameFor('  Dr. Yas  ', 'Yaseen Arshad', 'yaseen')).toBe('Dr. Yas')
    expect(displayNameFor('', 'Yaseen Arshad', 'yaseen')).toBe('Yaseen')
    expect(displayNameFor('   ', 'Yaseen Arshad', 'yaseen')).toBe('Yaseen')
    expect(displayNameFor(null, 'Yaseen Arshad', 'yaseen')).toBe('Yaseen')
    expect(displayNameFor(undefined, null, 'yaseen')).toBe('yaseen')
  })

  it('periodContext computes Sun–Sat week and Calendar Month bounds (YAZ-6305)', () => {
    // Sun 2026-11-22 12:00 local time
    const sunNoon = new Date(2026, 10, 22, 12, 0, 0).getTime()
    const wkSun = periodContext('week', sunNoon)
    expect(wkSun.fromDay).toBe('2026-11-22')
    expect(wkSun.toDay).toBe('2026-11-22')
    expect(wkSun.rangeLabel).toBe('Sun, Nov 22 – Sat, 28')

    // Wed 2026-11-25 12:00 local time -> Sun Nov 22 through Wed Nov 25
    const wedNoon = new Date(2026, 10, 25, 12, 0, 0).getTime()
    const wkWed = periodContext('week', wedNoon)
    expect(wkWed.fromDay).toBe('2026-11-22')
    expect(wkWed.toDay).toBe('2026-11-25')

    const mo = periodContext('month', wedNoon)
    expect(mo.fromDay).toBe('2026-11-01')
    expect(mo.toDay).toBe('2026-11-25')
    expect(mo.rangeLabel).toBe('November 2026')
    expect(mo.totalDays).toBe(25)
  })

  it('periodConsistency clamps denominator to earliest active day for new users and counts prior period (YAZ-6305)', () => {
    const wedNoon = new Date(2026, 10, 25, 12, 0, 0).getTime()
    // New user started on Tue 2026-11-24 (2 possible days in Sun Nov 22 – Wed Nov 25)
    const newUser = {
      days: [makeDay('2026-11-25', true), makeDay('2026-11-24', true)],
    }
    const newCons = periodConsistency(newUser, 'week', wedNoon)
    expect(newCons.finishedDays).toBe(2)
    expect(newCons.possibleDays).toBe(2)
    expect(newCons.priorFinishedDays).toBeNull()
    expect(newCons.daysLeftInPeriod).toBe(3) // Thu, Fri, Sat

    // Established user with 2 finished days last week (Sun Nov 15 – Sat Nov 21) and 3 this week
    const established = {
      days: [
        makeDay('2026-11-25', true),
        makeDay('2026-11-24', true),
        makeDay('2026-11-22', true),
        makeDay('2026-11-20', true),
        makeDay('2026-11-18', true),
      ],
    }
    const estCons = periodConsistency(established, 'week', wedNoon)
    expect(estCons.finishedDays).toBe(3)
    expect(estCons.possibleDays).toBe(4) // Sun, Mon, Tue, Wed
    expect(estCons.priorFinishedDays).toBe(2)
  })

  it('buildPeriodGoalHero covers beat, tie, already-beat, already-tied, unreachable, and no-prior branches (YAZ-6305)', () => {
    const sunNov22 = new Date(2026, 10, 22, 12, 0, 0).getTime() // 8 days left in Nov (Nov 23–30)
    const statsWithDays = (days: FriendDay[], streak = 4): FriendStats => ({
      ...makeStats('2026-11-22', 20, 300, streak, false),
      days,
    })

    // 1. Can beat prev month: 20 finished in Nov (today done), 23 in Oct -> need 4 more days, 8 left
    const octDays = Array.from({ length: 23 }, (_, i) => makeDay(`2026-10-${String(i + 1).padStart(2, '0')}`, true))
    const nov20 = Array.from({ length: 20 }, (_, i) => makeDay(`2026-11-${String(i + 3).padStart(2, '0')}`, true))
    const beatHero = buildPeriodGoalHero(statsWithDays([...nov20, ...octDays]), 'month', 400, '2h 10m', sunNov22)
    expect(beatHero.heroPrimary).toBe('4 more days')
    expect(beatHero.heroParen).toBe('(beat prev month)')
    expect(beatHero.heroDone).toBe(false)
    expect(beatHero.line3).toContain('Prev month: 23 days')

    // 2. Already beat prev month: 12 finished in Nov vs 10 in Oct
    const oct10 = Array.from({ length: 10 }, (_, i) => makeDay(`2026-10-${String(i + 1).padStart(2, '0')}`, true))
    const nov12 = Array.from({ length: 12 }, (_, i) => makeDay(`2026-11-${String(i + 1).padStart(2, '0')}`, true))
    const alreadyBeat = buildPeriodGoalHero(statsWithDays([...nov12, ...oct10]), 'month', 300, '1h 30m', sunNov22)
    expect(alreadyBeat.heroPrimary).toBe('🎉 Beat prev month')
    expect(alreadyBeat.heroParen).toBe('(12 vs 10)')
    expect(alreadyBeat.heroDone).toBe(true)

    // 3. Can only tie prev week: Sun Nov 22 (today not done -> 7 remaining days), prev week = 7 days, 0 done so far
    const prevWk7 = [15, 16, 17, 18, 19, 20, 21].map((d) => makeDay(`2026-11-${d}`, true))
    const canTie = buildPeriodGoalHero(statsWithDays(prevWk7), 'week', 0, '0m', sunNov22)
    expect(canTie.heroPrimary).toBe('7 more days')
    expect(canTie.heroParen).toBe('(tie prev week)')
    expect(canTie.heroDone).toBe(false)

    // 4. Already tied prev week on Saturday (0 days left, today done, 5 vs 5)
    const satNov28 = new Date(2026, 10, 28, 12, 0, 0).getTime()
    const thisWk5 = [22, 23, 24, 25, 28].map((d) => makeDay(`2026-11-${d}`, true))
    const prevWk5 = [15, 16, 17, 18, 19].map((d) => makeDay(`2026-11-${d}`, true))
    const tied = buildPeriodGoalHero(statsWithDays([...thisWk5, ...prevWk5]), 'week', 100, '40m', satNov28)
    expect(tied.heroPrimary).toBe('🎉 Tied prev week')
    expect(tied.heroParen).toBe('(5)')
    expect(tied.heroDone).toBe(true)

    // 5. Cannot tie or beat prev week on Saturday (2 done vs 5 prev, today done -> 0 remaining)
    const thisWk2 = [22, 28].map((d) => makeDay(`2026-11-${d}`, true))
    const unreachable = buildPeriodGoalHero(statsWithDays([...thisWk2, ...prevWk5]), 'week', 40, '15m', satNov28)
    expect(unreachable.heroPrimary).toBe('2 of 7 days')
    expect(unreachable.heroParen).toBeNull()
    expect(unreachable.heroDone).toBe(false)

    // 6. No prior history (new user): falls back to perfect-period or streak
    const newUserPerfect = buildPeriodGoalHero(statsWithDays([makeDay('2026-11-22', true)], 1), 'week', 20, '10m', sunNov22)
    expect(newUserPerfect.heroPrimary).toBe('🎉 1 of 1 day')
    expect(newUserPerfect.heroDone).toBe(true)
    expect(newUserPerfect.line3).toContain('1-day streak')
  })
})
