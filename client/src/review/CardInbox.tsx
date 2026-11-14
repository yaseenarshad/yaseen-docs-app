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
 *    part a link (`openPlace`: the folder page, or the page in a tab), and "3 of 12" of the filter's cards on the right.
 *  - Above the card, outside its frame (YAZ-5027): the state chip (YAZ-5018, as Mochi's: "New card", "Due today",
 *    "Due · 3 days ago"), then (YAZ-5051: the card frame holds only the card) THE HEAD (YAZ-5044): "Title · ID", the
 *    card ID small and grey (a click copies it, D20); a card in a page adds a quiet "in <page>", a link that opens the
 *    page (O too); a card file (YAZ-5037) adds nothing, its title is the link, and it and O open the card file's tab
 *    ("Open card"). Then the chip "Up next ×" for a card at the top of the Inbox (YAZ-4999 D3). A card of more than one
 *    side says "Side 1 of 2" on the row's right (YAZ-5048), and the key row's Space says "Next side" when the next Space shows a side.
 *  - SCROLL (YAZ-5049): the word a Space shows, or the side it adds, comes into view, gliding; never centred. Round 2
 *    (as Mochi): the card is one long page — no scroll bar of its own; the Inbox's view scrolls, the top row stays on
 *    top and the buttons at the bottom — and a word that reaches the view's lower third comes up to its upper third,
 *    so what comes next shows (`inboxScroll.ts`).
 *  - TITLE ON THE FRONT: HIDE (YAZ-5030, the card line's `notitle`): the front is drawn without its title line (its
 *    first line, `cardWithoutTitle`), so the title is never a Space step, nor any hidden word in it. The head shows the
 *    ID only until the card is fully shown, then the title: which card it was. A title that holds a hidden word waits
 *    the same way, also on the front: shown early, it would tell the answer.
 *  - SPACE (D18): each Space shows the NEXT hidden word, in page order. When the side showing has none left, the next
 *    Space shows the next side, whose hidden words then show one by one. The answer buttons show from the moment the
 *    card shows (YAZ-5010, Yaseen: "Should always be there"): `showAnswers()` fixes what each one writes then (the
 *    hover is the truth, D13), and 1–2 / 1–4 answer at any step.
 *  - The buttons (D5): ✕ Forgot · ✓ Remembered, or ↺ Again · ~ Hard · ✓ Good · ⇈ Easy, by the setting, round as
 *    Mochi's (YAZ-5018); the hover says when the card comes back ("Remembered · 9 days"; "Forgot · later today" while
 *    the answer keeps it in its same-day steps, YAZ-5020: it comes back at the end of this session).
 *  - The keys (`cardInboxKeys.ts`): Space, 1–2 / 1–4 (at any step, YAZ-5010), ⌘Z, O (the page on top, at its top,
 *    YAZ-5022; Esc there comes back to this card at the same step), E (YAZ-5003: the CARD WINDOW on top, in Edit card, in
 *    every vault, YAZ-5009: also a read-only one, with no "Allow edits?" box — only this card's text unlocks, for this
 *    edit; Done, Esc or ⌘↵ there saves and reads, locked again; then ⌘↵ or Esc comes back to this card at the same step), ← → (YAZ-5004: the card before or after, no answer), ⌘↵ (the page in a
 *    background tab: the review stays), Esc (only the ⋯ row; then the Esc order goes on, YAZ-5011). A key typed in a field, or while a dialog or a menu
 *    is open (Explore is a dialog), is not the Inbox's; a key with the keyboard elsewhere (the sidebar) neither.
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
 *    TIME SO FAR (YAZ-5130, `TodayWork`): the time hides behind a small clock by default (a click shows it), or shows,
 *    or is off, by Settings › Review › Time so far. The timer and the saved seconds do not change with it.
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
 *    the card window (as ⋯ › Open card), and "Unarchive" brings it back to review, its history kept. No answer buttons.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { answerLabel, answerRatings, type AddKind } from '@shared/cardSchedule'
