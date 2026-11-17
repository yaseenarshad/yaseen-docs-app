import { FSRS, Rating, StrategyMode, createEmptyCard, type AbstractScheduler, generatorParameters, type Card, type Grade } from 'ts-fsrs'
import { cardReviewsOf, cardTime, withoutCardReview, type CardRating, type CardReview, type CardRecord } from './cardLine'
import { embeddedCards, makeCardResolver } from './cardLinks'
import { hasLetters, pageIdNumber } from './pageId'
import type { ReviewSettings } from './reviews'
import { inFolder } from './types'

/**
 * The card schedule (YAZ-4959 D5): FSRS through `ts-fsrs` 5.4.2, pinned. The ONE place a card's due date is
 * computed — never stored. A card's reviews (its card line, `cardLine.ts`) are REPLAYED from an empty card: the same
 * log and the same settings give the same due date every time, on every Mac, also with fuzz on — ts-fsrs seeds its
 * fuzz from the review time, the review count, and difficulty × stability, all of which the log fixes.
 *
 * Days only, as Mochi (YAZ-5702 Decision, Mochi's scheduler YAZ-5703 findings E1–E2): `enable_short_term: false`, no
 * learning or relearning steps, so every wait FSRS gives is whole days: a Forgot gives 1 day, the Remembered after it a
 * few days. This replaces the one-minute steps of YAZ-5020 and the "held" rule of 8c467b70f.
 *
 * The only same-day returns are the app's (Review rules, the YAZ-5655 amendment, "only misses come back"):
 *  - A NEW card's first ✓ is ADDED to today's reviews (Mochi's "Added", "Added card to reviews · Undo"), so it gets
 *    ONE more review today. After that review FSRS's days count.
 *  - A ✕ comes back: a new card's in the new-cards run, a due card's once in "Review missed cards" (Mochi's finding 5:
 *    Due today keeps it). A ✕ in the missed pass brings it back again; its ✓ there is done for today.
 *  - A due card's ✓ is done for today. Nothing else comes back the same day.
 * Both are one flag, `comesBack`: the card is due at its review's own time (due now, also in an Inbox opened again and
 * on the other device), whatever wait FSRS gave; `interval` keeps FSRS's wait. FSRS only sees the reviews.
 * Reviews keep their full time on the line (YAZ-5642: to the millisecond, so no two share one); they replay in time
 * order. "Due" is due before local midnight tonight (`isCardDue`).
 *
 * The LOCAL day (Review rules v1, rule 14, YAZ-5655; Anki's way): ts-fsrs counts the days between two reviews by their
 * UTC dates, so in Phoenix an evening ✓ after 17:00 was "the next day". The replay hands FSRS each time moved by the
 * device's UTC offset (`localFrame`), so FSRS's UTC date is the local date, and moves each due date back by the same
 * offset: a due date is still the review time plus the wait, to the millisecond. The fuzz seed keeps the real time
 * (`seedAt`), so the same log gives the same fuzz as before.
 */

const DAY = 86_400_000

const GRADES: Record<CardRating, Grade> = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy }

/** Rule 14: the ms to take from time `t` so that its UTC date and clock are the device's local ones (0 in UTC). */
const localShift = (t: number): number => new Date(t).getTimezoneOffset() * 60_000
/** Rule 14: time `t` in the frame FSRS counts days in: its UTC date is the local date of `t`. */
const localFrame = (t: number): number => t - localShift(t)

/** Rule 14: the real time of the review FSRS steps now, for the fuzz seed (ts-fsrs's own seed, on the real time). */
let seedAt = 0

