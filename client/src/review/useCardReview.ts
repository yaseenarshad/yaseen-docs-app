import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { isCardSeconds, withCardNext, withCardOff, type CardLine, type CardRating, type CardReview } from '@shared/cardLine'
import { UP_NEXT_BEGUN, addStep, anyUpNext, cardPlan, cardState, isCardDue, newCardFolders, previewAnswers, reviewedToday, type AddKind, type CardAnswer, type CardPlan, type CardsAddedToday, type DueCard, type ReviewedToday } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import type { NoticeAction, NoticeKind, NoticeType } from '../lib/notice'
import { folderTitle } from '../links/folderTitle'
import { isCardGone, type CardOnPage } from './cardRead'
import { useLocalDay } from './localDay'
import type { ReviewHost } from './reviewHost'
import { dueFirsts, filterCount, matchesFilter, type FilterCount, type SessionAnswer } from './sessionProgress'
import { tourEvent } from '../course/tourBus'

/**
 * Card review as App sees it (YAZ-4967): how many cards are due, and the one review
 * session a vault can have open. The hook holds the review rules only; it reads and writes through its `host`
 * (YAZ-5067, `reviewHost.ts`): the desktop passes `desktopReviewHost`, the phone its own store. No default (YAZ-5161).
 * The queue comes from the index (`cardQueue`) and is taken ONCE, at start; a card is
 * checked against the live index only when its turn comes, and read from its page when it shows (the index holds no
 * text, D4). A card whose page or ID is gone is passed over. A card that LEAVES the scope's due cards while the session
 * is open (answered on the other device, YAZ-5622; archived elsewhere) leaves the whole session at once (`withLive`):
 * the counts, "done / total", ← → and the card on show, so it never gets a second review.
 *
 * The buttons (D13): `showAnswers` fixes what each button shows ("Remembered · 9 days") for the card on show. `answer`
 * writes the review at the time the button was PRESSED (Review rules v1, rule 15, YAZ-5655), at least 1 ms after the
 * card's last review (rule 16), so an answer just after midnight is the new day's. `undo` (⌘Z, idea 5) removes
 * the last answer's review and shows that card again. The first answer to an up-next card removes its `next` in the
 * same write (YAZ-4999 D3), and its undo puts it back.
 *
 * ← → (YAZ-5004) move the card showing through the queue with no answer: `at` is the one new piece of state, the
 * place of the card showing; a card you leave stays in the queue. `turnOff` (the Inbox ⋯'s Archive card) writes `off`
 * and takes the card out of the queue.
 *
 * Archived cards (YAZ-5046) are never in the queue. The Inbox lists none (YAZ-5319): a folder page's table finds them
 * (Show cards as rows, Card status), and a card's ⋯ menu unarchives it.
 *
 * Fix later (YAZ-5097): a marked card stays in review: the mark changes no count and no queue. The Inbox never shows or
 * sets it (YAZ-5430): a card's ⋯ elsewhere does, and a folder page's Cards table has Card fix status.
 *
 * The filter (YAZ-5017, as Mochi's "All cards ▾"): All cards, Due today (cards with reviews, due now) or New cards
 * (never reviewed, within today's new-card limit: the queue's own). The queue stays whole; the filter picks which of its
 * cards show, and "done / total" counts only those. Up next (YAZ-5028): the cards marked `next`, new or reviewed (`off` cards
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
 * `answered` (YAZ-5020) is each answer of the session, in order, with its card's kind; ⌘Z takes the last one back. The
 * top right's "✕ K · done / total" and the bar read it with the queue, as Mochi counts (YAZ-5675, `filterCount`): a
 * Forgot on a due card is done +1 and total +1, a new card learned under All cards total +1, a Remembered in the missed
 * pass total −1. A new session (or the Inbox tab closed) starts it empty.
 *
 * Same-day steps (YAZ-5020): an answer that leaves the card in its steps (`CardAnswer.inSteps`: a Forgot; a new card's
 * first Remembered) puts it back at the END of this session's queue, until the scheduler lets it go: a new card after
 * two Remembered in a row, a known card after one. Closed
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
 *
 * Round 2 (YAZ-5042, Yaseen: "keep it add ten cards, but we do the math behind the scenes"): `addCards` takes how many
 * MORE (the Inbox's "Add [10] more" field; the Settings number when not given), never more than what waits, so 10 + 12
 * makes today 22. `resetCards` sets today back to the Settings number, never below what today already did
 * (`CardPlan.floor`): the cards it takes out of today that are not answered yet leave the session, the one on show
 * stays. A Reset is on the undo stack as an add is; its undo brings the cards back.
 *
 * Where new cards come from (YAZ-5322): `setNewFrom` saves the folder pick (`ReviewSettings.newFrom`, all folders when
 * empty) until it is cleared. Only new cards follow it; due cards and Up next come from everywhere (`cardPlan`). A
 * change of the pick changes the open session's new cards at once (`withNewCards`): its new cards no longer in today's
 * queue leave (not the one on show, not a repeat), today's new cards not in it join at the end. It is a setting, so
 * it is not on the undo stack. `newCardFolders` gives the picker its folders and counts.
 *
 * THE END OF DUE TODAY (YAZ-5043, as Mochi's two passes): under All cards and Due today, a Forgot on a card with
 * reviews is held back to the end of the DUE part of the queue (before any new card), so the missed cards come before
 * the new ones. When the first pass of the due cards is done the session STOPS (`pause`): "You remembered 93% of
 * cards." with one button, "Review missed cards 5" (no skip: you finish them that day; YAZ-5677, Mochi's words). A missed card is one with a
 * Forgot in this session (YAZ-5614): a card back after a ✓ (still in its learning steps) waits, but makes no stop. When the missed cards are done
 * too it stops again: "Due today is done.", then "Learn new cards 11" (`goOn`). The % counts each due card's FIRST
 * answer of this session only (`dueFirsts`, `sessionProgress.ts`): a card missed then got right counts as missed, a new card never counts, and a
 * history reset elsewhere changes nothing. Each stop shows once per session (`stage`): a card that becomes due later
 * never brings the % screen back. ⌘Z on a stop takes it back with the last answer: the card shows again.
 */

/** Which cards of the session show (YAZ-5017). Each has a count of the session's queue. */
export type CardFilter = 'all' | 'next' | 'due' | 'new'

export { matchesFilter }

/** What a session reviews: the vault (nothing), a folder (root-relative, "Review this folder") or one page (its absolute path, "Review this page"). */
export interface CardReviewScope {
  folder?: string
  page?: string
}

/** Where a moved Inbox picks up (YAZ-5054): its filter, and the card it showed. */
export interface CardReviewResume {
  filter?: CardFilter
  card?: { path: string; id: string }
}

/** The card a session shows. */
export interface ShownCard extends DueCard {
  /** The card as its page holds it now; null while the page is read. */
  page: CardOnPage | null
  /** Put back by an answer that left it in its steps (YAZ-5020): a Forgot, a new card's first Remembered. */
  repeat?: boolean
  /** Put back by a Forgot (✕, YAZ-5626): the one card that wears "Again"; a new card back for its second ✓ does not. */
  forgot?: boolean
}

