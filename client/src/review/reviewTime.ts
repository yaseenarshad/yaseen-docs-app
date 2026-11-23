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
 * THE ONE TODAY LINE (YAZ-5690, YAZ-5710, Yaseen: "lets go with ur rec"): "Today: 21 cards", every different card
 * answered today, new and due. The cards menu's foot (the Mac: no reviews and no time, the time is in the top row's
 * View panel, YAZ-5689; the phone's sheet: its time after it, it has no View panel) and every finish screen
 * (`todayDone`). Empty with none.
 */
export function todayStudied(today: ReviewedToday): string {
  if (today.cards === 0) return ''
  return `Today: ${today.cards} card${today.cards === 1 ? '' : 's'}`
}

/**
 * A finish screen's "Today: 21 cards · 12 min" (YAZ-5665, YAZ-5710): the cards menu's words (`todayStudied`), then the
 * time always, whatever Settings › Review › Time so far says (that setting is for DURING the review). No seconds today
 * (only old reviews): the cards alone. Empty with nothing today.
 */
export function todayDone(today: ReviewedToday): string {
  const cards = todayStudied(today)
  return cards === '' || today.seconds === 0 ? cards : `${cards} · ${todayDuration(today.seconds)}`
}
