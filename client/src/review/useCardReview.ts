import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { isCardSeconds, withCardNext, withCardOff, type CardRating, type CardReview } from '@shared/cardLine'
import { addStep, archivedCards, cardPlan, previewAnswers, reviewedToday, type AddKind, type ArchivedCard, type CardAnswer, type CardPlan, type CardsAddedToday, type DueCard, type ReviewedToday } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import type { NoticeAction, NoticeKind, NoticeType } from '../lib/notice'
import { folderTitle } from '../links/shortcuts'
import { storage } from '../lib/storage'
import { changeCardLine, deleteCardReview, isCardGone, readCard, restoreCardReview, undoCardAnswer, writeCardAnswer, type CardOnPage } from './cardFile'
import { setUpNextTaken, subscribeUpNextTaken, upNextTakenToday } from './upNextTaken'
import { cardsAddedToday, setCardsAdded, subscribeCardsAdded } from './cardsAdded'

/**
 * Note card review as App sees it (YAZ-4967): how many cards are due, and the one review
 * session a vault can have open. The queue comes from the index (`cardQueue`) and is taken ONCE, at start; a card is
 * checked against the live index only when its turn comes, and read from its page when it shows (the index holds no
 * text, D4). A card whose page or ID is gone is passed over.
 *
 * The hover is the truth (D13): `showAnswers` fixes each button's review — its time to the minute, so its fuzz — and
 * `answer` writes exactly that review, so "Remembered · 9 days" is what the file gets. `undo` (⌘Z, idea 5) removes
 * the last answer's review and shows that card again. The first answer to an up-next card removes its `next` in the
 * same write (YAZ-4999 D3), and its undo puts it back.
 *
 * ← → (YAZ-5004) move the card showing through the queue with no answer: `at` is the one new piece of state, the
 * place of the card showing; a card you leave stays in the queue. `turnOff` (the Inbox ⋯'s Archive card) writes `off`
 * and takes the card out of the queue.
 *
 * Archived (YAZ-5046, Yaseen: "I think we should just call that archive"): the cards with `off` in the open scope, from
 * the index (`archivedCards`), to look at, not to review. The filter `archived` shows them as a list (no card on show:
 * `at` is past the queue's end); `unarchive` takes `off` away, the history stays, and the index takes the card off the
 * list. The review's own counts and queue never hold an archived card.
 *
 * The filter (YAZ-5017, as Mochi's "All cards ▾"): All cards, Due today (cards with reviews, due now) or New cards
 * (never reviewed, within today's new-card limit: the queue's own). The queue stays whole; the filter picks which of its
 * cards show, and "3 of 12" counts only those. Up next (YAZ-5028): the cards marked `next`, new or reviewed (`off` cards
 * are never in the queue); an answer takes a card out of it, as the repeat it may leave is no longer up next.
 *
 * Up next a day (YAZ-5028, Yaseen: "so it kinda works like new?"): only the day's N places are Up next — they go first,
 * and the Up next row counts and shows those alone; the other marked cards wait for another day, unless due anyway (YAZ-5042; `cardQueue`,
 * less `upNextTakenToday`: an answer that takes a card's mark off counts it, its ⌘Z gives it back). Every queue here
 * passes the same list, so the marks the session follows (YAZ-5031) are today's Up next, not every marked card. The
 * list lives in the app state (`upNextTaken.ts`), and a change of it is read as a change of the index.
 *
 * The marks follow the index (YAZ-5031): a card marked `next` while the session is open (the page's ⋯, the card
 * window, another window, the command line) joins Up next and comes right after the card on show; a mark taken off
 * leaves it, and the card goes when nothing else keeps it due. Only a CHANGE of the index's marks moves the session
 * (`marks`, the marks it last saw), so a snapshot that has not caught up with an answer yet never brings its card back.
 *
 * `answered` (YAZ-5020, the progress bar) is each answer of the session, in order; ⌘Z takes the last one back. The
 * bar's whole is the cards the session started with, plus any it took since. A new session (or the Inbox tab closed)
 * starts it empty.
 *
 * Same-day steps (YAZ-5020): an answer that leaves the card in its steps (`CardAnswer.inSteps`: a Forgot; a new card's
 * first Remembered) puts it back at the END of this session's queue, and the session grows by one ("3 of 13"). It
 * comes back until the scheduler lets it go: a new card after two Remembered in a row, a known card after one. Closed
 * and opened again, the Inbox shows it at once: a card in its steps is due now (`cardQueue`). ⌘Z takes the repeat
 * out again and puts the card back at its place.
 *
 * Fast ← → (YAZ-5029, Yaseen: "why does these two things jump and show like a small version of them like latency?"):
 * the cards around the one showing (`AHEAD` each way, under the filter) are read ahead into a small cache, so the next
 * card shows with its text in the same render as the move. A card not read yet leaves the card before on show, whole
 * (its head and its text agree), until its text is ready: the session never hands out an empty card between two cards.
 * A cached page is good while its index `mtime` is the one it was read at; every write of this hook drops its page's
 * entries, and a read that started before such a write is not kept. A read for a card left already never shows.
 *
 * Add more for today (YAZ-5042, Yaseen: "without having to go to settings"): `more` is how many cards of the scope wait
 * past today's number, of each kind (`cardPlan`); `addCards` adds one more day of the Settings number (`addStep`; 10
 * when it is 0), never more than what waits, for today only (`cardsAdded.ts`, the app state; the Settings number never
 * changes). The added cards join the open session: new cards at its end, Up next cards right after the card on show
 * (as a mark does, YAZ-5031); from the done screen the first added card shows at once. The add goes on the undo stack:
 * `undo` (the line's Undo and ⌘Z) takes it back while it is the last thing done — today's number goes down again, and
 * the added cards not answered yet leave the session.
 */

