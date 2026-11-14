import { FSRS, Rating, State, createEmptyCard, generatorParameters, type Card, type Grade, type StepUnit } from 'ts-fsrs'
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
 * Same-day steps (YAZ-5020, Yaseen: "we should just bring it back in the same session"): `enable_short_term: true`,
 * so FSRS knows about a card shown again the same day (its same-day weights w17–w19), with the smallest step ts-fsrs
 * takes, one minute (`CARD_STEP`; "0m" turns the steps off). A NEW card has two learning steps: it leaves them after
 * two Remembered in a row, and each Forgot starts them again (Anki's default shape). A known card that was Forgot has
 * one relearning step: one Remembered ends it. A card in its steps (`CardState.inSteps`) is due NOW, whatever its
 * minute: the Inbox puts it back at the end of the session, and an Inbox opened again shows it. The minute itself is
 * never what the person sees. After the last step FSRS gives days, as before. Reviews keep their minute on the line;
 * two in one minute replay in line order (a stable sort).
 *
 * Why not days only (the old D5 `false`): a card shown again the same day under `false` gets a too-long interval —
 * the research (YAZ-5020) measured new → Forgot → Remembered with Yaseen's weights at 3 days, where 1 day is right.
 * "Due" is due before local midnight tonight (`isCardDue`), or in its steps.
 */

/** The one step of every learning and relearning step (YAZ-5020): the smallest ts-fsrs takes. */
export const CARD_STEP: StepUnit = '1m'
/** A new card's steps: two Remembered in a row to leave them. */
export const CARD_LEARNING_STEPS: readonly StepUnit[] = [CARD_STEP, CARD_STEP]
/** A known card's steps after a Forgot: one Remembered to leave them. */
export const CARD_RELEARNING_STEPS: readonly StepUnit[] = [CARD_STEP]

const DAY = 86_400_000

const GRADES: Record<CardRating, Grade> = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy }

/** One FSRS per settings object: a vault's settings are one object until they change. */
const schedulers = new WeakMap<ReviewSettings, FSRS>()
function schedulerOf(s: ReviewSettings): FSRS {
  let f = schedulers.get(s)
  if (f === undefined) {
    f = new FSRS(generatorParameters({ w: s.weights, request_retention: s.retention, maximum_interval: s.maxDays, enable_fuzz: s.fuzz, enable_short_term: true, learning_steps: [...CARD_LEARNING_STEPS], relearning_steps: [...CARD_RELEARNING_STEPS] }))
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
  /** The wait this review set, in days; 0 for a step. */
  interval: number
  /** When this review made the card due (ms). */
  due: number
  /** This review left the card in its same-day steps: it comes back in this session. */
  inSteps: boolean
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
    inSteps: inSteps(card),
  }))
}

/** In its same-day steps: a new card not yet through them, or a known card after a Forgot. */
const inSteps = (card: Card): boolean => card.state === State.Learning || card.state === State.Relearning

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
  /** In its same-day steps (YAZ-5020): due now, and it comes back in this session. */
  inSteps: boolean
}

export function cardState(reviews: readonly CardReview[], s: ReviewSettings): CardState {
  const last = replay(reviews, s)
  if (last === null) return { isNew: true, due: null, interval: 0, lastReview: null, lapses: 0, inSteps: false }
  const { card, review } = last
  return { isNew: false, due: card.due.getTime(), interval: card.scheduled_days, lastReview: review.at, lapses: card.lapses, inSteps: inSteps(card) }
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
  /** The card stays in its same-day steps: it comes back later in this session ("later today"), not in `interval` days. */
  inSteps: boolean
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
    return { review, interval: row.interval, due: row.due, inSteps: row.inSteps }
  })
}

/**
 * Due now: due before local midnight tonight, the one test the Inbox, the count and `yaseendocs due` share. A card in
 * its same-day steps is due now too (`inSteps`, YAZ-5020), whatever minute its step ends.
 */
