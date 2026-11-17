/**
 * How long reviews took, in words (YAZ-5033): the Reviews table's Time column, the Inbox's "Today: …" and the View panel's Time (`ReviewViewButton`). Pure.
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
 * "Today: 2 learned · 3 reviews" (YAZ-5684, as Mochi's Dashboard, which always shows both): new cards that got their
 * first ✓ today, and the first answer today on each due card (`reviewedToday`); empty with neither. The time, "9 min"
 * (`todayDuration`), is its own part after it on the finish screens (`todayDone`).
 */
export function todayCards(today: ReviewedToday): string {
  if (today.learned === 0 && today.reviews === 0) return ''
  return `Today: ${today.learned} learned · ${today.reviews} review${today.reviews === 1 ? '' : 's'}`
}

/**
 * The cards menu's foot (YAZ-5690, Yaseen: "I do agree with you that we can do today twenty one cards"): "Today: 21
 * cards", every different card answered today, new and due; no reviews and no time (the time is in the top row's
 * View panel, YAZ-5689). Empty with none. The phone's sheet says the same, its time after it (it has no View panel).
 */
export function todayStudied(today: ReviewedToday): string {
  if (today.cards === 0) return ''
  return `Today: ${today.cards} card${today.cards === 1 ? '' : 's'}`
}

/**
 * A finish screen's "Today: 2 learned · 31 reviews · 12 min" (YAZ-5665, Yaseen: "on the completion screen can we show it?"): the
 * time always, whatever Settings › Review › Time so far says (that setting is for DURING the review). No seconds today
 * (only old reviews): the counts alone. Empty with nothing today.
 */
export function todayDone(today: ReviewedToday): string {
  const cards = todayCards(today)
  return cards === '' || today.seconds === 0 ? cards : `${cards} · ${todayDuration(today.seconds)}`
}