/** Which cards of the session show (YAZ-5017); `archived` (YAZ-5046): the archived cards' list, no card to review. */
export type CardFilter = 'all' | 'next' | 'due' | 'new' | 'archived'
/** The filters that review: each has a count of the session's queue. */
export type ReviewFilter = Exclude<CardFilter, 'archived'>

/** Whether `card` shows under `filter`: next = marked up next (YAZ-5028), due = reviewed before (due now), new = never reviewed; archived: none of the queue. */
export const matchesFilter = (card: DueCard, filter: CardFilter): boolean =>
  filter === 'all' || (filter === 'archived' ? false : filter === 'next' ? card.next : (filter === 'new') === card.isNew)

/** What a session reviews: the vault (nothing), a folder (root-relative, "Review this folder") or one page (its absolute path, "Review this page"). */
export interface CardReviewScope {
  folder?: string
  page?: string
}

/** The card a session shows. */
export interface ShownCard extends DueCard {
  /** The card as its page holds it now; null while the page is read. */
  page: CardOnPage | null
}

export interface CardReviewSession {
  /** "Inbox", the folder's title or the page's title. */
  label: string
  /** What the session reviews: the done screen says what is true for it (a page done is not the Inbox done). */
  scope: 'vault' | 'folder' | 'page'
  /** The card showing; null once nothing is left (the done screen). */
  card: ShownCard | null
  /** The showing card's place among the `total` the session started with. */
  position: number
  total: number
  /** ← and → (YAZ-5004): a card before or after the one showing is still in the queue. */
  canBack: boolean
  canNext: boolean
  /** Each button's outcome, fixed by `showAnswers` for the card showing (in button order); null until then. */
  answers: CardAnswer[] | null
  canUndo: boolean
  /** The filter on show (YAZ-5017). */
  filter: CardFilter
  /** The cards left in the session under each filter: the menu's counts. */
  counts: Record<ReviewFilter, number>
  /** The scope's archived cards (YAZ-5046), from the index: the Archived row's count and list. */
  archived: ArchivedCard[]
  /** Where the cards come from (YAZ-5017): the vault's name; the folder's parts; the page's name. Shown by the filter ("· in …"). */
  from: string[]
  /** The card showing's place (YAZ-5017 round 2): vault › folders › page, each with what a click opens. Empty with no card. */
  place: CardPlacePart[]
  /** Each answer of the session, in order (YAZ-5020): a Forgot ('again') or a Remembered (any other). */
  answered: CardRating[]
  /** The progress bar's whole (YAZ-5020): the cards the session started with, plus any it took since. */
  size: number
  /** Today's review work across the vault, from the index (YAZ-5033): the top row's and the done screen's "Today: …". */
  today: ReviewedToday
  /** The scope's cards past today's number, of each kind (YAZ-5042): the menu's "38 more", the done screen's line. */
  more: Record<AddKind, number>
  /** What one click adds of each kind (YAZ-5042): one more day of the Settings number, at most `more`; 0 = no Add. */
  adds: Record<AddKind, number>
  /** The add, while it is the last thing done (YAZ-5042): the line under the buttons says it; null otherwise. */
  lastAdd: { kind: AddKind; count: number } | null
}

export interface CardReviewApi {
  /** The cards due now in the vault: the Inbox row's count. 0 while review is off. */
  dueCount: number
  /** The vault's review settings (`answerRatings`, `answerLabel`, `cardHistory` read them). */
  settings: ReviewSettings
  session: CardReviewSession | null
  start: (scope?: CardReviewScope) => void
  /** Fixes and returns each button's outcome for the card showing; the same array until that card goes. Null with no card loaded. */
  showAnswers: () => CardAnswer[] | null
  /**
   * Writes the fixed review of `rating`'s button (fixing it now if `showAnswers` was not called), then the next card.
   * `seconds` (YAZ-5033): how long the answer took, by the Inbox's timer; the review part ends with ` <n>s`. Absent:
   * none is written.
   */
  answer: (rating: CardRating, seconds?: number) => Promise<void>
  /** Removes the last answer's review and shows that card again. */
  undo: () => Promise<void>
  close: () => void
  /**
   * The Reviews table's delete (YAZ-4962): removes `review` from card `id` of `path`, any card, in a session or not.
   * Its notice has Undo, which writes the review back (the app's undo of a file move is a notice the same way).
   */
  deleteReview: (path: string, id: string, review: CardReview) => Promise<void>
  /** Up next on or off for card `id` of `path` (YAZ-4999 D3, the Inbox head's chip ×): one write of the file, then the card read again. */
  setNext: (path: string, id: string, on: boolean) => Promise<void>
  /** ← (-1) and → (+1), YAZ-5004: the card before or after, with no answer; the card left stays in the queue. */
  move: (delta: -1 | 1) => void
  /** The Inbox ⋯'s Archive card (YAZ-5004, YAZ-5046): `off` on the card showing's line, and the card out of the queue. */
  turnOff: () => Promise<void>
  /** Unarchive card `id` of `path` (YAZ-5046, the Archived list): `off` off its line; its history stays. */
  unarchive: (path: string, id: string) => Promise<void>
  /** All cards, Due today, New cards (YAZ-5017) or the Archived list (YAZ-5046): which of the session's cards show. */
  setFilter: (filter: CardFilter) => void
  /** Adds `session.adds[kind]` cards of `kind` for today (YAZ-5042); `undo` takes it back. */
  addCards: (kind: AddKind) => void
}

/** One part of a card's place (YAZ-5017 round 2): its name, and the path a click opens (the vault's or a folder's page, or the page). */
export interface CardPlacePart {
  kind: 'vault' | 'folder' | 'page'
  label: string
  path: string
}

