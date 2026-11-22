/**
 * Shared Friends leaderboard sorting, daily marks, Study Buddy Emojis, and shared-card filters (YAZ-6200).
 * Pure — no React, no DOM, no network. Used identically on Phone and Desktop.
 */
import type { FriendDay, FriendStats } from './friendStatsFormat'
import type { SharedCardItem, SharedCardStatus } from './friendsApi'

export type BoardPeriod = 'today' | 'yesterday' | 'week' | 'month'
export type LeaderboardSort = 'cards' | 'time' | 'streak'
export type DailyMark = 'finished' | 'started' | 'not-started'

export const DAILY_MARK_SIGN: Record<DailyMark, string> = {
  finished: '✓',
  started: '◐',
  'not-started': '○',
}

export interface LeaderboardRow {
  id: number
  login: string
  name: string
  avatarUrl: string | null
  isMe: boolean
  mark: DailyMark
  cards: number
  seconds: number
  streak: number
  sharedCardCount: number
}

const pad = (n: number) => String(n).padStart(2, '0')

export function localDayKey(nowMs: number): string {
  const d = new Date(nowMs)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Converts an ISO timestamp (or YYYY-MM-DD day key) to a local YYYY-MM-DD day key. */
export function sinceDayKey(iso: string | null | undefined): string | null {
  if (!iso) return null
  const trimmed = iso.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const ms = Date.parse(trimmed)
  if (Number.isNaN(ms)) return null
  return localDayKey(ms)
}

function diffDays(fromDay: string, toDay: string): number {
  const [fy, fm, fd] = fromDay.split('-').map(Number)
  const [ty, tm, td] = toDay.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(y, m - 1, d + delta)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

/**
 * 7-day rolling daily average: divides by actual calendar span `Math.min(7, diffDays(oldestDay, endDay) + 1)`
 * and excludes an unstarted `today` (`cards === 0 && !done`) when prior days exist so morning zeros don't drag down the average.
 */
export function average7Day(stats: FriendStats | null, nowMs: number = Date.now()): { cards: number; seconds: number } {
  if (!stats || stats.days.length === 0) return { cards: 0, seconds: 0 }
  const mine = localDayKey(nowMs)
  const today = stats.days[0].day > mine ? stats.days[0].day : mine
  let oldestDay = stats.days[0].day
  let hasPriorDays = false
  let todayRow: FriendDay | undefined
  for (const d of stats.days) {
    if (d.day < oldestDay) oldestDay = d.day
    if (d.day < today) hasPriorDays = true
    if (d.day === today) todayRow = d
  }
  const excludeToday = hasPriorDays && (!todayRow || (todayRow.cards === 0 && !todayRow.done))
  const endDay = excludeToday ? addDays(today, -1) : today
  const span = Math.min(7, Math.max(1, diffDays(oldestDay, endDay) + 1))
  const startDay = addDays(endDay, -(span - 1))
  let cards = 0
  let seconds = 0
  for (const d of stats.days) {
    if (d.day >= startDay && d.day <= endDay) {
      cards += d.cards
      seconds += d.seconds
    }
  }
  return {
    cards: Math.round(cards / span),
    seconds: Math.round(seconds / span),
  }
}

function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return addDays(day, -((dt.getDay() + 6) % 7))
}

export function dailyMarkOf(stats: FriendStats | null, nowMs: number): DailyMark {
  if (!stats || stats.days.length === 0) return 'not-started'
  const mine = localDayKey(nowMs)
  const today = stats.days[0].day > mine ? stats.days[0].day : mine
  const row = stats.days.find((d) => d.day === today)
  if (!row) return 'not-started'
  if (row.done && row.cards > 0) return 'finished'
  return row.cards > 0 ? 'started' : 'not-started'
}

export function periodTotals(stats: FriendStats | null, period: BoardPeriod, nowMs: number): { cards: number; seconds: number } {
  if (!stats || stats.days.length === 0) return { cards: 0, seconds: 0 }
  const mine = localDayKey(nowMs)
  const today = stats.days[0].day > mine ? stats.days[0].day : mine
  const findDay = (k: string): FriendDay | undefined => stats.days.find((d) => d.day === k)
  if (period === 'today') {
    const d = findDay(today)
    return { cards: d?.cards ?? 0, seconds: d?.seconds ?? 0 }
  }
  if (period === 'yesterday') {
    const d = findDay(addDays(today, -1))
    return { cards: d?.cards ?? 0, seconds: d?.seconds ?? 0 }
  }
  const from = period === 'week' ? mondayOf(today) : addDays(today, -29)
  let cards = 0
  let seconds = 0
  for (const d of stats.days) {
    if (d.day >= from && d.day <= today) {
      cards += d.cards
      seconds += d.seconds
    }
  }
  return { cards, seconds }
}

const MARK_RANK: Record<DailyMark, number> = {
  finished: 0,
  started: 1,
  'not-started': 2,
}

/**
 * Approved D12 + Item 9 leaderboard ordering:
 * 1. Status first (`✓` finished -> `◐` started -> `○` not-started)
 * 2. Primary metric (`cards` default, `time`, or `streak`)
 * 3. Tie-break by secondary metrics, then name
 */
export function sortLeaderboard<T extends Pick<LeaderboardRow, 'mark' | 'cards' | 'seconds' | 'streak' | 'name'>>(
  rows: readonly T[],
  sort: LeaderboardSort = 'cards',
): T[] {
  return [...rows].sort((a, b) => {
    const mr = MARK_RANK[a.mark] - MARK_RANK[b.mark]
    if (mr !== 0) return mr
    if (sort === 'streak') {
      if (b.streak !== a.streak) return b.streak - a.streak
      if (b.cards !== a.cards) return b.cards - a.cards
      if (b.seconds !== a.seconds) return b.seconds - a.seconds
    } else if (sort === 'time') {
      if (b.seconds !== a.seconds) return b.seconds - a.seconds
      if (b.cards !== a.cards) return b.cards - a.cards
      if (b.streak !== a.streak) return b.streak - a.streak
    } else {
      if (b.cards !== a.cards) return b.cards - a.cards
      if (b.seconds !== a.seconds) return b.seconds - a.seconds
      if (b.streak !== a.streak) return b.streak - a.streak
    }
    return a.name.localeCompare(b.name)
  })
}

export function filterSharedCards(cards: readonly SharedCardItem[], status: SharedCardStatus): SharedCardItem[] {
  return cards.filter((c) => c.status === status)
}

/**
 * Timezone-safe mutual streak helper shared by Buddy Streak (2 friends) and Group Streak (N members).
 * Anchors to the latest calendar day across all participants (allowing today, yesterday, or — when participants
 * span a timezone date boundary — the day before the lagging member's current day) so a timezone rollover gap
 * never falsely breaks an active streak.
 */
function computeSharedStreak(
  memberDaysList: readonly (readonly FriendDay[] | null | undefined)[],
  nowMs: number = Date.now(),
): number {
  if (memberDaysList.length === 0) return 0
  const doneSets: Set<string>[] = []
  let maxLatest = localDayKey(nowMs)
  let minLatest: string | null = null

  for (const days of memberDaysList) {
    if (!days || days.length === 0) return 0
    doneSets.push(new Set(days.filter((d) => d.done).map((d) => d.day)))
    const latest = days[0]?.day
    if (latest) {
      if (latest > maxLatest) maxLatest = latest
      if (minLatest === null || latest < minLatest) minLatest = latest
    }
  }

  const allDoneOn = (day: string) => doneSets.every((s) => s.has(day))
  const candidates = [maxLatest, addDays(maxLatest, -1)]
  if (minLatest && minLatest < maxLatest) {
    const behindYesterday = addDays(minLatest, -1)
    if (!candidates.includes(behindYesterday)) candidates.push(behindYesterday)
  }

  let day: string | null = null
  for (const c of candidates) {
    if (allDoneOn(c)) {
      day = c
      break
    }
  }
  if (!day) return 0

  let streak = 0
  for (let i = 0; i < 365; i++) {
    if (allDoneOn(day)) {
      streak++
      day = addDays(day, -1)
    } else {
      break
    }
  }
  return streak
}

/** Counts consecutive days where BOTH `meDays` and `friendDays` finished their due cards (`done: true`). */
export function computeBuddyStreak(
  meDays: readonly FriendDay[] | null | undefined,
  friendDays: readonly FriendDay[] | null | undefined,
  nowMs: number = Date.now(),
): number {
  return computeSharedStreak([meDays, friendDays], nowMs)
}

/** Counts consecutive days where EVERY member in `memberDaysList` finished their due cards (`done: true`). */
export function computeGroupStreak(
  memberDaysList: readonly (readonly FriendDay[] | null | undefined)[],
  nowMs: number = Date.now(),
): number {
  return computeSharedStreak(memberDaysList, nowMs)
}

export function formatMinutes(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
}

/** Returns the first whitespace-separated token of `name.trim()` if non-empty, else `login`. */
export function firstNameOf(name: string | null | undefined, login: string): string {
  const trimmed = name?.trim() ?? ''
  if (!trimmed) return login
  return trimmed.split(/\s+/)[0] || login
}

/** Returns `nickname.trim()` as-typed if non-empty, else `firstNameOf(name, login)`. */
export function displayNameFor(nickname: string | null | undefined, name: string | null | undefined, login: string): string {
  const nick = nickname?.trim() ?? ''
  if (nick) return nick
  return firstNameOf(name, login)
}
