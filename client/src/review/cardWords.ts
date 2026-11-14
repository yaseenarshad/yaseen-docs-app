/**
 * The words of the card screens (YAZ-5032, YAZ-5020): waits, dates, the review history strip's facts and the Reviews
 * table's rows, with no bridge, no app state and no React (YAZ-5161). The Mac's card window and Inbox
 * (`cardParts.tsx`, which gives out the same names) and the phone's Review screen (4B) say the same words.
 */
import type { CardReview } from '@shared/cardLine'
import { cardState, cardStateWithout, dayCount, recallChance, type AddKind } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'

/** A date as the card screens say it: "Nov 21", with the year when it is not this year's. */
export function cardDate(ms: number, now = Date.now()): string {
  const date = new Date(ms)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' })
}

/**
 * A wait as the screens say it: "later today" for a card in its same-day steps (YAZ-5020: it comes back in this
 * session), "today" for 0, else "9 days".
 */
export const cardWait = (days: number, inSteps = false): string => (inSteps ? 'later today' : days === 0 ? 'today' : dayCount(days))

/** The day `due` is past (the strip then says "Overdue · …" with no "Due" label). */
export const cardOverdue = (due: number, now: number): boolean => due < new Date(now).setHours(0, 0, 0, 0)

/** A date in full, as the Reviews table says it (YAZ-5032, as Mochi's): "Sep 24, 2026". */
export const cardFullDate = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** The toggle's words (YAZ-5032, as Mochi's): "1 Review", "4 Reviews". The page's card block says the same (`cardBlockView.ts`). */
export const reviewsTitle = (n: number): string => `${n} Review${n === 1 ? '' : 's'}`

/** What review knows of a card, for the strip (YAZ-5032): its last answer, the wait it set, when it is due, the recall chance. Null for a new card. */
export interface CardFactsData {
  last: CardReview
  interval: number
  inSteps: boolean
  due: number
  recall: number | null
}

export function cardFacts(reviews: readonly CardReview[], settings: ReviewSettings, now: number): CardFactsData | null {
  const state = cardState(reviews, settings)
  const last = state.lastReview === null ? undefined : reviews.filter((r) => r.at === state.lastReview).at(-1)
  if (state.isNew || last === undefined || state.due === null) return null
  return { last, interval: state.interval, inSteps: state.inSteps, due: state.due, recall: recallChance(reviews, settings, now) }
}

/** The (i) of the recall chance (YAZ-5032; round 2, plain words): the strip's one help. */
export const RECALL_HELP = 'How likely you are to remember this card today. It drops the longer the card waits. A review brings it back up.'

/** Whole local days from today to the day of `ms`: 0 today, 1 tomorrow, -3 three days ago. */
const daysUntil = (ms: number, now: number): number => Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000)

/**
 * The review to come in words (YAZ-5032), the strip's and the table's last row: its date in full (none for today and
 * for a card in its same-day steps), and how far it is — "in 183 days", "3 days ago", "today", "later today".
 */
export function cardNextReview(due: number, inSteps: boolean, now: number): { date: string | null; days: number | null; when: string } {
  const days = daysUntil(due, now)
  // A step of a day gone by is overdue like any card: its date, and how long ago.
  if (inSteps && days >= 0) return { date: null, days: null, when: 'later today' }
  if (days === 0) return { date: null, days: 0, when: 'today' }
  const n = Math.abs(days)
  // Round 2 (plain words): a day ahead or behind is "tomorrow" or "yesterday".
  const when = days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : days > 0 ? `in ${dayCount(n)}` : `${dayCount(n)} ago`
  return { date: cardFullDate(due), days, when }
}

/**
 * The review to come in words (YAZ-5032 round 2, Yaseen: "the next review … needs better copy"): "Due" first, the
 * app's one word for it (the Inbox's "due today", the Next due column), then how far, then the date —
 * "Due in 183 days (Apr 28, 2027)", "Due today", "Due later today", "Due 3 days ago (Oct 24, 2026)". The strip and the
 * table's last row say the same words.
 */
export const cardDueWords = (next: ReturnType<typeof cardNextReview>): string => `Due ${next.when}${next.date === null ? '' : ` (${next.date})`}`

/** The table's columns, in Yaseen's order (YAZ-5032); the last, unnamed one holds the delete. */
export const REVIEW_COLUMNS = ['Reviewed on', 'Answer', 'Gap', 'Time', 'Next due'] as const

/**
 * What removing `review` does to the card, in words (YAZ-5032 round 2, Yaseen: "a pop up that would show the
 * consequences"): the schedule run again without it (`cardStateWithout`) — "The due date moves from Apr 28, 2027 to
 * Mar 3, 2027 (in 110 days).", "The due date stays Apr 28, 2027.", or, for the card's only review, "This is the card's
 * only review. The card becomes new again."
 */
export function cardRemoveOutcome(reviews: readonly CardReview[], review: CardReview, settings: ReviewSettings, now: number): string {
  const after = cardStateWithout(reviews, review.at, settings)
  if (after.isNew || after.due === null) return "This is the card's only review. The card becomes new again."
  const before = cardState(reviews, settings)
  const was = before.due === null ? cardNextReview(now, false, now) : cardNextReview(before.due, before.inSteps, now)
  const will = cardNextReview(after.due, after.inSteps, now)
  const from = was.date ?? was.when
  const to = will.date ?? will.when
  if (from === to) return `The due date stays ${to}.`
  return `The due date moves from ${from} to ${to}${will.date === null ? '' : ` (${will.when})`}.`
}

/** What waits past today's number (YAZ-5042), as the done screen says it: "38 new cards and 3 Up next cards wait for another day." */
export function waitingLine(more: Record<AddKind, number>, kinds: readonly AddKind[]): string {
  const parts = kinds.map((k) => `${more[k]} ${k === 'new' ? 'new' : 'Up next'} card${more[k] === 1 ? '' : 's'}`)
  const one = kinds.length === 1 && more[kinds[0]] === 1
  return `${parts.join(' and ')} ${one ? 'waits' : 'wait'} for another day.`
}

/** The add's line (YAZ-5042), after its "+": "Added 10 new cards for today". */
export const addedLine = (kind: AddKind, n: number): string => `Added ${n} ${kind === 'new' ? 'new' : 'Up next'} card${n === 1 ? '' : 's'} for today`

/** A Reset's line (YAZ-5042 round 2), after its "↺": "Reset today's new cards" (back to the Settings number). */
export const resetLine = (kind: AddKind): string => `Reset today's ${kind === 'new' ? 'new cards' : 'Up next'}`