export interface CardReviewSession {
  /** "Inbox", the folder's title or the page's title. */
  label: string
  /** What the session reviews: the done screen says what is true for it (a page done is not the Inbox done). */
  scope: 'vault' | 'folder' | 'page'
  /** The same as `start` was given it (YAZ-5054): the folder or the page, so the Inbox can open again in another window. */
  cards?: CardReviewScope
  /** The card showing; null once nothing is left (the done screen). */
  card: ShownCard | null
  /** ← and → (YAZ-5004): a card before or after the one showing is still in the queue. */
  canBack: boolean
  canNext: boolean
  /** Each button's outcome, fixed by `showAnswers` for the card showing (in button order); null until then. */
  answers: CardAnswer[] | null
  canUndo: boolean
  /** The filter on show (YAZ-5017). */
  filter: CardFilter
  /** The cards left in the session under each filter: the menu's counts. */
  counts: Record<CardFilter, number>
  /** Where the cards come from (YAZ-5017): the vault's name; the folder's parts; the page's name. Shown by the filter ("· in …"). */
  from: string[]
  /** The card showing's place (YAZ-5017 round 2, YAZ-5132): folders › page, no vault (YAZ-5682; a card file: its folders), each with what a click opens. Empty with no card. */
  place: CardPlacePart[]
  /** Each answer of the session, in order (YAZ-5020): a Forgot ('again') or a Remembered (any other). */
  answered: CardRating[]
  /**
   * The filter on show's "done / total" and its due cards waiting after a Forgot (YAZ-5675, as Mochi's, `filterCount`):
   * the top right's count and the progress bar (grey done ÷ total, red (done + waiting) ÷ total).
   */
  progress: FilterCount
  /**
   * The top right's red ✕ K (YAZ-5674): the open filter's due cards back after a Forgot, the bar's red too (YAZ-5681:
   * one place we differ from Mochi on purpose, which shows the session's ✕ on every filter); 0 (hidden) in the missed pass.
   */
  misses: number
  /**
   * The last thing done was a Remembered that learned a new card (YAZ-5679, Mochi's "Added card to reviews · Undo"):
   * one key per such answer, so the note shows for it; Undo (`undo`) takes that answer back. Null otherwise.
   */
  learned: string | null
  /** Today's review work across the vault, from the index (YAZ-5033): the top row's and the done screen's "Today: …". */
  today: ReviewedToday
  /** The scope's cards past today's number, of each kind (YAZ-5042): the menu's "38 more", the done screen's line. */
  more: Record<AddKind, number>
  /** What one click adds of each kind (YAZ-5042): one more day of the Settings number, at most `more`; 0 = no Add. */
  adds: Record<AddKind, number>
  /**
   * Whether each kind has a number a day (YAZ-5042 round 2): its menu row reads "today / total" ("10 / 48"); with no
   * limit every card of the kind is today's, and the row shows the count alone.
   */
  limited: Record<AddKind, boolean>
  /** Whether Reset would lower today's number of each kind (YAZ-5042 round 2): today has an add above today's work. */
  canReset: Record<AddKind, boolean>
  /** Some card of the vault is marked Up next (YAZ-5321, `anyUpNext`): with none, the Inbox offers no Up next. */
  upNext: boolean
  /** The add or Reset, while it is the last thing done (YAZ-5042): the line under the buttons says it; null otherwise. */
  lastAdd: { kind: AddKind; count: number; reset: boolean } | null
  /** The last thing done was Archive card, and Undo takes it back (YAZ-5078 on the phone, YAZ-5621 on the Mac: a host with `undoesArchive`). */
  lastArchive?: { id: string } | null
  /** The saved folder pick for new cards (YAZ-5322), each with its name; empty for All folders. */
  newFrom: Pick<NewCardFolder, 'folder' | 'label'>[]
  /** A stop at the end of Due today (YAZ-5043): the screen in place of the card; null while cards show. */
  end: DueTodayEnd | null
  /**
   * This landing on the done screen after an answer of this session (YAZ-5662): its cheer plays once for it, not when
   * the tab opens again. Null while a card shows, and on a session with no answer yet (opened done).
   */
  landing: string | null
  /** The picked folders have no new card left in the scope, so new cards come from All folders (YAZ-5322). */
  newFallback: boolean
}

/** Where Due today stopped (YAZ-5043): `missed` after the first pass (missed cards wait), `done` when all are done. */
export interface DueTodayEnd {
  kind: 'missed' | 'done'
  /** Unique per stop of the session: the screen's animation plays once for it. */
  id: string
  /** Due cards answered this session (their first answer), and how many of those first answers were Remembered. */
  count: number
  remembered: number
  /** The whole % remembered, never rounded up to 100 while one card was missed. */
  percent: number
  /** The missed cards waiting (the "Review missed cards 5" button). */
  missed: number
  /** The new cards left in the session, with those begun today that wait for their second ✓ (the "Learn new cards 11" button). */
  fresh: number
}

/** A folder of the new-cards picker (YAZ-5322): root-relative, its name, and how many new cards it holds with its subfolders. */
export interface NewCardFolder {
  folder: string
  label: string
  count: number
}

export interface CardReviewApi {
  /** The cards due now in the vault: the Inbox row's count. 0 while review is off. */
  dueCount: number
  /** The vault's review settings (`answerRatings`, `answerLabel`, `cardHistory` read them). */
  settings: ReviewSettings
  session: CardReviewSession | null
  /** A new session of `scope`; `resume` (YAZ-5054, a moved Inbox) starts it on that filter, at that card while it is in the queue. */
  start: (scope?: CardReviewScope, resume?: CardReviewResume) => void
  /** Fixes and returns each button's outcome for the card showing; the same array until that card goes. Null with no card loaded. */
  showAnswers: () => CardAnswer[] | null
  /**
   * Writes the fixed review of `rating`'s button (fixing it now if `showAnswers` was not called), then the next card.
   * `seconds` (YAZ-5033): how long the answer took, by the Inbox's timer; the review part ends with ` <n>s`. Absent:
   * none is written.
   */
  /** True when the answer was written (YAZ-5502: the caller learns it here, never from a later draw of the screen). */
  answer: (rating: CardRating, seconds?: number) => Promise<boolean>
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
  /** All cards, Up next, Due today or New cards (YAZ-5017): which of the session's cards show. */
  setFilter: (filter: CardFilter) => void
  /**
   * Adds `count` more cards of `kind` for today (YAZ-5042 round 2: the typed number; `session.adds[kind]`, the Settings
   * number, when not given), at most what waits; `undo` takes it back.
   */
  addCards: (kind: AddKind, count?: number) => void
  /** Sets today's number of `kind` back to the Settings number, never below today's work (YAZ-5042 round 2); `undo` takes it back. */
  resetCards: (kind: AddKind) => void
  /** Saves the folders new cards come from (YAZ-5322); empty for All folders. The open session's new cards follow at once. */
  setNewFrom: (folders: readonly string[]) => void
  /** The picker's rows (YAZ-5322): every new card of the vault, and each folder with new cards (or picked), parents first. */
  newCardFolders: () => { all: number; folders: NewCardFolder[] }
  /** Past a stop of Due today (YAZ-5043): the missed cards, or the new cards (Due today's filter goes to New cards). */
  goOn: () => void
}

/** One part of a card's place (YAZ-5017 round 2): its name, and the path a click opens (a folder's page, or the page). */
export interface CardPlacePart {
  kind: 'folder' | 'page'
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
  /** Bumped each time the card at the head is put there: its page is read again, its answers fixed again. */
  turn: number
  /** Each answer and each add (YAZ-5042), in order: ⌘Z takes back the last. */
  undo: UndoStep[]
  /** YAZ-5017: which cards show; `at` is always a card that matches it, or past the end when none does. */
  filter: CardFilter
  /** YAZ-5020: each answer, in order, with its card's kind (the progress bar and the end's ring, `sessionProgress`); ⌘Z takes the last back. */
  answered: SessionAnswer[]
  /** YAZ-5031: the cards of the scope the index last marked `next` (`cardKey`): a change of them moves the session. */
  marks: ReadonlySet<string>
  /**
   * YAZ-5622: the cards of the scope the index last had in today's queue (`cardKey`), with their list: one that leaves
   * it goes, one that joins it from the files joins the session (rules 11, 12: `withLive`).
   */
  live: ReadonlyMap<string, CardList>
  /** YAZ-5043: where Due today is: its first pass, its missed cards, or over (each stop shows once). */
  stage: DueStage
  /** YAZ-5043: the stop on show, or null. */
  pause: DueTodayEnd['kind'] | null
}

