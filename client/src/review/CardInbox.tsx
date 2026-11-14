/**
 * THE INBOX SCREEN (YAZ-4962, D11, D18; idea 14): the due cards one at a time, Mochi style — a calm card in the
 * middle, in the Explore window's look, over the tab stack. The page under it never renders for it. Read-only: the
 * card is `renderCard`, the page's own render. The session is `useCardReview`'s (YAZ-4967): this screen draws it.
 *
 *  - THE INBOX IS A TAB (YAZ-5011): App draws this screen for the window's Inbox tab, over the tab stack. Behind a page
 *    tab it stays mounted, hidden (`shown` false), so it comes back at its card and step; hidden, it hears no key. It
 *    closes as any tab does (its ✕, ⌘W): no × of its own, and Esc does not close it.
 *  - The top row (YAZ-5017, `CardInboxBar`): the filter "All cards ▾" (All cards, Due today, New cards, with counts)
 *    with what is under review by it ("· in spanish-words"), then the CURRENT card's place, vault › folder › page, each
 *    part a link with its icon (YAZ-5132: the one breadcrumb; `openPlace`: the folder page; the page as O), and "3 of 12" of the filter's cards on the right.
 *  - Above the card, outside its frame (YAZ-5027): the state chip (YAZ-5018, as Mochi's: "New card", "Due today",
 *    "Due · 3 days ago"), then (YAZ-5051: the card frame holds only the card) THE HEAD (YAZ-5044): "Title · ID", the
 *    card ID small and grey (a click copies it, D20). A card in a page says its page in the top row's ONE breadcrumb
 *    (YAZ-5132: no "in <page>" here), whose page part opens it as O does; a card file (YAZ-5037): its title is the
 *    link, and it and O open it in Explore (YAZ-5145, "Open card"). Then the chip "Up next ×" for a card at the top of the Inbox (YAZ-4999 D3). A card of more than one
 *    side says "Side 1 of 2" on the row's right (YAZ-5048), and the key row's Space says "Next side" when the next Space shows a side.
 *  - SCROLL (YAZ-5049): round 3 follows the NEXT blank (`data-next`, the one "Mark the next hidden word" colours) after
 *    each Space, a new side's first blank, and at the end (no blank left) brings the card's end — the Reviews strip — in
 *    as far as the last word stays in sight; one more Space there gives the answer buttons a soft ring. Round 5: Space
 *    never shows a blank you cannot see — a marked blank not wholly between the top row and the buttons only glides in. Round 1: the word a Space shows, or the side it adds, comes into view, gliding; never centred. Round 2
 *    (as Mochi): the card is one long page — no scroll bar of its own; the Inbox's view scrolls, the top row stays on
 *    top and the buttons at the bottom — and a word that reaches the view's lower third comes up to its upper third,
 *    so what comes next shows (`inboxScroll.ts`).
 *  - TITLE ON THE FRONT: HIDE (YAZ-5030, the card line's `notitle`): the title is on the card line (YAZ-5308), never in
 *    the text, so it is never a Space step. The head shows the ID only until the card is fully shown, then the title:
 *    which card it was.
 *  - SPACE (D18): each Space shows the NEXT hidden word, in page order. When the side showing has none left, the next
 *    Space shows the next side, whose hidden words then show one by one. The answer buttons show from the moment the
 *    card shows (YAZ-5010, Yaseen: "Should always be there"): `showAnswers()` fixes what each one writes then (the
 *    hover is the truth, D13), and 1–2 / 1–4 answer at any step.
 *  - The buttons (D5): ✕ Forgot · ✓ Remembered, or ↺ Again · ~ Hard · ✓ Good · ⇈ Easy, by the setting, round as
 *    Mochi's (YAZ-5018); the hover says when the card comes back ("Remembered · 9 days"; "Forgot · later today" while
 *    the answer keeps it in its same-day steps, YAZ-5020: it comes back at the end of this session).
 *  - The keys (`cardInboxKeys.ts`): Space, 1–2 / 1–4 (at any step, YAZ-5010), ⌘Z, O, E, ← → (YAZ-5004: the card before
 *    or after, no answer), ⌘↵ (the page in a background tab: the review stays), Esc (only the ⋯ row; then the Esc order
 *    goes on, YAZ-5011). A key typed in a field, or while a dialog or a menu is open (Explore is a dialog), is not the
 *    Inbox's; a key with the keyboard elsewhere (the sidebar) neither.
 *  - O AND E OPEN EXPLORE'S OWN VIEW (YAZ-5145, Yaseen: "shuld be exactly the same ... we're just going to reuse
 *    explore"): the page layer Explore opens for the same file, so the card looks the same from both. O: a card file's
 *    layer, reading; a card in a page, its page at its TOP (YAZ-5022), or landed on the card with its one flash when
 *    Settings › Cards › Inbox: O opens the page at says The card (YAZ-5307; Explore's page layer `card`, `landOn`). E: the same layer in edit, as Explore's own E —
 *    in a Read only vault its "Allow edits?" asks first; a card in a page lands on the card and opens its Edit card
 *    ("e would edit the card"). Esc or ⌘↵ in edit go back to reading; then Esc or ⌘↵ come back to this card at the
 *    same step. The title and "in <page>" links, ⋯ › Open card and an archived card's row open as O does.
 *  - P (YAZ-5014): plays or stops the first sound of the sides that show. Nothing plays by itself; the next card (an
 *    answer, ← →, ⌘Z), a hidden Inbox and its close stop it. "P Play" is in the hint row only while a side that shows
 *    has a sound. A board's picture (YAZ-5015) opens the board on top; Esc there comes back to this card and step.
 *  - Under the card, OUTSIDE its frame, as in Mochi (YAZ-5002): the answer buttons; the key hint row last, at the bottom.
 *    No "Press Space" line over the buttons (YAZ-5021): the key row already says Space.
 *  - FAST ← → (YAZ-5029): the buttons are the setting's, always mounted, the same size from card to card; only their
 *    hover waits for the card's answers. The hook reads the cards around this one ahead and keeps the card before on show
 *    until the next one's text is ready, so the card never empties and nothing under it moves.
 *  - The buttons row (YAZ-5004, as in Mochi): ← → on its left, the answers in the middle, ⋯ on its right. ⋯ opens a
 *    small row of icons, each with the app's hover box (its name and key): Undo last review (⌘Z), Archive card (YAZ-5046),
 *    Put at top of Inbox / Remove from top of Inbox, Open card. They are the hook's own actions.
 *  - THE LAST ANSWER'S LINE (YAZ-5025 round 2; no toast): one quiet line, centred under the answer buttons, "✓ Remembered ·
 *    DEMO-51 · back in 9 days · Undo ⌘Z" (a Forgot in red), in the button hover's words. It stays until the next answer
 *    replaces it; its Undo is the hook's own undo, as ⌘Z; an undo clears it. It shows only once the session counts the
 *    answer (`answered` one longer): a failed write shows its own error. The row keeps its height empty (YAZ-5029).
 *  - The hint row shows a key only while it does something; the digits are on the buttons. It is ONE line at any width
 *    (YAZ-5024, `CardInboxHints`): ⌘↵ folds first, then O; Space and E stay.
 *  - THE WIDTH (YAZ-5019): the card's left or right edge drags it wider or narrower, centred (`inboxCardWidth.ts`): at
 *    least 420 px, at most the tab's width less its margins; the width stays for the app's run, in memory only.
 *  - HOW LONG EACH ANSWER TOOK (YAZ-5033, `answerTimer.ts`): the timer starts when a card shows (again when ⌘Z shows
 *    it again), pauses while the Inbox is not in front and over any stretch of "Pause the timer after" with no key or
 *    mouse; the answer writes its active seconds on its review part (`… good 13s`). The top row says today's work
 *    across the vault, "Today: 31 cards · 9 min" (`session.today`, from the index), and the done screen says it too.
 *    TIME SO FAR (YAZ-5130, `TodayWork`): the time hides behind a small clock by default (round 2: only its hover box
 *    shows it, and a keyboard focus), or shows, or is off, by Settings › Review › Time so far. The timer and the saved seconds do not change with it.
 *  - REVIEWS AT THE BOTTOM OF THE LAST SIDE (YAZ-5105, as Mochi; it amends YAZ-5000, which took them out of the Inbox):
 *    a card with reviews has the Reviews strip ("✓ 4 Reviews") right under the card, outside its frame (round 2): the
 *    card window's own `CardReviews`, closed until asked for, with no delete here. Round 3: it shows as soon as the
 *    LAST side shows, its hidden words shown or not (a one-side card: after its first Space, or at once with nothing
 *    hidden). Never on the front or an earlier side. It is no Space step, and the scroll never goes to it; the buttons' band
 *    stays at the bottom of the view over it.
 *  - Nothing left: "Inbox complete." for the vault; for one page or folder "This page is done." and, quiet, "21 more in
 *    the Inbox", which starts the vault's review.
 *  - ADD MORE FOR TODAY (YAZ-5042, Yaseen: "instead of having to go settings"): the done screen says what waits past
 *    today's number, "38 new cards and 3 Up next cards wait for another day.", with one button for each kind, "Add 10
 *    new cards" and "Add 2 Up next" (the first added card shows at once); a filter's done screen has its own kind's
 *    button; nothing waiting, the screen is as before. The cards menu has the same Add (`CardInboxBar`). The add's
 *    line takes the last answer's line, "+ Added 10 new cards for today · Undo ⌘Z": its Undo, and ⌘Z, take the add
 *    back while it is the last thing done (the hook's own undo).
 *  - ARCHIVED (YAZ-5046, Yaseen: "We need a way to be able to then have a toggle"): the cards menu's last row lists the
 *    scope's archived cards in the card's place, to look at, not to review: each its title and its page; a click opens
 *    it as O does (YAZ-5145), and "Unarchive" brings it back to review, its history kept. No answer buttons.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CourseOffer, type CourseOfferProps } from '../course/CourseOffer'
import { answerLabel, answerRatings, type AddKind } from '@shared/cardSchedule'
import { cardSides } from '@shared/cardText'
import { withCardTitle } from '@shared/cardLine'
import { PageTitle } from '../editor/PageTitle'
import { changeCardLine } from './cardFile'
import { recordAt } from '../editor/card/embedCard'
import type { GestureAction } from '@shared/keys'
import type { InboxOpenAt } from '@shared/types'
import type { CardRating } from '@shared/cardLine'
import type { ExploreVault } from '../explore/ExplorePage'
import type { CardReviewApi, CardReviewSession } from './useCardReview'
import { CardId, CardNextChip, CardReviews, cardWait } from './cardParts'
import { CardSideCount, InboxCardFace, InboxCardPanel, useCardFront, useCardSteps, useStepScroll } from './inboxCard'
import { cardInboxHints, cardInboxKey } from './cardInboxKeys'
import { textHasAudio, toggleCardAudio } from '../editor/card/cardMedia'
import { HoverTip } from '../components/HoverTip'
import type { NoticeAction, NoticeKind, NoticeType } from '../lib/notice'
import { CARD_FILTERS, CardInboxBar } from './CardInboxBar'
import { CardStateChip, answerIcon, answerLine } from './cardInboxChip'
import { useInboxCardWidth } from './inboxCardWidth'
import { CardInboxHints } from './CardInboxHints'
import { KeyLabel } from '../keys/KeyLabel'
import { withKeys } from '@shared/keyLabel'
import { AddMoreField } from './AddMoreField'
import { useAnswerTimer } from './answerTimer'
import { TodayWork } from './TodayWork'
import { todayCards } from './reviewTime'
import '../explore/explore.css'
import { useUnit } from '../vault/unitWord'
import { tourEvent } from '../course/tourBus'
import type { CardPlace } from '../editor/card/cardOpen'

export interface CardInboxProps {
  /** The Inbox tab is the one on show (YAZ-5011); false: behind a page tab, hidden, and deaf to keys. Default true. */
  shown?: boolean
  review: CardReviewApi
  session: CardReviewSession
  vaultOf: (path: string) => ExploreVault
  nameOf: (path: string) => string
  /**
   * O, the title and the page name (YAZ-5145): Explore's own page layer for the card's file, reading, at its TOP
   * (YAZ-5022); with `card` (YAZ-5307, Settings › Cards › Inbox: O opens the page at › The card), landed on that card.
   */
  openPage: (path: string, card?: CardPlace) => void
  /** Settings › Cards › Inbox: O opens the page at (YAZ-5307): `top` (the default) or `card`, for a card in a page. */
  openAt?: InboxOpenAt
  /** E (YAZ-5145): the same layer in edit, as Explore's own E; a card in a page (`card`: by its ID, YAZ-5164) lands on it in Edit card. */
  editCard: (path: string, card: CardPlace | null) => void
  /** ⌘↵: the page in a background tab. */
  openInTab: (path: string) => void
  /** A link's bound gesture (⌘-click): App's link door. */
  openLinkIn: (path: string, where: GestureAction) => void
  /** A plain click on a link in the card: the page on top. */
  openLayer: (path: string) => void
  onNotice: (message: string, icon?: NoticeKind, type?: NoticeType, action?: NoticeAction) => void
  /** A folder of the top row's card place (YAZ-5017 round 2): the vault's or a folder's page, in a tab. The page part opens as O does. */
  openPlace?: (path: string) => void
  /**
   * The card course's offer on the vault's empty Inbox (YAZ-5120, suggestion 24): App gives it only when the vault has
   * no card, the course is not done, the person did not dismiss it, and Card tips is on. Absent: no offer.
   */
  courseOffer?: CourseOfferProps
}

