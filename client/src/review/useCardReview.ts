import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CardRating, CardReview } from '@shared/cardLine'
import { cardQueue, previewAnswers, type CardAnswer, type DueCard } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import type { NoticeAction, NoticeKind, NoticeType } from '../lib/notice'
import { folderTitle } from '../links/shortcuts'
import { deleteCardReview, isCardGone, readCard, writeCardReview, type CardOnPage } from './cardFile'

/**
 * Note card review as App sees it (YAZ-4967): how many cards are due, and the one review
 * session a vault can have open. The queue comes from the index (`cardQueue`) and is taken ONCE, at start; a card is
 * checked against the live index only when its turn comes, and read from its page when it shows (the index holds no
 * text, D4). A card whose page or ID is gone is passed over.
 *
 * The hover is the truth (D13): `showAnswers` fixes each button's review — its time to the minute, so its fuzz — and
 * `answer` writes exactly that review, so "Remembered · 9 days" is what the file gets. `undo` (⌘Z, idea 5) removes
 * the last answer's review and shows that card again.
 */

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
  /** Each button's outcome, fixed by `showAnswers` for the card showing (in button order); null until then. */
  answers: CardAnswer[] | null
  canUndo: boolean
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
}

/** How many answers ⌘Z can take back in one session. */
export const UNDO_DEPTH = 20

interface Session {
  label: string
  scope: CardReviewScope
  /** Cards still to show; the first is the one showing. */
  queue: DueCard[]
  total: number
  /** Bumped each time the card at the head is put there: its page is read again, its answers fixed again. */
  turn: number
  undo: { card: DueCard; review: CardReview }[]
}

interface IndexSource {
  readonly records: readonly IndexRecord[]
  readonly folders: readonly IndexRecord[]
  subscribe(listener: () => void): () => void
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const sameCard = (a: DueCard, b: DueCard): boolean => a.path === b.path && a.id === b.id
const titleOf = (records: readonly IndexRecord[], path: string): string => records.find((r) => r.path === path)?.title ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '')