type DueStage = 'first' | 'missed' | 'over'

/** The one list a card of today is in (Review rules v1, rule 7): Up next, Due today or New cards. */
type CardList = 'next' | 'due' | 'new'
const listOf = (c: Pick<DueCard, 'isNew' | 'next'>): CardList => (c.next ? 'next' : c.isNew ? 'new' : 'due')
const listsOf = (queue: readonly DueCard[]): Map<string, CardList> => new Map(queue.map((c) => [cardKey(c), listOf(c)]))

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
  /** YAZ-5043: the Due today stage before it. */
  stage: DueStage
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

/**
 * A Reset (YAZ-5042 round 2): its kind, how much today's added number went down (`delta`), and the cards that left the
 * session or stopped being Up next (`count`).
 */
interface ResetStep {
  kind: 'reset'
  what: AddKind
  delta: number
  count: number
}

/**
 * An Archive card that Undo can take back (both apps: YAZ-5078 the phone, YAZ-5621 the Mac; a host with
 * `undoesArchive`): the card, and its place in the queue, so the undo puts it back where it was.
 */
interface ArchiveStep {
  kind: 'archive'
  card: QueueCard
  at: number
}

type UndoStep = AnswerStep | AddStep | ResetStep | ArchiveStep

/**
 * A card of a session's queue; `repeat` (YAZ-5020): put back at the end by an answer that left it in its steps.
 * `fromNew` (YAZ-5610, Yaseen's rule from Mochi): a new card past its first Remembered, back the same day as a Due today
 * card; it is no missed card (the % screen's "Review missed cards" leaves it out) and waits at the end of the session.
 * `forgot` (YAZ-5626): put back by a Forgot (✕), so it wears "Again"; the last answer decides, so a ✓ that leaves it in
 * its steps takes it off.
 */
type QueueCard = DueCard & { repeat?: boolean; fromNew?: boolean; forgot?: boolean }

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
/**
 * Where a Forgot's repeat goes (YAZ-5043): a new card's at the end; a due card's at the end of the DUE part of `rest`,
 * so the missed cards come before the new cards under All cards too.
 */
const repeatPlace = (rest: readonly QueueCard[], from: number, card: QueueCard): number => {
  if (card.isNew || card.fromNew === true) return rest.length
  for (let i = rest.length - 1; i >= from; i--) if (!rest[i].isNew) return i + 1
  return from
}

/**
 * The stop after a due card's answer (YAZ-5043), or none: the first pass done (missed cards wait, or none: Due today
 * is done), or the missed cards done. Only under All cards and Due today, and each stop once (`stage`).
 */
const dueStop = (s: Session, card: QueueCard): Pick<Session, 'stage' | 'pause'> => {
  const none = { stage: s.stage, pause: null }
  if (!inPass(card, s.filter) || s.stage === 'over' || (s.filter !== 'all' && s.filter !== 'due')) return none
  const due = s.queue.filter((c) => inPass(c, s.filter))
  // The first pass is done when every due card waiting is a repeat (YAZ-5614: a repeat after a ✓, a card still in its
  // learning steps, is no missed card: the stop needs a Forgot, so it never says "100%" with "Review missed cards 1").
  if (due.some((c) => c.repeat !== true)) return none
  // And the % it shows must be under 100: a first answer of this session was a Forgot (spec 15).
  if (s.stage === 'first' && missedCards(s).length > 0 && s.answered.some((a) => a.first && a.rating === 'again')) return { stage: 'missed', pause: 'missed' }
  if (due.length > 0) return none
  return { stage: 'over', pause: 'done' }
}

/**
 * A card of Due today's pass (YAZ-5043): under All cards a due card or an Up next card (rule 8: the % counts every card
 * answered in that pass, an Up next card too); under Due today its own cards (rule 7). A new card begun today
 * (`fromNew`) waits for its second ✓ after the pass.
 */
const inPass = (c: QueueCard, filter: CardFilter): boolean => c.fromNew !== true && (filter === 'all' ? c.next || !c.isNew : matchesFilter(c, 'due'))

/** The missed cards waiting (YAZ-5043): due cards back in this session after a Forgot of this session (YAZ-5614). */
const missedCards = (s: Session): QueueCard[] => {
  const forgot = new Set(s.answered.filter((a) => a.rating === 'again').map((a) => a.key))
  return s.queue.filter((c) => !c.isNew && c.repeat === true && c.fromNew !== true && forgot.has(cardKey(c)))
}

/** The place of the card the filter shows next before (-1) or after (+1) `at`; -1 when there is none. */
const stepFrom = (s: Session, delta: -1 | 1): number => {
  for (let i = s.at + delta; i >= 0 && i < s.queue.length; i += delta) if (matchesFilter(s.queue[i], s.filter)) return i
  return -1
}
/** The menu's counts (rule 7): each card in one list only, so All cards = Up next + Due today + New cards. */
const countOf = (queue: readonly DueCard[]): Record<CardFilter, number> => {
  const counts = { all: queue.length, next: 0, due: 0, new: 0 }
  for (const c of queue) counts[listOf(c)]++
  return counts
}

/** Each session's `id`, unique in the app's run (YAZ-5043: an end screen's animation plays once per stop). */
let sessionCount = 0

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
  let shown: QueueCard | undefined = head
  const rest: QueueCard[] = []
  const moved = new Map<string, QueueCard>()
  for (const card of s.queue) {
    const key = cardKey(card)
    if (on.has(key) && !card.next) {
      const marked = { ...card, next: true }
      if (card === head) rest.push((shown = marked))
      else moved.set(key, marked)
    } else if (off.has(key) && card.next) {
      if (card !== head && card.repeat !== true && !due.has(key)) continue
      if (card === head) rest.push((shown = { ...card, next: false }))
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
    else if (!inSession.has(key)) joining.push(card)
  }
  const place = shown === undefined ? rest.length : rest.indexOf(shown) + 1
  const queue = [...rest.slice(0, place), ...joining, ...rest.slice(place)]
  const at = shown === undefined ? place : place - 1
  return fitted({ ...s, queue, at, marks, turn: shown === head ? s.turn : s.turn + 1 })
}

/**
 * The session after the index changed (YAZ-5622, audit item 6): a card that WAS in the scope's queue (`live`, `cardQueue`)
 * and is not now was answered on the other device (or archived, or its page went): it leaves the whole session — the
 * counts, "done / total", ← and →, the card on show too — so it never gets a second review. Only a CHANGE moves it, as with
 * the marks (YAZ-5031): a snapshot that has not caught up with this session's own write (an Undo that brought a card
 * back) drops nothing. Only the FILES move it (`files`: the index changed): this device's own Add more, Reset, Up next
 * places or settings have their own rules (`withAdded`, `withReset`, …), so then it only takes the new list in. `keep`: the
 * card this session is writing now, which its own write handles, and the cards whose mark changed (`withMarks` has them).
 *
 * The lists rebuild at once (Review rules v1, rules 11 and 12, YAZ-5655; Anki rebuilds its queue after any action that is
 * not an answer, and after a sync): a card that JOINS today's list from the files joins the session — the next new card
 * when an Archive or an Up next mark freed a New cards place, a card the other device began or forgot. A due card comes
 * at the end of the due cards, a new card at the end. A card of the session the other device began (New cards → Due
 * today) is a Due today card here, back for its second ✓. Up next cards join through `withMarks`.
 */