export const isCardDue = (due: number, now: number, steps = false): boolean => steps || due < new Date(now).setHours(24, 0, 0, 0)

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
 * The due date of a card that has reviews (NaN for a new card) and whether it is in its steps, cached (YAZ-4967) by
 * its log as text, one map per settings object: new settings are a new object, so a settings change starts empty. A
 * hit costs a string join and a lookup, no FSRS step.
 */
const dueCache = new WeakMap<ReviewSettings, Map<string, CardDue>>()
/** A reviewed card's due date, and whether it is in its same-day steps. */
interface CardDue {
  due: number
  inSteps: boolean
}
const NEW_DUE: CardDue = Object.freeze({ due: Number.NaN, inSteps: false })
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
    const card = replay(reviews, s)?.card
    map.set(key, (due = card === undefined ? NEW_DUE : { due: card.due.getTime(), inSteps: inSteps(card) }))
  }
  return due
}

/** What the queue needs of each card of a page, in page order: its due date (NaN when new) and its first review's time. */
interface CardFacts {
  due: number
  /** In its same-day steps: due now. */
  inSteps: boolean
  first: string | null
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
      if (!card.off && card.id !== null && card.reviews.length > 0 && (card.next || isCardDue(facts[i].due, now, facts[i].inSteps))) due++
    })
  }
  return { cards: cards.length, due }
}

/** An archived card (YAZ-5046: the line's `off`): what the Inbox's Archived list shows of it, from the index. */
export interface ArchivedCard {
  path: string
  /** Its place among the page's cards. */
  index: number
  id: string
  /** Its title (off its card line, YAZ-5308); absent for a card with none. */
  title?: string
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
 * The archived cards (YAZ-5046) of the vault, of `folder` (root-relative, and its subfolders) or of `page` (its
 * absolute path), by path and then in page order. Only a card with an ID: Unarchive finds it by its ID. A copy whose ID
 * a card before it on the same page holds is left out, as `cardPlan` leaves it out.
 */
export function archivedCards(records: readonly CardPage[], folder = '', page?: string): ArchivedCard[] {
  const out: ArchivedCard[] = []
  const sorted = records.filter((r) => r.cards !== undefined && r.cards.some((c) => c.off)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  for (const r of sorted) {
    if (page === undefined ? !inFolder(r.folder, folder) : r.path !== page) continue
    const ids = new Set<string>()
    ;(r.cards ?? []).forEach((card, index) => {
      if (card.id === null || ids.has(card.id)) return
      ids.add(card.id)
      if (card.off) out.push({ path: r.path, index, id: card.id, ...(card.title !== undefined && { title: card.title }) })
    })
  }
  return out
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
 * The cards due now (D11), in this order:
 *  1. UP NEXT (YAZ-4999 D3): each card whose line holds `next`, due or not, new or not, by ID number (the time of the
 *     mark is not in the file). They are outside the new-card limit, and are due now. `upNextPerDay` (YAZ-5028; null:
 *     all of them) caps them as "New cards a day" caps new cards: the vault's first N marked cards by ID number, less
 *     `upNextTaken`, the card IDs whose mark an answer took off today (the line keeps no trace of them, so the caller
 *     keeps them; an ID still marked in `records`, an index that has not caught up with the answer, is not counted:
 *     it holds its own place). Only those are today's Up next (`DueCard.next`, the Up next row). The other marked
 *     cards keep the mark in the file and WAIT FOR ANOTHER DAY (YAZ-5042 Decision 1, which replaces the YAZ-5028 rule
 *     where they came today in their normal place): a marked card past the number comes today only if it is due
 *     anyway, among the due cards by its due date, not as Up next. A new one, or one not due, is not in today's queue.
 *  2. Each card with reviews whose due date is before local midnight tonight, or in its same-day steps (YAZ-5020),
 *     most overdue first.
 *  3. New cards, by ID number (`newOrder`: the oldest or the newest first, D2; an ID of other letters last), as many as
 *     `newPerDay` leaves today (a card counts as new on the day of its first review); `newPerDay` null: all of them (D1).
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
  if (!s.enabled) return { queue: [], more: { new: 0, next: 0 }, grow: () => 0, floor: { new: 0, next: 0 } }
  const next: DueCard[] = []
  // YAZ-5028: every marked card of the vault (the day's places are the vault's, as the new-card limit is).
  const marked: DueCard[] = []
  // YAZ-5042: a marked reviewed card's own due date, and whether it is in its steps: is it due anyway?
  const dueOf = new Map<DueCard, { at: number; steps: boolean }>()
  const due: DueCard[] = []
  const fresh: DueCard[] = []
  let startedToday = 0
  // Today on this computer's calendar, as minutes the line writes: a card line's time sorts as text.
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
      const { due: at, inSteps: steps, first } = facts[index]
      if (first !== null && first >= today && first < tomorrow) startedToday++
      if (card.off || card.id === null || ids.has(card.id)) return
      ids.add(card.id)
      const isNew = first === null
      if (card.next === true) marked.push({ path: r.path, index, id: card.id, due: isNew ? now : Math.min(at, now), isNew, next: true })
      if (!scoped && (embedded.size === 0 || embedded.get(card.id.toLowerCase()) !== r.path)) return
      if (card.next === true) {
        const c: DueCard = { path: r.path, index, id: card.id, due: isNew ? now : Math.min(at, now), isNew, next: true }
        if (!isNew) dueOf.set(c, { at, steps })
        next.push(c)
      } else if (isNew) fresh.push({ path: r.path, index, id: card.id, due: now, isNew: true, next: false })
      else if (isCardDue(at, now, steps)) due.push({ path: r.path, index, id: card.id, due: at, isNew: false, next: false })
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
    taken = new Set(upNextTaken.filter((id) => !still.has(id))).size
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
      if (own !== undefined && isCardDue(own.at, now, own.steps)) due.push({ ...c, next: false })
    }
    ranks = ranks.sort((a, b) => a - b)
  }
  due.sort((a, b) => a.due - b.due || place(a, b))
  fresh.sort(byAge(s.newOrder === 'newest' ? -1 : 1))
  const newBase = s.newPerDay === null ? Number.POSITIVE_INFINITY : s.newPerDay + added.newCards - startedToday
  const newToday = s.newPerDay === null ? fresh : fresh.slice(0, Math.max(0, newBase))
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
  }
}

