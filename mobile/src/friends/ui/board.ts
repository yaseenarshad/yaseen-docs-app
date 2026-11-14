import { agoLabel, updatedAgo } from '@shared/friendGists'
import { daysReviewed, rememberedPercent, type FriendDay, type FriendMark, type FriendStats } from '@shared/friendStats'

/**
 * THE RULES OF THE FRIENDS SCREENS (YAZ-5085, 4E4; decisions 21, 23, 24 and 25 on YAZ-5057; round 10, items 12 and 13).
 * Pure: no React, no store, no network. The screens draw what these functions give and compute no number of their own.
 * The numbers come from the friend's `FriendStats` (2C, `shared/friendStats.ts`); "remembered %" and "days reviewed of
 * 30" are 2C's own readers. "Updated … ago" is 4E1's `agoLabel(updatedAgo(…))`.
 *
 * Each person's own local day counts (YAZ-5058). A friend's "today" is the day in their file with MY local date, or
 * their newest day when it is after my date (they are ahead of me in time). A friend who is behind me in time shows
 * their running day under "Yesterday" until their day turns (round 10, item 21: travel and time zones are accepted).
 */

export type Period = 'today' | 'yesterday' | 'week' | 'month'
export const PERIODS: readonly { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

// ---------------------------------------------------------------------------------------------------------------------
// Local days.

const pad = (n: number) => String(n).padStart(2, '0')
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dateOf = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}
/** My local date at `now`, `2026-11-13`. */
export const localDay = (now: number): string => keyOf(new Date(now))
/** `day` moved by `n` days (local calendar). */
export const addDays = (day: string, n: number): string => {
  const d = dateOf(day)
  return keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n))
}
/** The Monday of the local week of `day` (a week is Monday to Sunday, as 2C's `addedThisWeek` and `bestWeek`). */
const mondayOf = (day: string): string => {
  const d = dateOf(day)
  return addDays(day, -((d.getDay() + 6) % 7))
}
/** The start of the local day after the day after `t`: when a seen cheer goes (decision 24). */
export const endOfNextDay = (t: number): number => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2).getTime()
}

/** The person's own "today" (see the top of the file). */
export function todayOf(stats: Pick<FriendStats, 'days'>, now: number): string {
  const mine = localDay(now)
  const newest = stats.days[0]?.day
  return newest !== undefined && newest > mine ? newest : mine
}

const dayIn = (stats: Pick<FriendStats, 'days'>, day: string): FriendDay | undefined => stats.days.find((d) => d.day === day)
const sumOf = (days: readonly FriendDay[], from: string, to: string) => {
  let cards = 0
  let seconds = 0
  for (const d of days)
    if (d.day >= from && d.day <= to) {
      cards += d.cards
      seconds += d.seconds
    }
  return { cards, seconds }
}
const minutesOf = (seconds: number) => Math.round(seconds / 60)

// ---------------------------------------------------------------------------------------------------------------------
// The daily mark (decision 25).

/** ○ not started, ◐ started with due cards left, ✓ the due cards are finished. About the DUE cards only (round 9). */
export type DailyMark = 'not-started' | 'started' | 'finished'
export const MARK_SIGN: Record<DailyMark, string> = { 'not-started': '○', started: '◐', finished: '✓' }

/**
 * Today's mark: `done` gives ✓ (a day with no due card is done, 2C). Else a card answered today gives ◐, and none
 * gives ○. A friend with no numbers for today yet (no send today) is ○.
 */
export function dailyMark(stats: Pick<FriendStats, 'days'>, now: number): DailyMark {
  const today = dayIn(stats, todayOf(stats, now))
  if (today === undefined) return 'not-started'
  if (today.done) return 'finished'
  return today.cards > 0 ? 'started' : 'not-started'
}
/** Yesterday shows ✓ or ○ only (decision 25). A day with no numbers is not finished. */
export function yesterdayMark(stats: Pick<FriendStats, 'days'>, now: number): DailyMark {
  return dayIn(stats, addDays(todayOf(stats, now), -1))?.done === true ? 'finished' : 'not-started'
}
/** What VoiceOver reads for a mark (the signs are not words). */
export function markWords(mark: DailyMark, period: Period): string {
  if (period === 'yesterday') return mark === 'finished' ? 'Finished the due cards yesterday' : 'Did not finish the due cards yesterday'
  return { 'not-started': 'Not started today', started: 'Started, due cards left', finished: 'Finished the due cards' }[mark]
}

// ---------------------------------------------------------------------------------------------------------------------
// One person's numbers for a period, and the order of the rows (decision 21).

export interface PeriodNumbers {
  /** Each card answered in the period, new cards too, each card one time a day (round 9). */
  cards: number
  minutes: number
  /** Today and Yesterday have a mark; Week and Month have none in the first build (decision 25). */
  mark: DailyMark | null
}

