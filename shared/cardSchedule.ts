import { FSRS, Rating, createEmptyCard, generatorParameters, type Card, type Grade } from 'ts-fsrs'
import { cardTime, type CardRating, type CardReview, type NoteCardRecord } from './cardLine'
import { hasLetters, noteIdNumber } from './noteId'
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

/** The FSRS card after each review of `reviews`, in time order, with its review: the ONE replay loop. */
function steps(reviews: readonly CardReview[], s: ReviewSettings): { review: CardReview; card: Card }[] {
  const f = schedulerOf(s)
  const out: { review: CardReview; card: Card }[] = []
  for (const review of inOrder(reviews)) {
    const at = Date.parse(review.at)
    out.push({ review, card: f.next(out.at(-1)?.card ?? createEmptyCard(at), at, GRADES[review.rating]).card })
  }
  return out
}

/** Replays `reviews` through FSRS: one row per review, in time order. */
export function cardHistory(reviews: readonly CardReview[], s: ReviewSettings): CardHistoryRow[] {
  return steps(reviews, s).map(({ review, card }, i, all) => ({
    review,
    elapsed: i === 0 ? 0 : Math.max(0, Math.round((Date.parse(review.at) - Date.parse(all[i - 1].review.at)) / DAY)),
    interval: card.scheduled_days,
    due: card.due.getTime(),
  }))
}

/** The FSRS card after `reviews`, and the last review; null for a card never reviewed. */
const replay = (reviews: readonly CardReview[], s: ReviewSettings): { review: CardReview; card: Card } | null => steps(reviews, s).at(-1) ?? null

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
  const last = replay(reviews, s)
  if (last === null) return { isNew: true, due: null, interval: 0, lastReview: null, lapses: 0 }
  const { card, review } = last
  return { isNew: false, due: card.due.getTime(), interval: card.scheduled_days, lastReview: review.at, lapses: card.lapses }
}

/** The chance to remember the card now (idea 11, Mochi's "83%"), 0 to 1; null for a new card. */
export function recallChance(reviews: readonly CardReview[], s: ReviewSettings, now: number): number | null {
  const last = replay(reviews, s)
  return last === null ? null : schedulerOf(s).get_retrievability(last.card, now, false)
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
  /** Up next (the line's `next`, YAZ-4999 D3): shown before every other card. */
  next: boolean
}

/**
 * The due date of a card that has reviews (NaN for a new card), cached (YAZ-4967) by its log as text, one map per
 * settings object: new settings are a new object, so a settings change starts empty. A hit costs a string join and
 * a lookup, no FSRS step.
 */
const dueCache = new WeakMap<ReviewSettings, Map<string, number>>()
/** A cap so a long session cannot grow the log map without end: past it, the map starts again. Each answer adds a log. */
const CACHE_MAX = 20_000

export function cardDueAt(reviews: readonly CardReview[], s: ReviewSettings): number {
  if (reviews.length === 0) return Number.NaN
  let map = dueCache.get(s)
  if (map === undefined) dueCache.set(s, (map = new Map()))
  let key = ''
  for (const r of reviews) key += `${r.at} ${r.rating},`
  let due = map.get(key)
  if (due === undefined) {
    if (map.size >= CACHE_MAX) map.clear()
    map.set(key, (due = replay(reviews, s)?.card.due.getTime() ?? Number.NaN))
  }
  return due
}

/** What the queue needs of each card of a page, in page order: its due date (NaN when new) and its first review's time. */
interface CardFacts {
  due: number
  first: string | null
}

/** A page as the index hands it: `mtime` and `size` say its bytes did not change. */
type CardPage = { path: string; folder: string; mtime?: number; size?: number; cards?: readonly NoteCardRecord[] }

/** Each page's facts by its PATH, with the mtime and size they are for: one entry per page, never per save. */
const pageCache = new WeakMap<ReviewSettings, Map<string, { mtime: number; size: number; facts: readonly CardFacts[] }>>()

/**
 * The facts of each card of `r`. The Inbox count runs on every index change, and a snapshot is new objects each
 * time (IPC), so a page whose mtime and size are the same as last time takes its facts from the cache: a lookup per
 * PAGE. A page without mtime (a test, the command) is worked out card by card through `cardDueAt`.
 */
function cardFacts(r: CardPage, s: ReviewSettings): readonly CardFacts[] {
  const cards = r.cards ?? []
  const keyed = typeof r.mtime === 'number' && typeof r.size === 'number'
  let map = keyed ? pageCache.get(s) : undefined
  if (keyed && map === undefined) pageCache.set(s, (map = new Map()))
  const hit = map?.get(r.path)
  if (hit !== undefined && hit.mtime === r.mtime && hit.size === r.size && hit.facts.length === cards.length) return hit.facts
  const facts = cards.map((card) => ({
    due: cardDueAt(card.reviews, s),
    // The earliest review, without a sort.
    first: card.reviews.reduce<string | null>((a, x) => (a === null || x.at < a ? x.at : a), null),
  }))
  if (map !== undefined) map.set(r.path, { mtime: r.mtime!, size: r.size!, facts })
  return facts
}