/** One FSRS per settings object: a vault's settings are one object until they change. */
const schedulers = new WeakMap<ReviewSettings, FSRS>()
function schedulerOf(s: ReviewSettings): FSRS {
  let f = schedulers.get(s)
  if (f === undefined) {
    f = new FSRS(generatorParameters({ w: s.weights, request_retention: s.retention, maximum_interval: s.maxDays, enable_fuzz: s.fuzz, enable_short_term: false }))
    // ts-fsrs's default seed (its review time, reps, difficulty × stability), with the real time, not the local frame's.
    f.useStrategy(StrategyMode.SEED, function (this: AbstractScheduler) {
      // `current` is protected in ts-fsrs's types; the default seed reads it the same way.
      const { reps, difficulty, stability } = (this as unknown as { current: Card }).current
      return `${seedAt}_${reps}_${difficulty * stability}`
    })
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
  /** The wait FSRS gave this review, in whole days (days only, YAZ-5702). */
  interval: number
  /** When this review made the card due (ms): its own time when it `comesBack`. */
  due: number
  /** The card comes back today (YAZ-5702): a ✕, or a new card's first ✓ (added to today's reviews, Mochi's "Added"). */
  comesBack: boolean
}

/**
 * One step of the replay: the review, the FSRS card after it (in the local frame, rule 14), its real due time, and
 * whether the card comes back today (a ✕, or a new card's first ✓).
 */
interface ReplayStep {
  review: CardReview
  card: Card
  due: number
  comesBack: boolean
}

/** The FSRS card after each review of `reviews`, in time order, with its review: the ONE replay loop. */
function steps(reviews: readonly CardReview[], s: ReviewSettings): ReplayStep[] {
  const f = schedulerOf(s)
  const out: ReplayStep[] = []
  let learned = false
  for (const review of inOrder(reviews)) {
    const at = Date.parse(review.at)
    const local = localFrame(at)
    seedAt = at
    const card = f.next(out.at(-1)?.card ?? createEmptyCard(local), local, GRADES[review.rating]).card
    // YAZ-5702: a ✕, or a new card's first ✓ (added to today's reviews), comes back today: due at once.
    const comesBack = review.rating === 'again' || !learned
    learned ||= review.rating !== 'again'
    // Else back from the local frame by the review's own offset: the due date is the review time plus the wait.
    out.push({ review, card, due: comesBack ? at : card.due.getTime() + (at - local), comesBack })
  }
  return out
}

/** Replays `reviews` through FSRS: one row per review, in time order. */
export function cardHistory(reviews: readonly CardReview[], s: ReviewSettings): CardHistoryRow[] {
  return steps(reviews, s).map(({ review, card, due, comesBack }, i, all) => ({
    review,
    elapsed: i === 0 ? 0 : Math.max(0, Math.round((Date.parse(review.at) - Date.parse(all[i - 1].review.at)) / DAY)),
    interval: card.scheduled_days,
    due,
    comesBack,
  }))
}

/** The FSRS card after `reviews`, and the last review; null for a card never reviewed. */
const replay = (reviews: readonly CardReview[], s: ReviewSettings): ReplayStep | null => steps(reviews, s).at(-1) ?? null

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
  /** It comes back today (YAZ-5702): its last review was a ✕, or a new card's first ✓. Due now. */
  comesBack: boolean
}

export function cardState(reviews: readonly CardReview[], s: ReviewSettings): CardState {
  const last = replay(reviews, s)
  if (last === null) return { isNew: true, due: null, interval: 0, lastReview: null, lapses: 0, comesBack: false }
  const { card, review, due, comesBack } = last
  return { isNew: false, due, interval: card.scheduled_days, lastReview: review.at, lapses: card.lapses, comesBack }
}

/**
 * The card's state with one review taken away (YAZ-5032 round 2: the ask before a remove says what it does): the
 * schedule run again without it. The review taken is the one the remove takes (`withoutCardReview`): the last one at
 * `at` in the line's order.
 */
export const cardStateWithout = (reviews: readonly CardReview[], at: string, s: ReviewSettings): CardState =>
  cardState(cardReviewsOf(withoutCardReview({ parts: reviews.map((review) => ({ kind: 'review', review })) }, at)), s)

/** The chance to remember the card now (idea 11, Mochi's "83%"), 0 to 1; null for a new card. */
export function recallChance(reviews: readonly CardReview[], s: ReviewSettings, now: number): number | null {
  const last = replay(reviews, s)
  return last === null ? null : schedulerOf(s).get_retrievability(last.card, localFrame(now), false)
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
  /**
   * The card comes back later in this session ("later today", YAZ-5702): a ✕ (a due card's once, in "Review missed
   * cards"), or a new card's first ✓ (added to today's reviews). A due card's ✓ never does.
   */
  comesBack: boolean
}

