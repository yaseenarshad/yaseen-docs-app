import { describe, expect, it } from 'vitest'
import type { FriendDay, FriendStats } from '@shared/friendStats'
import {
  addDays,
  avatarUrl,
  boardRows,
  cleanName,
  dailyMark,
  endOfNextDay,
  groupStreak,
  initialOf,
  localDay,
  markToShow,
  markWords,
  periodNumbers,
  seeMark,
  todayOf,
  updatedLabel,
  vsBoard,
} from './board'

/** Friday 13 November 2026, 12:00 local. Each test reads days in the local calendar, as the phone does. */
const NOW = new Date(2026, 10, 13, 12).getTime()
const TODAY = localDay(NOW)

const day = (offset: number, d: Partial<FriendDay> = {}): FriendDay => ({ day: addDays(TODAY, offset), cards: 0, seconds: 0, remembered: 0, forgot: 0, newCards: 0, done: false, ...d })
const TOTALS = { cards: 0, inReview: 0, newLeft: 0, mature: 0, dueLeft: 0, addedThisWeek: 0, streak: 0, bestStreak: 0, bestDay: 0, bestWeek: 0 }
const stats = (days: FriendDay[], totals: Partial<FriendStats['totals']> = {}): FriendStats => ({
  v: 1,
  login: 'x',
  name: 'X',
  avatar: '',
  days: [...days].sort((a, b) => (a.day < b.day ? 1 : -1)),
  totals: { ...TOTALS, ...totals },
  at: new Date(NOW).toISOString(),
})

/** The hand-made fixture of the "You vs Sam" screen: every number below is counted by hand from these days. */
const YOU = stats(
  [
    day(0, { cards: 31, newCards: 9, seconds: 55 * 60, remembered: 40, forgot: 10, done: false }),
    day(-1, { cards: 42, newCards: 12, seconds: 60 * 60, remembered: 30, forgot: 0, done: true }),
    day(-2, { cards: 20, done: true, remembered: 10 }),
    day(-3, { cards: 10, done: false }),
    day(-4, { cards: 30, done: true }),
    day(-5, { cards: 0, done: true }),
    day(-6, { cards: 7, done: true }),
    day(-7, { cards: 99, done: true }),
    day(-40, { cards: 500, remembered: 500, done: true }),
  ],
  { cards: 2199, inReview: 1689, newLeft: 510, mature: 940, dueLeft: 5, addedThisWeek: 35, streak: 6, bestDay: 88 },
)
const SAM = stats(
  [
    day(0, { cards: 44, newCards: 14, seconds: 66 * 60 + 20, remembered: 9, forgot: 1, done: true }),
    day(-1, { cards: 38, done: true }),
    day(-2, { cards: 5, done: false }),
    day(-3, { cards: 12, done: true }),
    day(-4, { cards: 30, done: true }),
    day(-6, { cards: 1, done: true }),
  ],
  { cards: 1840, inReview: 1310, newLeft: 530, mature: 810, addedThisWeek: 60, streak: 8, bestDay: 96 },
)

describe('the daily mark (decision 25)', () => {
  it('○ not started, ◐ started with due cards left, ✓ finished; the number counts new cards too', () => {
    expect(dailyMark(stats([day(0, { cards: 0 })], { dueLeft: 12 }), NOW)).toBe('not-started')
    expect(dailyMark(stats([day(0, { cards: 5, newCards: 5 })], { dueLeft: 12 }), NOW)).toBe('started')
    expect(dailyMark(stats([day(0, { cards: 44, newCards: 40, done: true })]), NOW)).toBe('finished')
    // ✓ is for the due cards only: 0 cards today but no due card is a finished day (2C sets `done`).
    expect(dailyMark(stats([day(0, { cards: 0, done: true })]), NOW)).toBe('finished')
    // No numbers for today yet (no send today): not started.
    expect(dailyMark(stats([day(-1, { cards: 10, done: true })]), NOW)).toBe('not-started')
    expect(periodNumbers(stats([day(0, { cards: 44, newCards: 40, seconds: 600, done: true })]), 'today', NOW)).toEqual({ cards: 44, minutes: 10, mark: 'finished' })
  })

  it('Yesterday shows ✓ or ○ only; Week and Month show no mark', () => {
    expect(periodNumbers(YOU, 'yesterday', NOW)).toEqual({ cards: 42, minutes: 60, mark: 'finished' })
    expect(periodNumbers(stats([day(-1, { cards: 3 })]), 'yesterday', NOW).mark).toBe('not-started')
    expect(periodNumbers(YOU, 'week', NOW).mark).toBeNull()
    expect(periodNumbers(YOU, 'month', NOW).mark).toBeNull()
  })

  it('the marks are read as words', () => {
    expect(markWords('not-started', 'today')).toBe('Not started today')
    expect(markWords('started', 'today')).toBe('Started, due cards left')
    expect(markWords('finished', 'today')).toBe('Finished the due cards')
    expect(markWords('finished', 'yesterday')).toBe('Finished the due cards yesterday')
    expect(markWords('not-started', 'yesterday')).toBe('Did not finish the due cards yesterday')
  })
})