/** How many cards a page has, and how many of them are due now (idea 2, the folder columns "Cards" and "Due"). */
export interface PageCardCounts {
  cards: number
  /**
   * Cards with reviews that are due now (in review: an ID, not `off`). A NEW card is not counted: the new cards a day
   * (`newPerDay`) are the vault's limit, so no page can say how many of its own the Inbox takes. 0 while review is off.
   */
  due: number
}

export function pageCardCounts(r: CardPage, s: ReviewSettings, now: number): PageCardCounts {
  const cards = r.cards ?? []
  let due = 0
  if (s.enabled && cards.length > 0) {
    const facts = cardFacts(r, s)
    cards.forEach((card, i) => {
      // An up-next card is due now (YAZ-4999 D3).
      if (!card.off && card.id !== null && card.reviews.length > 0 && (card.next || isCardDue(facts[i].due, now))) due++
    })
  }
  return { cards: cards.length, due }
}

/**
 * A card's place in the vault's time (YAZ-4999 D2): its ID number, the vault's one counter, so a lower number is an
 * older card. An ID with letters that are not the vault's (`letters` given: a pasted card the sweep has not given a
 * number yet) has no place: Infinity, so it sorts last.
 */
function idAge(id: string, letters: readonly string[] | undefined): number {
  if (letters !== undefined && letters.length > 0 && !hasLetters(letters, id.slice(0, id.indexOf('-')))) return Number.POSITIVE_INFINITY
  return noteIdNumber(id) ?? Number.POSITIVE_INFINITY
}

/**
 * The cards due now (D11), in this order:
 *  1. UP NEXT (YAZ-4999 D3): each card whose line holds `next`, due or not, new or not, by ID number (the time of the
 *     mark is not in the file). They are outside the new-card limit, and are due now.
 *  2. Each card with reviews whose due date is before local midnight tonight, most overdue first.
 *  3. New cards, by ID number (`newOrder`: the oldest or the newest first, D2; an ID of other letters last), as many as
 *     `newPerDay` leaves today (a card counts as new on the day of its first review); `newPerDay` null: all of them (D1).
 * Only a card in review shows: it has an ID, and is not `off` (`off` wins over `next`). None while the vault has
 * review off. `folder` (root-relative, '' = the vault) keeps the cards of that folder and its subfolders; `page` (a
 * page's absolute path, "Review this page", idea 4) keeps that page's cards alone. Either way the new cards begun today
 * are counted over the whole vault: the limit is the vault's. A card whose ID a card before it on the same page holds
 * (a copy the sweep has not settled yet) is left out until it has its own ID: the Inbox never shows one card twice.
 * `letters`: the vault's ID letters (`hasLetters`), so an ID of other letters sorts last.
 */
export function cardQueue(records: readonly CardPage[], s: ReviewSettings, now: number, folder = '', page?: string, letters?: readonly string[]): DueCard[] {
  if (!s.enabled) return []
  const next: DueCard[] = []
  const due: DueCard[] = []
  const fresh: DueCard[] = []
  let startedToday = 0
  // Today on this computer's calendar, as minutes the line writes: a card line's time sorts as text.
  const today = cardTime(new Date(now).setHours(0, 0, 0, 0))
  const tomorrow = cardTime(new Date(now).setHours(24, 0, 0, 0))
  // Only the pages with cards: most pages have none, and the sort is the loop's one cost per page.
  const sorted = records.filter((r) => r.cards !== undefined && r.cards.length > 0).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  for (const r of sorted) {
    const mine = page === undefined ? inFolder(r.folder, folder) : r.path === page
    const facts = cardFacts(r, s)
    const ids = new Set<string>()
    ;(r.cards ?? []).forEach((card, index) => {
      const { due: at, first } = facts[index]
      if (first !== null && first >= today && first < tomorrow) startedToday++
      if (!mine || card.off || card.id === null || ids.has(card.id)) return
      ids.add(card.id)
      const isNew = first === null
      if (card.next === true) next.push({ path: r.path, index, id: card.id, due: isNew ? now : Math.min(at, now), isNew, next: true })
      else if (isNew) fresh.push({ path: r.path, index, id: card.id, due: now, isNew: true, next: false })
      else if (isCardDue(at, now)) due.push({ path: r.path, index, id: card.id, due: at, isNew: false, next: false })
    })
  }
  const place = (a: DueCard, b: DueCard): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.index - b.index)
  /** By ID number, `sign` 1 the oldest first, -1 the newest; an ID with no place last either way. */
  const byAge =
    (sign: 1 | -1) =>
    (a: DueCard, b: DueCard): number => {
      const x = idAge(a.id, letters)
      const y = idAge(b.id, letters)
      if (x === y) return place(a, b)
      if (x === Number.POSITIVE_INFINITY) return 1
      if (y === Number.POSITIVE_INFINITY) return -1
      return sign * (x - y)
    }
  next.sort(byAge(1))
  due.sort((a, b) => a.due - b.due || place(a, b))
  fresh.sort(byAge(s.newOrder === 'newest' ? -1 : 1))
  return [...next, ...due, ...(s.newPerDay === null ? fresh : fresh.slice(0, Math.max(0, s.newPerDay - startedToday)))]
}
