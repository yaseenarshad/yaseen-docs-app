/**
 * Shared Friends leaderboard sorting, daily marks, Study Buddy Emojis, and shared-card filters (YAZ-6200).
 * Pure — no React, no DOM, no network. Used identically on Phone and Desktop.
 */
import type { FriendDay, FriendStats } from './friendStatsFormat'
import type { FriendBoardMember, SharedCardItem, SharedCardStatus } from './friendsApi'

export type BoardPeriod = 'today' | 'yesterday' | 'week' | 'month'
export type LeaderboardSort = 'cards' | 'time' | 'streak'
export type DailyMark = 'finished' | 'started' | 'not-started'

export const DAILY_MARK_SIGN: Record<DailyMark, string> = {
  finished: '✓',
  started: '◐',
  'not-started': '○',
}

export interface BuddyEmoji {
  emoji: string
  label: string
  reason: string
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
  emojis: BuddyEmoji[]
}

const pad = (n: number) => String(n).padStart(2, '0')

export function localDayKey(nowMs: number): string {
  const d = new Date(nowMs)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(y, m - 1, d + delta)
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
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
  if (row.done) return 'finished'
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

/** Last 7 local days chain for the Seinfeld "don't break the streak" display: 'done' | 'open' | 'missed'. */
export function sevenDayChain(stats: FriendStats | null, nowMs: number): ('done' | 'open' | 'missed')[] {
  const today = localDayKey(nowMs)
  const byDay = new Map<string, FriendDay>()
  for (const d of stats?.days ?? []) byDay.set(d.day, d)
  const out: ('done' | 'open' | 'missed')[] = []
  for (let i = 6; i >= 0; i--) {
    const key = addDays(today, -i)
    const row = byDay.get(key)
    if (row?.done) out.push('done')
    else if (i === 0) out.push('open')
    else out.push('missed')
  }
  return out
}

/** Smart context-aware Cheer / Nudge label & message based on a friend's streak and daily status (D12). */
export function smartMarkSuggestion(friend: Pick<FriendBoardMember, 'name' | 'stats'>, nowMs: number): {
  kind: 'cheer' | 'nudge'
  buttonLabel: string
  message: string
} {
  const mark = dailyMarkOf(friend.stats, nowMs)
  const streak = friend.stats?.totals.streak ?? 0
  if (mark === 'finished') {
    if (streak >= 3) {
      return { kind: 'cheer', buttonLabel: `Cheer ${streak}d streak`, message: `cheered your ${streak}-day streak! 🔥` }
    }
    return { kind: 'cheer', buttonLabel: 'Cheer', message: 'cheered your review today! 🎉' }
  }
  if (streak >= 3) {
    return { kind: 'nudge', buttonLabel: `Save ${streak}d streak ⏳`, message: `nudged you — don't break your ${streak}-day streak! ⏳` }
  }
  return { kind: 'nudge', buttonLabel: 'Nudge', message: 'sent a friendly nudge to review today!' }
}

/**
 * Snapchat-style Study Buddy Emojis (YAZ-6200 D11):
 * Computed from existing D1 interaction data (mutual streaks, shared card counts, cheers/nudges).
 */
export function computeBuddyEmojis(
  friend: FriendBoardMember,
  me: { stats: FriendStats | null },
  allFriends: readonly FriendBoardMember[],
  nowMs: number,
): BuddyEmoji[] {
  const out: BuddyEmoji[] = []
  const myStreak = me.stats?.totals.streak ?? 0
  const theirStreak = friend.stats?.totals.streak ?? 0
  const mutualStreak = Math.min(myStreak, theirStreak)

  // 1. Mutual Study Streak (🔥) and Streak at Risk (⏳)
  if (mutualStreak >= 3) {
    out.push({ emoji: '🔥', label: 'Study Streak', reason: `You and ${friend.name} both have a ${mutualStreak}+ day streak` })
    const myMark = dailyMarkOf(me.stats, nowMs)
    const theirMark = dailyMarkOf(friend.stats, nowMs)
    if (myMark !== 'finished' || theirMark !== 'finished') {
      out.push({ emoji: '⏳', label: 'Streak at Risk', reason: 'Finish daily due cards today to keep your mutual streak alive' })
    }
  }

  // 2. Top Study Buddy (#1 by shared cards + recent marks)
  const scoreOf = (f: FriendBoardMember) => f.sharedCardCount * 2 + (f.incomingMark ? 1 : 0) + (f.outgoingMark ? 1 : 0)
  const myScore = scoreOf(friend)
  if (myScore > 0) {
    const maxScore = allFriends.reduce((acc, f) => Math.max(acc, scoreOf(f)), 0)
    const daysFriends = Math.max(0, Math.floor((nowMs - Date.parse(friend.since)) / 86_400_000))
    if (myScore === maxScore && allFriends.length > 0) {
      if (daysFriends >= 60 && myScore >= 20) {
        out.push({ emoji: '💕', label: 'Super Study Buddy', reason: '#1 study buddy for 2+ months' })
      } else if (daysFriends >= 14 && myScore >= 10) {
        out.push({ emoji: '❤️', label: 'Best Study Buddy', reason: '#1 study buddy for 2+ weeks' })
      } else {
        out.push({ emoji: '💛', label: '#1 Study Buddy', reason: 'Your most active friend by shared cards and cheers' })
      }
    } else if (friend.sharedCardCount >= 10) {
      out.push({ emoji: '📚', label: 'Card Sharer', reason: `${friend.sharedCardCount} cards shared together` })
    } else if (friend.incomingMark || friend.outgoingMark) {
      out.push({ emoji: '🤝', label: 'Active Buddy', reason: 'Recently exchanged cheers or cards' })
    }
  }

  return out
}

export function filterSharedCards(cards: readonly SharedCardItem[], status: SharedCardStatus): SharedCardItem[] {
  return cards.filter((c) => c.status === status)
}

export function formatMinutes(seconds: number): string {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`
}
