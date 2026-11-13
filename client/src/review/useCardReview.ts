import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { withCardNext, withCardOff, type CardRating, type CardReview } from '@shared/cardLine'
import { cardQueue, previewAnswers, type CardAnswer, type DueCard } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import type { NoticeAction, NoticeKind, NoticeType } from '../lib/notice'
import { folderTitle } from '../links/shortcuts'
import { storage } from '../lib/storage'
import { changeCardLine, deleteCardReview, isCardGone, readCard, restoreCardReview, undoCardAnswer, writeCardAnswer, type CardOnPage } from './cardFile'

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
 * place of the card showing; a card you leave stays in the queue. `turnOff` (the Inbox ⋯) writes `off` and takes the
 * card out of the queue.
 *
 * The filter (YAZ-5017, as Mochi's "All cards ▾"): All cards, Due today (cards with reviews, due now) or New cards
 * (never reviewed, within today's new-card limit: the queue's own). The queue stays whole; the filter picks which of its
 * cards show, and "3 of 12" counts only those. Up next (YAZ-5028): the cards marked `next` at start, new or reviewed
 * (`off` cards are never in the queue); an answer takes a card out of it, as the repeat it may leave is no longer up next.
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
 */

/** Which cards of the session show (YAZ-5017). */
export type CardFilter = 'all' | 'next' | 'due' | 'new'

/** Whether `card` shows under `filter`: next = marked up next (YAZ-5028), due = reviewed before (due now), new = never reviewed. */
export const matchesFilter = (card: DueCard, filter: CardFilter): boolean =>
  filter === 'all' || (filter === 'next' ? card.next : (filter === 'new') === card.isNew)

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
  counts: Record<CardFilter, number>
  /** Where the cards come from, as a quiet path (YAZ-5017): the vault's name; the folder's parts; the page's name. */
  from: string[]
  /** Each answer of the session, in order (YAZ-5020): a Forgot ('again') or a Remembered (any other). */
  answered: CardRating[]
  /** The progress bar's whole (YAZ-5020): the cards the session started with, plus any it took since. */
  size: number
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
  /** Writes the fixed review of `rating`'s button (fixing it now if `showAnswers` was not called), then the next card. */
  answer: (rating: CardRating) => Promise<void>
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
  /** The Inbox ⋯'s Turn review off (YAZ-5004): `off` on the card showing's line, and the card out of the queue. */
  turnOff: () => Promise<void>
  /** All cards, Due today or New cards (YAZ-5017): which of the session's cards show. */
  setFilter: (filter: CardFilter) => void
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
  /**
   * Each answer: the card, its review, the place its `next` had (-1: none), so the undo puts the file back as it was;
   * its place in the queue, and whether it went back at the end (YAZ-5020), so the undo puts the queue back too.
   */
  undo: { card: DueCard; review: CardReview; next: number; at: number; repeat: boolean }[]
  /** YAZ-5017: which cards show; `at` is always a card that matches it, or past the end when none does. */
  filter: CardFilter
  /** The cards with reviews and the new cards at start, plus the repeats (YAZ-5020): each filter's "of 12". */
  totals: { due: number; new: number; next: number }
  /** YAZ-5020: each answer, in order (the progress bar); ⌘Z takes the last back. */
  answered: CardRating[]
}

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
const countOf = (queue: readonly DueCard[]): Record<CardFilter, number> => {
  const fresh = queue.filter((c) => c.isNew).length
  return { all: queue.length, next: queue.filter((c) => c.next).length, due: queue.length - fresh, new: fresh }
}

