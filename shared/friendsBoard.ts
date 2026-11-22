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

function sundayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return addDays(day, -dt.getDay())
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
  const from = period === 'week' ? sundayOf(today) : `${today.slice(0, 8)}01`
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

export interface PeriodContext {
  rangeLabel: string
  heroTitle: string
  fromDay: string
  toDay: string
  totalDays: number
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Date range and bounds for each leaderboard period (Week = Sun–Sat, Month = 1st–today). */
export function periodContext(period: BoardPeriod, nowMs: number = Date.now()): PeriodContext {
  const d = new Date(nowMs)
  const y = d.getFullYear()
  const m = d.getMonth()
  const day = d.getDate()
  const todayKey = localDayKey(nowMs)

  if (period === 'today') {
    return {
      rangeLabel: `${WEEKDAYS_SHORT[d.getDay()]}, ${MONTHS_SHORT[m]} ${day}`,
      heroTitle: 'Your Today',
      fromDay: todayKey,
      toDay: todayKey,
      totalDays: 1,
    }
  }
  if (period === 'yesterday') {
    const prev = new Date(y, m, day - 1)
    const prevKey = addDays(todayKey, -1)
    return {
      rangeLabel: `${WEEKDAYS_SHORT[prev.getDay()]}, ${MONTHS_SHORT[prev.getMonth()]} ${prev.getDate()}`,
      heroTitle: 'Your Yesterday',
      fromDay: prevKey,
      toDay: prevKey,
      totalDays: 1,
    }
  }
  if (period === 'week') {
    const sunKey = sundayOf(todayKey)
    const sun = new Date(y, m, day - d.getDay())
    const sat = new Date(y, m, day - d.getDay() + 6)
    const sunStr = `${MONTHS_SHORT[sun.getMonth()]} ${sun.getDate()}`
    const satStr = sun.getMonth() === sat.getMonth() ? `${sat.getDate()}` : `${MONTHS_SHORT[sat.getMonth()]} ${sat.getDate()}`
    return {
      rangeLabel: `Sun, ${sunStr} – Sat, ${satStr}`,
      heroTitle: 'Your Week',
      fromDay: sunKey,
      toDay: todayKey,
      totalDays: 7,
    }
  }
  return {
    rangeLabel: `${MONTHS_FULL[m]} ${y}`,
    heroTitle: `Your ${MONTHS_FULL[m]}`,
    fromDay: `${todayKey.slice(0, 8)}01`,
    toDay: todayKey,
    totalDays: day,
  }
}

export interface PeriodConsistency {
  finishedDays: number
  possibleDays: number
  priorFinishedDays: number | null
  priorLabel: string
  daysLeftInPeriod: number
}

/**
 * Counts finished days (`done: true`) vs possible elapsed days in `[fromDay, toDay]`,
 * clamping the start to the user's earliest active day in `stats.days` so new users
 * are not penalized for days before they started using cards.
 * Also computes prior week / prior month finished days so the UI can show
 * concrete "X more days beats October" / "Beat last week" goals.
 */
export function periodConsistency(
  stats: Pick<FriendStats, 'days'> | null | undefined,
  period: 'week' | 'month',
  nowMs: number = Date.now(),
): PeriodConsistency {
  const ctx = periodContext(period, nowMs)
  const { fromDay, toDay } = ctx
  const days = stats?.days ?? []
  let earliestActive: string | null = null
  for (const d of days) {
    if (d.cards > 0 || d.done) {
      if (earliestActive === null || d.day < earliestActive) earliestActive = d.day
    }
  }
  const effectiveStart = earliestActive !== null && earliestActive > fromDay && earliestActive <= toDay ? earliestActive : fromDay
  const possibleDays = Math.max(1, diffDays(effectiveStart, toDay) + 1)
  let finishedDays = 0
  for (const d of days) {
    if (d.day >= effectiveStart && d.day <= toDay && d.done) finishedDays++
  }

  // Prior period bounds & days left in current period
  const nowDate = new Date(nowMs)
  const y = nowDate.getFullYear()
  const m = nowDate.getMonth()
  let priorFrom: string
  let priorTo: string
  let priorLabel: string
  let daysLeftInPeriod: number

  if (period === 'week') {
    priorFrom = addDays(fromDay, -7)
    priorTo = addDays(fromDay, -1)
    priorLabel = 'last week'
    daysLeftInPeriod = Math.max(0, 6 - nowDate.getDay())
  } else {
    const prevMonthEnd = new Date(y, m, 0)
    const py = prevMonthEnd.getFullYear()
    const pm = prevMonthEnd.getMonth()
    const pad2 = (n: number) => String(n).padStart(2, '0')
    priorFrom = `${py}-${pad2(pm + 1)}-01`
    priorTo = `${py}-${pad2(pm + 1)}-${pad2(prevMonthEnd.getDate())}`
    priorLabel = MONTHS_FULL[pm]
    const curMonthEnd = new Date(y, m + 1, 0).getDate()
    daysLeftInPeriod = Math.max(0, curMonthEnd - nowDate.getDate())
  }

  const hasPriorHistory = earliestActive !== null && earliestActive <= priorTo
  let priorFinishedDays: number | null = null
  if (hasPriorHistory) {
    let count = 0
    for (const d of days) {
      if (d.day >= priorFrom && d.day <= priorTo && d.done) count++
    }
    priorFinishedDays = count
  }

  return { finishedDays, possibleDays, priorFinishedDays, priorLabel, daysLeftInPeriod }
}

export interface GoalHeroLines {
  line1: string
  heroText: string
  heroPrimary: string
  heroParen: string | null
  heroDone: boolean
  line3: string
}

/** Builds strictly 3 clean hero lines for Week or Month with "X more days (beat Oct)" as the star. */
export function buildPeriodGoalHero(
  stats: FriendStats | null | undefined,
  period: 'week' | 'month',
  cards: number,
  durationText: string,
  nowMs: number = Date.now(),
): GoalHeroLines {
  const ctx = periodContext(period, nowMs)
  const c = periodConsistency(stats, period, nowMs)
  const dayWord = c.possibleDays === 1 ? 'day' : 'days'
  const line1 = `${ctx.rangeLabel} · ${c.finishedDays} of ${c.possibleDays} ${dayWord}`
  const streak = stats?.totals.streak ?? 0
  const streakText = streak === 1 ? '1-day streak' : `${streak}-day streak`

  let heroPrimary: string
  let heroParen: string | null = null
  let heroDone = false
  const metaParts = [`${cards.toLocaleString()} cards`, durationText]

  if (c.priorFinishedDays !== null && c.priorFinishedDays > 0) {
    const remainingPossible = c.daysLeftInPeriod + (stats?.days.some((d) => d.day === ctx.toDay && d.done) ? 0 : 1)
    const neededToBeat = c.priorFinishedDays - c.finishedDays + 1
    const neededToTie = c.priorFinishedDays - c.finishedDays
    const shortPrior = period === 'week' ? 'last wk' : c.priorLabel.slice(0, 3)
    const metaPriorLabel = period === 'week' ? 'Last wk' : c.priorLabel.slice(0, 3)
    metaParts.push(`${metaPriorLabel}: ${c.priorFinishedDays} ${c.priorFinishedDays === 1 ? 'day' : 'days'}`)

    if (neededToBeat <= 0) {
      heroDone = true
      heroPrimary = `🎉 Beat ${shortPrior}`
      heroParen = `(${c.finishedDays} vs ${c.priorFinishedDays})`
    } else if (neededToBeat <= remainingPossible) {
      heroPrimary = `${neededToBeat} more ${neededToBeat === 1 ? 'day' : 'days'}`
      heroParen = `(beat ${shortPrior})`
    } else if (neededToTie === 0) {
      heroDone = true
      heroPrimary = `🎉 Tied ${shortPrior}`
      heroParen = `(${c.priorFinishedDays})`
    } else if (neededToTie > 0 && neededToTie <= remainingPossible) {
      heroPrimary = `${neededToTie} more ${neededToTie === 1 ? 'day' : 'days'}`
      heroParen = `(tie ${shortPrior})`
    } else {
      heroDone = c.finishedDays >= c.possibleDays
      heroPrimary = heroDone ? `🎉 ${c.finishedDays} of ${c.possibleDays} ${dayWord}` : `${c.finishedDays} of ${c.possibleDays} ${dayWord}`
    }
  } else {
    heroDone = c.finishedDays >= c.possibleDays && c.possibleDays > 0
    heroPrimary = heroDone ? `🎉 ${c.finishedDays} of ${c.possibleDays} ${dayWord}` : streakText
    if (heroPrimary !== streakText) metaParts.push(streakText)
  }

  const heroText = heroParen ? `${heroPrimary} ${heroParen}` : heroPrimary
  return { line1, heroText, heroPrimary, heroParen, heroDone, line3: metaParts.join(' · ') }
}
