/**
 * How long reviews took, in words (YAZ-5033): the Reviews table's Time column and the Inbox's "Today: …" (`TodayWork`). Pure.
 */
import type { ReviewedToday } from '@shared/cardSchedule'

/** One answer's time: "13 s", "1 min 4 s", "2 min"; "—" when the review has none (made before YAZ-5033). */
export function reviewDuration(seconds: number | undefined): string {
  if (seconds === undefined) return '—'
  if (seconds < 60) return `${seconds} s`
  const min = Math.floor(seconds / 60)
  const s = seconds % 60
  return s === 0 ? `${min} min` : `${min} min ${s} s`
}

/** A day's total: "45 s" under a minute, else whole minutes ("9 min"). */
export const todayDuration = (seconds: number): string => (seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`)

/**
 * "Today: 31 cards" (YAZ-5033); empty with no card today. The time, "9 min" (`todayDuration`), is its own part after
 * it (YAZ-5130): `TodayWork` shows it, hides it behind a click, or leaves it out, by Settings › Review › Time so far.
 */
export const todayCards = (today: ReviewedToday): string => (today.cards === 0 ? '' : `Today: ${today.cards} card${today.cards === 1 ? '' : 's'}`)