export function periodNumbers(stats: Pick<FriendStats, 'days'>, period: Period, now: number): PeriodNumbers {
  const today = todayOf(stats, now)
  switch (period) {
    case 'today': {
      const d = dayIn(stats, today)
      return { cards: d?.cards ?? 0, minutes: minutesOf(d?.seconds ?? 0), mark: dailyMark(stats, now) }
    }
    case 'yesterday': {
      const d = dayIn(stats, addDays(today, -1))
      return { cards: d?.cards ?? 0, minutes: minutesOf(d?.seconds ?? 0), mark: yesterdayMark(stats, now) }
    }
    case 'week': {
      const s = sumOf(stats.days, mondayOf(today), today)
      return { cards: s.cards, minutes: minutesOf(s.seconds), mark: null }
    }
    case 'month': {
      const s = sumOf(stats.days, `${today.slice(0, 8)}01`, today)
      return { cards: s.cards, minutes: minutesOf(s.seconds), mark: null }
    }
  }
}

/** One person on the board: me, a friend, or a member of a group. `stats` null: no numbers to show. */
export interface BoardEntry {
  key: string
  name: string
  you: boolean
  stats: Pick<FriendStats, 'days'> | null
}
export interface BoardRow<E extends BoardEntry = BoardEntry> {
  entry: E
  /** 1, 2, 3 …; null for a row with no numbers (it sorts last). Equal numbers share a rank. */
  rank: number | null
  numbers: PeriodNumbers | null
}

/** The rows sorted by cards, then minutes (decision 21); rows with no numbers go last, in the order given. */
export function boardRows<E extends BoardEntry>(entries: readonly E[], period: Period, now: number): BoardRow<E>[] {
  const withNumbers = entries.map((entry, i) => ({ entry, i, numbers: entry.stats === null ? null : periodNumbers(entry.stats, period, now) }))
  withNumbers.sort((a, b) => {
    if (a.numbers === null || b.numbers === null) return (a.numbers === null ? 1 : 0) - (b.numbers === null ? 1 : 0) || a.i - b.i
    return b.numbers.cards - a.numbers.cards || b.numbers.minutes - a.numbers.minutes || a.i - b.i
  })
  let rank = 0
  let last: PeriodNumbers | null = null
  return withNumbers.map((r, k) => {
    if (r.numbers === null) return { entry: r.entry, rank: null, numbers: null }
    if (last === null || r.numbers.cards !== last.cards || r.numbers.minutes !== last.minutes) rank = k + 1
    last = r.numbers
    return { entry: r.entry, rank, numbers: r.numbers }
  })
}

// ---------------------------------------------------------------------------------------------------------------------
// "You vs <friend>" (decision 23; round 9: cards today in two rows, due and new).

export type Lead = 'you' | 'them' | 'both' | null
export interface VsLine {
  label: string
  you: number | null
  them: number | null
  /** The larger number is bold; equal numbers are both bold. Null when a side has no number. */
  lead: Lead
  /** A part of the line above it (the due and new cards of "cards today"). */
  part?: boolean
  suffix?: string
}
export interface VsDay {
  day: string
  /** Mon, Tue, … of MY local calendar for that place in the week. */
  weekday: string
  you: boolean
  them: boolean
  /** "If you both did your review, you are both winners" (decision 23). */
  both: boolean
}
export interface VsBoard {
  side: VsLine[]
  vault: VsLine[]
  week: VsDay[]
  /** Days of the last 7 that both finished. */
  bothWon: number
}

const lead = (you: number | null, them: number | null): Lead => (you === null || them === null ? null : you > them ? 'you' : them > you ? 'them' : 'both')
const line = (label: string, you: number | null, them: number | null, more: Partial<VsLine> = {}): VsLine => ({ label, you, them, lead: lead(you, them), ...more })