const NO_TITLES: ReadonlyMap<string, string> = new Map()

/** The keys of a dialog, a sheet or a menu that is open: theirs, never the Inbox's. */
const KEY_OWNERS = '[role="dialog"], [role="menu"], [role="listbox"]'

/**
 * Whether a key owner SHOWS. Each editor keeps its `[[` picker (a listbox) and a table its colour menus in the DOM,
 * hidden, also in the tab layers under the Inbox: only one that shows takes the keys.
 */
const ownerShows = (el: HTMLElement): boolean =>
  typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true }) : el.closest('[hidden]') === null && el.dataset.show !== 'false'
const FIELD = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'

/** Whether a key press belongs to the Inbox: the keyboard is in it (or nowhere), not in a field, and nothing nearer took it. */
export function isInboxKeyTarget(event: KeyboardEvent, inbox: HTMLElement | null): boolean {
  if (event.defaultPrevented || event.isComposing || inbox === null) return false
  if ([...document.querySelectorAll<HTMLElement>(KEY_OWNERS)].some(ownerShows)) return false
  const target = event.target instanceof Element ? event.target : null
  if (target === null || target === document.body || target === document.documentElement) return true
  if (target.closest(FIELD) !== null) return false
  return inbox.contains(target)
}

const icon = (d: string) => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)
/** The ⋯ row's icons (YAZ-5004): undo, an archive box (Archive card, YAZ-5046), up to the top, a card window. */
const ICON_UNDO = icon('M6 4 3 7l3 3M3 7h7a3 3 0 0 1 0 6H8')
const ICON_OFF = icon('M2.5 3.5h11v3h-11zM3.5 6.5v6h9v-6M6.5 9h3')
const ICON_TOP = icon('M3 2.5h10M8 13.5V5.5M5 8.5l3-3 3 3')
const ICON_CARD = icon('M2.5 3.5h11v9h-11zM2.5 6.5h11')