const withLive = (s: Session, live: readonly DueCard[], files: boolean, keep: ReadonlySet<string>): Session => {
  const now = listsOf(live)
  const gone = new Set(files ? [...s.live.keys()].filter((k) => !now.has(k) && !keep.has(k)) : [])
  const inSession = new Set(s.queue.map(cardKey))
  const joining = files ? live.filter((c) => !c.next && !s.live.has(cardKey(c)) && !inSession.has(cardKey(c)) && !keep.has(cardKey(c))) : []
  const begun = new Set(files ? [...now].filter(([k, list]) => list === 'due' && s.live.get(k) === 'new' && !keep.has(k)).map(([k]) => k) : [])
  const moved = s.queue.some((c) => gone.has(cardKey(c)) || (begun.has(cardKey(c)) && c.isNew && c.repeat !== true))
  if (!moved && joining.length === 0) {
    const same = now.size === s.live.size && [...now].every(([k, list]) => s.live.get(k) === list)
    return same ? s : { ...s, live: now }
  }
  const head = s.queue[s.at]
  // The other device began it: a Due today card here, for its second ✓ (rule 12, as YAZ-5610's `fromNew`).
  const kept = s.queue.filter((c) => !gone.has(cardKey(c))).map((c): QueueCard => (begun.has(cardKey(c)) && c.isNew && c.repeat !== true ? { ...c, isNew: false, fromNew: true } : c))
  const shown = head === undefined ? undefined : kept.find((c) => sameCard(c, head))
  let queue = kept
  for (const card of joining) queue = card.isNew ? [...queue, card] : [...queue.slice(0, dueEnd(queue)), card, ...queue.slice(dueEnd(queue))]
  // The card on show stays on show; when it went, the next card left after it.
  const at = shown !== undefined ? queue.indexOf(shown) : s.queue.slice(0, s.at).filter((c) => !gone.has(cardKey(c))).length
  const next = fitted({ ...s, queue, at: at < queue.length ? at : 0, live: now, turn: queue[at] !== undefined && head !== undefined && sameCard(queue[at], head) && queue[at].isNew === head.isNew ? s.turn : s.turn + 1 })
  // The card on show went and it was the last due card left of the first pass: Due today's stop, as an answer here makes.
  return head !== undefined && gone.has(cardKey(head)) && s.pause === null && dueFirsts(s.answered).count > 0 ? { ...next, ...dueStop(next, head) } : next
}

/** The place after the last due card of `queue` (before the new cards and the new cards begun today): where a due card joins. */
const dueEnd = (queue: readonly QueueCard[]): number => {
  for (let i = queue.length - 1; i >= 0; i--) if (!queue[i].isNew && queue[i].fromNew !== true) return i + 1
  return 0
}

/** A card with reviews that is not due today, nor Up next, nor off: the other device finished it (YAZ-5617). */
const doneToday = (card: CardOnPage, settings: ReviewSettings): boolean => {
  if (card.off || card.next || card.reviews.length === 0) return false
  const state = cardState(card.reviews, settings)
  return state.due !== null && !isCardDue(state.due, Date.now(), state.inSteps)
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
  // YAZ-5043: an add from the "Due today is done." screen with nothing left shows its first card at once.
  const pause = shownNow === undefined ? null : s.pause
  return fitted({ ...s, queue, at, filter, marks, undo, pause, turn: shownNow === head ? s.turn : s.turn + 1 })
}

/** The session after an add's undo (YAZ-5042): its cards not answered yet leave; a card it made Up next is not any more. */
const withoutAdded = (s: Session, step: AddStep): Session => {
  const joined = new Set(step.joined)
  const promoted = new Set(step.promoted)
  const head = s.queue[s.at]
  const queue: QueueCard[] = []
  let at = -1
  for (const c of s.queue) {
    const key = cardKey(c)
    if (joined.has(key) && c.repeat !== true) continue
    const back = promoted.has(key) && c.next && c.repeat !== true ? { ...c, next: false } : c
    if (c === head) at = queue.length
    queue.push(back)
  }
  const marks = step.what === 'next' ? new Set([...s.marks].filter((k) => !joined.has(k) && !promoted.has(k))) : s.marks
  const kept = at !== -1
  return fitted({ ...s, queue, at: kept ? at : Math.min(s.at, queue.length), marks, undo: s.undo.slice(0, -1), turn: kept && queue[at] === head ? s.turn : s.turn + 1 })
}

/**
 * The session after a Reset (YAZ-5042 round 2): `live` is the scope's queue with the lower added number. A card of
 * `what` no longer in today's queue leaves the session, unless it shows or comes back as a repeat; an Up next card due
 * anyway stays, as a due card. The step goes on the undo stack even when no card of the session changes. On a stop of
 * Due today no card is on show, so none is kept for it (rule 11: Reset never shows a card not in today's list).
 */
const withReset = (s: Session, what: AddKind, live: readonly DueCard[], delta: number): Session => {
  const today = new Map(live.map((c) => [cardKey(c), c]))
  const head = s.queue[s.at]
  const dropped = new Set<string>()
  const queue: QueueCard[] = []
  let at = -1
  for (const c of s.queue) {
    const ofKind = c.repeat !== true && (what === 'next' ? c.next : c.isNew && !c.next)
    const now = today.get(cardKey(c))
    // Rule 11 (YAZ-5614 item 3): on a stop no card is on show, so Reset keeps none that today's list does not have.
    if (ofKind && (c !== head || s.pause !== null) && (now === undefined || (what === 'next' && !now.next))) {
      dropped.add(cardKey(c))
      if (now === undefined) continue
      queue.push({ ...c, next: false })
      continue
    }
    if (c === head) at = queue.length
    queue.push(c)
  }
  const marks = what === 'next' ? new Set([...s.marks].filter((k) => !dropped.has(k))) : s.marks
  const step: ResetStep = { kind: 'reset', what, delta, count: dropped.size }
  const undo = [...s.undo, step].slice(-UNDO_DEPTH)
  return fitted({ ...s, queue, at: at === -1 ? Math.min(s.at, queue.length) : at, marks, undo, turn: s.turn })
}

/**
 * The session after the folder pick changed (YAZ-5322): `live` is the scope's queue with the new pick. A new card of the
 * session no longer in it leaves (not the card on show, not a repeat); today's new cards not in the session join at the
 * end, and on the done screen the first of them shows. Not on the undo stack: it is a setting.
 */
const withNewCards = (s: Session, live: readonly DueCard[]): Session => {
  const plain = (c: QueueCard): boolean => c.isNew && !c.next && c.repeat !== true
  const today = new Set(live.filter(plain).map(cardKey))
  const inSession = new Set(s.queue.map(cardKey))
  const head = s.queue[s.at]
  const queue: QueueCard[] = []
  let at = -1
  for (const c of s.queue) {
    if (plain(c) && (c !== head || s.pause !== null) && !today.has(cardKey(c))) continue
    if (c === head) at = queue.length
    queue.push(c)
  }
  const joining = live.filter((c) => plain(c) && !inSession.has(cardKey(c)))
  if (joining.length === 0 && queue.length === s.queue.length) return s
  return fitted({ ...s, queue: [...queue, ...joining], at: at === -1 ? queue.length : at })
}