describe('the four periods and the order (decision 21)', () => {
  it('Week is Monday to today; Month is the 1st to today', () => {
    // Friday 13: the week is Monday 9 to Friday 13 (offsets -4 to 0): 31 + 42 + 20 + 10 + 30.
    expect(periodNumbers(YOU, 'week', NOW).cards).toBe(133)
    // November 1 to 13: the days at offsets 0 to -7 (the -40 day is in October): 133 + 0 + 7 + 99.
    expect(periodNumbers(YOU, 'month', NOW).cards).toBe(239)
  })

  it('sorts by cards, then minutes; equal rows share a rank; rows with no numbers go last', () => {
    const e = (key: string, cards: number, minutes: number, you = false) => ({ key, name: key, you, stats: stats([day(0, { cards, seconds: minutes * 60 })]) })
    const rows = boardRows([e('you', 31, 55, true), e('sam', 44, 66), { key: 'gone', name: 'Gone', you: false, stats: null }, e('priya', 12, 49), e('leo', 31, 20), e('mina', 31, 20)], 'today', NOW)
    expect(rows.map((r) => [r.entry.key, r.rank])).toEqual([
      ['sam', 1],
      ['you', 2],
      ['leo', 3],
      ['mina', 3],
      ['priya', 5],
      ['gone', null],
    ])
  })

  it('a friend ahead of me in time: their newest day is their today', () => {
    const ahead = stats([day(1, { cards: 9, done: true }), day(0, { cards: 4 })])
    expect(todayOf(ahead, NOW)).toBe(addDays(TODAY, 1))
    expect(periodNumbers(ahead, 'today', NOW)).toMatchObject({ cards: 9, mark: 'finished' })
    expect(periodNumbers(ahead, 'yesterday', NOW).cards).toBe(4)
  })
})

describe('"You vs <friend>" against a hand-made fixture (decision 23)', () => {
  it('each number, in the order of the decision', () => {
    const vs = vsBoard(YOU, SAM, NOW)
    expect(vs.side.map((l) => [l.label, l.you, l.them, l.lead])).toEqual([
      ['cards today', 31, 44, 'them'],
      ['due cards', 22, 30, 'them'],
      ['new cards', 9, 14, 'them'],
      ['yesterday', 42, 38, 'you'],
      // The last 7 days with today: you 31+42+20+10+30+0+7 = 140 → 20; Sam 44+38+5+12+30+1 = 130 → 19.
      ['7 day average', 20, 19, 'you'],
      ['minutes today', 55, 66, 'them'],
      ['best day', 88, 96, 'them'],
      ['streak', 6, 8, 'them'],
    ])
    expect(vs.vault.map((l) => [l.label, l.you, l.them])).toEqual([
      ['total cards', 2199, 1840],
      ['in review', 1689, 1310],
      ['new cards left', 510, 530],
      // The last 30 days: you 80 remembered, 10 forgot → 89 %; the October day is outside. Sam 9 of 10 → 90 %.
      ['remembered', 89, 90],
      ['mature cards', 940, 810],
      ['added this week', 35, 60],
      // Days with a card in the last 30: you 7 (offset -5 had none), Sam 6 (no day at -5).
      ['days reviewed of 30', 7, 6],
    ])
    expect(vs.vault[3].suffix).toBe('%')
    expect(vs.side.filter((l) => l.part).map((l) => l.label)).toEqual(['due cards', 'new cards'])
  })

  it('the last 7 days: a day is marked when both finished; both win', () => {
    const vs = vsBoard(YOU, SAM, NOW)
    // Offsets -6 … 0. You: ✓ ✓ ✓ ✗ ✓ ✓ ✗(today not done). Sam: ✓ ✗(no day) ✓ ✓ ✗ ✓ ✓.
    expect(vs.week.map((d) => [d.you, d.them, d.both])).toEqual([
      [true, true, true],
      [true, false, false],
      [true, true, true],
      [false, true, false],
      [true, false, false],
      [true, true, true],
      [false, true, false],
    ])
    expect(vs.bothWon).toBe(3)
    expect(vs.week.at(-1)).toMatchObject({ day: TODAY, weekday: 'Fri' })
  })

  it('a tie is bold on both sides; a friend with no numbers yet has no lead', () => {
    const same = vsBoard(SAM, SAM, NOW)
    expect(same.side.every((l) => l.lead === 'both')).toBe(true)
    expect(same.bothWon).toBe(5)
    const none = vsBoard(YOU, null, NOW)
    expect(none.side.every((l) => l.them === null && l.lead === null)).toBe(true)
    expect(none.week.every((d) => !d.them && !d.both)).toBe(true)
  })
})