/** The last answer's line (YAZ-5025 round 2): its words, its answer, and the session's answer count with it. */
interface AnswerLine {
  text: string
  rating: CardRating
  count: number
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

/**
 * The Archived list (YAZ-5046): the scope's archived cards, to look at. Each row: its title (a click opens it as O does,
 * YAZ-5145), its page, quiet, and Unarchive. None: one quiet line and the way back to All cards.
 */
function ArchivedList({ session, nameOf, openPage, unarchive, backToAll }: { session: CardReviewSession; nameOf: (path: string) => string; openPage: (path: string) => void; unarchive: CardReviewApi['unarchive']; backToAll: () => void }) {
  if (session.archived.length === 0)
    return (
      <div className="card-inbox__done" role="status">
        <p className="card-inbox__done-line card-inbox__archived-empty">No archived cards.</p>
        {session.counts.all > 0 && (
          <button type="button" className="card-inbox__done-more" onMouseDown={(e) => e.preventDefault()} onClick={backToAll}>
            {session.counts.all} more in {CARD_FILTERS[0].label}
          </button>
        )}
      </div>
    )
  return (
    <ul className="card-inbox__archived" aria-label="Archived cards">
      {session.archived.map((c) => (
        <li key={`${c.path}\n${c.id}`} className="card-inbox__archived-row">
          <button type="button" className="card-inbox__archived-open" onMouseDown={(e) => e.preventDefault()} onClick={() => openPage(c.path)}>
            <span className={`card-inbox__archived-title${c.title === undefined ? ' card__title--empty' : ''}`}>{c.title ?? c.id}</span>
            <span className="card-inbox__archived-page">{nameOf(c.path)}</span>
          </button>
          <button type="button" className="explore__button card-inbox__archived-unarchive" onMouseDown={(e) => e.preventDefault()} onClick={() => void unarchive(c.path, c.id)}>
            Unarchive
          </button>
        </li>
      ))}
    </ul>
  )
}

export function CardInbox({ shown = true, review, session, vaultOf, nameOf, openPage: openFile, openAt = 'top', editCard, openInTab, openLinkIn, openLayer, onNotice, openPlace, courseOffer }: CardInboxProps) {
  const unit = useUnit()
  const rootRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const { width, startDrag } = useInboxCardWidth(columnRef, rootRef)
  const card = session.card
  const pageText = card?.page?.text ?? null
  // The Inbox's card (YAZ-5152: shared with the Preview, `inboxCard.tsx`): the front, and the head's title off the card
  // line (YAZ-5308), which waits for the last step where it is hidden on the front (YAZ-5030).
  const { text, title } = useCardFront(pageText, card?.page?.title ?? '', card?.page?.notitle === true)
  // A card FILE (YAZ-5037): "Open card" in the key row, and no "in <page>". One look in the index the vault already holds.
  const cardFile = card !== null && recordAt(vaultOf(card.path).wikilinks.records, card.path)?.kind === 'card'
  const cardKey = card === null ? null : `${session.position}\n${card.path}\n${card.id}`
  /**
   * O (YAZ-5307): the card's file at its top, or a card in a page landed on it when Settings › Cards › Inbox: O opens the
   * page at says The card. The breadcrumb's page part and ⋯ › Open card open as O does; a card file opens as itself.
   */
  const openCard = useCallback(
    (at: { path: string; id: string; index: number }, file: boolean) => (openAt === 'card' && !file ? openFile(at.path, { id: at.id, index: at.index }) : openFile(at.path)),
    [openAt, openFile],
  )
  // YAZ-5033: the active seconds on this card, from the moment its text shows; read at the answer.
  const answerSeconds = useAnswerTimer(card?.page == null ? null : cardKey, shown, review.settings.pauseAfter)
  // Time so far (YAZ-5130): hidden in the clock's hover box by default (round 2: hover only, never a click).
  const time = review.settings.timeSoFar

  // Space's steps (D18, YAZ-5048, YAZ-5049, YAZ-5105 round 3) and the scroll that follows them: the Inbox's card,
  // shared with the Preview (YAZ-5152, `inboxCard.tsx`). The card's sound stops with the card and a hidden Inbox.
  const steps = useCardSteps(text, cardKey, rootRef)
  const { counts, step, done, nextSide, onLastSide } = steps
  const bodyRef = useRef<HTMLDivElement>(null)
  useStepScroll(steps, shown, bodyRef, rootRef)

  // The buttons show with the card (YAZ-5010): their reviews are fixed now, so the hover and the write agree (D13). Again after a delete re-reads the card.
  // The page object, not its text (YAZ-5029): a card read again with the same text is a new page, and fixes again.
  const { showAnswers } = review
  const page = card?.page ?? null
  useEffect(() => {
    if (page !== null && session.answers === null) showAnswers()
  }, [page, session.answers, showAnswers])

  // The keyboard comes to the Inbox when it opens and with each card; back from the Explore stack, App gives it back here.
  useEffect(() => {
    if (shown) rootRef.current?.focus({ preventScroll: true })
  }, [cardKey, shown])

  const ratings = answerRatings(review.settings)
  // The ⋯ row (YAZ-5004): open or closed; it closes with the card, Esc and a press outside it.
  const [moreState, setMore] = useState<string | null>(null)
  const moreOpen = moreState !== null && moreState === cardKey
  const live = useRef({ steps, card, session, review, ratings, moreOpen, shown, answerSeconds, cardFile })
  live.current = { steps, card, session, review, ratings, moreOpen, shown, answerSeconds, cardFile }

  // The last answer's line (YAZ-5025 round 2): its words fixed when the answer is given, shown once the session counts
  // it (`count`: the session's answers with it), and only while that answer is still the session's last (an undo clears it).
  const pendingLine = useRef<AnswerLine | null>(null)
  const [lastLine, setLastLine] = useState<AnswerLine | null>(null)
  const answerWith = useCallback((rating: CardRating) => {
    const { session, review, card, answerSeconds } = live.current
    // The answers as the hook fixed them (a digit can come before the buttons show: they are fixed now, as `answer` would).
    const fixed = (session.answers ?? review.showAnswers())?.find((a) => a.review.rating === rating)
    // The card by its title (YAZ-5030), a title hidden in review too: the answer is given.
    const title = card?.page?.title ?? ''
    pendingLine.current = fixed === undefined || card === null ? null : { text: answerLine(rating, card.id, fixed.interval, fixed.inSteps, review.settings, title), rating, count: session.answered.length + 1 }
    void review.answer(rating, answerSeconds())
  }, [])
  const answeredCount = session.answered.length
  useEffect(() => {
    const pending = pendingLine.current
    if (pending === null || answeredCount !== pending.count) return
    pendingLine.current = null
    setLastLine(pending)
  }, [answeredCount])
  const line = lastLine !== null && answeredCount === lastLine.count && session.answered[answeredCount - 1] === lastLine.rating ? lastLine : null
  useEffect(() => {
    if (!moreOpen) return
    const away = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || event.target.closest('.card-inbox__more') === null) setMore(null)
    }
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [moreOpen])

