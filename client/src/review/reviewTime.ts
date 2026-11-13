/**
 * How long reviews took, in words (YAZ-5033): the Reviews table's Time column and the Inbox's "Today: …". Pure.
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

/** "Today: 31 cards · 9 min" (YAZ-5033); the time is left out while today's reviews have none. Empty with no card today. */
export function todayWork(today: ReviewedToday): string {
  if (today.cards === 0) return ''
  const cards = `Today: ${today.cards} card${today.cards === 1 ? '' : 's'}`
  return today.seconds === 0 ? cards : `${cards} · ${todayDuration(today.seconds)}`
}