export function useCardReview(root: string | null, source: IndexSource, settings: ReviewSettings, onNotice: (text: string, icon?: NoticeKind, type?: NoticeType, action?: NoticeAction) => void): CardReviewApi {
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
  const dueCount = useMemo(() => cardQueue(records, settings, Date.now()).length, [records, settings, day])

  // The callbacks read the latest state at call time; their identities stay stable for memoised children.
  const live = useRef({ records, settings, session, loaded, fixed })
  live.current = { records, settings, session, loaded, fixed }
  const busy = useRef(false)

  /** Drops the cards at the head of `queue` that are no longer due by the live index: their turn came. */
  const settle = useCallback((queue: DueCard[], scope: CardReviewScope): DueCard[] => {
    const { records, settings } = live.current
    const due = cardQueue(records, settings, Date.now(), scope.folder, scope.page)
    const first = queue.findIndex((card) => due.some((d) => sameCard(d, card)))
    return first === -1 ? [] : queue.slice(first)
  }, [])

  const head = session?.queue[0]
  const turnKey = session === null || head === undefined ? null : `${session.turn}\n${head.path}\n${head.id}`

  // The notice door in a ref: the read below runs once per turn, whatever identity the caller's callback has.
  const notice = useRef(onNotice)
  notice.current = onNotice

  // Read the card showing from its page; a page or card that is gone passes it over.
  useEffect(() => {
    if (turnKey === null || head === undefined) return
    let on = true
    readCard(head.path, head.id).then(
      (page) => {
        if (!on) return
        if (page !== null) return setLoaded({ key: turnKey, page })
        setSession((s) => (s === null || s.queue[0] !== head ? s : { ...s, queue: s.queue.slice(1), turn: s.turn + 1 }))
      },
      (err: unknown) => {
        if (!on) return
        notice.current(`Can't read the card: ${reason(err)}`, 'error')
        setSession((s) => (s === null || s.queue[0] !== head ? s : { ...s, queue: s.queue.slice(1), turn: s.turn + 1 }))
      },
    )
    return () => {
      on = false
    }
  }, [turnKey, head])

  const start = useCallback(
    (scope: CardReviewScope = {}) => {
      const { records, settings } = live.current
      if (!settings.enabled) return
      const queue = cardQueue(records, settings, Date.now(), scope.folder, scope.page)
      const label = scope.page !== undefined ? titleOf(records, scope.page) : scope.folder ? folderTitle(source.folders, `${root}/${scope.folder}`) : 'Inbox'
      setSession((s) => ({ label, scope, queue, total: queue.length, turn: (s?.turn ?? 0) + 1, undo: [] }))
    },
    [root, source],
  )

  /** The fixed answers of the card showing: fixed now when not yet (D13). */
  const fixAnswers = useCallback((): CardAnswer[] | null => {
    const { session, loaded, fixed, settings } = live.current
    const key = session === null || session.queue[0] === undefined ? null : `${session.turn}\n${session.queue[0].path}\n${session.queue[0].id}`
    if (key === null || loaded?.key !== key) return null
    if (fixed?.key === key) return fixed.answers
    const answers = previewAnswers(loaded.page.reviews, settings, Date.now())
    const next = { key, answers }
    live.current.fixed = next
    setFixed(next)
    return answers
  }, [])

  const answer = useCallback(
    async (rating: CardRating) => {
      const card = live.current.session?.queue[0]
      const chosen = fixAnswers()?.find((a) => a.review.rating === rating)
      if (card === undefined || chosen === undefined || busy.current) return
      busy.current = true
      const written = await writeCardReview(card.path, card.id, chosen.review).then(
        () => 'written' as const,
        (err: unknown) => {
          if (isCardGone(err)) return 'gone' as const
          onNotice(`Can't save the answer: ${reason(err)}`, 'error')
          return 'failed' as const
        },
      )
      busy.current = false
      if (written === 'failed') return
      setSession((s) => {
        if (s === null || s.queue[0] !== card) return s
        const undo = written === 'written' ? [...s.undo, { card, review: chosen.review }].slice(-UNDO_DEPTH) : s.undo
        return { ...s, queue: settle(s.queue.slice(1), s.scope), turn: s.turn + 1, undo }
      })
    },
    [fixAnswers, onNotice, settle],
  )

  const undo = useCallback(async () => {
    const last = live.current.session?.undo.at(-1)
    if (last === undefined || busy.current) return
    busy.current = true
    const undone = await deleteCardReview(last.card.path, last.card.id, last.review.at).then(
      () => true,
      (err: unknown) => {
        onNotice(`Can't undo the answer: ${reason(err)}`, 'error')
        return false
      },
    )
    busy.current = false
    if (undone) setSession((s) => (s === null || s.undo.at(-1) !== last ? s : { ...s, queue: [last.card, ...s.queue.filter((c) => !sameCard(c, last.card))], turn: s.turn + 1, undo: s.undo.slice(0, -1) }))
  }, [onNotice])

  const close = useCallback(() => setSession(null), [])

  /** The card showing, when it is card `id` of `path`, is read again, and its answers fixed again, on its new log. */
  const readAgain = useCallback((path: string, id: string) => {
    const shown = live.current.session?.queue[0]
    if (shown !== undefined && shown.path === path && shown.id === id) setSession((s) => (s === null ? s : { ...s, turn: s.turn + 1 }))
  }, [])

  const deleteReview = useCallback(
    async (path: string, id: string, review: CardReview) => {
      const done = await deleteCardReview(path, id, review.at).then(
        () => true,
        (err: unknown) => {
          onNotice(`Can't delete the review: ${reason(err)}`, 'error')
          return false
        },
      )
      if (!done) return
      readAgain(path, id)
      const restore = () =>
        void writeCardReview(path, id, review).then(
          () => readAgain(path, id),
          (err: unknown) => onNotice(`Can't put the review back: ${reason(err)}`, 'error'),
        )
      onNotice('Review deleted', 'info', 'undo', { label: 'Undo', run: restore, fades: true })
    },
    [onNotice, readAgain],
  )

  const shownSession = useMemo<CardReviewSession | null>(() => {
    if (session === null) return null
    const card = session.queue[0]
    return {
      label: session.label,
      scope: session.scope.page !== undefined ? 'page' : session.scope.folder ? 'folder' : 'vault',
      card: card === undefined ? null : { ...card, page: loaded?.key === turnKey ? loaded.page : null },
      position: Math.min(session.total - session.queue.length + 1, session.total),
      total: session.total,
      answers: fixed?.key === turnKey ? fixed.answers : null,
      canUndo: session.undo.length > 0,
    }
  }, [session, loaded, fixed, turnKey])

  return { dueCount, settings, session: shownSession, start, showAnswers: fixAnswers, answer, undo, close, deleteReview }
}