/** How many answers ⌘Z can take back in one session. */
export const UNDO_DEPTH = 20
/** YAZ-5029: how many cards each way of the one showing are read ahead. */
export const AHEAD = 3
/** YAZ-5029: the most cards the read-ahead cache holds; the oldest go first. */
const CACHE_SIZE = 48

/** A page read ahead (YAZ-5029): the card as read, at the index `mtime` its read started at. */
interface CachedCard {
  page: CardOnPage
  mtime: number | undefined
}

interface Session {
  /** YAZ-5029: one per `start`: the card left on show while the next is read is only ever this session's. */
  id: number
  label: string
  scope: CardReviewScope
  /** Cards still to show; the one at `at` is the one showing. */
  queue: QueueCard[]
  /** The place of the card showing in `queue` (YAZ-5004: ← → move it); 0 until then. */
  at: number
  total: number
  /** Bumped each time the card at the head is put there: its page is read again, its answers fixed again. */
  turn: number
  /** Each answer and each add (YAZ-5042), in order: ⌘Z takes back the last. */
  undo: UndoStep[]
  /** YAZ-5017: which cards show; `at` is always a card that matches it, or past the end when none does. */
  filter: CardFilter
  /** The cards with reviews and the new cards at start, plus the repeats (YAZ-5020): each filter's "of 12". */
  totals: { due: number; new: number; next: number }
  /** YAZ-5020: each answer, in order (the progress bar); ⌘Z takes the last back. */
  answered: CardRating[]
  /** YAZ-5031: the cards of the scope the index last marked `next` (`cardKey`): a change of them moves the session. */
  marks: ReadonlySet<string>
}

/**
 * An answer: the card, its review, the place its `next` had (-1: none), so the undo puts the file back as it was; its
 * place in the queue, and whether it went back at the end (YAZ-5020), so the undo puts the queue back too.
 */
interface AnswerStep {
  kind: 'answer'
  card: DueCard
  review: CardReview
  next: number
  at: number
  repeat: boolean
}

/**
 * An add (YAZ-5042): its kind, how much today's added number grew (`delta`, maybe more than the cards it brought:
 * `CardPlan.grow`), the cards it brought (`count`), the cards that joined the session and those already in it that it
 * made Up next (a marked card due anyway), by `cardKey`.
 */
interface AddStep {
  kind: 'add'
  what: AddKind
  delta: number
  count: number
  joined: readonly string[]
  promoted: readonly string[]
}

type UndoStep = AnswerStep | AddStep

/** A card of a session's queue; `repeat` (YAZ-5020): put back at the end by an answer that left it in its steps. */
type QueueCard = DueCard & { repeat?: boolean }

interface IndexSource {
  readonly records: readonly IndexRecord[]
  readonly folders: readonly IndexRecord[]
  /** The vault's ID letters: a card ID of other letters sorts last among the new cards (`cardQueue`). */
  readonly letters?: readonly string[]
  subscribe(listener: () => void): () => void
}

/**
 * `at` on a card the filter shows (YAZ-5017): this one, else the next one, else the first; past the end when none
 * does (the done screen).
 */
const fitted = (s: Session): Session => {
  const ok = (i: number) => s.queue[i] !== undefined && matchesFilter(s.queue[i], s.filter)
  if (ok(s.at)) return s
  let at = s.queue.findIndex((c, i) => i > s.at && matchesFilter(c, s.filter))
  if (at === -1) at = s.queue.findIndex((c) => matchesFilter(c, s.filter))
  return { ...s, at: at === -1 ? s.queue.length : at }
}
/** The place of the card the filter shows next before (-1) or after (+1) `at`; -1 when there is none. */
const stepFrom = (s: Session, delta: -1 | 1): number => {
  for (let i = s.at + delta; i >= 0 && i < s.queue.length; i += delta) if (matchesFilter(s.queue[i], s.filter)) return i
  return -1
}
const countOf = (queue: readonly DueCard[]): Record<ReviewFilter, number> => {
  const fresh = queue.filter((c) => c.isNew).length
  return { all: queue.length, next: queue.filter((c) => c.next).length, due: queue.length - fresh, new: fresh }
}

const NO_TAKEN: readonly string[] = []
const NO_ADDED: CardsAddedToday = Object.freeze({ newCards: 0, upNext: 0 })

/** What one click adds of each kind (YAZ-5042): one more day of the Settings number (`addStep`), never more than what waits. */
const addsOf = (plan: CardPlan, s: ReviewSettings): Record<AddKind, number> => ({
  new: Math.min(addStep(s.newPerDay) ?? 0, plan.more.new),
  next: Math.min(addStep(s.upNextPerDay) ?? 0, plan.more.next),
})

const markedIn = (live: readonly DueCard[]): Set<string> => new Set(live.filter((c) => c.next).map(cardKey))

/**
 * The session after the index's marks changed (YAZ-5031): `live` is the scope's queue now (`cardQueue`). A card newly
 * marked is up next and comes right after the card on show (it joins the session when it was not in it); one whose
 * mark went is no longer up next, and leaves the queue when it is not due either (the card on show stays). Unchanged
 * marks: the same session.
 */
