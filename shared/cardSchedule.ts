import { FSRS, Rating, createEmptyCard, generatorParameters, type Card, type Grade } from 'ts-fsrs'
import { cardTime, type CardRating, type CardReview, type NoteCardRecord } from './cardLine'
import type { ReviewSettings } from './reviews'
import { inFolder } from './types'

/**
 * The note card schedule (YAZ-4959 D5): FSRS through `ts-fsrs` 5.4.2, pinned. The ONE place a card's due date is
 * computed — never stored. A card's reviews (its card line, `cardLine.ts`) are REPLAYED from an empty card: the same
 * log and the same settings give the same due date every time, on every Mac, also with fuzz on — ts-fsrs seeds its
 * fuzz from the review time, the review count, and difficulty × stability, all of which the log fixes.
 *
 * Days, not minutes: `enable_short_term: false`, so a card answered "again" comes back the next day, not in ten
 * minutes. "Due" is due before local midnight tonight (`isCardDue`).
 */

const DAY = 86_400_000

const GRADES: Record<CardRating, Grade> = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy }

/** One FSRS per settings object: a vault's settings are one object until they change. */
const schedulers = new WeakMap<ReviewSettings, FSRS>()
function schedulerOf(s: ReviewSettings): FSRS {
  let f = schedulers.get(s)
  if (f === undefined) {
    f = new FSRS(generatorParameters({ w: s.weights, request_retention: s.retention, maximum_interval: s.maxDays, enable_fuzz: s.fuzz, enable_short_term: false }))
    schedulers.set(s, f)
  }
  return f
}

/** The reviews in time order (the line holds them in the order they were made; a hand edit may not). */
const inOrder = (reviews: readonly CardReview[]): CardReview[] => [...reviews].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

/** One row of a card's Reviews table (D3, D13): the review, the days since the one before, the wait it set, and the due date it set. */
export interface CardHistoryRow {
  review: CardReview
  /** Whole days since the review before; 0 for the first. */
  elapsed: number
  /** The wait this review set, in days. */
  interval: number
  /** When this review made the card due (ms). */
  due: number
}

/** Replays `reviews` through FSRS: one row per review, in time order. */
export function cardHistory(reviews: readonly CardReview[], s: ReviewSettings): CardHistoryRow[] {
  const f = schedulerOf(s)
  const rows: CardHistoryRow[] = []
  let card: Card | null = null
  let last = 0
  for (const review of inOrder(reviews)) {
    const at = Date.parse(review.at)
    card = f.next(card ?? createEmptyCard(at), at, GRADES[review.rating]).card
    rows.push({ review, elapsed: rows.length === 0 ? 0 : Math.max(0, Math.round((at - last) / DAY)), interval: card.scheduled_days, due: card.due.getTime() })
    last = at
  }
  return rows
}

/** The FSRS card after `reviews`; null for a card never reviewed. */
function replay(reviews: readonly CardReview[], s: ReviewSettings): Card | null {
  const f = schedulerOf(s)
  let card: Card | null = null
  for (const review of inOrder(reviews)) {
    const at = Date.parse(review.at)
    card = f.next(card ?? createEmptyCard(at), at, GRADES[review.rating]).card
  }
  return card
}

/** Where a card stands after its reviews. */
export interface CardState {
  /** Never reviewed: a new card, due at once (the Inbox takes `newPerDay` of them a day). */
  isNew: boolean
  /** When it is next due (ms); null for a new card. */
  due: number | null
  /** The wait the last review set, in days; 0 for a new card. */
  interval: number
  /** The last review's time, as the line holds it; null for a new card. */
  lastReview: string | null
  /** How many times the card was answered "again" after it was learned. */
  lapses: number
}

export function cardState(reviews: readonly CardReview[], s: ReviewSettings): CardState {
  const card = replay(reviews, s)
  if (card === null) return { isNew: true, due: null, interval: 0, lastReview: null, lapses: 0 }
  return { isNew: false, due: card.due.getTime(), interval: card.scheduled_days, lastReview: inOrder(reviews).at(-1)?.at ?? null, lapses: card.lapses }
}