/**
 * Each answer button's outcome at `now`, in button order. The review time is `now` (`cardTime`), as the line will
 * hold it, so the wait shown is the wait the replay gives once the answer is written — fuzz included.
 */
export function previewAnswers(reviews: readonly CardReview[], s: ReviewSettings, now: number): CardAnswer[] {
  const at = cardTime(now)
  return answerRatings(s).map((rating) => {
    const review = { at, rating }
    const row = cardHistory([...reviews, review], s).at(-1)!
    return { review, interval: row.interval, due: row.due, comesBack: row.comesBack }
  })
}

/**
 * Due now: due before local midnight tonight, the one test the Inbox, the count and `yaseendocs due` share. A card
 * that comes back today (a ✕, a new card's first ✓, YAZ-5702) is due at its review's time, so it is due now too.
 */
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
  /**
   * In today's Up next (YAZ-4999 D3; YAZ-5028: as New cards, only the day's places): shown before every other card,
   * and under the Inbox's Up next row. A marked card past "Up next a day" keeps its line's `next` but is false here
   * (it is in the queue only when due anyway, YAZ-5042).
   */
  next: boolean
}

/**
 * The due date of a card that has reviews (NaN for a new card), cached (YAZ-4967) by
 * its log as text, one map per settings object: new settings are a new object, so a settings change starts empty. A
 * hit costs a string join and a lookup, no FSRS step.
 */
const dueCache = new WeakMap<ReviewSettings, Map<string, CardDue>>()
/** A reviewed card's due date. */
interface CardDue {
  due: number
}
const NEW_DUE: CardDue = Object.freeze({ due: Number.NaN })
/** A cap so a long session cannot grow the log map without end: past it, the map starts again. Each answer adds a log. */
const CACHE_MAX = 20_000

export const cardDueAt = (reviews: readonly CardReview[], s: ReviewSettings): number => cardDue(reviews, s).due

function cardDue(reviews: readonly CardReview[], s: ReviewSettings): CardDue {
  if (reviews.length === 0) return NEW_DUE
  let map = dueCache.get(s)
  if (map === undefined) dueCache.set(s, (map = new Map()))
  let key = ''
  for (const r of reviews) key += `${r.at} ${r.rating},`
  let due = map.get(key)
  if (due === undefined) {
    if (map.size >= CACHE_MAX) map.clear()
    const last = replay(reviews, s)
    map.set(key, (due = last === null ? NEW_DUE : { due: last.due }))
  }
  return due
}

/**
 * A NEW card (Review rules v1, rule 2, YAZ-5655; Mochi: "New cards stay new until the first correct review"): a card
 * with no ✓ yet. A card whose reviews are all ✕ is still a New card, also when the Inbox opens again.
 */
export const isNewCard = (reviews: readonly CardReview[]): boolean => !reviews.some((r) => r.rating !== 'again')

/** What the queue needs of each card of a page, in page order: its due date (NaN when new), its first review's time, and whether it has a ✓. */
interface CardFacts {
  due: number
  first: string | null
  /** It has a ✓ (rule 2): not a New card any more. */
  learned: boolean
}

/** A page as the index hands it: `mtime` and `size` say its bytes did not change; `embeds`, its `![[…]]` targets. */
type CardPage = { path: string; folder: string; mtime?: number; size?: number; cards?: readonly CardRecord[]; embeds?: readonly string[] }

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
    ...cardDue(card.reviews, s),
    // The earliest review, without a sort.
    first: card.reviews.reduce<string | null>((a, x) => (a === null || x.at < a ? x.at : a), null),
    learned: !isNewCard(card.reviews),
  }))
  if (map !== undefined) map.set(r.path, { mtime: r.mtime!, size: r.size!, facts })
  return facts
}