const withMarks = (s: Session, live: readonly DueCard[]): Session => {
  const marks = markedIn(live)
  const added = [...marks].filter((k) => !s.marks.has(k))
  const gone = [...s.marks].filter((k) => !marks.has(k))
  if (added.length === 0 && gone.length === 0) return s
  const on = new Set(added)
  const off = new Set(gone)
  const due = new Set(live.map(cardKey))
  const head = s.queue[s.at]
  const totals = { ...s.totals }
  let total = s.total
  let shown: QueueCard | undefined = head
  const rest: QueueCard[] = []
  const moved = new Map<string, QueueCard>()
  for (const card of s.queue) {
    const key = cardKey(card)
    if (on.has(key) && !card.next) {
      totals.next++
      const marked = { ...card, next: true }
      if (card === head) rest.push((shown = marked))
      else moved.set(key, marked)
    } else if (off.has(key) && card.next) {
      totals.next--
      if (card !== head && card.repeat !== true && !due.has(key)) {
        totals[card.isNew ? 'new' : 'due']--
        total--
      } else if (card === head) rest.push((shown = { ...card, next: false }))
      else rest.push({ ...card, next: false })
    } else rest.push(card)
  }
  // The newly marked in the index's order (by ID number): those of the session moved, the others joining it.
  const inSession = new Set(s.queue.map(cardKey))
  const joining: QueueCard[] = []
  for (const card of live) {
    const key = cardKey(card)
    if (!on.has(key)) continue
    const mine = moved.get(key)
    if (mine !== undefined) joining.push(mine)
    else if (!inSession.has(key)) {
      joining.push(card)
      totals.next++
      totals[card.isNew ? 'new' : 'due']++
      total++
    }
  }
  const place = shown === undefined ? rest.length : rest.indexOf(shown) + 1
  const queue = [...rest.slice(0, place), ...joining, ...rest.slice(place)]
  const at = shown === undefined ? place : place - 1
  return fitted({ ...s, queue, at, total, totals, marks, turn: shown === head ? s.turn : s.turn + 1 })
}

/** The session with the card at `at` gone from its queue (answered elsewhere, its page gone, review off): the next one shows. */
const without = (s: Session, at: number): Session => {
  const queue = [...s.queue.slice(0, at), ...s.queue.slice(at + 1)]
  return fitted({ ...s, queue, at: at < queue.length ? at : 0, turn: s.turn + 1 })
}
/**
 * The session after an add (YAZ-5042): `live` is the scope's queue with the new added number. New cards join at the end;
 * Up next cards right after the card on show, and a card of the session made Up next (due anyway) moves there too. On
 * the done screen the first added card shows, under All cards when the filter would hide it.
 */
const withAdded = (s: Session, what: AddKind, live: readonly DueCard[], delta: number): Session => {
  const inSession = new Map(s.queue.map((c) => [cardKey(c), c]))
  const head = s.queue[s.at]
  const joining = live.filter((c) => !inSession.has(cardKey(c)) && (what === 'next' ? c.next : c.isNew && !c.next))
  const promoted = what === 'next' ? live.filter((c) => c.next && inSession.get(cardKey(c))?.next === false && inSession.get(cardKey(c))?.repeat !== true).map(cardKey) : []
  if (joining.length + promoted.length === 0) return s
  const moved = new Set(promoted)
  const totals = { ...s.totals }
  for (const c of joining) totals[c.isNew ? 'new' : 'due']++
  if (what === 'next') totals.next += joining.length + promoted.length
  const coming: QueueCard[] = [...s.queue.filter((c) => moved.has(cardKey(c)) && c !== head).map((c) => ({ ...c, next: true })), ...joining]
  const shownNow = head !== undefined && moved.has(cardKey(head)) ? { ...head, next: true } : head
  const rest = s.queue.filter((c) => c === head || !moved.has(cardKey(c))).map((c) => (c === head ? shownNow! : c))
  let queue: QueueCard[]
  let at: number
  if (shownNow === undefined) {
    // The done screen: the added cards after the rest, the first of them on show.
    queue = [...rest, ...coming]
    at = rest.length
  } else if (what === 'next') {
    at = rest.indexOf(shownNow)
    queue = [...rest.slice(0, at + 1), ...coming, ...rest.slice(at + 1)]
  } else {
    at = rest.indexOf(shownNow)
    queue = [...rest, ...coming]
  }
  const filter = shownNow === undefined && !matchesFilter(coming[0], s.filter) ? 'all' : s.filter
  const marks = what === 'next' ? new Set([...s.marks, ...joining.map(cardKey), ...promoted]) : s.marks
  const step: AddStep = { kind: 'add', what, delta, count: joining.length + promoted.length, joined: joining.map(cardKey), promoted }
  const undo = [...s.undo, step].slice(-UNDO_DEPTH)
  return fitted({ ...s, queue, at, filter, total: s.total + joining.length, totals, marks, undo, turn: shownNow === head ? s.turn : s.turn + 1 })
}