/** The stop's screen (YAZ-5043): the %, from first answers only, never 100 while one was missed. */
const endOf = (s: Session): DueTodayEnd | null => {
  if (s.pause === null) return null
  return {
    kind: s.pause,
    id: `${s.id}:${s.answered.length}:${s.pause}`,
    ...dueFirsts(s.answered),
    missed: missedCards(s).length,
    // YAZ-5616: a new card begun today (its first ✓, `fromNew`) still waits for its second ✓ in this session: it counts.
    // Rule 7: a new Up next card is under Up next, not New cards.
    fresh: s.queue.filter((c) => matchesFilter(c, 'new') || c.fromNew === true).length,
  }
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const sameCard = (a: DueCard, b: DueCard): boolean => a.path === b.path && a.id === b.id
/** Is `card` the one on show? By path and ID: a mark the index changed (YAZ-5031) gives the card a new object. */
const showing = (s: Session, card: DueCard): boolean => s.queue[s.at] !== undefined && sameCard(s.queue[s.at], card)
const cardKey = (card: DueCard): string => `${card.path}\n${card.id}`
const titleOf = (records: readonly IndexRecord[], path: string): string => records.find((r) => r.path === path)?.title ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

/**
 * The place of the card at `path`, where it LIVES (YAZ-5017 round 2; YAZ-5132, Yaseen: "we should just have the
 * breadcrumb at the top"): each folder down to the file, then the page by its title — the ONE breadcrumb; the head
 * has no "in <page>". No vault (YAZ-5682): a session is one vault's (`root`), named in the window title and the
 * sidebar, so a page at the vault's top is its name alone. A CARD FILE (YAZ-5037) ends at its folder: its name is its
 * title, which the head shows (and keeps back while `notitle` hides it). An embed never shows here: the queue is the
 * cards of each page's own text (`cardRecords`), never a page's `![[…]]`.
 */
export function cardPlace(root: string, folders: readonly IndexRecord[], records: readonly IndexRecord[], path: string): CardPlacePart[] {
  const dirs = (path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path).split('/').slice(0, -1)
  const inside = dirs.map((_, i): CardPlacePart => {
    const dir = `${root}/${dirs.slice(0, i + 1).join('/')}`
    return { kind: 'folder', label: folderTitle(folders, dir), path: dir }
  })
  return records.find((r) => r.path === path)?.kind === 'card' ? inside : [...inside, { kind: 'page', label: titleOf(records, path), path }]
}

export function useCardReview(
  root: string | null,
  source: IndexSource,
  settings: ReviewSettings,
  onNotice: (text: string, icon?: NoticeKind, type?: NoticeType, action?: NoticeAction) => void,
  vaultName: string | null | undefined,
  host: ReviewHost,
  /** The vault's settings save (`useReviewSettings`): the folder pick for new cards (YAZ-5322) is one of them. */
  saveSettings?: (next: ReviewSettings) => void,
): CardReviewApi {
  const records = useSyncExternalStore(source.subscribe, () => source.records)
  const [session, setSession] = useState<Session | null>(null)
  // The card showing, read from its page, and its fixed answers: each for one turn (`turnKey`).
  const [loaded, setLoaded] = useState<{ key: string; page: CardOnPage } | null>(null)
  const [fixed, setFixed] = useState<{ key: string; answers: CardAnswer[] } | null>(null)
  // "Due now" runs to local midnight, so the count moves at midnight with no file changing; also when the Mac wakes
  // after midnight, or the phone app comes back (YAZ-5615). A slot with no vault (YAZ-2602) counts nothing: no timer.
  const day = useLocalDay(root !== null)
  // A session ends with its vault, and when review is turned off.
  useEffect(() => setSession(null), [root, settings.enabled])

  // The replay of each card is cached by its log (`cardDueAt`), so a new snapshot costs a join per reviewed card.
  const letters = source.letters
  // YAZ-5028: today's taken Up next places, from the app state; one array while it holds still.
  const taken = useSyncExternalStore(host.subscribeUpNextTaken, () => (root === null ? NO_TAKEN : host.upNextTakenToday(root)))
  // YAZ-5042: today's added numbers, from the app state; none on another day (`day` re-renders at midnight).
  const added = useSyncExternalStore(host.subscribeCardsAdded, () => (root === null ? NO_ADDED : host.cardsAddedToday(root)))
  const vaultPlan = useMemo(() => cardPlan(records, settings, Date.now(), '', undefined, letters, taken, added), [records, settings, day, letters, taken, added])
  const vaultQueue = vaultPlan.queue
  const dueCount = vaultQueue.length
  // YAZ-5033: today's reviews across the vault, from the index: the new answer counts once the index has its write.
  const today = useMemo(() => reviewedToday(records, Date.now()), [records, day])

  // YAZ-5622: the card this session is writing (an answer, an archive): the index may have the write before the write returns.
  const writing = useRef<string | null>(null)
  // YAZ-5031: the open session follows the index's `next` marks (`withMarks`); the vault's queue serves the vault's session.
  const seenRecords = useRef(records)
  useEffect(() => {
    // Read now, not when React runs the update: by then the write may have returned.
    const writes = writing.current
    const files = seenRecords.current !== records
    seenRecords.current = records
    setSession((s) => {
      if (s === null || !settings.enabled) return s
      const vault = !s.scope.folder && s.scope.page === undefined
      const live = vault ? vaultQueue : cardPlan(records, settings, Date.now(), s.scope.folder, s.scope.page, letters, taken, added).queue
      const marked = withMarks(s, live)
      // YAZ-5622: and a card the other device answered leaves it.
      const keep = new Set([...s.marks, ...marked.marks].filter((k) => s.marks.has(k) !== marked.marks.has(k)))
      if (writes !== null) keep.add(writes)
      return withLive(marked, live, files, keep)
    })
  }, [vaultQueue, records, settings, letters, taken, added])

  // YAZ-5322: a change of the folder pick changes the open session's new cards at once.
  const pickKey = settings.newFrom.join('\n')
  const lastPick = useRef(pickKey)
  useEffect(() => {
    if (lastPick.current === pickKey) return
    lastPick.current = pickKey
    setSession((s) => {
      if (s === null || !settings.enabled) return s
      const vault = !s.scope.folder && s.scope.page === undefined
      return withNewCards(s, vault ? vaultQueue : cardPlan(records, settings, Date.now(), s.scope.folder, s.scope.page, letters, taken, added).queue)
    })
  }, [pickKey, vaultQueue, records, settings, letters, taken, added])

  // The callbacks read the latest state at call time; their identities stay stable for memoised children.
  const live = useRef({ records, settings, session, loaded, fixed, taken, added })
  live.current = { records, settings, session, loaded, fixed, taken, added }
  const busy = useRef(false)

  /**
   * Drops the cards at the head of `queue` that are no longer due by the live index: their turn came. A repeat
   * (YAZ-5020) stays: this session put it back, and the index may not have its new answer yet.
   */
  const settle = useCallback((queue: QueueCard[], scope: CardReviewScope): QueueCard[] => {
    const { records, settings, added } = live.current
    // The host's list now (rule 10): the answer just wrote to it, before React draws again.
    const taken = root === null ? NO_TAKEN : host.upNextTakenToday(root)
    const due = cardPlan(records, settings, Date.now(), scope.folder, scope.page, source.letters, taken, added).queue
    const first = queue.findIndex((card) => card.repeat === true || due.some((d) => sameCard(d, card)))
    return first === -1 ? [] : queue.slice(first)
  }, [source, root, host])

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
      const page = await host.readCard(card.path, card.id)
      const key = cardKey(card)
      if (page !== null && (epoch.current.get(card.path) ?? 0) === from) {
        cache.current.delete(key)
        cache.current.set(key, { page, mtime })
        if (cache.current.size > CACHE_SIZE) cache.current.delete(cache.current.keys().next().value!)
      }
      return page
    },
    [mtimeOf, host],
  )
  /** A write of `path` here: its cached cards go, and reads of it already begun are not kept. */
  const forget = useCallback((path: string) => {
    epoch.current.set(path, (epoch.current.get(path) ?? 0) + 1)
    for (const [key, hit] of cache.current) if (hit.page.path === path) cache.current.delete(key)
  }, [])

  const head = session?.queue[session.at]
  // The session's `id` too (YAZ-5614): a session closed and started again begins its turns at 1 again, and the card at
  // its head must not take the fixed answers (their time) or the page of the session before.
  const turnKey = session === null || head === undefined ? null : `${session.id}\n${session.turn}\n${head.path}\n${head.id}`

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
    (scope: CardReviewScope = {}, resume: CardReviewResume = {}) => {
      const { records, settings } = live.current
      if (!settings.enabled) return
      const queue = cardPlan(records, settings, Date.now(), scope.folder, scope.page, source.letters, root === null ? NO_TAKEN : host.upNextTakenToday(root), root === null ? NO_ADDED : host.cardsAddedToday(root)).queue
      const label = scope.page !== undefined ? titleOf(records, scope.page) : scope.folder ? folderTitle(source.folders, `${root}/${scope.folder}`) : 'Inbox'
      // A new scope starts on All cards (YAZ-5017), with an empty bar (YAZ-5020); a moved Inbox on its filter, at its
      // card when that is still in the queue, else on the filter's first card (YAZ-5054).
      const filter = resume.filter ?? 'all'
      const at = resume.card === undefined ? -1 : queue.findIndex((c) => c.path === resume.card?.path && c.id === resume.card.id)
      setSession((s) => fitted({ id: ++sessionCount, label, scope, queue, at: Math.max(at, 0), turn: (s?.turn ?? 0) + 1, undo: [], filter, answered: [], marks: markedIn(queue), live: listsOf(queue), stage: 'first', pause: null }))
    },
    [root, source, host],
  )

  /** The page of the card showing, with its turn key: read this turn, or read ahead (YAZ-5029) — the one the Inbox shows. */
  const shownPage = useCallback((): { key: string; page: CardOnPage } | null => {
    const { session, loaded } = live.current
    const shown = session?.queue[session.at]
    if (session === null || shown === undefined) return null
    const key = `${session.id}\n${session.turn}\n${shown.path}\n${shown.id}`
    const page = loaded?.key === key ? loaded.page : cached(shown)
    return page === null ? null : { key, page }
  }, [cached])

  /** The fixed answers of the card showing: fixed now when not yet (D13: what each button shows). */
  const fixAnswers = useCallback((): CardAnswer[] | null => {
    const { fixed, settings } = live.current
    const on = shownPage()
    if (on === null) return null
    const { key, page } = on
    if (fixed?.key === key) return fixed.answers
    const answers = previewAnswers(page.reviews, settings, Date.now())
    const next = { key, answers }
    live.current.fixed = next
    setFixed(next)
    return answers
  }, [shownPage])

  const answer = useCallback(
    async (rating: CardRating, seconds?: number) => {
      const s0 = live.current.session
      const card = s0?.queue[s0.at]
      const page = shownPage()?.page
      if (card === undefined || page === undefined || fixAnswers() === null || busy.current || s0?.pause !== null) return false
      // Rule 15 (Review rules v1, YAZ-5655; Anki's press time): the review is written at the time the button was
      // PRESSED, not when the buttons showed, so an answer just after midnight counts for the new day. Rule 16 (Anki's
      // id + 1): never at or before the card's last review — two answers in one millisecond, the second 1 ms later.
      const last = page.reviews.reduce((t, r) => Math.max(t, Date.parse(r.at)), Number.NEGATIVE_INFINITY)
      const pressed = previewAnswers(page.reviews, live.current.settings, Math.max(Date.now(), last + 1)).find((a) => a.review.rating === rating)
      if (pressed === undefined) return false
      // With how long the answer took (YAZ-5033) when the Inbox timed it.
      const chosen = isCardSeconds(seconds) ? { ...pressed, review: { ...pressed.review, seconds } } : pressed
      busy.current = true
      writing.current = cardKey(card)
      forget(card.path)
      const written = await host.writeCardAnswer(card.path, card.id, chosen.review).then(
        (next) => ({ next }),
        (err: unknown) => {
          if (isCardGone(err)) return 'gone' as const
          onNotice(`Can't save the answer: ${reason(err)}`, 'error')
          return 'failed' as const
        },
      )
      busy.current = false
      writing.current = null
      forget(card.path) // also a read begun while it wrote
      if (written === 'failed') return false
      tourEvent('inbox-answered', card.path)
      // YAZ-5028: the answer took the mark off a card of today's Up next: one of the day's places is used. A marked
      // card past the day's places (`card.next` false) loses its mark too, but it held no place.
      if (written !== 'gone' && written.next >= 0 && card.next && root !== null) {
        host.setUpNextTaken(root, card.id, true)
        // Rule 10: this answer BEGAN a new card (its first review): it holds no New cards place today.
        if (page.reviews.length === 0) host.setUpNextTaken(root, `${card.id}${UP_NEXT_BEGUN}`, true)
      }
      setSession((s) => {
        if (s === null || !showing(s, card)) return s
        // Still in its steps (YAZ-5020): back at the end of this session, no longer new or up next.
        const repeat = written !== 'gone' && chosen.inSteps
        // YAZ-5043: a due card's first answer this session counts for the % (a repeat's, a new card's never do); rule 8:
        // an Up next card's too, new or not.
        const key = cardKey(card)
        const first = (!card.isNew || card.next) && !s.answered.some((a) => a.key === key)
        const undo = written !== 'gone' ? [...s.undo, { kind: 'answer' as const, card, review: chosen.review, next: written.next, at: s.at, repeat, stage: s.stage }].slice(-UNDO_DEPTH) : s.undo
        // The cards before (passed over with →) stay; the ones after are settled, as the head was before ← →.
        const after = settle(s.queue.slice(s.at + 1), s.scope)
        // A due card's repeat waits at the end of the due cards (YAZ-5043), before the new cards. A new card's first
        // Remembered moves it into Due today (YAZ-5610, Yaseen's rule from Mochi: New one less, Due today one more, the
        // same cards in all); it comes back at the end, and its second Remembered lets it go. A new card's Forgot keeps
        // it under New cards (YAZ-5017).
        const rest: QueueCard[] = [...s.queue.slice(0, s.at), ...after]
        const place = repeatPlace(rest, s.at, card)
        const learned = card.isNew && rating !== 'again'
        const back: QueueCard = { ...card, due: chosen.due, next: false, repeat: true, forgot: rating === 'again', ...(learned ? { isNew: false, fromNew: true } : {}) }
        const queue = repeat ? [...rest.slice(0, place), back, ...rest.slice(place)] : rest
        // YAZ-5432: with what the card was, so each filter's bar reads its own answers.
        const answered = written !== 'gone' ? [...s.answered, { key, rating, isNew: card.isNew, next: card.next, first }] : s.answered
        // A repeat is the same card (YAZ-5594, YAZ-5610): "3 / 13" and the bar's size stay; the card is not done yet.
        // The next card is the one after; past the last, the first (a card passed over with →, or the repeat).
        const next = fitted({ ...s, queue, at: after.length > 0 ? s.at : 0, turn: s.turn + 1, undo, answered })
        return written === 'gone' ? next : { ...next, ...dueStop(next, card) }
      })
      return written !== 'gone'
    },
    [fixAnswers, shownPage, onNotice, settle, forget, root, host],
  )

  // YAZ-5614: the add and Reset steps whose undo ran. Two ⌘Z in one tick (a key repeat) both read the same last step
  // before React takes the first one off the stack: the day's number must change once.
  const undoneSteps = useRef(new WeakSet<UndoStep>())

  /** The add's undo (YAZ-5042): today's number goes down by what the add grew it; its cards not answered yet leave. */
  const undoAdd = useCallback(
    (step: AddStep) => {
      if (undoneSteps.current.has(step)) return
      undoneSteps.current.add(step)
      if (root !== null) {
        const now = host.cardsAddedToday(root)
        host.setCardsAdded(root, step.what === 'new' ? { ...now, newCards: now.newCards - step.delta } : { ...now, upNext: now.upNext - step.delta })
      }
      setSession((s) => (s === null || s.undo.at(-1) !== step ? s : withoutAdded(s, step)))
    },
    [root, host],
  )

  /** A Reset's undo (YAZ-5042 round 2): today's number goes back up; its cards join the session again, as an add's do. */
  const undoReset = useCallback(
    (step: ResetStep) => {
      if (root === null || undoneSteps.current.has(step)) return
      undoneSteps.current.add(step)
      const now = host.cardsAddedToday(root)
      const next = step.what === 'new' ? { ...now, newCards: now.newCards + step.delta } : { ...now, upNext: now.upNext + step.delta }
      host.setCardsAdded(root, next)
      live.current.added = next
      const { records, settings, taken } = live.current
      setSession((s) => {
        if (s === null || s.undo.at(-1) !== step) return s
        const before = { ...s, undo: s.undo.slice(0, -1) }
        const queue = cardPlan(records, settings, Date.now(), s.scope.folder, s.scope.page, source.letters, taken, next).queue
        const back = withAdded(before, step.what, queue, step.delta)
        return back === before ? before : { ...back, undo: before.undo }
      })
    },
    [root, source, host],
  )

  /** The undo of an Archive card (YAZ-5078, a host with `undoesArchive`): `off` off its line, the card back at its place. */
  const undoArchive = useCallback(
    async (step: ArchiveStep) => {
      if (busy.current) return
      busy.current = true
      forget(step.card.path)
      const undone = await host.changeCardLine(step.card.path, step.card.id, (l) => withCardOff(l, false)).then(
        () => true,
        (err: unknown) => {
          onNotice(`Can't undo the archive: ${reason(err)}`, 'error')
          return false
        },
      )
      busy.current = false
      forget(step.card.path)
      if (!undone) return
      setSession((s) => {
        if (s === null || s.undo.at(-1) !== step) return s
        const rest = s.queue.filter((c) => !sameCard(c, step.card))
        const at = Math.min(step.at, rest.length)
        const filter = matchesFilter(step.card, s.filter) ? s.filter : 'all'
        return { ...s, queue: [...rest.slice(0, at), step.card, ...rest.slice(at)], at, filter, turn: s.turn + 1, undo: s.undo.slice(0, -1) }
      })
    },
    [onNotice, forget, host],
  )

  const undo = useCallback(async () => {
    const last = live.current.session?.undo.at(-1)
    if (last === undefined || busy.current) return
    if (last.kind === 'add') return undoAdd(last)
    if (last.kind === 'reset') return undoReset(last)
    if (last.kind === 'archive') return undoArchive(last)
    busy.current = true
    forget(last.card.path)
    const undone = await host.undoCardAnswer(last.card.path, last.card.id, last.review.at, last.next).then(
      () => true,
      (err: unknown) => {
        onNotice(`Can't undo the answer: ${reason(err)}`, 'error')
        return false
      },
    )
    // YAZ-5617: the other device answered the card too (a sync brought it): after this undo it may be done for today.
    // Then it does not come back, so it never gets a second review here (YAZ-5622); the file, read now, says.
    const back = undone ? await host.readCard(last.card.path, last.card.id).catch(() => null) : null
    busy.current = false
    forget(last.card.path)
    if (undone && last.next >= 0 && last.card.next && root !== null) {
      host.setUpNextTaken(root, last.card.id, false)
      host.setUpNextTaken(root, `${last.card.id}${UP_NEXT_BEGUN}`, false)
    }
    if (back !== null && doneToday(back, live.current.settings)) {
      setSession((s) => {
        if (s === null || s.undo.at(-1) !== last) return s
        const queue = s.queue.filter((c) => !sameCard(c, last.card))
        const at = Math.min(last.at, queue.length)
        return fitted({ ...s, queue, at: at < queue.length ? at : 0, turn: s.turn + 1, undo: s.undo.slice(0, -1), answered: s.answered.slice(0, -1), stage: last.stage, pause: null })
      })
      return
    }
    // The card back at its place (YAZ-5020), its repeat out of the queue and the session one smaller again; it shows
    // also under a filter that would hide it: then All cards (YAZ-5017). Its answer leaves the bar (YAZ-5020).
    if (undone)
      setSession((s) => {
        if (s === null || s.undo.at(-1) !== last) return s
        const rest = s.queue.filter((c) => !sameCard(c, last.card))
        const at = Math.min(last.at, rest.length)
        // As it was (YAZ-5028): Up next again when it was in today's Up next; a marked card past the day's places
        // gets its mark back in the file, and waits in its normal place again.
        const card = last.card
        const filter = matchesFilter(card, s.filter) ? s.filter : 'all'
        // YAZ-5043: a stop it made goes with it, and Due today's stage is as it was.
        return { ...s, queue: [...rest.slice(0, at), card, ...rest.slice(at)], at, turn: s.turn + 1, undo: s.undo.slice(0, -1), filter, answered: s.answered.slice(0, -1), stage: last.stage, pause: null }
      })
  }, [onNotice, forget, root, undoAdd, undoReset, undoArchive, host])

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
      const removed = await host.deleteCardReview(path, id, review.at).then(
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
        void host.restoreCardReview(path, id, review, removed).then(
          () => readAgain(path, id),
          (err: unknown) => onNotice(`Can't put the review back: ${reason(err)}`, 'error'),
        )
      onNotice('Review deleted', 'info', 'undo', { label: 'Undo', run: restore, fades: true })
    },
    [onNotice, readAgain, host],
  )

  /** One mark on or off (Up next, Fix later): one write of the file, then the card read again. */
  const setMark = useCallback(
    async (path: string, id: string, change: (line: CardLine) => CardLine) => {
      const written = await host.changeCardLine(path, id, change).then(
        () => true,
        (err: unknown) => {
          onNotice(`Can't change the card: ${reason(err)}`, 'error')
          return false
        },
      )
      if (written) readAgain(path, id)
    },
    [onNotice, readAgain, host],
  )
  const setNext = useCallback((path: string, id: string, on: boolean) => setMark(path, id, (l) => withCardNext(l, on)), [setMark])

  const move = useCallback((delta: -1 | 1) => {
    setSession((s) => {
      if (s === null || s.pause !== null) return s
      const at = stepFrom(s, delta)
      return at === -1 ? s : { ...s, at, turn: s.turn + 1 }
    })
  }, [])

  const setFilter = useCallback((filter: CardFilter) => {
    setSession((s) => (s === null || s.filter === filter ? s : fitted({ ...s, filter, at: 0, turn: s.turn + 1, pause: null })))
  }, [])

  const goOn = useCallback(() => {
    setSession((s) => {
      if (s === null || s.pause === null) return s
      // Learn new cards from Due today: the New cards filter. Under All cards the new cards are next already.
      // YAZ-5616: with no plain new card left, the begun ones (Due today cards now) come next under Due today itself.
      if (s.pause === 'done' && s.filter === 'due') return s.queue.some((c) => matchesFilter(c, 'new')) ? fitted({ ...s, filter: 'new', at: 0, turn: s.turn + 1, pause: null }) : fitted({ ...s, turn: s.turn + 1, pause: null })
      return { ...s, pause: null }
    })
  }, [])

  const addCards = useCallback(
    (kind: AddKind, count?: number) => {
      const { session: s0, records, settings, taken, added } = live.current
      if (s0 === null || root === null || !settings.enabled) return
      const now = Date.now()
      const plan = cardPlan(records, settings, now, s0.scope.folder, s0.scope.page, source.letters, taken, added)
      // Round 2: how many MORE, typed; above what waits adds all that waits.
      const n = count === undefined ? addsOf(plan, settings)[kind] : Math.min(Math.max(0, Math.floor(count)), plan.more[kind])
      const delta = plan.grow(kind, n)
      if (n === 0 || delta <= 0) return
      const next = kind === 'new' ? { ...added, newCards: added.newCards + delta } : { ...added, upNext: added.upNext + delta }
      host.setCardsAdded(root, next)
      live.current.added = next
      const queue = cardPlan(records, settings, now, s0.scope.folder, s0.scope.page, source.letters, taken, next).queue
      setSession((s) => (s === null || s.id !== s0.id ? s : withAdded(s, kind, queue, delta)))
    },
    [root, source, host],
  )

  const resetCards = useCallback(
    (kind: AddKind) => {
      const { session: s0, records, settings, taken, added } = live.current
      if (s0 === null || root === null || !settings.enabled) return
      const now = Date.now()
      const plan = cardPlan(records, settings, now, s0.scope.folder, s0.scope.page, source.letters, taken, added)
      const had = kind === 'new' ? added.newCards : added.upNext
      const delta = had - plan.floor[kind]
      if (delta <= 0) return
      const next = kind === 'new' ? { ...added, newCards: plan.floor.new } : { ...added, upNext: plan.floor.next }
      host.setCardsAdded(root, next)
      live.current.added = next
      const queue = cardPlan(records, settings, now, s0.scope.folder, s0.scope.page, source.letters, taken, next).queue
      setSession((s) => (s === null || s.id !== s0.id ? s : withReset(s, kind, queue, delta)))
    },
    [root, source, host],
  )

  const setNewFrom = useCallback(
    (picked: readonly string[]) => {
      const { settings } = live.current
      if (saveSettings === undefined || picked.join('\n') === settings.newFrom.join('\n')) return
      saveSettings({ ...settings, newFrom: [...picked] })
    },
    [saveSettings],
  )

  const turnOff = useCallback(async () => {
    const s0 = live.current.session
    const card = s0?.queue[s0.at]
    if (card === undefined || s0?.pause !== null) return
    writing.current = cardKey(card)
    forget(card.path)
    const written = await host.changeCardLine(card.path, card.id, (l) => withCardOff(l, true)).then(
      () => true,
      (err: unknown) => {
        onNotice(`Can't change the card: ${reason(err)}`, 'error')
        return false
      },
    )
    writing.current = null
    forget(card.path)
    if (!written) return
    setSession((s) => {
      if (s === null || !showing(s, card)) return s
      const next = without(s, s.at)
      // Both apps take an archive back with Undo (YAZ-5078 the phone, YAZ-5621 the Mac: `undoesArchive`); a host
      // without it keeps the stack as before.
      return host.undoesArchive === true ? { ...next, undo: [...s.undo, { kind: 'archive' as const, card: s.queue[s.at], at: s.at }].slice(-UNDO_DEPTH) } : next
    })
  }, [onNotice, forget, host])

  const folders = source.folders
  /** A root-relative folder's name, as the breadcrumb says it (its title, else its last part). */
  const folderLabelOf = useCallback((folder: string) => (root === null ? folder.slice(folder.lastIndexOf('/') + 1) : folderTitle(folders, `${root}/${folder}`)), [root, folders])
  // YAZ-5042: the open scope's plan, for what waits past today's number (the vault's is `vaultPlan`).
  const scope = session?.scope
  const scopePlan = useMemo(
    () => (scope === undefined || (!scope.folder && scope.page === undefined) ? vaultPlan : cardPlan(records, settings, Date.now(), scope.folder, scope.page, letters, taken, added)),
    [scope, vaultPlan, records, settings, letters, taken, added],
  )
  const upNext = useMemo(() => anyUpNext(records), [records])
  // YAZ-5029: the last card shown with its text, and its session: on show while the next card is read.
  const lastShown = useRef<{ session: number; card: ShownCard } | null>(null)
  const shownSession = useMemo<CardReviewSession | null>(() => {
    if (session === null) return null
    // YAZ-5043: a stop of Due today shows its screen in place of the card (the card waits, read).
    const card = session.pause !== null ? undefined : session.queue[session.at]
    const page = card === undefined ? null : loaded?.key === turnKey ? loaded.page : cached(card)
    let shownCard: ShownCard | null = card === undefined ? null : { ...card, page }
    if (shownCard !== null && page === null && lastShown.current?.session === session.id) shownCard = lastShown.current.card
    else if (shownCard !== null && page !== null) lastShown.current = { session: session.id, card: shownCard }
    const { filter, queue, scope } = session
    const counts = countOf(queue)
    const progress = filterCount(session.answered, queue, filter)
    const lastStep = session.undo.at(-1)
    const vault = vaultName ?? (root === null ? 'Inbox' : host.vaultName(root))
    const from = scope.page !== undefined ? [session.label] : scope.folder ? scope.folder.split('/').filter(Boolean) : [vault]
    return {
      label: session.label,
      scope: scope.page !== undefined ? 'page' : scope.folder ? 'folder' : 'vault',
      cards: scope,
      card: shownCard,
      canBack: session.pause === null && stepFrom(session, -1) !== -1,
      canNext: session.pause === null && stepFrom(session, 1) !== -1,
      // The card before, still on show (YAZ-5029), has no answers: none of its buttons writes to the card under it.
      answers: fixed?.key === turnKey && page !== null ? fixed.answers : null,
      canUndo: session.undo.length > 0,
      filter,
      counts,
      from,
      place: shownCard === null || root === null ? [] : cardPlace(root, folders, records, shownCard.path),
      answered: session.answered.map((a) => a.rating),
      progress,
      // Mochi hides the ✕ in the missed pass (YAZ-5671 finding 9); its % screen still shows it. YAZ-5681: the open filter's.
      misses: session.stage === 'first' || session.pause === 'missed' ? progress.waiting : 0,
      today,
      more: scopePlan.more,
      adds: addsOf(scopePlan, settings),
      limited: { new: settings.newPerDay !== null, next: settings.upNextPerDay !== null },
      canReset: { new: (added.newCards > scopePlan.floor.new), next: (added.upNext > scopePlan.floor.next) },
      lastArchive: lastStep?.kind === 'archive' ? { id: lastStep.card.id } : null,
      learned: lastStep?.kind === 'answer' && lastStep.card.isNew && lastStep.review.rating !== 'again' ? `${session.id}:${lastStep.card.path}\n${lastStep.card.id}:${lastStep.review.at}` : null,
      upNext,
      lastAdd: lastStep?.kind === 'add' ? { kind: lastStep.what, count: lastStep.count, reset: false } : lastStep?.kind === 'reset' ? { kind: lastStep.what, count: lastStep.count, reset: true } : null,
      newFrom: settings.newFrom.map((folder) => ({ folder, label: folderLabelOf(folder) })),
      newFallback: scopePlan.newFallback,
      end: endOf(session),
      landing: shownCard === null && session.answered.length > 0 ? `${session.id}:${session.answered.length}` : null,
    }
    // `records`: a cached page is good only at its page's mtime.
  }, [session, loaded, fixed, turnKey, root, vaultName, host, cached, records, folders, today, scopePlan, settings, added, upNext, folderLabelOf])

  // YAZ-5322: the picker's rows, worked out when it opens: each folder with new cards, and each picked one (0 when empty).
  const pickerFolders = useCallback(() => {
    const { records, settings } = live.current
    const { all, folders: found } = newCardFolders(records, settings)
    const rows = new Map(found.map((f) => [f.folder, f.count]))
    for (const folder of settings.newFrom) if (!rows.has(folder)) rows.set(folder, 0)
    const list = [...rows].map(([folder, count]) => ({ folder, label: folderLabelOf(folder), count })).sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0))
    return { all, folders: list }
  }, [folderLabelOf])

  return { dueCount, settings, session: shownSession, start, showAnswers: fixAnswers, answer, undo, close, deleteReview, setNext, move, turnOff, setFilter, addCards, resetCards, setNewFrom, newCardFolders: pickerFolders, goOn }
}