/** The cards due now: `cardPlan`'s queue (the order is there). */
export const cardQueue = (records: readonly CardPage[], s: ReviewSettings, now: number, folder = '', page?: string, letters?: readonly string[], upNextTaken: readonly string[] = [], added: CardsAddedToday = NOTHING_ADDED): DueCard[] =>
  cardPlan(records, s, now, folder, page, letters, upNextTaken, added).queue

/** Today's review work (YAZ-5033, the Inbox's "Today: 31 cards · 9 min"): the cards answered, and their seconds. */
export interface ReviewedToday {
  /** The cards with at least one review today (a card answered twice counts once). */
  cards: number
  /** The reviews made today. */
  reviews: number
  /** The seconds those reviews took; a review with no seconds (made before YAZ-5033) counts 0. */
  seconds: number
}

/**
 * Today's reviews across `pages` (the index's records): the LOCAL day of `now`, midnight to midnight. A review's time
 * is a UTC minute that sorts as a string, so each one is two string compares with the day's bounds (`cardTime`): no
 * date parsed per review. Off cards count too: their reviews were made.
 */
export function reviewedToday(pages: readonly { cards?: readonly CardRecord[] }[], now: number): ReviewedToday {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const from = cardTime(start.getTime())
  const to = cardTime(end.getTime())
  let cards = 0
  let reviews = 0
  let seconds = 0
  for (const page of pages) {
    for (const card of page.cards ?? []) {
      let any = false
      for (const r of card.reviews) {
        if (r.at < from || r.at >= to) continue
        any = true
        reviews++
        seconds += r.seconds ?? 0
      }
      if (any) cards++
    }
  }
  return { cards, reviews, seconds }
}