/** The session after an add's undo (YAZ-5042): its cards not answered yet leave; a card it made Up next is not any more. */
const withoutAdded = (s: Session, step: AddStep): Session => {
  const joined = new Set(step.joined)
  const promoted = new Set(step.promoted)
  const head = s.queue[s.at]
  const totals = { ...s.totals }
  let total = s.total
  const queue: QueueCard[] = []
  let at = -1
  for (const c of s.queue) {
    const key = cardKey(c)
    if (joined.has(key) && c.repeat !== true) {
      totals[c.isNew ? 'new' : 'due']--
      if (step.what === 'next') totals.next--
      total--
      continue
    }
    const back = promoted.has(key) && c.next && c.repeat !== true ? { ...c, next: false } : c
    if (back !== c) totals.next--
    if (c === head) at = queue.length
    queue.push(back)
  }
  const marks = step.what === 'next' ? new Set([...s.marks].filter((k) => !joined.has(k) && !promoted.has(k))) : s.marks
  const kept = at !== -1
  return fitted({ ...s, queue, at: kept ? at : Math.min(s.at, queue.length), total, totals, marks, undo: s.undo.slice(0, -1), turn: kept && queue[at] === head ? s.turn : s.turn + 1 })
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const sameCard = (a: DueCard, b: DueCard): boolean => a.path === b.path && a.id === b.id
/** Is `card` the one on show? By path and ID: a mark the index changed (YAZ-5031) gives the card a new object. */
const showing = (s: Session, card: DueCard): boolean => s.queue[s.at] !== undefined && sameCard(s.queue[s.at], card)
const cardKey = (card: DueCard): string => `${card.path}\n${card.id}`
const titleOf = (records: readonly IndexRecord[], path: string): string => records.find((r) => r.path === path)?.title ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

/**
 * The place of the page at `path` (YAZ-5017 round 2): the vault, then each folder down to the page's (by its title). No
 * page part (Yaseen: "isnt this redundant?"): the card's head shows the page's name.
 */
export function cardPlace(root: string, vault: string, folders: readonly IndexRecord[], _records: readonly IndexRecord[], path: string): CardPlacePart[] {
  const dirs = (path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path).split('/').slice(0, -1)
  const inside = dirs.map((_, i): CardPlacePart => {
    const dir = `${root}/${dirs.slice(0, i + 1).join('/')}`
    return { kind: 'folder', label: folderTitle(folders, dir), path: dir }
  })
  return [{ kind: 'vault', label: vault, path: root }, ...inside]
}

export function useCardReview(root: string | null, source: IndexSource, settings: ReviewSettings, onNotice: (text: string, icon?: NoticeKind, type?: NoticeType, action?: NoticeAction) => void, vaultName?: string | null): CardReviewApi {
  const records = useSyncExternalStore(source.subscribe, () => source.records)
  const [session, setSession] = useState<Session | null>(null)
  // The card showing, read from its page, and its fixed answers: each for one turn (`turnKey`).
  const [loaded, setLoaded] = useState<{ key: string; page: CardOnPage } | null>(null)
  const [fixed, setFixed] = useState<{ key: string; answers: CardAnswer[] } | null>(null)
  // "Due now" runs to local midnight, so the count moves at midnight with no file changing.
  const [day, setDay] = useState(0)
  useEffect(() => {
    if (root === null) return // a slot with no vault (YAZ-2602) counts nothing: no timer
    const timer = setTimeout(() => setDay((d) => d + 1), new Date().setHours(24, 0, 0, 0) - Date.now())
    return () => clearTimeout(timer)
  }, [day, root])
  // A session ends with its vault, and when review is turned off.
  useEffect(() => setSession(null), [root, settings.enabled])

  // The replay of each card is cached by its log (`cardDueAt`), so a new snapshot costs a join per reviewed card.
  const letters = source.letters
  // YAZ-5028: today's taken Up next places, from the app state; one array while it holds still.
  const taken = useSyncExternalStore(subscribeUpNextTaken, () => (root === null ? NO_TAKEN : upNextTakenToday(root)))
  // YAZ-5042: today's added numbers, from the app state; none on another day (`day` re-renders at midnight).
  const added = useSyncExternalStore(subscribeCardsAdded, () => (root === null ? NO_ADDED : cardsAddedToday(root)))
  const vaultPlan = useMemo(() => cardPlan(records, settings, Date.now(), '', undefined, letters, taken, added), [records, settings, day, letters, taken, added])
  const vaultQueue = vaultPlan.queue
  const dueCount = vaultQueue.length
  // YAZ-5033: today's reviews across the vault, from the index: the new answer counts once the index has its write.
  const today = useMemo(() => reviewedToday(records, Date.now()), [records, day])

  // YAZ-5031: the open session follows the index's `next` marks (`withMarks`); the vault's queue serves the vault's session.
  useEffect(() => {
    setSession((s) => {
      if (s === null || !settings.enabled) return s
      const vault = !s.scope.folder && s.scope.page === undefined
      return withMarks(s, vault ? vaultQueue : cardPlan(records, settings, Date.now(), s.scope.folder, s.scope.page, letters, taken, added).queue)
    })
  }, [vaultQueue, records, settings, letters, taken, added])

  // The callbacks read the latest state at call time; their identities stay stable for memoised children.
  const live = useRef({ records, settings, session, loaded, fixed, taken, added })
  live.current = { records, settings, session, loaded, fixed, taken, added }
  const busy = useRef(false)

  /**
   * Drops the cards at the head of `queue` that are no longer due by the live index: their turn came. A repeat
   * (YAZ-5020) stays: this session put it back, and the index may not have its new answer yet.
   */
  const settle = useCallback((queue: QueueCard[], scope: CardReviewScope): QueueCard[] => {
    const { records, settings, taken, added } = live.current
    const due = cardPlan(records, settings, Date.now(), scope.folder, scope.page, source.letters, taken, added).queue
    const first = queue.findIndex((card) => card.repeat === true || due.some((d) => sameCard(d, card)))
    return first === -1 ? [] : queue.slice(first)
  }, [source])

  // YAZ-5029: the read-ahead cache, by card; `epoch` per page, bumped by each write here, so a read begun before it is dropped.
  const cache = useRef(new Map<string, CachedCard>())
  const epoch = useRef(new Map<string, number>())
  const mtimeOf = useCallback((path: string): number | undefined => live.current.records.find((r) => r.path === path)?.mtime, [])
  const cached = useCallback(
    (card: DueCard): CardOnPage | null => {
      const hit = cache.current.get(cardKey(card))
      return hit !== undefined && hit.mtime === mtimeOf(card.path) ? hit.page : null
    },
    [mtimeOf],
  )
  /** Reads card `card` and keeps it in the cache, unless its page was written since the read began. */
  const readInto = useCallback(
    async (card: DueCard): Promise<CardOnPage | null> => {
      const from = epoch.current.get(card.path) ?? 0
      const mtime = mtimeOf(card.path)
      const page = await readCard(card.path, card.id)
      const key = cardKey(card)
      if (page !== null && (epoch.current.get(card.path) ?? 0) === from) {
        cache.current.delete(key)
        cache.current.set(key, { page, mtime })
        if (cache.current.size > CACHE_SIZE) cache.current.delete(cache.current.keys().next().value!)
      }
      return page
    },
    [mtimeOf],
  )
  /** A write of `path` here: its cached cards go, and reads of it already begun are not kept. */
  const forget = useCallback((path: string) => {
    epoch.current.set(path, (epoch.current.get(path) ?? 0) + 1)
    for (const [key, hit] of cache.current) if (hit.page.path === path) cache.current.delete(key)
  }, [])

  const head = session?.queue[session.at]
  const turnKey = session === null || head === undefined ? null : `${session.turn}\n${head.path}\n${head.id}`

  // The notice door in a ref: the read below runs once per turn, whatever identity the caller's callback has.
  const notice = useRef(onNotice)
  notice.current = onNotice

  // The page of the card showing changed on disk (Edit card in the card window, YAZ-5003; an edit in its tab): read
  // the card again in place — same turn, so its step and its fixed answers stay, and no frame shows it empty.
  const [reread, setReread] = useState(0)
  const pageMtime = useMemo(() => (head === undefined ? undefined : records.find((r) => r.path === head.path)?.mtime), [records, head])
  const seenPage = useRef<{ key: string | null; mtime: number | undefined }>({ key: null, mtime: undefined })
  useEffect(() => {
    const seen = seenPage.current
    seenPage.current = { key: turnKey, mtime: pageMtime }
    if (turnKey !== null && seen.key === turnKey && seen.mtime !== pageMtime) setReread((n) => n + 1)
  }, [turnKey, pageMtime])

  // Read the card showing from its page; a page or card that is gone passes it over.
  useEffect(() => {
    if (turnKey === null || head === undefined) return
    // Read ahead (YAZ-5029): the card is in the cache, at its page's mtime — no read, no frame without it.
    const hit = cached(head)
    if (hit !== null) return setLoaded((l) => (l?.key === turnKey && l.page === hit ? l : { key: turnKey, page: hit }))
    let on = true
    readInto(head).then(
      (page) => {
        if (!on) return
        if (page !== null) return setLoaded({ key: turnKey, page })
        setSession((s) => (s === null || !showing(s, head) ? s : without(s, s.at)))
      },
      (err: unknown) => {
        if (!on) return
        notice.current(`Can't read the card: ${reason(err)}`, 'error')
        setSession((s) => (s === null || !showing(s, head) ? s : without(s, s.at)))
      },
    )
    return () => {
      on = false
    }
  }, [turnKey, head, reread, cached, readInto])

  // Read ahead (YAZ-5029): the cards around the one showing, under the filter, so ← → find their text ready. A read
  // already on its way is not begun again; a failed one is left to the card's own read, when its turn comes.
  const reading = useRef(new Set<string>())
  const filter = session?.filter
  const queue = session?.queue
  const at = session?.at
  useEffect(() => {
    if (queue === undefined || at === undefined || filter === undefined) return
    const near: DueCard[] = []
    for (const delta of [1, -1] as const) {
      let left = AHEAD
      for (let i = at + delta; left > 0 && i >= 0 && i < queue.length; i += delta) {
        if (!matchesFilter(queue[i], filter)) continue
        near.push(queue[i])
        left--
      }
    }
    for (const card of near) {
      const key = cardKey(card)
      if (cached(card) !== null || reading.current.has(key)) continue
      reading.current.add(key)
      void readInto(card)
        .catch(() => null)
        .finally(() => reading.current.delete(key))
    }
  }, [queue, at, filter, records, cached, readInto])

  const start = useCallback(
    (scope: CardReviewScope = {}) => {
      const { records, settings } = live.current
      if (!settings.enabled) return
      const queue = cardPlan(records, settings, Date.now(), scope.folder, scope.page, source.letters, root === null ? NO_TAKEN : upNextTakenToday(root), root === null ? NO_ADDED : cardsAddedToday(root)).queue
      const label = scope.page !== undefined ? titleOf(records, scope.page) : scope.folder ? folderTitle(source.folders, `${root}/${scope.folder}`) : 'Inbox'
      const { due, new: fresh, next } = countOf(queue)
      // A new scope starts on All cards (YAZ-5017), with an empty bar (YAZ-5020).
      setSession((s) => ({ id: (s?.id ?? 0) + 1, label, scope, queue, at: 0, total: queue.length, turn: (s?.turn ?? 0) + 1, undo: [], filter: 'all', totals: { due, new: fresh, next }, answered: [], marks: markedIn(queue) }))
    },
    [root, source],
  )

  /** The fixed answers of the card showing: fixed now when not yet (D13). */
  const fixAnswers = useCallback((): CardAnswer[] | null => {
    const { session, loaded, fixed, settings } = live.current
    const shown = session?.queue[session.at]
    const key = session === null || shown === undefined ? null : `${session.turn}\n${shown.path}\n${shown.id}`
    if (key === null || shown === undefined) return null
    // The card's page: read this turn, or read ahead (YAZ-5029) — the one the Inbox shows.
    const page = loaded?.key === key ? loaded.page : cached(shown)
    if (page === null) return null
    if (fixed?.key === key) return fixed.answers
    const answers = previewAnswers(page.reviews, settings, Date.now())
    const next = { key, answers }
    live.current.fixed = next
    setFixed(next)
    return answers
  }, [cached])

  const answer = useCallback(
    async (rating: CardRating, seconds?: number) => {
      const s0 = live.current.session
      const card = s0?.queue[s0.at]
      const fixedAnswer = fixAnswers()?.find((a) => a.review.rating === rating)
      if (card === undefined || fixedAnswer === undefined || busy.current) return
      // The hover's review, with how long the answer took (YAZ-5033) when the Inbox timed it.
      const chosen = isCardSeconds(seconds) ? { ...fixedAnswer, review: { ...fixedAnswer.review, seconds } } : fixedAnswer
      busy.current = true
      forget(card.path)
      const written = await writeCardAnswer(card.path, card.id, chosen.review).then(
        (next) => ({ next }),
        (err: unknown) => {
          if (isCardGone(err)) return 'gone' as const
          onNotice(`Can't save the answer: ${reason(err)}`, 'error')
          return 'failed' as const
        },
      )
      busy.current = false
      forget(card.path) // also a read begun while it wrote
      if (written === 'failed') return
      // YAZ-5028: the answer took the mark off a card of today's Up next: one of the day's places is used. A marked
      // card past the day's places (`card.next` false) loses its mark too, but it held no place.
      if (written !== 'gone' && written.next >= 0 && card.next && root !== null) setUpNextTaken(root, card.id, true)
      setSession((s) => {
        if (s === null || !showing(s, card)) return s
        // Still in its steps (YAZ-5020): back at the end of this session, no longer new or up next.
        const repeat = written !== 'gone' && chosen.inSteps
        const undo = written !== 'gone' ? [...s.undo, { kind: 'answer' as const, card, review: chosen.review, next: written.next, at: s.at, repeat }].slice(-UNDO_DEPTH) : s.undo
        // The cards before (passed over with →) stay; the ones after are settled, as the head was before ← →.
        const after = settle(s.queue.slice(s.at + 1), s.scope)
        // The repeat keeps the filter it showed under (YAZ-5017): a new card's second Remembered is still under New cards.
        const queue = [...s.queue.slice(0, s.at), ...after, ...(repeat ? [{ ...card, due: chosen.due, next: false, repeat: true }] : [])]
        const answered = written !== 'gone' ? [...s.answered, rating] : s.answered
        // A repeat adds one to the session ("3 of 13", the progress bar's size).
        const totals = repeat ? { ...s.totals, [card.isNew ? 'new' : 'due']: s.totals[card.isNew ? 'new' : 'due'] + 1 } : s.totals
        // The next card is the one after; past the last, the first (a card passed over with →, or the repeat).
        return fitted({ ...s, queue, at: after.length > 0 ? s.at : 0, total: s.total + (repeat ? 1 : 0), totals, turn: s.turn + 1, undo, answered })
      })
    },
    [fixAnswers, onNotice, settle, forget, root],
  )

  /** The add's undo (YAZ-5042): today's number goes down by what the add grew it; its cards not answered yet leave. */
  const undoAdd = useCallback(
    (step: AddStep) => {
      if (root !== null) {
        const now = cardsAddedToday(root)
        setCardsAdded(root, step.what === 'new' ? { ...now, newCards: now.newCards - step.delta } : { ...now, upNext: now.upNext - step.delta })
      }
      setSession((s) => (s === null || s.undo.at(-1) !== step ? s : withoutAdded(s, step)))
    },
    [root],
  )

  const undo = useCallback(async () => {
    const last = live.current.session?.undo.at(-1)
    if (last === undefined || busy.current) return
    if (last.kind === 'add') return undoAdd(last)
    busy.current = true
    forget(last.card.path)
    const undone = await undoCardAnswer(last.card.path, last.card.id, last.review.at, last.next).then(
      () => true,
      (err: unknown) => {
        onNotice(`Can't undo the answer: ${reason(err)}`, 'error')
        return false
      },
    )
    busy.current = false
    forget(last.card.path)
    if (undone && last.next >= 0 && last.card.next && root !== null) setUpNextTaken(root, last.card.id, false)
    // The card back at its place (YAZ-5020), its repeat out of the queue and the session one smaller again; it shows
    // also under a filter that would hide it: then All cards (YAZ-5017). Its answer leaves the bar (YAZ-5020).
    if (undone)
      setSession((s) => {
        if (s === null || s.undo.at(-1) !== last) return s
        const rest = s.queue.filter((c) => !sameCard(c, last.card))
        const at = Math.min(last.at, rest.length)
        const side = last.card.isNew ? 'new' : 'due'
        const totals = last.repeat ? { ...s.totals, [side]: s.totals[side] - 1 } : s.totals
        // As it was (YAZ-5028): Up next again when it was in today's Up next; a marked card past the day's places
        // gets its mark back in the file, and waits in its normal place again.
        const card = last.card
        const filter = matchesFilter(card, s.filter) ? s.filter : 'all'
        return { ...s, queue: [...rest.slice(0, at), card, ...rest.slice(at)], at, total: s.total - (last.repeat ? 1 : 0), totals, turn: s.turn + 1, undo: s.undo.slice(0, -1), filter, answered: s.answered.slice(0, -1) }
      })
  }, [onNotice, forget, root, undoAdd])

  const close = useCallback(() => setSession(null), [])

  /** The card showing, when it is card `id` of `path`, is read again, and its answers fixed again, on its new log. */
  const readAgain = useCallback((path: string, id: string) => {
    forget(path)
    const s0 = live.current.session
    const shown = s0?.queue[s0.at]
    if (shown !== undefined && shown.path === path && shown.id === id) setSession((s) => (s === null ? s : { ...s, turn: s.turn + 1 }))
  }, [forget])

  const deleteReview = useCallback(
    async (path: string, id: string, review: CardReview) => {
      const removed = await deleteCardReview(path, id, review.at).then(
        (index) => index,
        (err: unknown) => {
          onNotice(`Can't delete the review: ${reason(err)}`, 'error')
          return null
        },
      )
      if (removed === null) return
      readAgain(path, id)
      // Back in its own place, not after the last review: the file is the same bytes again (YAZ-4964).
      const restore = () =>
        void restoreCardReview(path, id, review, removed).then(
          () => readAgain(path, id),
          (err: unknown) => onNotice(`Can't put the review back: ${reason(err)}`, 'error'),
        )
      onNotice('Review deleted', 'info', 'undo', { label: 'Undo', run: restore, fades: true })
    },
    [onNotice, readAgain],
  )

  const setNext = useCallback(
    async (path: string, id: string, on: boolean) => {
      const written = await changeCardLine(path, id, (l) => withCardNext(l, on)).then(
        () => true,
        (err: unknown) => {
          onNotice(`Can't change the card: ${reason(err)}`, 'error')
          return false
        },
      )
      if (written) readAgain(path, id)
    },
    [onNotice, readAgain],
  )

  const move = useCallback((delta: -1 | 1) => {
    setSession((s) => {
      if (s === null) return s
      const at = stepFrom(s, delta)
      return at === -1 ? s : { ...s, at, turn: s.turn + 1 }
    })
  }, [])

  const setFilter = useCallback((filter: CardFilter) => {
    setSession((s) => (s === null || s.filter === filter ? s : fitted({ ...s, filter, at: 0, turn: s.turn + 1 })))
  }, [])

  const addCards = useCallback(
    (kind: AddKind) => {
      const { session: s0, records, settings, taken, added } = live.current
      if (s0 === null || root === null || !settings.enabled) return
      const now = Date.now()
      const plan = cardPlan(records, settings, now, s0.scope.folder, s0.scope.page, source.letters, taken, added)
      const n = addsOf(plan, settings)[kind]
      const delta = plan.grow(kind, n)
      if (n === 0 || delta <= 0) return
      const next = kind === 'new' ? { ...added, newCards: added.newCards + delta } : { ...added, upNext: added.upNext + delta }
      setCardsAdded(root, next)
      live.current.added = next
      const queue = cardPlan(records, settings, now, s0.scope.folder, s0.scope.page, source.letters, taken, next).queue
      setSession((s) => (s === null || s.id !== s0.id ? s : withAdded(s, kind, queue, delta)))
    },
    [root, source],
  )

  const unarchive = useCallback(
    async (path: string, id: string) => {
      forget(path)
      await changeCardLine(path, id, (l) => withCardOff(l, false)).then(
        () => undefined,
        (err: unknown) => onNotice(`Can't change the card: ${reason(err)}`, 'error'),
      )
      forget(path)
    },
    [onNotice, forget],
  )

  const turnOff = useCallback(async () => {
    const s0 = live.current.session
    const card = s0?.queue[s0.at]
    if (card === undefined) return
    forget(card.path)
    const written = await changeCardLine(card.path, card.id, (l) => withCardOff(l, true)).then(
      () => true,
      (err: unknown) => {
        onNotice(`Can't change the card: ${reason(err)}`, 'error')
        return false
      },
    )
    forget(card.path)
    if (written) setSession((s) => (s === null || !showing(s, card) ? s : without(s, s.at)))
  }, [onNotice, forget])

  const folders = source.folders
  // YAZ-5042: the open scope's plan, for what waits past today's number (the vault's is `vaultPlan`).
  const scope = session?.scope
  const scopePlan = useMemo(
    () => (scope === undefined || (!scope.folder && scope.page === undefined) ? vaultPlan : cardPlan(records, settings, Date.now(), scope.folder, scope.page, letters, taken, added)),
    [scope, vaultPlan, records, settings, letters, taken, added],
  )
  // YAZ-5046: the open scope's archived cards, from the index.
  const archived = useMemo(() => (scope === undefined ? [] : archivedCards(records, scope.folder, scope.page)), [scope, records])
  // YAZ-5029: the last card shown with its text, and its session: on show while the next card is read.
  const lastShown = useRef<{ session: number; card: ShownCard } | null>(null)
  const shownSession = useMemo<CardReviewSession | null>(() => {
    if (session === null) return null
    const card = session.queue[session.at]
    const page = card === undefined ? null : loaded?.key === turnKey ? loaded.page : cached(card)
    let shownCard: ShownCard | null = card === undefined ? null : { ...card, page }
    if (shownCard !== null && page === null && lastShown.current?.session === session.id) shownCard = lastShown.current.card
    else if (shownCard !== null && page !== null) lastShown.current = { session: session.id, card: shownCard }
    const { filter, queue, totals, scope } = session
    const counts = countOf(queue)
    const lastStep = session.undo.at(-1)
    // "3 of 12" under the filter (YAZ-5017): its cards at start, those gone since, and the place among those left.
    const total = filter === 'all' ? totals.due + totals.new : filter === 'archived' ? archived.length : totals[filter]
    const before = queue.slice(0, session.at).filter((c) => matchesFilter(c, filter)).length
    const vault = vaultName ?? (root === null ? 'Inbox' : storage.vaultName(root))
    const from = scope.page !== undefined ? [session.label] : scope.folder ? scope.folder.split('/').filter(Boolean) : [vault]
    return {
      label: session.label,
      scope: scope.page !== undefined ? 'page' : scope.folder ? 'folder' : 'vault',
      card: shownCard,
      position: filter === 'archived' ? 0 : Math.max(1, Math.min(total - counts[filter] + 1 + before, total)),
      total,
      canBack: stepFrom(session, -1) !== -1,
      canNext: stepFrom(session, 1) !== -1,
      // The card before, still on show (YAZ-5029), has no answers: none of its buttons writes to the card under it.
      answers: fixed?.key === turnKey && page !== null ? fixed.answers : null,
      canUndo: session.undo.length > 0,
      filter,
      counts,
      archived,
      from,
      place: shownCard === null || root === null ? [] : cardPlace(root, vault, folders, records, shownCard.path),
      answered: session.answered,
      size: Math.max(session.total, session.answered.length + queue.length),
      today,
      more: scopePlan.more,
      adds: addsOf(scopePlan, settings),
      lastAdd: lastStep?.kind === 'add' ? { kind: lastStep.what, count: lastStep.count } : null,
    }
    // `records`: a cached page is good only at its page's mtime.
  }, [session, loaded, fixed, turnKey, root, vaultName, cached, records, folders, today, scopePlan, settings, archived])

  return { dueCount, settings, session: shownSession, start, showAnswers: fixAnswers, answer, undo, close, deleteReview, setNext, move, turnOff, unarchive, setFilter, addCards }
}