/** The session with the card at `at` gone from its queue (answered elsewhere, its page gone, review off): the next one shows. */
const without = (s: Session, at: number): Session => {
  const queue = [...s.queue.slice(0, at), ...s.queue.slice(at + 1)]
  return fitted({ ...s, queue, at: at < queue.length ? at : 0, turn: s.turn + 1 })
}
const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const sameCard = (a: DueCard, b: DueCard): boolean => a.path === b.path && a.id === b.id
const cardKey = (card: DueCard): string => `${card.path}\n${card.id}`
const titleOf = (records: readonly IndexRecord[], path: string): string => records.find((r) => r.path === path)?.title ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

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
  const dueCount = useMemo(() => cardQueue(records, settings, Date.now(), '', undefined, letters).length, [records, settings, day, letters])

  // The callbacks read the latest state at call time; their identities stay stable for memoised children.
  const live = useRef({ records, settings, session, loaded, fixed })
  live.current = { records, settings, session, loaded, fixed }
  const busy = useRef(false)

  /**
   * Drops the cards at the head of `queue` that are no longer due by the live index: their turn came. A repeat
   * (YAZ-5020) stays: this session put it back, and the index may not have its new answer yet.
   */
  const settle = useCallback((queue: QueueCard[], scope: CardReviewScope): QueueCard[] => {
    const { records, settings } = live.current
    const due = cardQueue(records, settings, Date.now(), scope.folder, scope.page, source.letters)
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
        setSession((s) => (s === null || s.queue[s.at] !== head ? s : without(s, s.at)))
      },
      (err: unknown) => {
        if (!on) return
        notice.current(`Can't read the card: ${reason(err)}`, 'error')
        setSession((s) => (s === null || s.queue[s.at] !== head ? s : without(s, s.at)))
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
      const queue = cardQueue(records, settings, Date.now(), scope.folder, scope.page, source.letters)
      const label = scope.page !== undefined ? titleOf(records, scope.page) : scope.folder ? folderTitle(source.folders, `${root}/${scope.folder}`) : 'Inbox'
      const { due, new: fresh, next } = countOf(queue)
      // A new scope starts on All cards (YAZ-5017), with an empty bar (YAZ-5020).
      setSession((s) => ({ id: (s?.id ?? 0) + 1, label, scope, queue, at: 0, total: queue.length, turn: (s?.turn ?? 0) + 1, undo: [], filter: 'all', totals: { due, new: fresh, next }, answered: [] }))
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
    async (rating: CardRating) => {
      const s0 = live.current.session
      const card = s0?.queue[s0.at]
      const chosen = fixAnswers()?.find((a) => a.review.rating === rating)
      if (card === undefined || chosen === undefined || busy.current) return
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
      setSession((s) => {
        if (s === null || s.queue[s.at] !== card) return s
        // Still in its steps (YAZ-5020): back at the end of this session, no longer new or up next.
        const repeat = written !== 'gone' && chosen.inSteps
        const undo = written !== 'gone' ? [...s.undo, { card, review: chosen.review, next: written.next, at: s.at, repeat }].slice(-UNDO_DEPTH) : s.undo
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
    [fixAnswers, onNotice, settle, forget],
  )

  const undo = useCallback(async () => {
    const last = live.current.session?.undo.at(-1)
    if (last === undefined || busy.current) return
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
    // The card back at its place (YAZ-5020), its repeat out of the queue and the session one smaller again; it shows
    // also under a filter that would hide it: then All cards (YAZ-5017). Its answer leaves the bar (YAZ-5020).
    if (undone)
      setSession((s) => {
        if (s === null || s.undo.at(-1) !== last) return s
        const rest = s.queue.filter((c) => !sameCard(c, last.card))
        const at = Math.min(last.at, rest.length)
        const side = last.card.isNew ? 'new' : 'due'
        const totals = last.repeat ? { ...s.totals, [side]: s.totals[side] - 1 } : s.totals
        const filter = matchesFilter(last.card, s.filter) ? s.filter : 'all'
        return { ...s, queue: [...rest.slice(0, at), last.card, ...rest.slice(at)], at, total: s.total - (last.repeat ? 1 : 0), totals, turn: s.turn + 1, undo: s.undo.slice(0, -1), filter, answered: s.answered.slice(0, -1) }
      })
  }, [onNotice, forget])

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
    if (written) setSession((s) => (s === null || s.queue[s.at] !== card ? s : without(s, s.at)))
  }, [onNotice, forget])

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
    // "3 of 12" under the filter (YAZ-5017): its cards at start, those gone since, and the place among those left.
    const total = filter === 'all' ? totals.due + totals.new : totals[filter]
    const before = queue.slice(0, session.at).filter((c) => matchesFilter(c, filter)).length
    const from = scope.page !== undefined ? [session.label] : scope.folder ? scope.folder.split('/').filter(Boolean) : [vaultName ?? (root === null ? 'Inbox' : storage.vaultName(root))]
    return {
      label: session.label,
      scope: scope.page !== undefined ? 'page' : scope.folder ? 'folder' : 'vault',
      card: shownCard,
      position: Math.max(1, Math.min(total - counts[filter] + 1 + before, total)),
      total,
      canBack: stepFrom(session, -1) !== -1,
      canNext: stepFrom(session, 1) !== -1,
      // The card before, still on show (YAZ-5029), has no answers: none of its buttons writes to the card under it.
      answers: fixed?.key === turnKey && page !== null ? fixed.answers : null,
      canUndo: session.undo.length > 0,
      filter,
      counts,
      from,
      answered: session.answered,
      size: Math.max(session.total, session.answered.length + queue.length),
    }
    // `records`: a cached page is good only at its page's mtime.
  }, [session, loaded, fixed, turnKey, root, vaultName, cached, records])

  return { dueCount, settings, session: shownSession, start, showAnswers: fixAnswers, answer, undo, close, deleteReview, setNext, move, turnOff, setFilter }
}