describe('the group streak (round 10, item 13)', () => {
  const done = (...offsets: number[]) => stats(offsets.map((o) => day(o, { cards: 1, done: true })))
  it('counts the days in a row that everyone finished; an unfinished today does not stop it', () => {
    expect(groupStreak([done(0, -1, -2, -3), done(-1, -2, -3, -4)], NOW)).toBe(3)
    expect(groupStreak([done(0, -1, -2), done(0, -1)], NOW)).toBe(2)
  })
  it('a member with no update for a day did not finish it', () => {
    expect(groupStreak([done(0, -1, -2), null], NOW)).toBe(0)
    expect(groupStreak([done(-1, -2, -4), done(-1, -3, -2, -4)], NOW)).toBe(2)
    expect(groupStreak([], NOW)).toBe(0)
  })
})

describe('Cheer and Nudge on the side that gets them (decision 24)', () => {
  const cheer = { kind: 'cheer' as const, at: new Date(NOW - 3 * 86_400_000).toISOString() }
  it('shows until it was seen, however old', () => {
    expect(markToShow(cheer, undefined, NOW)).toEqual(cheer)
    expect(markToShow(cheer, undefined, NOW + 30 * 86_400_000)).toEqual(cheer)
  })
  it('once seen, it shows to the end of the next local day', () => {
    const seen = seeMark(cheer, undefined, NOW)
    expect(seen).toEqual({ at: cheer.at, seenAt: NOW })
    // Seen at 12:00 on the 13th: it shows until 00:00 on the 15th.
    const end = new Date(2026, 10, 15).getTime()
    expect(endOfNextDay(NOW)).toBe(end)
    expect(markToShow(cheer, seen, end - 1)).toEqual(cheer)
    expect(markToShow(cheer, seen, end)).toBeNull()
    // A second look does not move the first time.
    expect(seeMark(cheer, seen, NOW + 5 * 3600_000)).toBe(seen)
  })
  it('a new cheer or nudge from the same friend replaces the old one and is unseen again', () => {
    const seen = seeMark(cheer, undefined, NOW)
    const nudge = { kind: 'nudge' as const, at: new Date(NOW + 9 * 86_400_000).toISOString() }
    expect(markToShow(nudge, seen, NOW + 10 * 86_400_000)).toEqual(nudge)
    expect(seeMark(nudge, seen, NOW + 10 * 86_400_000)).toEqual({ at: nudge.at, seenAt: NOW + 10 * 86_400_000 })
    expect(markToShow(undefined, seen, NOW)).toBeNull()
  })
})

describe('strings from a gist', () => {
  it('a hostile name is plain text: bounded, one line, no bidi control', () => {
    expect(cleanName('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>')
    expect(cleanName('a'.repeat(10_000))).toHaveLength(40)
    expect(cleanName('a'.repeat(10_000)).endsWith('…')).toBe(true)
    expect(cleanName('‮evil‬ Sam‏')).toBe('evil Sam')
    expect(cleanName('Sam\n\tLee')).toBe('Sam Lee')
    expect(cleanName('Sam\u200dLee\u2067x')).toBe('Sam\u200dLeex')
    expect(cleanName('👩‍👩‍👧‍👦'.repeat(50))).toBe(`${'👩‍👩‍👧‍👦'.repeat(39)}…`)
    expect(cleanName(42)).toBe('')
    expect(initialOf('  émile')).toBe('É')
    expect(initialOf('👩‍👩‍👧‍👦 fam')).toBe('👩‍👩‍👧‍👦')
    expect(initialOf('')).toBe('?')
  })
  it('an avatar comes only from https://avatars.githubusercontent.com', () => {
    expect(avatarUrl('https://avatars.githubusercontent.com/u/1?v=4')).toBe('https://avatars.githubusercontent.com/u/1?v=4')
    for (const bad of ['http://avatars.githubusercontent.com/u/1', 'https://evil.com/a.png', 'https://avatars.githubusercontent.com.evil.com/u/1', 'https://x@avatars.githubusercontent.com/u/1', 'https://avatars.githubusercontent.com:444/u/1', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '', null, 'x'.repeat(600)])
      expect(avatarUrl(bad)).toBeNull()
  })
  it('"updated … ago" is 4E1\'s label', () => {
    expect(updatedLabel(NOW - 2 * 3600_000, NOW)).toBe('2h ago')
    expect(updatedLabel(null, NOW)).toBe('no update yet')
    expect(updatedLabel(NOW + 60_000, NOW)).toBe('now')
  })
})