/** The chance to remember the card now (idea 11, Mochi's "83%"), 0 to 1; null for a new card. */
export function recallChance(reviews: readonly CardReview[], s: ReviewSettings, now: number): number | null {
  const card = replay(reviews, s)
  return card === null ? null : schedulerOf(s).get_retrievability(card, now, false)
}

/** The ratings the review buttons write, left to right (D5): two buttons by default, four by the setting. */
export const answerRatings = (s: ReviewSettings): CardRating[] => (s.buttons === 4 ? ['again', 'hard', 'good', 'easy'] : ['again', 'good'])

/** A button's name (D5): "Forgot" and "Remembered" with two buttons, Anki's four names with four. */
export const answerLabel = (rating: CardRating, s: ReviewSettings): string =>
  s.buttons === 4 ? { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' }[rating] : rating === 'again' ? 'Forgot' : 'Remembered'

/** What each button would do if pressed now (D13, the hover "Remembered · 9 days"): the review it writes, the wait and the due date. */
export interface CardAnswer {
  review: CardReview
  interval: number
  due: number
}

/**
 * Each answer button's outcome at `now`, in button order. The review time is `now` to the minute, as the line will
 * hold it, so the wait shown is the wait the replay gives once the answer is written — fuzz included.
 */
export function previewAnswers(reviews: readonly CardReview[], s: ReviewSettings, now: number): CardAnswer[] {
  const at = cardTime(now)
  return answerRatings(s).map((rating) => {
    const review = { at, rating }
    const row = cardHistory([...reviews, review], s).at(-1)!
    return { review, interval: row.interval, due: row.due }
  })
}

/** Due now: due before local midnight tonight, the one test the Inbox, the count and `yaseendocs due` share. */
export const isCardDue = (due: number, now: number): boolean => due < new Date(now).setHours(24, 0, 0, 0)

/** A number of days as the UI says it: "1 day", "30 days". */
export const dayCount = (n: number): string => `${n} day${n === 1 ? '' : 's'}`

/** One card the Inbox shows. The card's text is not in the index (D4): read the page to show it. */
export interface DueCard {
  /** The page's absolute path. */
  path: string
  /** The card's place among the page's cards (`findCards` order). */
  index: number
  id: string
  /** When it is due (ms); a new card is due `now`. */
  due: number
  isNew: boolean
}

/** Is `ms` today, on this computer's calendar? */
const isToday = (ms: number, now: number): boolean => new Date(ms).toDateString() === new Date(now).toDateString()

/**
 * The cards due now (D11): each card that is in review — it has an ID, and is not `off` — and whose due date is
 * before local midnight tonight, most overdue first; then new cards in page order, as many as `newPerDay` leaves
 * today (a card counts as new on the day of its first review). None while the vault has review off.
 * `folder` (root-relative, '' = the vault) keeps the cards of that folder and its subfolders.
 */
export function cardQueue(records: readonly { path: string; folder: string; cards?: readonly NoteCardRecord[] }[], s: ReviewSettings, now: number, folder = ''): DueCard[] {
  if (!s.enabled) return []
  const due: DueCard[] = []
  const fresh: DueCard[] = []
  let startedToday = 0
  const sorted = [...records].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  for (const r of sorted) {
    const mine = inFolder(r.folder, folder)
    ;(r.cards ?? []).forEach((card, index) => {
      const first = card.reviews.length === 0 ? undefined : inOrder(card.reviews)[0]
      if (first !== undefined && isToday(Date.parse(first.at), now)) startedToday++
      if (!mine || card.off || card.id === null) return
      if (first === undefined) fresh.push({ path: r.path, index, id: card.id, due: now, isNew: true })
      else {
        const at = cardState(card.reviews, s).due!
        if (isCardDue(at, now)) due.push({ path: r.path, index, id: card.id, due: at, isNew: false })
      }
    })
  }
  due.sort((a, b) => a.due - b.due || (a.path < b.path ? -1 : a.path > b.path ? 1 : a.index - b.index))
  return [...due, ...fresh.slice(0, Math.max(0, s.newPerDay - startedToday))]
}