import { cardSides, cardTitle, cardWithoutTitle, hiddenCount } from '@shared/cardText'
import { recordAt } from '../editor/card/embedCard'
import type { GestureAction } from '@shared/keys'
import type { CardRating } from '@shared/cardLine'
import type { ExploreVault } from '../explore/ExplorePage'
import type { CardReviewApi, CardReviewSession } from './useCardReview'
import { CardBody, CardId, CardNextChip, CardReviews, cardWait } from './cardParts'
import { cardInboxHints, cardInboxKey } from './cardInboxKeys'
import { CARD_MEDIA, CARD_OPENS, stopCardAudio, textHasAudio, toggleCardAudio } from '../editor/card/cardMedia'
import { HoverTip } from '../components/HoverTip'
import type { NoticeAction, NoticeKind, NoticeType } from '../lib/notice'
import { CARD_FILTERS, CardInboxBar } from './CardInboxBar'
import { CardStateChip, answerIcon, answerLine } from './cardInboxChip'
import { useInboxCardWidth } from './inboxCardWidth'
import { CardInboxHints } from './CardInboxHints'
import { KeyCaps } from '../keys/KeyCaps'
import { AddMoreField } from './AddMoreField'
import { useAnswerTimer } from './answerTimer'
import { TodayWork } from './TodayWork'
import { todayCards } from './reviewTime'
import { cssZoom } from '../lib/cssZoom'
import { inboxRoom, readingScroll } from './inboxScroll'
import '../explore/explore.css'
import { useUnit } from '../vault/unitWord'

export interface CardInboxProps {
  /** The Inbox tab is the one on show (YAZ-5011); false: behind a page tab, hidden, and deaf to keys. Default true. */
  shown?: boolean
  review: CardReviewApi
  session: CardReviewSession
  vaultOf: (path: string) => ExploreVault
  nameOf: (path: string) => string
  /** O and the page name: the page on top as an Explore layer, at its TOP (YAZ-5022: no scroll to the card). */
  openPage: (path: string) => void
  /** O and the title of a card FILE (YAZ-5037, "Open card"): the card file's own tab. Absent: `openPage`. */
  openTab?: (path: string) => void
  /** The card window on top (⋯ › Open card); `edit` in Edit card (E, YAZ-5003). */
  openCard: (path: string, id: string, index: number, edit: boolean) => void
  /** ⌘↵: the page in a background tab. */
  openInTab: (path: string) => void
  /** A link's bound gesture (⌘-click): App's link door. */
  openLinkIn: (path: string, where: GestureAction) => void
  /** A plain click on a link in the card: the page on top. */
  openLayer: (path: string) => void
  onNotice: (message: string, icon?: NoticeKind, type?: NoticeType, action?: NoticeAction) => void
  /** A part of the top row's card place (YAZ-5017 round 2): the vault's or a folder's page, or the page, in a tab. */
  openPlace?: (path: string) => void
}

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
 * The Archived list (YAZ-5046): the scope's archived cards, to look at. Each row: its title (a click opens the card
 * window), its page, quiet, and Unarchive. None: one quiet line and the way back to All cards.
 */