/** How many cards a page has, and how many of them are due now (idea 2, the folder columns "Cards" and "Due"). */
export interface PageCardCounts {
  cards: number
  /**
   * Cards with a ✓ that are due now (in review: an ID, not `off`). A NEW card (rule 2: no ✓ yet) is not counted: the new cards a day
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
      if (!card.off && card.id !== null && facts[i].learned && (card.next || isCardDue(facts[i].due, now))) due++
    })
  }
  return { cards: cards.length, due }
}

/**
 * Whether any card of the vault is marked Up next (YAZ-5321: the line's `next`, on a card in review: an ID, not
 * archived). With none, the Inbox offers no Up next: the cards menu has no Up next row, so it does not confuse
 * someone who never uses it; one mark brings it back.
 */
export function anyUpNext(records: readonly CardPage[]): boolean {
  return records.some((r) => r.cards !== undefined && r.cards.some((c) => c.next && !c.off && c.id !== null))
}

/**
 * A card's review numbers as the folder table's card rows show them (YAZ-5319): its last review (ms; null for a new
 * card), how many reviews it has, and how often it was remembered (any answer but Forgot, `again`), in whole percent
 * (null for a new card). Off the card line's reviews alone: no FSRS step.
 */
export interface CardReviewNumbers {
  last: number | null
  reviews: number
  successRate: number | null
}

export function cardReviewNumbers(reviews: readonly CardReview[]): CardReviewNumbers {
  let last: string | null = null
  let remembered = 0
  for (const r of reviews) {
    if (last === null || r.at > last) last = r.at
    if (r.rating !== 'again') remembered++
  }
  const at = last === null ? Number.NaN : Date.parse(last)
  return { last: Number.isNaN(at) ? null : at, reviews: reviews.length, successRate: reviews.length === 0 ? null : Math.round((100 * remembered) / reviews.length) }
}

/**
 * A card's place in the vault's time (YAZ-4999 D2): its ID number, the vault's one counter, so a lower number is an
 * older card. An ID with letters that are not the vault's (`letters` given: a pasted card the sweep has not given a
 * number yet) has no place: Infinity, so it sorts last.
 */
function idAge(id: string, letters: readonly string[] | undefined): number {
  if (letters !== undefined && letters.length > 0 && !hasLetters(letters, id.slice(0, id.indexOf('-')))) return Number.POSITIVE_INFINITY
  return pageIdNumber(id) ?? Number.POSITIVE_INFINITY
}

/**
 * The cards added for today (YAZ-5042): how many more of each kind today takes, past the Settings number. The
 * Settings number never changes; the Inbox keeps these per vault and day (`client/src/review/cardsAdded.ts`).
 */
export interface CardsAddedToday {
  newCards: number
  upNext: number
}

export const NOTHING_ADDED: CardsAddedToday = Object.freeze({ newCards: 0, upNext: 0 })

/** The two kinds of card a day has a number of (YAZ-5042): new cards, and Up next. */
export type AddKind = 'new' | 'next'

/** The step when the Settings number is 0 (YAZ-5042): an add still adds some. */
export const ADD_STEP_AT_ZERO = 10

/**
 * One click's add (YAZ-5042): one more day of the Settings number (`perDay`), 10 when it is 0; null with no limit
 * (every card is in today already). The Inbox adds no more than what waits.
 */
export const addStep = (perDay: number | null): number | null => (perDay === null ? null : perDay > 0 ? perDay : ADD_STEP_AT_ZERO)

/** Today's cards of a scope (YAZ-5042): the queue, the cards that wait past today's number, and how to add them. */
export interface CardPlan {
  queue: DueCard[]
  /**
   * The cards of the scope past today's number, of each kind: new cards past "New cards a day", marked cards past "Up
   * next a day" (with the added numbers). 0 with no limit.
   */
  more: Record<AddKind, number>
  /**
   * How much the added number of `kind` must grow so that the next `n` waiting cards of the scope come today (`n` at
   * most `more[kind]`). More than `n` when today used more than its number (new cards begun past it; Up next places
   * taken), or for Up next when the vault's places go to marked cards of another scope first.
   */
  grow: (kind: AddKind, n: number) => number
  /**
   * Reset (YAZ-5042 round 2): the least added number of each kind that keeps today's number at or above what today
   * already did — new cards begun today past "New cards a day", Up next places taken past "Up next a day". 0 with no
   * limit. Reset sets the added number to this, so today goes back to the Settings number, never below today's work.
   */
  floor: Record<AddKind, number>
  /**
   * The fallback (YAZ-5322): folders are picked (`newFrom`), but the scope has no new card left in them, so today's new
   * cards come from All folders. The done screen says so, and its button reads "from All folders"; the pick stays.
   */
  newFallback: boolean
}

/**
 * The cards the scope's pages embed (YAZ-5037, Q3 and open decision 5: you review what you see there): each card's ID
 * in lowercase → the page it lives on (`embeddedCards`), so a card is one card however many pages embed it, and a copy
 * of its ID the sweep has not settled is not taken for it. Empty for the vault's scope, which holds every card already.
 */
function embeddedInScope(records: readonly CardPage[], folder: string, page: string | undefined, letters: readonly string[] | undefined): ReadonlyMap<string, string> {
  if (page === undefined && folder === '') return NO_EMBEDS
  const targets: string[] = []
  for (const r of records) if (r.embeds !== undefined && r.embeds.length > 0 && (page === undefined ? inFolder(r.folder, folder) : r.path === page)) targets.push(...r.embeds)
  // Most scopes embed no card: no resolver is made.
  if (targets.length === 0) return NO_EMBEDS
  return new Map(embeddedCards(targets, makeCardResolver(records, letters)).map((card) => [card.id.toLowerCase(), card.path]))
}
const NO_EMBEDS: ReadonlyMap<string, string> = new Map()

/**
 * Up next takes no New cards place (Review rules v1, rule 10, YAZ-5655; Anki's Set due date): the taken list
 * (`upNextTaken`) also names each new card that an Up next answer BEGAN today (its first review), as its ID and this
 * ending. Such a card is not one of today's "new cards begun": it holds no place of "New cards a day". A card begun as a
 * plain new card and marked later keeps its place. Kept in the same day list, so no store changes shape.
 */
export const UP_NEXT_BEGUN = ' new'

/**
 * The cards due now (D11), in this order:
 *  1. UP NEXT (YAZ-4999 D3): each card whose line holds `next`, due or not, new or not, by ID number (the time of the
 *     mark is not in the file). They are outside the new-card limit, and are due now. `upNextPerDay` (YAZ-5028; null:
 *     all of them) caps them as "New cards a day" caps new cards: the vault's first N marked cards by ID number, less
 *     `upNextTaken`, the card IDs whose mark an answer took off today (the line keeps no trace of them, so the caller
 *     keeps them; an ID still marked in `records`, an index that has not caught up with the answer, is not counted:
 *     it holds its own place). Only those are today's Up next (`DueCard.next`, the Up next row). The other marked
 *     cards keep the mark in the file and WAIT FOR ANOTHER DAY (YAZ-5042 Decision 1, which replaces the YAZ-5028 rule
 *     where they came today in their normal place): a marked card past the number comes today only if it is due
 *     anyway, among the due cards by its due date, not as Up next; or a New card begun already (rule 2: it holds its
 *     New cards place), among the new cards. A new one, or one not due, is not in today's queue.
 *  2. Each card with a ✓ whose due date is before local midnight tonight (a card that comes back today is, YAZ-5702),
 *     most overdue first by day, then in a random order for the day (rule 5, as Anki and Mochi).
 *  3. New cards (rule 2: no ✓ yet), by ID number (`newOrder`: the oldest or the newest first, D2; an ID of other letters last; or Random,
 *     one order for the day, YAZ-5322), only those of the picked folders (`newFrom`, YAZ-5322; none left there: all of
 *     them, `newFallback`), as many as
 *     `newPerDay` leaves today (a card counts as new on the day of its first review, once: rule 2); `newPerDay` null:
 *     all of them (D1). A new card already begun (only ✕ so far) holds its place: it is always in today's list.
 * `added` (YAZ-5042): today's added numbers, on top of `newPerDay` and `upNextPerDay` (not with no limit).
 * Only a card in review shows: it has an ID, and is not `off` (`off` wins over `next`). None while the vault has
 * review off. `folder` (root-relative, '' = the vault) keeps the cards of that folder and its subfolders; `page` (a
 * page's absolute path, "Review this page", idea 4) keeps that page's cards. Both also keep the cards the scope's pages
 * embed (`![[GEO-140]]`, YAZ-5037), each card one time: it is still read where it lives. Either way the new cards begun today
 * are counted over the whole vault: the limit is the vault's. A card whose ID a card before it on the same page holds
 * (a copy the sweep has not settled yet) is left out until it has its own ID: the Inbox never shows one card twice.
 * `letters`: the vault's ID letters (`hasLetters`), so an ID of other letters sorts last.
 */
export function cardPlan(records: readonly CardPage[], s: ReviewSettings, now: number, folder = '', page?: string, letters?: readonly string[], upNextTaken: readonly string[] = [], added: CardsAddedToday = NOTHING_ADDED): CardPlan {
  if (!s.enabled) return { queue: [], more: { new: 0, next: 0 }, grow: () => 0, floor: { new: 0, next: 0 }, newFallback: false }
  const next: DueCard[] = []
  // YAZ-5028: every marked card of the vault (the day's places are the vault's, as the new-card limit is).
  const marked: DueCard[] = []
  // YAZ-5042: a marked reviewed card's own due date: is it due anyway?
  const dueOf = new Map<DueCard, number>()
  const due: DueCard[] = []
  let fresh: DueCard[] = []
  // YAZ-5322: the new cards of the picked folders (`newFrom`), by where each card lives.
  const picked = new Set<DueCard>()
  const picking = s.newFrom.length > 0
  // Rule 2: the new cards begun already (only ✕ so far): each holds its own place.
  const begun = new Set<DueCard>()
  // Rule 2: a marked new card begun already: past the day's Up next places it keeps its New cards place.
  const begunMarked = new Set<DueCard>()
  // Rule 10: the new cards an Up next answer began today hold no place.
  const byUpNext = new Set<string>()
  for (const entry of upNextTaken) if (entry.endsWith(UP_NEXT_BEGUN)) byUpNext.add(entry.slice(0, -UP_NEXT_BEGUN.length))
  let startedToday = 0
  // Today on this computer's calendar, as times the line writes (`cardTime`): a card line's time sorts as text.
  const today = cardTime(new Date(now).setHours(0, 0, 0, 0))
  const tomorrow = cardTime(new Date(now).setHours(24, 0, 0, 0))
  // Only the pages with cards: most pages have none, and the sort is the loop's one cost per page.
  const sorted = records.filter((r) => r.cards !== undefined && r.cards.length > 0).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const embedded = embeddedInScope(records, folder, page, letters)
  for (const r of sorted) {
    const scoped = page === undefined ? inFolder(r.folder, folder) : r.path === page
    const facts = cardFacts(r, s)
    const ids = new Set<string>()
    ;(r.cards ?? []).forEach((card, index) => {
      const { due: at, first, learned } = facts[index]
      if (first !== null && first >= today && first < tomorrow && (card.id === null || !byUpNext.has(card.id))) startedToday++
      if (card.off || card.id === null || ids.has(card.id)) return
      ids.add(card.id)
      const isNew = !learned
      if (card.next === true) marked.push({ path: r.path, index, id: card.id, due: isNew ? now : Math.min(at, now), isNew, next: true })
      if (!scoped && (embedded.size === 0 || embedded.get(card.id.toLowerCase()) !== r.path)) return
      if (card.next === true) {
        const c: DueCard = { path: r.path, index, id: card.id, due: isNew ? now : Math.min(at, now), isNew, next: true }
        if (!isNew) dueOf.set(c, at)
        else if (first !== null) begunMarked.add(c)
        next.push(c)
      } else if (isNew) {
        const c: DueCard = { path: r.path, index, id: card.id, due: now, isNew: true, next: false }
        fresh.push(c)
        if (first !== null) begun.add(c)
        if (picking && s.newFrom.some((f) => inFolder(r.folder, f))) picked.add(c)
      }
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
  // YAZ-5028: today's Up next is the vault's first N marked cards (N: the number plus today's added, YAZ-5042), less
  // those an answer took today; the scope keeps its own of them. The others wait for another day (YAZ-5042 Decision
  // 1); one due anyway comes among the due cards.
  let upNext = next
  let nextBase = Number.POSITIVE_INFINITY
  /** Each waiting marked card's place among the vault's marked cards (0 first): what an add must reach. */
  let ranks: number[] = []
  let taken = 0
  if (s.upNextPerDay !== null) {
    const still = new Set(marked.map((c) => c.id))
    taken = new Set(upNextTaken.filter((id) => !id.endsWith(UP_NEXT_BEGUN) && !still.has(id))).size
    nextBase = s.upNextPerDay + added.upNext - taken
    const rankOf = new Map(marked.sort(byAge(1)).map((c, i) => [`${c.path}\n${c.id}`, i]))
    const places = Math.max(0, nextBase)
    upNext = []
    for (const c of next) {
      const rank = rankOf.get(`${c.path}\n${c.id}`) ?? Number.POSITIVE_INFINITY
      if (rank < places) {
        upNext.push(c)
        continue
      }
      ranks.push(rank)
      const own = dueOf.get(c)
      if (own !== undefined && isCardDue(own, now)) due.push({ ...c, next: false })
      else if (begunMarked.has(c)) {
        const kept: DueCard = { ...c, due: now, next: false }
        fresh.push(kept)
        begun.add(kept)
      }
    }
    ranks = ranks.sort((a, b) => a - b)
  }
  // Rule 5: the most overdue DAY first; inside one day, one random order for the day (a hash of the ID and today).
  const day = new Date(now).toDateString()
  // The hash of the day's part (`${day}\n`), once: each card's rank goes on from it with its ID.
  const dayStart = dayHash(`${day}\n`)
  // Each card's keys are worked out once and sorted with it: the Inbox count runs this on every index change (YAZ-4967).
  const dueOrder = due.map((c) => ({ c, day: new Date(c.due).setHours(0, 0, 0, 0), rank: dayHash(c.id, dayStart) }))
  dueOrder.sort((a, b) => a.day - b.day || a.rank - b.rank || place(a.c, b.c))
  for (let i = 0; i < dueOrder.length; i++) due[i] = dueOrder[i].c
  // YAZ-5322: only the new cards follow the pick; none left in the picked folders, they come from All folders. A card
  // begun already stays (rule 2).
  const newFallback = picking && picked.size === 0 && fresh.length > 0
  if (picking && !newFallback) fresh = fresh.filter((c) => picked.has(c) || begun.has(c))
  if (s.newOrder === 'random') {
    // One order for the day: each card's place is a hash of its ID and today's date, so a redraw keeps it.
    const rank = new Map(fresh.map((c) => [c, dayHash(c.id, dayStart)]))
    fresh.sort((a, b) => rank.get(a)! - rank.get(b)! || place(a, b))
  } else fresh.sort(byAge(s.newOrder === 'newest' ? -1 : 1))
  const newBase = s.newPerDay === null ? Number.POSITIVE_INFINITY : s.newPerDay + added.newCards - startedToday
  // Rule 2: a card begun already is in today's list; the others take the places left, in order.
  let room = newBase
  const newToday = s.newPerDay === null ? fresh : fresh.filter((c) => begun.has(c) || room-- > 0)
  return {
    queue: [...upNext, ...due, ...newToday],
    more: { new: fresh.length - newToday.length, next: ranks.length },
    grow: (kind, n) => {
      if (n <= 0) return 0
      if (kind === 'new') return s.newPerDay === null ? 0 : n + Math.max(0, -newBase)
      const rank = ranks[Math.min(n, ranks.length) - 1]
      return rank === undefined ? 0 : rank + 1 - nextBase
    },
    floor: {
      new: s.newPerDay === null ? 0 : Math.max(0, startedToday - s.newPerDay),
      next: s.upNextPerDay === null ? 0 : Math.max(0, taken - s.upNextPerDay),
    },
    newFallback,
  }
}

/**
 * FNV-1a of `text`: a stable number per card and day for the Random order (YAZ-5322). `from` goes on from the hash of a
 * text before it, so `dayHash(id, dayHash(day))` is `dayHash(day + id)` with no new string per card.
 */
function dayHash(text: string, from = 0x811c9dc5): number {
  let h = from
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** The folder picker's counts (YAZ-5322): every new card of the vault, and each folder's with its subfolders. */
export interface NewCardFolders {
  all: number
  /** Each folder that holds a new card, itself or below, by path (root-relative): a parent before its subfolders. */
  folders: { folder: string; count: number }[]
}

/**
 * The new cards of the vault by folder, for the picker (YAZ-5322): what `cardPlan` counts as new — a card in review
 * (an ID, not `off`), with no ✓ yet (rule 2), not Up next — each card one time, counted in its folder and each folder above it.
 */
export function newCardFolders(records: readonly CardPage[], s: ReviewSettings): NewCardFolders {
  const counts = new Map<string, number>()
  let all = 0
  for (const r of records) {
    if (r.cards === undefined || r.cards.length === 0) continue
    const facts = cardFacts(r, s)
    const ids = new Set<string>()
    let n = 0
    r.cards.forEach((card, index) => {
      if (card.off || card.id === null || ids.has(card.id)) return
      ids.add(card.id)
      if (card.next !== true && !facts[index].learned) n++
    })
    if (n === 0) continue
    all += n
    const parts = r.folder.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) {
      const folder = parts.slice(0, i).join('/')
      counts.set(folder, (counts.get(folder) ?? 0) + n)
    }
  }
  const folders = [...counts].map(([folder, count]) => ({ folder, count })).sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0))
  return { all, folders }
}

/** The cards due now: `cardPlan`'s queue (the order is there). */
export const cardQueue = (records: readonly CardPage[], s: ReviewSettings, now: number, folder = '', page?: string, letters?: readonly string[], upNextTaken: readonly string[] = [], added: CardsAddedToday = NOTHING_ADDED): DueCard[] =>
  cardPlan(records, s, now, folder, page, letters, upNextTaken, added).queue

/**
 * Today's review work, as Mochi's Dashboard "Today" counts it (YAZ-5684; YAZ-5671 finding 13): "Today: 2 learned ·
 * 3 reviews · 2 min" (the finish screens). The cards menu's foot says `cards` alone (YAZ-5690): "Today: 21 cards".
 */
export interface ReviewedToday {
  /** Every different card answered today, new and due, whatever the answer (YAZ-5690, Yaseen: "today twenty one cards"). */
  cards: number
  /** New cards that got their first ✓ today (a Forgot on a new card counts nowhere). */
  learned: number
  /** The FIRST answer today on each card that was a due card this morning (it had a ✓ before today): a retry in the missed pass adds nothing, nor a learned card's later answers. */
  reviews: number
  /** The seconds of every answer today; an answer with no seconds (made before YAZ-5033) counts 0. */
  seconds: number
}

/**
 * Today's review work across `pages` (the index's records), from each card's own review line, so it is right across
 * the sessions of the day and the devices: the LOCAL day of `now`, midnight to midnight. A review's time is ISO 8601
 * UTC to the millisecond (YAZ-5642) and sorts as a string, so each one is two string compares with the day's bounds
 * (`cardTime`): no date parsed per review. Off cards count too: their reviews were made.
 */
export function reviewedToday(pages: readonly { cards?: readonly CardRecord[] }[], now: number): ReviewedToday {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const from = cardTime(start.getTime())
  const to = cardTime(end.getTime())
  let cards = 0
  let learned = 0
  let reviews = 0
  let seconds = 0
  for (const page of pages) {
    for (const card of page.cards ?? []) {
      let knownBefore = false
      let today = false
      let rightToday = false
      for (const r of card.reviews) {
        if (r.at < from) {
          if (r.rating !== 'again') knownBefore = true
          continue
        }
        if (r.at >= to) continue
        today = true
        if (r.rating !== 'again') rightToday = true
        seconds += r.seconds ?? 0
      }
      if (!today) continue
      cards++
      if (knownBefore) reviews++
      else if (rightToday) learned++
    }
  }
  return { cards, learned, reviews, seconds }
}