  /** One Space (D18): the next hidden word of the sides showing, else the next side. */
  // THE END's cue (YAZ-5049 round 3, Yaseen: "there is no way to know they have hit the end"): the hint row has
  // dropped Space, and one more Space moves nothing but gives the answer buttons one soft ring — where to go now.
  // A new value each time, so the ring plays again; none on the next card.
  const [nudge, setNudge] = useState<{ key: string | null; n: number }>({ key: null, n: 0 })
  // Round 4: `by` says what showed it — Space (a key) scrolls to follow the next blank, a mouse never moves the view.
  // The steps are the shared card's (`useCardSteps`); at the end, a key rings the buttons.
  const advance = useCallback((by: 'key' | 'mouse' = 'key') => {
    const { steps, card } = live.current
    if (card?.page == null) return
    if (steps.stepOn(by)) {
      // The guided tour (YAZ-5123) hears each step of the card.
      tourEvent('inbox-step-shown', card.path)
      return
    }
    if (by !== 'key') return
    const key = steps.step.key
    setNudge((v) => ({ key, n: v.key === key ? v.n + 1 : 1 }))
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!live.current.shown || !isInboxKeyTarget(event, rootRef.current)) return
      const key = cardInboxKey(event)
      if (key === null) return
      const { card, session, review, ratings, moreOpen } = live.current
      // Esc closes the ⋯ row only (YAZ-5011): the Inbox is a tab, so with the row closed the key goes on down the Esc order.
      if (key.kind === 'close' && !moreOpen) return
      event.preventDefault()
      event.stopPropagation()
      if (key.kind === 'close') return setMore(null)
      if (key.kind === 'undo') {
        if (session.canUndo && !event.repeat) void review.undo()
        return
      }
      if (card === null) return
      if (key.kind === 'step') return advance()
      if (key.kind === 'play') {
        if (!event.repeat) toggleCardAudio(rootRef.current?.querySelector('.card-inbox__card') ?? null)
        return
      }
      if (key.kind === 'move') {
        if (key.delta < 0 ? session.canBack : session.canNext) review.move(key.delta)
        return
      }
      if (key.kind === 'answer') {
        // At any step (YAZ-5010): the buttons show from the moment the card shows.
        const rating = ratings[key.button]
        if (card.page !== null && rating !== undefined && !event.repeat) answerWith(rating)
        return
      }
      if (key.kind === 'open') return openCard(card, live.current.cardFile)
      // E (YAZ-5145): Explore's own edit of the card's file; a card in a page lands on the card, in Edit card.
      if (key.kind === 'edit') return editCard(card.path, live.current.cardFile ? null : { id: card.id, index: card.index })
      if (key.kind === 'tab') return openInTab(card.path)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, answerWith, openCard, editCard, openInTab])

  const doors = useMemo(() => ({ openLayer, openTab: openLinkIn, onNotice }), [openLayer, openLinkIn, onNotice])
  // YAZ-5042: the kinds that wait past today's number, with an add; under a filter, only that filter's kind.
  const addKinds = (['new', 'next'] as const).filter((k) => session.adds[k] > 0 && (session.filter === 'all' || session.filter === k))
  const addButtons =
    addKinds.length === 0 ? null : (
      <div className="card-inbox__done-adds">
        {/* Round 2: the same field as the cards menu's, "Add [10] new cards"; the number starts at the Settings number. */}
        {addKinds.map((k) => (
          <AddMoreField key={k} kind={k} look="done" start={session.adds[k]} onAdd={(n) => review.addCards(k, n)} />
        ))}
      </div>
    )
  const waits = addKinds.length > 0 && <p className="card-inbox__done-line">{waitingLine(session.more, addKinds)}</p>
  // The rest of the vault, after a review of one page or one folder: the way on.
  const more = session.scope === 'vault' ? 0 : review.dueCount
  // The head's title: once the card is fully shown where it waits (`notitle`).
  const headTitle = title.waits && !done ? '' : title.text
  /** The head's rename (YAZ-5164 part 3): the title on the card's line (YAZ-5308), one write; the Inbox reads the card again. */
  const retitle = (path: string, id: string, next: string): void => {
    changeCardLine(path, id, (l) => withCardTitle(l, next)).catch((err: unknown) => onNotice(`Can't rename the card: ${err instanceof Error ? err.message : String(err)}`))
  }
  const hints = cardInboxHints({ card: card !== null, cardFile, answering: done, canUndo: session.canUndo, moves: session.canBack || session.canNext, audio: text !== null && textHasAudio(cardSides(text).slice(0, step.sides).join('\n')), nextSide })
  /** The ⋯ row's actions (YAZ-5004): the hook's own, with their names and keys for the hover box. */
  const moreActions =
    card === null
      ? []
      : [
          { id: 'undo', label: 'Undo last review', keys: '⌘Z', icon: ICON_UNDO, disabled: !session.canUndo, run: () => void review.undo() },
          { id: 'off', label: 'Archive card', tour: 'card-menu-archive', icon: ICON_OFF, disabled: card.page === null, run: () => void review.turnOff() },
          card.page?.next === true
            ? { id: 'next', label: 'Remove from top of Inbox', icon: ICON_TOP, disabled: false, run: () => void review.setNext(card.path, card.id, false) }
            : { id: 'next', label: 'Put at top of Inbox', icon: ICON_TOP, disabled: card.page === null, run: () => void review.setNext(card.path, card.id, true) },
          { id: 'card', label: 'Open card', icon: ICON_CARD, disabled: false, run: () => openCard(card, cardFile) },
        ]

  return (
    <div ref={rootRef} className="card-inbox" hidden={!shown} tabIndex={-1} role="region" aria-label={session.label === 'Inbox' ? 'Inbox' : `Review: ${session.label}`}>
      <CardInboxBar session={session} setFilter={review.setFilter} addCards={review.addCards} resetCards={review.resetCards} openPlace={(part) => (part.kind === 'page' ? (card !== null && part.path === card.path ? openCard(card, cardFile) : openFile(part.path)) : openPlace?.(part.path))} time={time} />
      <div ref={columnRef} className="card-inbox__column" style={width === null ? undefined : { width: `min(${width}px, 100%)` }}>
        {/* YAZ-5027: the state chip sits right above the card, outside its frame, on the left. The row keeps its height
            with no chip (the done screen), so the card does not move. YAZ-5051 (Yaseen: "so that the card is just pure"):
            the head sits here too, after the chip — YAZ-5044 "Title · ID" (a click on the ID copies it) — with "Up next ×";
            the card frame holds only the card. YAZ-5132: no "in <page>": the top row's breadcrumb ends with the page. A long name gives way first. */}
        <div className="card-inbox__above">
          {card !== null && (
            <>
              <CardStateChip card={card} />
              <span className="card-inbox__head">
                {headTitle !== '' && (
                  <>
                    {cardFile ? (
                      <button type="button" className="card-inbox__name card-inbox__name--link" onMouseDown={(e) => e.preventDefault()} onClick={() => openFile(card.path)}>
                        {headTitle}
                      </button>
                    ) : card.page !== null && vaultOf(card.path).readOnly !== true ? (
                      // A card in a page (YAZ-5164 part 3): the page title's own component, a click renames the card (its
                      // card line), as in the page's card head. In a Read only vault it shows only.
                      <span className="card-inbox__name">
                        <PageTitle path={card.path} titles={NO_TITLES} text={headTitle} onRetitle={(next) => retitle(card.path, card.id, next)} />
                      </span>
                    ) : (
                      <span className="card-inbox__name">{headTitle}</span>
                    )}
                    <span className="card-inbox__dot" aria-hidden>
                      ·
                    </span>
                  </>
                )}
                <CardId id={card.id} onNotice={onNotice} />
                {card.page?.next === true && <CardNextChip onRemove={() => void review.setNext(card.path, card.id, false)} />}
              </span>
            </>
          )}
          {/* YAZ-5048: a card of more than one side says where you are, quietly, on the right; one side says nothing. */}
          {card !== null && text !== null && <CardSideCount steps={steps} />}
        </div>
        {/* The card's frame and its width edges (YAZ-5019), shared with the Preview (YAZ-5152). */}
        <InboxCardPanel startDrag={startDrag} bodyRef={bodyRef}>
            {session.filter === 'archived' ? (
              <ArchivedList session={session} nameOf={nameOf} openPage={openFile} unarchive={review.unarchive} backToAll={() => review.setFilter('all')} />
            ) : card === null ? (
              <div className="card-inbox__done" role="status">
                {/* YAZ-5033: today's work across the vault, under whatever the screen says. */}
                {session.filter !== 'all' && session.counts.all > 0 ? (
                  // The filter's cards are done, others are left (YAZ-5017): the way back to All cards.
                  <>
                    <p className="card-inbox__done-title">{session.filter === 'due' ? 'No due cards left.' : session.filter === 'next' ? 'No Up next cards left.' : 'No new cards left.'}</p>
                    {addButtons}
                    <button type="button" className="card-inbox__done-more" onMouseDown={(e) => e.preventDefault()} onClick={() => review.setFilter('all')}>
                      {session.counts.all} more in {CARD_FILTERS[0].label}
                    </button>
                  </>
                ) : session.scope === 'vault' ? (
                  <>
                    <p className="card-inbox__done-title">Inbox complete.</p>
                    {courseOffer !== undefined ? (
                      <CourseOffer {...courseOffer} />
                    ) : addButtons === null ? (
                      <p className="card-inbox__done-line">Nothing else is due today. Enjoy your day!</p>
                    ) : (
                      [waits, addButtons]
                    )}
                  </>
                ) : (
                  <>
                    <p className="card-inbox__done-title">{session.scope === 'page' ? unit('This page is done.') : 'This folder is done.'}</p>
                    {waits}
                    {addButtons}
                    {more > 0 ? (
                      <button type="button" className="card-inbox__done-more" onMouseDown={(e) => e.preventDefault()} onClick={() => review.start({})}>
                        {more} more in the Inbox
                      </button>
                    ) : (
                      addButtons === null && <p className="card-inbox__done-line">Nothing else is due today. Enjoy your day!</p>
                    )}
                  </>
                )}
                {todayCards(session.today) !== '' && (
                  <p className="card-inbox__done-today">
                    <TodayWork today={session.today} time={time} />
                  </p>
                )}
              </div>
            ) : (
              text !== null &&
              card.page !== null && (
                <InboxCardFace tour="inbox-card" text={text} path={card.path} vault={vaultOf(card.path)} steps={steps} doors={doors} onStep={advance} />
              )
            )}
        </InboxCardPanel>
        {/* YAZ-5105 round 2: the Reviews strip, as Mochi's, under the card and outside its frame; round 3: as soon as the
            last side shows, its hidden words shown or not; closed again for each card. The buttons' band stays at the
            bottom of the view over it. */}
        {card?.page != null && session.filter !== 'archived' && onLastSide && card.page.reviews.length > 0 && <CardReviews key={cardKey} reviews={card.page.reviews} settings={review.settings} />}
        {/* Under the card, outside its frame, as in Mochi (YAZ-5002): the answer buttons, then the keys. No "Press Space"
            line between them (YAZ-5021): the key row at the bottom already says Space. */}
        {/* YAZ-5049 round 2: the buttons and their line stay at the bottom of the view while a long card scrolls under them. */}
        <div className="card-inbox__dock">
        {card !== null && (
          <div className="card-inbox__actions">
            <div className="card-inbox__moves">
              <HoverTip text="Previous card (←)">
                <button type="button" className="explore__button card-inbox__move" aria-label="Previous card" disabled={!session.canBack} onMouseDown={(e) => e.preventDefault()} onClick={() => review.move(-1)}>
                  ←
                </button>
              </HoverTip>
              <HoverTip text="Next card (→)">
                <button type="button" className="explore__button card-inbox__move" aria-label="Next card" disabled={!session.canNext} onMouseDown={(e) => e.preventDefault()} onClick={() => review.move(1)}>
                  →
                </button>
              </HoverTip>
            </div>
            <div className="card-inbox__answers" data-tour="inbox-answers" data-nudge={nudge.key === cardKey && nudge.key !== null ? (nudge.n % 2 === 1 ? 'a' : 'b') : undefined}>
              {/* YAZ-5029: the buttons are the setting's, always there — never only once the card's answers are fixed, so
                  fast ← → never takes them away for a frame. The hover says when the card comes back once it is known. */}
              {ratings.map((rating, i) => {
                const a = session.answers?.find((x) => x.review.rating === rating)
                const label = answerLabel(rating, review.settings)
                // The app's own hover box (a native title shows nothing in the app, YAZ-4772): when the card comes back.
                const comesBack = a === undefined ? label : `${label} · ${cardWait(a.interval, a.inSteps)}`
                return (
                  <HoverTip key={rating} text={comesBack}>
                    <button type="button" className="explore__button card-inbox__answer" data-rating={rating} aria-description={comesBack} onMouseDown={(e) => e.preventDefault()} onClick={() => live.current.card?.page != null && answerWith(rating)}>
                      {answerIcon(rating, review.settings.buttons)}
                      <KeyLabel action={<span className="card-inbox__answer-label">{label}</span>} keys={String(i + 1)} />
                    </button>
                  </HoverTip>
                )
              })}
            </div>
            <div className="card-inbox__more">
              {moreOpen && (
                <div className="card-inbox__more-row" role="toolbar" aria-label="Card actions">
                  {moreActions.map((a) => (
                    <HoverTip key={a.id} text={withKeys(a.label, a.keys)}>
                      <button
                        type="button"
                        className="explore__button card-inbox__more-action"
                        data-action={a.id}
                        data-tour={a.tour}
                        aria-label={a.label}
                        disabled={a.disabled}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setMore(null)
                          a.run()
                        }}
                      >
                        {a.icon}
                      </button>
                    </HoverTip>
                  ))}
                </div>
              )}
              <HoverTip text="More">
                <button type="button" className="explore__button card-inbox__more-button" data-tour="card-menu" aria-label="More" aria-expanded={moreOpen} onMouseDown={(e) => e.preventDefault()} onClick={() => setMore(moreOpen ? null : cardKey)}>
                  ⋯
                </button>
              </HoverTip>
            </div>
          </div>
        )}
        {/* The last answer's line (YAZ-5025 round 2): centred under the buttons; the row keeps its height when empty. */}
        <div className="card-inbox__last" role="status" aria-live="polite" data-rating={session.lastAdd === null ? line?.rating : undefined} data-kind={session.lastAdd === null ? undefined : 'add'}>
          {session.lastAdd !== null ? (
            // YAZ-5042: the add (round 2: or the Reset), while it is the last thing done; its Undo is the hook's undo, as ⌘Z.
            <>
              <span className="card-inbox__last-mark">{session.lastAdd.reset ? '↺' : '+'}</span>
              <span className="card-inbox__last-text"> {session.lastAdd.reset ? resetLine(session.lastAdd.kind) : addedLine(session.lastAdd.kind, session.lastAdd.count)} · </span>
              <button type="button" className="card-inbox__last-undo" disabled={!session.canUndo} onMouseDown={(e) => e.preventDefault()} onClick={() => void review.undo()}>
                <KeyLabel action="Undo" keys="⌘Z" />
              </button>
            </>
          ) : (
            line !== null && (
            <>
              <span className="card-inbox__last-mark">{line.text.slice(0, line.text.indexOf(' '))}</span>
              <span className="card-inbox__last-text">{line.text.slice(line.text.indexOf(' '))} · </span>
              <button type="button" className="card-inbox__last-undo" disabled={!session.canUndo} onMouseDown={(e) => e.preventDefault()} onClick={() => void review.undo()}>
                <KeyLabel action="Undo" keys="⌘Z" />
              </button>
            </>
            )
          )}
        </div>
        </div>
        <CardInboxHints hints={hints} />
      </div>
    </div>
  )
}
