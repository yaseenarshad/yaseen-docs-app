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
 *    part a link with its icon (YAZ-5132: the one breadcrumb; `openPlace`: the folder page; the page as O), and Mochi's "✕ 2 · 4 / 6" on the right (YAZ-5674).
 *  - Above the card, outside its frame (YAZ-5027): the state chip (YAZ-5018, as Mochi's: "New card", "Due today",
 *    "Due · 3 days ago"), then THE HEAD: the card ID small and grey (a click copies it, D20). A card in a page says its
 *    page in the top row's ONE breadcrumb (YAZ-5132: no "in <page>" here), whose page part opens it as O does. Then the chip "Up next ×" for a card at the top of the Inbox (YAZ-4999 D3). A card of more than one
 *    side says "Side 1 of 2" on the row's right (YAZ-5048), and the key row's Space says "Next side" when the next Space shows a side.
 *  - SCROLL (YAZ-5049): round 6 (Yaseen: "certain space clicks that are actually oriented towards just moving the
 *    screen"): a Space that shows never scrolls, so the word just shown stays still to study. When what it would show is
 *    out of view — the marked blank not wholly between the top row and the buttons (round 5), the next side's place
 *    under the card low in the view, or at the end the card's end (the Reviews strip) — that Space only glides it in,
 *    and the next Space shows (or, at the end, gives the answer buttons a soft ring). A click on a blank shows it, a
 *    click on a shown word hides it again; a mouse never scrolls. Never centred. Round 2
 *    (as Mochi): the card is one long page — no scroll bar of its own; the Inbox's view scrolls, the top row stays on
 *    top and the buttons at the bottom — and a word that reaches the view's lower third comes up to its upper third,
 *    so what comes next shows (`inboxScroll.ts`).
 *  - THE TITLE BAND (YAZ-5308 A3): the title sits in the band at the top of the card's frame (`CardBand`), with no label;
 *    a card with no title has none. A click renames a card in a page; a card file's title (YAZ-5037) is a link, and it
 *    and O open it in Explore (YAZ-5145, "Open card").
 *  - TITLE IN REVIEW: NEVER (YAZ-5696; the card line's `notitle`, YAZ-5030): the title is on the card line (YAZ-5308), never in
 *    the text, so it is never a Space step. YAZ-5695 (Yaseen: "it should never show up in reviews. Period."): no band
 *    at any step, fully shown too, and the answer line names the card by its ID (`reviewTitleOf`).
 *  - WHEN A TITLE SHOWS (YAZ-5696): Never, Always, After the first click or Before Side 2 (YAZ-5709: the title then has its own Space) — the card's own choice
 *    (⋯ › Title in review, its line's `title-click`…), else Settings › Cards › Show card titles (`bandTitle`,
 *    `titleShows`). While it waits the band keeps its room, empty to the eye and to VoiceOver, so the card never jumps.
 *  - SPACE (D18): each Space shows the NEXT hidden word, in page order. When the side showing has none left, the next
 *    Space shows the next side, whose hidden words then show one by one. The answer buttons show from the moment the
 *    card shows (YAZ-5010, Yaseen: "Should always be there"): `showAnswers()` fixes what each one writes then (the
 *    hover is the truth, D13), and 1–2 / 1–4 answer at any step.
 *  - The buttons (D5): ✕ Forgot · ✓ Remembered, or ↺ Again · ~ Hard · ✓ Good · ⇈ Easy, by the setting, round as
 *    Mochi's (YAZ-5018); the hover says when the card comes back ("Remembered · 9 days"; "Forgot · later today" when
 *    the card comes back in this session: a ✕, or a new card's first ✓, YAZ-5702).
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
 *    same step. The title and "in <page>" links and ⋯ › Open card open as O does.
 *  - P (YAZ-5014): plays or stops the first sound of the sides that show. Nothing plays by itself; the next card (an
 *    answer, ← →, ⌘Z), a hidden Inbox and its close stop it. "P Play" is in the hint row only while a side that shows
 *    has a sound. A board's picture (YAZ-5015) opens the board on top; Esc there comes back to this card and step.
 *  - Under the card, OUTSIDE its frame, as in Mochi (YAZ-5002): the answer buttons; the key hint row last, at the bottom.
 *    YAZ-5431 (as Mochi): that whole block — ← →, the buttons, ⋯, the last answer's line, the key row — is ONE band pinned
 *    to the bottom of the Inbox, so it never moves for a short or long card, a Space, or the next card; a long card
 *    scrolls above it and ends just over it. The end screens (YAZ-5043) keep their button in the card's place.
 *    No "Press Space" line over the buttons (YAZ-5021): the key row already says Space.
 *  - FAST ← → (YAZ-5029): the buttons are the setting's, always mounted, the same size from card to card; only their
 *    hover waits for the card's answers. The hook reads the cards around this one ahead and keeps the card before on show
 *    until the next one's text is ready, so the card never empties and nothing under it moves.
 *  - The buttons row (YAZ-5004, as in Mochi): ← → on its left, the answers in the middle, ⋯ on its right. ⋯ opens the
 *    ONE card menu (YAZ-5697 round 2, `cardMenuView.ts`): Undo last review (⌘Z), then the card's Inbox rows — Open card,
 *    Move to Up next / Remove from Up next, Archive card (YAZ-5046; it asks first), Title in review ›.
 *  - THE LAST ANSWER'S LINE (YAZ-5025 round 2; no toast): one quiet line, centred under the answer buttons, "✓ Remembered ·
 *    DEMO-51 · back in 9 days · Undo ⌘Z" (YAZ-5433: the card's title alone, its ID with no title; all grey, a Forgot's ✕ only red), in the button hover's words. It stays until the next answer
 *    replaces it; its Undo is the hook's own undo, as ⌘Z; an undo clears it. It shows only once the session counts the
 *    answer (`answered` one longer): a failed write shows its own error. The row keeps its height empty (YAZ-5029).
 *  - The hint row shows a key only while it does something; the digits are on the buttons. It is ONE line at any width
 *    (YAZ-5024, `CardInboxHints`): ⌘↵ folds first, then O; Space and E stay.
 *  - THE WIDTH (YAZ-5019): the card's left or right edge drags it wider or narrower, centred (`inboxCardWidth.ts`): at
 *    least 420 px, at most the tab's width less its margins; the width stays for the app's run, in memory only.
 *  - HOW LONG EACH ANSWER TOOK (YAZ-5033, `answerTimer.ts`): the timer starts when a card shows (again when ⌘Z shows
 *    it again), pauses while the Inbox is not in front and over any stretch of "Pause the timer after" with no key or
 *    mouse; the answer writes its active seconds on its review part (`… good 13s`). The cards menu's last line
 *    says "Today: 21 cards" (YAZ-5690, `session.today`, from the index); the done screen says the same words with the
 *    time, "Today: 21 cards · 9 min" (YAZ-5710, one Today line).
 *    TIME SO FAR (YAZ-5130; YAZ-5689 in the top row's View panel, `ReviewViewButton`): behind a "Show" by default, or
 *    shown, or off, by Settings › Review › Time so far, DURING the review: every finish screen shows the time
 *    (YAZ-5665, `DoneScreen`). The timer and the saved seconds do not change with it.
 *  - REVIEWS AT THE BOTTOM OF THE LAST SIDE (YAZ-5105, as Mochi; it amends YAZ-5000, which took them out of the Inbox):
 *    a card with reviews has the Reviews strip ("✓ 4 Reviews") right under the card, outside its frame (round 2): the
 *    card window's own `CardReviews`, closed until asked for, with no delete here. Round 3: it shows as soon as the
 *    LAST side shows, its hidden words shown or not (a one-side card: after its first Space, or at once with nothing
 *    hidden). Never on the front or an earlier side. It is no Space step, and the scroll never goes to it; the buttons' band
 *    stays at the bottom of the view over it.
 *  - Nothing left: "Inbox complete." for the vault; for one page or folder "This page is done." and, quiet, "21 more in
 *    the Inbox", which starts the vault's review. The vault done while cards are still due (a new day began during the
 *    review; YAZ-5623, the phone's rule, `reviewMoreCount`): "Review 12 more", which starts it again.
 *  - ADD MORE FOR TODAY (YAZ-5042, Yaseen: "instead of having to go settings"): the done screen says what waits past
 *    today's number, "38 new cards and 3 Up next cards wait for another day.", with one button for each kind, "Add 10
 *    new cards" and "Add 2 Up next" (the first added card shows at once); a filter's done screen has its own kind's
 *    button; nothing waiting, the screen is as before. The cards menu has the same Add (`CardInboxBar`). The add's
 *    line takes the last answer's line, "+ Added 10 new cards for today · Undo ⌘Z": its Undo, and ⌘Z, take the add
 *    back while it is the last thing done (the hook's own undo).
 *  - TO FIX (YAZ-5097, "Fix later") never shows in the Inbox (YAZ-5430, Yaseen: "As long as to fix doesn't show up in
 *    the inbox"): no To fix row, no Fix later in ⋯, no "To fix" on the head. A marked card stays in review. The mark
 *    shows on the card everywhere else (a page, an embed, its file tab, Explore) and in the Cards table's Card fix status.
 *  - ARCHIVED cards are not listed here (YAZ-5319): a folder page's table shows them (+ › Card table, Status
 *    is Archived), and a card's ⋯ menu unarchives it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { CourseOffer, type CourseOfferProps } from '../course/CourseOffer'
import { answerLabel, answerRatings, type AddKind } from '@shared/cardSchedule'
import { cardSides } from '@shared/cardText'
import { reviewTitleOf, withCardTitle } from '@shared/cardLine'
import { PageTitle } from '../editor/PageTitle'
import { savedZoom, saveZoom, zoomByKey } from '../editor/DocumentZoom'
import { ReviewViewButton } from './ReviewViewButton'
import { ZOOM_EVENT } from '../editor/zoomRequest'
import type { ZoomStep } from '@shared/types'
import { changeCardLine } from './cardFile'
import { recordAt } from '../editor/card/embedCard'
import type { GestureAction } from '@shared/keys'
import type { InboxOpenAt } from '@shared/types'
import type { CardRating } from '@shared/cardLine'
import type { ExploreVault } from '../explore/ExplorePage'
import type { CardReviewApi, CardReviewSession } from './useCardReview'
import { CardBand, CardId, CardNextChip, CardStrip, cardWait } from './cardParts'
import { CardSideCount, InboxCardFace, InboxCardPanel, bandTitle, bandTitleStep, useCardFront, useCardSteps, useStepScroll } from './inboxCard'
import { cardInboxHints, cardInboxKey } from './cardInboxKeys'
import { textHasAudio, toggleCardAudio } from '../editor/card/cardMedia'
import { HoverTip } from '../components/HoverTip'
import { ContextMenu } from '../sidebar/ContextMenu'
import type { MenuSection } from '../sidebar/menuSections'
import { cardMarksOf, cardMenuSections } from './cardMenuView'
import type { NoticeAction, NoticeKind, NoticeType } from '../lib/notice'
import { CardInboxBar } from './CardInboxBar'
import { AnswerLine, CardAgainChip, CardStateChip, answerIcon, answerWords, showsAgain, type AnswerWords } from './cardInboxChip'
import { cardColumnStyle, useInboxCardWidth } from './inboxCardWidth'
import { CardInboxHints } from './CardInboxHints'
import { KeyLabel } from '../keys/KeyLabel'
import { AddMoreField } from './AddMoreField'
import { newCardsFrom, useNewCardsPicker } from './NewCardsPicker'
import { ChevronIcon } from './cardInboxIcons'
import { useAnswerTimer } from './answerTimer'
import { DoneScreen, type DoneLook } from './DoneScreen'
import { LearnedToast } from './LearnedToast'
import '../explore/explore.css'
import { useUnit } from '../vault/unitWord'
import { tourEvent } from '../course/tourBus'
import { addedLine, resetLine } from './cardWords'
import type { CardPlace } from '../editor/card/cardOpen'

/** How long "Archived · Undo" stays under the buttons (YAZ-5621): the phone's `UNDO_SHOWN_MS`. */
const ARCHIVED_SHOWN_MS = 4000

/** The finish screens' look on the Mac (`DoneScreen`, YAZ-5665): the Inbox's own classes; the confetti over the window. */
const DONE_LOOK: DoneLook = { title: 'card-inbox__done-title', line: 'card-inbox__done-line', more: 'card-inbox__done-more', today: 'card-inbox__done-today', go: 'due-end__go' }

/** Where the Inbox's zoom is kept (YAZ-5372): `savedZoom`, localStorage. */
const INBOX_ZOOM_KEY = 'inbox:zoom'

export interface CardInboxProps {
  /** The Inbox tab is the one on show (YAZ-5011); false: behind a page tab, hidden, and deaf to keys. Default true. */
  shown?: boolean
  review: CardReviewApi
  session: CardReviewSession
  vaultOf: (path: string) => ExploreVault
  /**
   * The card look of the vault that holds a card (YAZ-5484, `review/cardLook.ts`): its CSS variables, on the Inbox's
   * root while its card shows, so the card draws with ITS vault's look. Absent: `.app`'s (the app's look).
   */
  cardVarsOf?: (path: string) => CSSProperties
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
  /** The breadcrumb bubble's Show in sidebar (YAZ-5713): the App's own Show in sidebar. */
  showInSidebar?: (path: string) => void
  /** Focus mode (YAZ-5375, App's, remembered): on, the tab row hides while the Inbox shows. The bar's button, F and Esc change it. */
  focusMode?: boolean
  onFocusMode?: (on: boolean) => void
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


/** The last answer's line (YAZ-5025 round 2): its words, its answer, and the session's answer count with it. */
interface LastAnswer {
  words: AnswerWords
  rating: CardRating
  count: number
}

// The done screen's words moved to `cardWords.ts` (YAZ-5078), so the phone's Review screen says them too.
export { addedLine, resetLine, waitingLine } from './cardWords'

export function CardInbox({ shown = true, review, session, vaultOf, cardVarsOf, openPage: openFile, openAt = 'top', editCard, openInTab, openLinkIn, openLayer, onNotice, openPlace, showInSidebar, focusMode = false, onFocusMode, courseOffer }: CardInboxProps) {
  const unit = useUnit()
  const rootRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const card = session.card
  const pageText = card?.page?.text ?? null
  // The Inbox's card (YAZ-5152: shared with the Preview, `inboxCard.tsx`): the front, and the head's title off the card
  // line (YAZ-5308), which waits for the last step where it is hidden on the front (YAZ-5030).
  const { text, title: headTitle } = useCardFront(pageText, card?.page ?? { title: '' }, review.settings.titleAt)
  // A card FILE (YAZ-5037): "Open card" in the key row, and no "in <page>". One look in the index the vault already holds.
  const cardFile = card !== null && recordAt(vaultOf(card.path).wikilinks.records, card.path)?.kind === 'card'
  // A card that comes back (YAZ-5594: the same card again) is a new turn: the answers so far tell the two apart.
  const cardKey = card === null ? null : `${session.answered.length}\n${card.path}\n${card.id}`
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
  // Time so far (YAZ-5130): the View panel's Time row (YAZ-5689), behind a "Show" by default.
  const time = review.settings.timeSoFar

  // Space's steps (D18, YAZ-5048, YAZ-5049, YAZ-5105 round 3) and the scroll that follows them: the Inbox's card,
  // shared with the Preview (YAZ-5152, `inboxCard.tsx`). The card's sound stops with the card and a hidden Inbox.
  const steps = useCardSteps(text, cardKey, rootRef, bandTitleStep(headTitle, card?.page?.titleAt, review.settings.titleAt))
  const { counts, step, done, nextSide, onLastSide } = steps
  // YAZ-5696: when the band's title shows (the card's own choice, else Settings › Cards › Show card titles).
  const band = bandTitle(headTitle, card?.page?.titleAt, review.settings.titleAt, steps)
  const bodyRef = useRef<HTMLDivElement>(null)
  useStepScroll(steps, shown, rootRef)

  // The buttons show with the card (YAZ-5010): their reviews are fixed now, so the hover and the write agree (D13). Again after a delete re-reads the card.
  // The page object, not its text (YAZ-5029): a card read again with the same text is a new page, and fixes again.
  const { showAnswers } = review
  const page = card?.page ?? null
  useEffect(() => {
    if (page !== null && session.answers === null) showAnswers()
  }, [page, session.answers, showAnswers])

  /**
   * THE INBOX'S ZOOM (YAZ-5372): the page zoom's own pill (in the top row's View panel, YAZ-5689) and key ladder (`DocumentZoom`), and its own rule: the Inbox
   * carries `--document-zoom` as a page's scroller does, so the whole card scales as a page does (app.css) — its text,
   * title band, sides, pictures, spacing and width (Card width × zoom, capped by the window). The bar, the head and the
   * buttons stay. One value for the Inbox, kept across restarts (`inbox:zoom` in localStorage).
   * ⌘+ / ⌘− / ⌘0 while the Inbox shows are its own (they zoomed the sidebar): unclaimed by a page or Explore (Explore
   * stops them on the document first), and not pressed from the sidebar or the right panel, which keep theirs.
   */
  const [zoom, setZoomState] = useState(() => savedZoom(INBOX_ZOOM_KEY))
  const setZoom = useCallback((next: number) => {
    setZoomState(next)
    saveZoom(INBOX_ZOOM_KEY, next)
  }, [])
  useEffect(() => {
    if (!shown) return
    const onZoom = (event: Event) => {
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('.sidebar, .right-panel') !== null)) return
      event.preventDefault()
      setZoomState((was) => {
        const next = zoomByKey(was, (event as CustomEvent<ZoomStep>).detail)
        saveZoom(INBOX_ZOOM_KEY, next)
        return next
      })
    }
    document.addEventListener(ZOOM_EVENT, onZoom)
    return () => document.removeEventListener(ZOOM_EVENT, onZoom)
  }, [shown])
  // The card's width (YAZ-5019), kept at 100%: a drag under the zoom sets it as at 100%.
  const { width, startDrag } = useInboxCardWidth(columnRef, rootRef, zoom / 100)

  // The keyboard comes to the Inbox when it opens and with each card; back from the Explore stack, App gives it back here.
  useEffect(() => {
    if (shown) rootRef.current?.focus({ preventScroll: true })
  }, [cardKey, shown])

  const ratings = answerRatings(review.settings)
  // The ⋯ row (YAZ-5004): open or closed; it closes with the card, Esc and a press outside it.
  const [moreState, setMore] = useState<string | null>(null)
  const [moreAt, setMoreAt] = useState<{ x: number; y: number } | null>(null)
  const moreOpen = moreState !== null && moreState === cardKey
  const live = useRef({ steps, card, session, review, ratings, moreOpen, shown, answerSeconds, cardFile, focusMode, onFocusMode })
  live.current = { steps, card, session, review, ratings, moreOpen, shown, answerSeconds, cardFile, focusMode, onFocusMode }

  // The last answer's line (YAZ-5025 round 2): its words fixed when the answer is given, shown once the session counts
  // it (`count`: the session's answers with it), and only while that answer is still the session's last (an undo clears it).
  const pendingLine = useRef<LastAnswer | null>(null)
  const [lastLine, setLastLine] = useState<LastAnswer | null>(null)
  const answerWith = useCallback((rating: CardRating) => {
    const { session, review, card, answerSeconds } = live.current
    // The answers as the hook fixed them (a digit can come before the buttons show: they are fixed now, as `answer` would).
    const fixed = (session.answers ?? review.showAnswers())?.find((a) => a.review.rating === rating)
    // The card by its title (YAZ-5030); a title hidden in review never shows (YAZ-5695): its ID.
    const title = card?.page == null ? '' : reviewTitleOf(card.page, review.settings.titleAt)
    pendingLine.current = fixed === undefined || card === null ? null : { words: answerWords(rating, card.id, fixed.interval, fixed.comesBack, review.settings, title), rating, count: session.answered.length + 1 }
    void review.answer(rating, answerSeconds())
  }, [])
  const answeredCount = session.answered.length
  useEffect(() => {
    const pending = pendingLine.current
    if (pending === null || answeredCount !== pending.count) return
    pendingLine.current = null
    setLastLine(pending)
  }, [answeredCount])
  // YAZ-5621: Archive card is on the Undo stack, as on the phone (YAZ-5078). While it is the last thing done, the
  // answer's line goes (its Undo would take back the archive), and "Archived · Undo ⌘Z" shows for the phone's 4
  // seconds; ⌘Z and ⋯'s Undo still take the archive back after that.
  const [archivedAt, setArchivedAt] = useState<object | null>(null)
  useEffect(() => {
    if (archivedAt === null) return
    const id = setTimeout(() => setArchivedAt((a) => (a === archivedAt ? null : a)), ARCHIVED_SHOWN_MS)
    return () => clearTimeout(id)
  }, [archivedAt])
  const archived = session.lastArchive != null
  const answerLineNow = lastLine !== null && answeredCount === lastLine.count && session.answered[answeredCount - 1] === lastLine.rating ? lastLine : null
  const line = archived ? null : answerLineNow
  const archivedLine = archived && archivedAt !== null && session.lastAdd === null

  /** One Space (D18): the next hidden word of the sides showing, else the next side. */
  // THE END's cue (YAZ-5049 round 3, Yaseen: "there is no way to know they have hit the end"): the hint row has
  // dropped Space, and one more Space moves nothing but gives the answer buttons one soft ring — where to go now.
  // A new value each time, so the ring plays again; none on the next card.
  const [nudge, setNudge] = useState<{ key: string | null; n: number }>({ key: null, n: 0 })
  // Round 4: `by` says what asked — a key may scroll instead of a step (round 6), a mouse never moves the view.
  // The steps are the shared card's (`useCardSteps`); at the end, with the end in view, a key rings the buttons.
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
      const { card, session, review, ratings, moreOpen, focusMode, onFocusMode } = live.current
      // Esc closes the ⋯ row (YAZ-5011), else leaves focus mode (YAZ-5375): the Inbox is a tab, so with neither the key
      // goes on down the Esc order.
      if (key.kind === 'close' && !moreOpen && !(focusMode && onFocusMode !== undefined)) return
      if (key.kind === 'focus' && onFocusMode === undefined) return
      event.preventDefault()
      event.stopPropagation()
      if (key.kind === 'close') return moreOpen ? setMore(null) : onFocusMode?.(false)
      // F (YAZ-5375): focus mode on or off, on the done screen too.
      if (key.kind === 'focus') return event.repeat ? undefined : onFocusMode?.(!focusMode)
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
  // YAZ-5322: the new cards' pill ends "from [Spanish ▾]" (where they really come from: "All folders" in the
  // fallback); ▾ opens the cards menu's folder picker and changes the same saved pick. Up next never picks folders.
  const picker = useNewCardsPicker(review, session)
  const fromButton = (
    <button type="button" className="card-inbox__done-from" aria-haspopup="dialog" aria-expanded={picker.isOpen} onMouseDown={(e) => e.preventDefault()} onClick={(e) => (picker.isOpen ? picker.close() : picker.open(e.currentTarget, 'below'))}>
      {'from '}
      <span className="card-inbox__done-from-box">
        <span className="card-inbox__done-from-name">{newCardsFrom(session)}</span>
        <ChevronIcon />
      </span>
    </button>
  )
  const addButtons =
    addKinds.length === 0 ? null : (
      <div className="card-inbox__done-adds">
        {/* Round 2: the same field as the cards menu's, "Add [10] new cards"; the number starts at the Settings number. */}
        {addKinds.map((k) => (
          <AddMoreField key={k} kind={k} look="done" start={session.adds[k]} onAdd={(n) => review.addCards(k, n)} after={k === 'new' ? fromButton : undefined} />
        ))}
        {picker.picker}
      </div>
    )
  /** The band's rename (YAZ-5164 part 3): the title on the card's line (YAZ-5308), one write; the Inbox reads the card again. */
  const retitle = (path: string, id: string, next: string): void => {
    changeCardLine(path, id, (l) => withCardTitle(l, next)).catch((err: unknown) => onNotice(`Can't rename the card: ${err instanceof Error ? err.message : String(err)}`))
  }
  const hints = cardInboxHints({ card: card !== null, cardFile, answering: done, canUndo: session.canUndo, moves: session.canBack || session.canNext, audio: text !== null && textHasAudio(cardSides(text).slice(0, step.sides).join('\n')), nextSide, lineUndo: session.lastAdd !== null || archivedLine || line !== null })
  /**
   * The ⋯ (YAZ-5004): Undo last review, then the ONE card menu's Inbox rows (YAZ-5697 round 2: Open card, Move to Up next
   * (YAZ-5697), Archive card, Title in review ›; no Fix later, YAZ-5430). Archive card asks first, then goes on the hook's
   * Undo stack (YAZ-5621); the other marks are the hook's own writes.
   */
  const moreSections = (): MenuSection[] =>
    card === null
      ? []
      : cardMenuSections({
          marks: cardMarksOf(card.page === null ? null : { ...card.page, id: card.id }),
          path: card.path,
          upNext: true,
          fix: false,
          copyId: null,
          change: (change) => void review.setMark(card.path, card.id, change),
          onNotice,
          openCard: () => openCard(card, cardFile),
          first: { id: 'undo', label: 'Undo last review', hint: '⌘Z', disabled: !session.canUndo, onSelect: () => void review.undo() },
          runOwn: (item) => {
            if (item.action === 'off' && item.on === true) {
              setArchivedAt({})
              void review.turnOff()
              return true
            }
            if (item.action === 'next') {
              void review.setNext(card.path, card.id, item.on === true)
              return true
            }
            return false
          },
        })

  return (
    <div ref={rootRef} className="card-inbox" hidden={!shown} tabIndex={-1} role="region" aria-label={session.label === 'Inbox' ? 'Inbox' : `Review: ${session.label}`} style={{ ...(card !== null && cardVarsOf?.(card.path)), '--document-zoom': zoom / 100 } as CSSProperties}>
      <CardInboxBar
        session={session}
        setFilter={review.setFilter}
        addCards={review.addCards}
        resetCards={review.resetCards}
        openPlace={(part) => (part.kind === 'page' ? (card !== null && part.path === card.path ? openCard(card, cardFile) : openFile(part.path)) : openPlace?.(part.path))}
        showInSidebar={card !== null && showInSidebar !== undefined ? () => showInSidebar(card.path) : undefined}
        pick={review}
        view={<ReviewViewButton seconds={session.today.seconds} time={time} zoom={zoom} setZoom={setZoom} focusMode={focusMode} onFocusMode={onFocusMode} />}
      />
      <div ref={columnRef} className="card-inbox__column" style={cardColumnStyle(width)}>
        {/* YAZ-5027: the state chip sits right above the card, outside its frame, on the left. The row keeps its height
            with no chip (the done screen), so the card does not move. YAZ-5051 (Yaseen: "so that the card is just pure"):
            the head sits here too, after the chip — the ID (a click copies it) — with "Up next ×"; the title is in the
            card's band (YAZ-5308 A3). YAZ-5132: no "in <page>": the top row's breadcrumb ends with the page. A long name gives way first. */}
        <div className="card-inbox__above">
          {card !== null && (
            <>
              <CardStateChip card={card} />
              {/* YAZ-5626 (the phone's YAZ-5594): a card back after a Forgot says so, "Again", beside its state. */}
              {showsAgain(card) && <CardAgainChip />}
              <span className="card-inbox__head">
                <CardId id={card.id} onNotice={onNotice} />
                {card.page?.next === true && <CardNextChip onRemove={() => void review.setNext(card.path, card.id, false)} />}
              </span>
            </>
          )}
          {/* YAZ-5048: a card of more than one side says where you are, quietly, on the right; one side says nothing. */}
          {card !== null && text !== null && <CardSideCount steps={steps} />}
        </div>
        {/* The card's frame and its width edges (YAZ-5019), shared with the Preview (YAZ-5152). */}
        <InboxCardPanel
          startDrag={startDrag}
          bodyRef={bodyRef}
          band={
            card !== null &&
            headTitle !== '' && (
              // The title band at the top of the card's frame (YAZ-5308 A3), no label. A card file's title opens its tab; a
              // card in a page's is the page title's own component, a click renames the card (its card line), as in the
              // page's card (YAZ-5164 part 3). In a Read only vault it shows only.
              <CardBand waiting={band.waits}>
                {band.waits ? (
                  <span className="card-inbox__name">{headTitle}</span>
                ) : cardFile ? (
                  <button type="button" className="card-inbox__name card-inbox__name--link" onMouseDown={(e) => e.preventDefault()} onClick={() => openFile(card.path)}>
                    {headTitle}
                  </button>
                ) : card.page !== null && vaultOf(card.path).readOnly !== true ? (
                  <span className="card-inbox__name">
                    <PageTitle path={card.path} titles={NO_TITLES} text={headTitle} onRetitle={(next) => retitle(card.path, card.id, next)} />
                  </span>
                ) : (
                  <span className="card-inbox__name">{headTitle}</span>
                )}
              </CardBand>
            )
          }
        >
            {card === null ? (
              <div className="card-inbox__done" role="status">
                <DoneScreen
                  review={review}
                  session={session}
                  shown={shown}
                  look={DONE_LOOK}
                  addKinds={addKinds}
                  adds={addButtons}
                  from={
                    <>
                      {fromButton}
                      {picker.picker}
                    </>
                  }
                  unit={unit}
                  offer={courseOffer !== undefined ? <CourseOffer {...courseOffer} /> : undefined}
                />
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
        {card?.page != null && onLastSide && <CardStrip key={cardKey} reviews={card.page.reviews} settings={review.settings} properties={{ values: card.page.properties ?? {} }} />}
        {/* Under the card, outside its frame, as in Mochi (YAZ-5002): the answer buttons, then the keys. No "Press Space"
            line between them (YAZ-5021): the key row at the bottom already says Space. */}
        {/* YAZ-5049 round 2: the buttons and their line stay at the bottom of the view while a long card scrolls under them.
            YAZ-5431 (Yaseen, as Mochi: "if the card is more or less it doesn't change or jump"): the band, keys and all, is
            at the bottom of the Inbox for every card, short or long — under a short card too, with the room left above it. */}
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
                const comesBack = a === undefined ? label : `${label} · ${cardWait(a.interval, a.comesBack)}`
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
              {moreOpen && moreAt !== null && <ContextMenu x={moreAt.x} y={moreAt.y} sections={moreSections()} onClose={() => setMore(null)} />}
              <HoverTip text="More">
                <button type="button" className="explore__button card-inbox__more-button" data-tour="card-menu" aria-label="More" aria-expanded={moreOpen} onMouseDown={(e) => e.preventDefault()} onClick={(e) => {
                    const box = e.currentTarget.getBoundingClientRect()
                    setMoreAt({ x: box.left, y: box.bottom + 4 })
                    setMore(moreOpen ? null : cardKey)
                  }}>
                  ⋯
                </button>
              </HoverTip>
            </div>
          </div>
        )}
        {/* The last answer's line (YAZ-5025 round 2): centred under the buttons; the row keeps its height when empty. */}
        <div className="card-inbox__last" role="status" aria-live="polite" data-rating={session.lastAdd === null ? line?.rating : undefined} data-kind={session.lastAdd !== null ? 'add' : archivedLine ? 'archive' : undefined}>
          {session.lastAdd !== null ? (
            // YAZ-5042: the add (round 2: or the Reset), while it is the last thing done; its Undo is the hook's undo, as ⌘Z.
            <>
              <span className="card-inbox__last-mark">{session.lastAdd.reset ? '↺' : '+'}</span>
              <span className="card-inbox__last-text"> {session.lastAdd.reset ? resetLine(session.lastAdd.kind) : addedLine(session.lastAdd.kind, session.lastAdd.count)} · </span>
              <button type="button" className="card-inbox__last-undo" disabled={!session.canUndo} onMouseDown={(e) => e.preventDefault()} onClick={() => void review.undo()}>
                <KeyLabel action="Undo" keys="⌘Z" />
              </button>
            </>
          ) : archivedLine ? (
            // YAZ-5621: the phone's words, "Archived · Undo"; its Undo is the hook's undo, as ⌘Z.
            <>
              <span className="card-inbox__last-text">Archived · </span>
              <button type="button" className="card-inbox__last-undo" disabled={!session.canUndo} onMouseDown={(e) => e.preventDefault()} onClick={() => void review.undo()}>
                <KeyLabel action="Undo" keys="⌘Z" />
              </button>
            </>
          ) : (
            line !== null && (
              // YAZ-5693: the Mac's and the phone's one piece (`AnswerLine`).
              <AnswerLine
                words={line.words}
                base="card-inbox__last"
                undo={
                  <button type="button" className="card-inbox__last-undo" disabled={!session.canUndo} onMouseDown={(e) => e.preventDefault()} onClick={() => void review.undo()}>
                    <KeyLabel action="Undo" keys="⌘Z" />
                  </button>
                }
              />
            )
          )}
        </div>
        {/* YAZ-5431 (as Mochi): the key row is in the band too, so the whole block under the card stays at the bottom. */}
        <CardInboxHints hints={hints} />
        </div>
      </div>
      {/* YAZ-5679: Mochi's "Added card to reviews · Undo" when a new card is learned. */}
      <LearnedToast learned={session.learned} onUndo={() => void review.undo()} />
    </div>
  )
}