function ArchivedList({ session, nameOf, openCard, unarchive, backToAll }: { session: CardReviewSession; nameOf: (path: string) => string; openCard: CardInboxProps['openCard']; unarchive: CardReviewApi['unarchive']; backToAll: () => void }) {
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
          <button type="button" className="card-inbox__archived-open" onMouseDown={(e) => e.preventDefault()} onClick={() => openCard(c.path, c.id, c.index, false)}>
            <span className={`card-inbox__archived-title${c.title === undefined ? ' card__title--empty' : ''}`}>{c.title ?? 'New card'}</span>
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

/** The step a card is at (D18): how many sides show, and how many hidden words, in page order over the card. */
interface Step {
  key: string | null
  sides: number
  shown: number
}

export function CardInbox({ shown = true, review, session, vaultOf, nameOf, openPage, openTab, openCard, openInTab, openLinkIn, openLayer, onNotice, openPlace }: CardInboxProps) {
  const unit = useUnit()
  const rootRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const { width, startDrag } = useInboxCardWidth(columnRef, rootRef)
  const card = session.card
  const pageText = card?.page?.text ?? null
  // "Title on the front: Hide" (YAZ-5030): the front is drawn without its title line, so the title is never a Space
  // step (nor a hidden word in it); once the card is fully shown, the head shows it (YAZ-5044).
  const hideTitle = card?.page?.notitle === true
  const text = useMemo(() => (pageText !== null && hideTitle ? cardWithoutTitle(pageText) : pageText), [pageText, hideTitle])
  // The head's title (YAZ-5044), and whether it waits for the card's last step: hidden on the front, or holding a hidden word.
  const title = useMemo(() => {
    if (pageText === null) return { text: '', waits: false }
    const tells = hiddenCount(cardSides(pageText)[0]) > hiddenCount(cardSides(cardWithoutTitle(pageText))[0])
    return { text: cardTitle(pageText), waits: hideTitle || tells }
  }, [pageText, hideTitle])
  // A card FILE (YAZ-5037): its own tab is where it lives. One look in the index the card's vault already holds.
  const cardFile = card !== null && recordAt(vaultOf(card.path).wikilinks.records, card.path)?.kind === 'card'
  const open = useCallback((path: string): void => (cardFile ? (openTab ?? openPage)(path) : openPage(path)), [cardFile, openTab, openPage])
  const cardKey = card === null ? null : `${session.position}\n${card.path}\n${card.id}`
  // YAZ-5033: the active seconds on this card, from the moment its text shows; read at the answer.
  const answerSeconds = useAnswerTimer(card?.page == null ? null : cardKey, shown, review.settings.pauseAfter)
  // Time so far (YAZ-5130): hidden behind a click by default; one click shows it in the top row and on the done screen.
  const [timeOpen, setTimeOpen] = useState(false)
  const time = { mode: review.settings.timeSoFar, open: timeOpen, setOpen: setTimeOpen }

  // The sides and their hidden words, once per card text.
  const counts = useMemo(() => (text === null ? [] : cardSides(text).map(hiddenCount)), [text])
  const [stepState, setStep] = useState<Step>({ key: cardKey, sides: 1, shown: 0 })
  const step = stepState.key === cardKey ? stepState : { key: cardKey, sides: 1, shown: 0 }
  // A card that goes and comes back (⌘Z after the last answer) starts again from its first step.
  useEffect(() => setStep((s) => (s.key === cardKey ? s : { key: cardKey, sides: 1, shown: 0 })), [cardKey])
  // The card's sound never outlives it (YAZ-5014): the next card, a hidden Inbox and its close stop it.
  useEffect(() => stopCardAudio, [cardKey, shown])
  const hiddenUpTo = (sides: number): number => counts.slice(0, sides).reduce((a, b) => a + b, 0)
  const done = text !== null && step.sides >= counts.length && step.shown >= hiddenUpTo(counts.length)
  // YAZ-5048: the next Space shows the next side (the sides that show have no hidden word left).
  const nextSide = !done && text !== null && step.shown >= hiddenUpTo(step.sides)
  // YAZ-5105 round 3 (Yaseen: "just show on the last side … regardless of it hidden words are all revealed or not"):
  // the card's last side shows, past its front. A one-side card's front IS its last side: past it means its first
  // Space has shown something, or it has nothing to show (fully shown at once).
  const onLastSide = text !== null && step.sides >= counts.length && (step.sides > 1 || step.shown > 0 || done)

  // YAZ-5049 (Yaseen: "kinda like we have in the app our CMD F search"): the word a Space shows, or the side it adds,
  // comes into view, gliding; never centred. Only a step of the same card moves it. The card's render runs first.
  // Round 2: the card is one long page, as in Mochi (no scroll bar of its own: the Inbox's view scrolls, the top row
  // and the buttons stay), and the rule keeps room below the word, to see what comes next (`inboxScroll.ts`). A new
  // card starts at its top, at once.
  const bodyRef = useRef<HTMLDivElement>(null)
  const lastStep = useRef<Step | null>(null)
  useEffect(() => {
    const before = lastStep.current
    lastStep.current = { key: step.key, sides: step.sides, shown: step.shown }
    const body = bodyRef.current
    const view = rootRef.current
    if (!shown || body === null || view === null) return
    if (before !== null && before.key !== step.key) {
      view.scrollTop = 0
      return
    }
    if (before === null) return
    const side = step.sides > before.sides ? body.querySelector(`.card__side[data-side="${step.sides - 1}"]`) : null
    const target = side ?? (step.shown > before.shown ? body.querySelector(`[data-hidden="${step.shown - 1}"]`) : null)
    if (target === null) return
    const r = target.getBoundingClientRect()
    // A side by its top: its first line, the line between the sides above it.
    const thing = side === null ? { start: r.top, end: r.bottom } : { start: r.top, end: r.top }
    const dy = readingScroll(thing, inboxRoom(view))
    if (dy === 0) return
    const top = view.scrollTop + dy / cssZoom(view)
    const smooth = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== true
    if (typeof view.scrollTo === 'function') view.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
    else view.scrollTop = top
  }, [step.key, step.sides, step.shown, shown])

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
  const live = useRef({ step, done, counts, card, session, review, ratings, moreOpen, shown, answerSeconds })
  live.current = { step, done, counts, card, session, review, ratings, moreOpen, shown, answerSeconds }

  // The last answer's line (YAZ-5025 round 2): its words fixed when the answer is given, shown once the session counts
  // it (`count`: the session's answers with it), and only while that answer is still the session's last (an undo clears it).
  const pendingLine = useRef<AnswerLine | null>(null)
  const [lastLine, setLastLine] = useState<AnswerLine | null>(null)
  const answerWith = useCallback((rating: CardRating) => {
    const { session, review, card, answerSeconds } = live.current
    // The answers as the hook fixed them (a digit can come before the buttons show: they are fixed now, as `answer` would).
    const fixed = (session.answers ?? review.showAnswers())?.find((a) => a.review.rating === rating)
    // The card by its title (YAZ-5030), a title hidden in review too: the answer is given.
    const title = card?.page == null ? '' : cardTitle(card.page.text)
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
  const advance = useCallback(() => {
    const { step, done, counts, card } = live.current
    if (done || card?.page == null) return
    const before = counts.slice(0, step.sides).reduce((a, b) => a + b, 0)
    setStep(step.shown < before ? { ...step, shown: step.shown + 1 } : { ...step, sides: step.sides + 1 })
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
      if (key.kind === 'open') return open(card.path)
      // E edits only the card (YAZ-5003): the card window in Edit card, in every vault (YAZ-5009, Yaseen: "e should go
      // directly into edit mode"). A read-only vault unlocks this card's text alone, for this edit (`ExploreCard`).
      if (key.kind === 'edit') return openCard(card.path, card.id, card.index, true)
      if (key.kind === 'tab') return openInTab(card.path)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, answerWith, open, openCard, openInTab])

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
  // The head's title (YAZ-5044): once the card is fully shown where it waits (`notitle`, or a hidden word in it).
  const headTitle = title.waits && !done ? '' : title.text
  const hints = cardInboxHints({ card: card !== null, cardFile, answering: done, canUndo: session.canUndo, moves: session.canBack || session.canNext, audio: text !== null && textHasAudio(cardSides(text).slice(0, step.sides).join('\n')), nextSide })
  /** The ⋯ row's actions (YAZ-5004): the hook's own, with their names and keys for the hover box. */
  const moreActions =
    card === null
      ? []
      : [
          { id: 'undo', label: 'Undo last review', keys: '⌘Z', icon: ICON_UNDO, disabled: !session.canUndo, run: () => void review.undo() },
          { id: 'off', label: 'Archive card', icon: ICON_OFF, disabled: card.page === null, run: () => void review.turnOff() },
          card.page?.next === true
            ? { id: 'next', label: 'Remove from top of Inbox', icon: ICON_TOP, disabled: false, run: () => void review.setNext(card.path, card.id, false) }
            : { id: 'next', label: 'Put at top of Inbox', icon: ICON_TOP, disabled: card.page === null, run: () => void review.setNext(card.path, card.id, true) },
          { id: 'card', label: 'Open card', icon: ICON_CARD, disabled: false, run: () => openCard(card.path, card.id, card.index, false) },
        ]

  return (
    <div ref={rootRef} className="card-inbox" hidden={!shown} tabIndex={-1} role="region" aria-label={session.label === 'Inbox' ? 'Inbox' : `Review: ${session.label}`}>
      <CardInboxBar session={session} setFilter={review.setFilter} addCards={review.addCards} resetCards={review.resetCards} openPlace={openPlace} time={time} />
      <div ref={columnRef} className="card-inbox__column" style={width === null ? undefined : { width: `min(${width}px, 100%)` }}>
        {/* YAZ-5027: the state chip sits right above the card, outside its frame, on the left. The row keeps its height
            with no chip (the done screen), so the card does not move. YAZ-5051 (Yaseen: "so that the card is just pure"):
            the head sits here too, after the chip — YAZ-5044 "Title · ID" (a click on the ID copies it), "in <page>" for
            a card in a page (O opens it) — with "Up next ×"; the card frame holds only the card. A long name gives way first. */}
        <div className="card-inbox__above">
          {card !== null && (
            <>
              <CardStateChip card={card} />
              <span className="card-inbox__head">
                {headTitle !== '' && (
                  <>
                    {cardFile ? (
                      <button type="button" className="card-inbox__name card-inbox__name--link" onMouseDown={(e) => e.preventDefault()} onClick={() => open(card.path)}>
                        {headTitle}
                      </button>
                    ) : (
                      <span className="card-inbox__name">{headTitle}</span>
                    )}
                    <span className="card-inbox__dot" aria-hidden>
                      ·
                    </span>
                  </>
                )}
                <CardId id={card.id} onNotice={onNotice} />
                {!cardFile && (
                  <span className="card-inbox__in">
                    {'in '}
                    <button type="button" className="card-strip__page card-inbox__page" onMouseDown={(e) => e.preventDefault()} onClick={() => open(card.path)}>
                      {nameOf(card.path)}
                    </button>
                  </span>
                )}
                {card.page?.next === true && <CardNextChip onRemove={() => void review.setNext(card.path, card.id, false)} />}
              </span>
            </>
          )}
          {/* YAZ-5048: a card of more than one side says where you are, quietly, on the right; one side says nothing. */}
          {card !== null && text !== null && counts.length > 1 && <span className="card-inbox__sides">{`Side ${Math.min(step.sides, counts.length)} of ${counts.length}`}</span>}
        </div>
        <div className="card-inbox__panel">
          {/* The card's edges (YAZ-5019): a drag of either sizes the card, centred. */}
          <div className="card-inbox__edge" data-side="left" role="separator" aria-orientation="vertical" aria-label="Card width" onPointerDown={startDrag(-1)} />
          <div className="card-inbox__edge" data-side="right" role="separator" aria-orientation="vertical" aria-label="Card width" onPointerDown={startDrag(1)} />
          <div ref={bodyRef} className="card-inbox__body">
            {session.filter === 'archived' ? (
              <ArchivedList session={session} nameOf={nameOf} openCard={openCard} unarchive={review.unarchive} backToAll={() => review.setFilter('all')} />
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
                    {addButtons === null ? <p className="card-inbox__done-line">Nothing else is due today. Enjoy your day!</p> : [waits, addButtons]}
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
                <>
                  <div className="card card-screen card-inbox__card" onClick={(e) => e.target instanceof Element && e.target.closest(`a[href], ${CARD_OPENS}, ${CARD_MEDIA}`) === null && advance()}>
                    <CardBody text={text} path={card.path} vault={vaultOf(card.path)} show={{ sides: step.sides, shown: step.shown }} doors={doors} />
                  </div>
                </>
              )
            )}
          </div>
        </div>
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
            <div className="card-inbox__answers">
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
                      <span className="card-inbox__answer-label">{label}</span>
                      <kbd>{i + 1}</kbd>
                    </button>
                  </HoverTip>
                )
              })}
            </div>
            <div className="card-inbox__more">
              {moreOpen && (
                <div className="card-inbox__more-row" role="toolbar" aria-label="Card actions">
                  {moreActions.map((a) => (
                    <HoverTip key={a.id} text={a.keys === undefined ? a.label : `${a.label} (${a.keys})`}>
                      <button
                        type="button"
                        className="explore__button card-inbox__more-action"
                        data-action={a.id}
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
                <button type="button" className="explore__button card-inbox__more-button" aria-label="More" aria-expanded={moreOpen} onMouseDown={(e) => e.preventDefault()} onClick={() => setMore(moreOpen ? null : cardKey)}>
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
                Undo <KeyCaps keys="⌘Z" />
              </button>
            </>
          ) : (
            line !== null && (
            <>
              <span className="card-inbox__last-mark">{line.text.slice(0, line.text.indexOf(' '))}</span>
              <span className="card-inbox__last-text">{line.text.slice(line.text.indexOf(' '))} · </span>
              <button type="button" className="card-inbox__last-undo" disabled={!session.canUndo} onMouseDown={(e) => e.preventDefault()} onClick={() => void review.undo()}>
                Undo <KeyCaps keys="⌘Z" />
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