type VsStats = Pick<FriendStats, 'days' | 'totals'>
function sideOf(s: VsStats | null, now: number) {
  if (s === null) return null
  const today = todayOf(s, now)
  const d = dayIn(s, today)
  const cards = d?.cards ?? 0
  const fresh = d?.newCards ?? 0
  const last7 = sumOf(s.days, addDays(today, -6), today).cards
  return {
    today,
    cards,
    due: Math.max(0, cards - fresh),
    fresh,
    yesterday: dayIn(s, addDays(today, -1))?.cards ?? 0,
    average: Math.round(last7 / 7),
    minutes: minutesOf(d?.seconds ?? 0),
  }
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The "You vs" numbers, in the order of decision 23. A side is null when it has no numbers (no send yet). */
export function vsBoard(you: VsStats | null, them: VsStats | null, now: number): VsBoard {
  const a = sideOf(you, now)
  const b = sideOf(them, now)
  const t = (s: VsStats | null, pick: (x: VsStats['totals']) => number) => (s === null ? null : pick(s.totals))
  const side: VsLine[] = [
    line('cards today', a?.cards ?? null, b?.cards ?? null),
    line('due cards', a?.due ?? null, b?.due ?? null, { part: true }),
    line('new cards', a?.fresh ?? null, b?.fresh ?? null, { part: true }),
    line('yesterday', a?.yesterday ?? null, b?.yesterday ?? null),
    line('7 day average', a?.average ?? null, b?.average ?? null),
    line('minutes today', a?.minutes ?? null, b?.minutes ?? null),
    line('best day', t(you, (x) => x.bestDay), t(them, (x) => x.bestDay)),
    line('streak', t(you, (x) => x.streak), t(them, (x) => x.streak)),
  ]
  const vault: VsLine[] = [
    line('total cards', t(you, (x) => x.cards), t(them, (x) => x.cards)),
    line('in review', t(you, (x) => x.inReview), t(them, (x) => x.inReview)),
    line('new cards left', t(you, (x) => x.newLeft), t(them, (x) => x.newLeft)),
    line('remembered', you === null ? null : rememberedPercent(you.days), them === null ? null : rememberedPercent(them.days), { suffix: '%' }),
    line('mature cards', t(you, (x) => x.mature), t(them, (x) => x.mature)),
    line('added this week', t(you, (x) => x.addedThisWeek), t(them, (x) => x.addedThisWeek)),
    line('days reviewed of 30', you === null ? null : daysReviewed(you.days), them === null ? null : daysReviewed(them.days)),
  ]
  const mineToday = localDay(now)
  const week: VsDay[] = []
  for (let i = 6; i >= 0; i--) {
    const day = addDays(mineToday, -i)
    const youDone = you !== null && dayIn(you, addDays(a!.today, -i))?.done === true
    const themDone = them !== null && dayIn(them, addDays(b!.today, -i))?.done === true
    week.push({ day, weekday: WEEKDAYS[dateOf(day).getDay()], you: youDone, them: themDone, both: youDone && themDone })
  }
  return { side, vault, week, bothWon: week.filter((d) => d.both).length }
}

// ---------------------------------------------------------------------------------------------------------------------
// The group streak (round 10, item 13).

/**
 * The days in a row that EVERY member finished their due cards, up to today. An unfinished today does not stop it
 * (as 2C's own `streak`). A member with no numbers for a day (no update yet) did not finish that day.
 */
export function groupStreak(members: readonly (Pick<FriendStats, 'days'> | null)[], now: number): number {
  if (members.length === 0) return 0
  const all = (offset: number) => members.every((m) => m !== null && dayIn(m, addDays(todayOf(m, now), -offset))?.done === true)
  let start = all(0) ? 0 : 1
  let n = 0
  while (start + n < 400 && all(start + n)) n++
  return n
}

// ---------------------------------------------------------------------------------------------------------------------
// Cheer and Nudge, on the side that gets them (decision 24, changed in round 7).

/** What this phone keeps of a mark it has shown: the mark's `at`, and when the line was first on the screen. */
export interface SeenMark {
  at: string
  seenAt: number
}

/**
 * The line to show for a friend's mark: until it was seen, then to the end of the next local day. A new mark (another
 * `at`) replaces the old one and is unseen again.
 */
export function markToShow(mark: FriendMark | undefined, seen: SeenMark | undefined, now: number): FriendMark | null {
  if (mark === undefined) return null
  if (seen === undefined || seen.at !== mark.at) return mark
  return now < endOfNextDay(seen.seenAt) ? mark : null
}
/** The mark was on the screen at `now`: keep the first time only. */
export function seeMark(mark: FriendMark, seen: SeenMark | undefined, now: number): SeenMark {
  return seen !== undefined && seen.at === mark.at ? seen : { at: mark.at, seenAt: now }
}
export const MARK_LINE: Record<FriendMark['kind'], string> = { cheer: 'cheered you', nudge: 'nudged you' }

// ---------------------------------------------------------------------------------------------------------------------
// Words and strings from a gist: always text, bounded.

/** "now", "2h ago", "no update yet" (round 10, item 12), from GitHub's time of the numbers gist. */
export const updatedLabel = (updatedAt: number | null, now: number): string => agoLabel(updatedAgo(updatedAt, now))

/** Bidi controls and other invisible format characters: a name must not turn the row's text around. */
const CONTROLS = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g
/** The most letters of a name on a screen (a GitHub name has 255 at most; a nickname 40). */
export const NAME_MAX = 40

const graphemes = (text: string): string[] => {
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (Seg === undefined) return Array.from(text)
  return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment)
}

/** A name from a gist as plain text: no control or bidi character, one line, at most `max` letters (then "…"). */
export function cleanName(text: unknown, max = NAME_MAX): string {
  if (typeof text !== 'string') return ''
  const flat = text.slice(0, max * 32).replace(/\s+/g, ' ').replace(CONTROLS, '').trim()
  const parts = graphemes(flat)
  return parts.length <= max ? flat : `${parts.slice(0, max - 1).join('').trimEnd()}…`
}
/** The letter of the plain avatar: the first letter of the name, or "?" */
export function initialOf(name: string): string {
  const first = graphemes(cleanName(name, 4))[0]
  return first === undefined ? '?' : first.toLocaleUpperCase()
}

/** The only host the page may load a picture from (round 12, item 13; the CSP of 5-). */
export const AVATAR_HOST = 'avatars.githubusercontent.com'
/** The avatar address when it is a plain https address on GitHub's avatar host; else null (the plain avatar shows). */
export function avatarUrl(text: unknown): string | null {
  if (typeof text !== 'string' || text.length > 500) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== AVATAR_HOST || url.port !== '' || url.username !== '' || url.password !== '') return null
  return url.href
}
