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
 * "Today: 31 cards" (YAZ-5033); empty with no card today. YAZ-5678 (honest numbers; YAZ-5669, Yaseen: "is it true
 * today i did 10 cards? … so 20 total?"): it counts different cards, so when a card was answered more than once the
 * answers say so too, "Today: 10 cards · 17 reviews". The time, "9 min" (`todayDuration`), is its own part after it
 * (YAZ-5130): `TodayWork` shows it, hides it behind a click, or leaves it out, by Settings › Review › Time so far.
 */
export function todayCards(today: ReviewedToday): string {
  if (today.cards === 0) return ''
  const cards = `Today: ${today.cards} card${today.cards === 1 ? '' : 's'}`
  return today.reviews > today.cards ? `${cards} · ${today.reviews} reviews` : cards
}

/**
 * A finish screen's "Today: 25 cards · 31 reviews · 12 min" (YAZ-5665, Yaseen: "on the completion screen can we show it?"): the
 * time always, whatever Settings › Review › Time so far says (that setting is for DURING the review). No seconds today
 * (only old reviews): the cards alone. Empty with no card today.
 */
export function todayDone(today: ReviewedToday): string {
  const cards = todayCards(today)
  return cards === '' || today.seconds === 0 ? cards : `${cards} · ${todayDuration(today.seconds)}`
}
