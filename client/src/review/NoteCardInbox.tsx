/**
 * THE INBOX SCREEN (YAZ-4962, D11, D18; idea 14): the due cards one at a time, Mochi style — a calm card in the
 * middle, in the Explore window's look, over the tab stack. The page under it never renders for it. Read-only: the
 * card is `renderNoteCard`, the page's own render. The session is `useCardReview`'s (YAZ-4967): this screen draws it.
 *
 *  - THE INBOX IS A TAB (YAZ-5011): App draws this screen for the window's Inbox tab, over the tab stack. Behind a page
 *    tab it stays mounted, hidden (`shown` false), so it comes back at its card and step; hidden, it hears no key. It
 *    closes as any tab does (its ✕, ⌘W): no × of its own, and Esc does not close it.
 *  - The top row (YAZ-5017, `NoteCardInboxBar`): the filter "All cards ▾" (All cards, Due today, New cards, with counts),
 *    where the cards come from (the vault, "Folder / Sub", the page), and "3 of 12" of the filter's cards on the right.
 *  - Above the card, outside its frame (YAZ-5027): the state chip (YAZ-5018, as Mochi's: "New card", "Due today",
 *    "Due · 3 days ago"). Head: the page's name (O), the card ID in brackets, small and grey (a click copies it, D20), the chip "Up next ×"
 *    for a card at the top of the Inbox (YAZ-4999 D3). No card title: the card is right below it.
 *  - SPACE (D18): each Space shows the NEXT hidden word, in page order. When the side showing has none left, the next
 *    Space shows the next side, whose hidden words then show one by one. The answer buttons show from the moment the
 *    card shows (YAZ-5010, Yaseen: "Should always be there"): `showAnswers()` fixes what each one writes then (the
 *    hover is the truth, D13), and 1–2 / 1–4 answer at any step.
 *  - The buttons (D5): ✕ Forgot · ✓ Remembered, or ↺ Again · ~ Hard · ✓ Good · ⇈ Easy, by the setting, round as
 *    Mochi's (YAZ-5018); the hover says when the card comes back ("Remembered · 9 days"; "Forgot · later today" while
 *    the answer keeps it in its same-day steps, YAZ-5020: it comes back at the end of this session).
 *  - The keys (`noteCardInboxKeys.ts`): Space, 1–2 / 1–4 (at any step, YAZ-5010), ⌘Z, O (the page on top, at its top,
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
 *    small row of icons, each with the app's hover box (its name and key): Undo last review (⌘Z), Turn review off,
 *    Put at top of Inbox / Remove from top of Inbox, Open card. They are the hook's own actions.
 *  - THE ANSWER'S TOAST (YAZ-5025): each answer that lands shows the app's toast, "✓ Remembered · back in 9 days",
 *    with Undo — the hook's own undo, as ⌘Z — and it fades as the app's Undo toasts do. A new answer replaces it.
 *    It shows only once the session counts the answer (`answered` one longer): a failed write shows its own error.
 *  - The hint row shows a key only while it does something; the digits are on the buttons. It is ONE line at any width
 *    (YAZ-5024, `NoteCardInboxHints`): ⌘↵ folds first, then O; Space and E stay.
 *  - THE WIDTH (YAZ-5019): the card's left or right edge drags it wider or narrower, centred (`inboxCardWidth.ts`): at
 *    least 420 px, at most the tab's width less its margins; the width stays for the app's run, in memory only.
 *  - No Reviews section (YAZ-5000: it lives only under the card in the page, and in the card window). Nothing left: "Inbox complete." for the vault; for one page or
 *    folder "This page is done." and, quiet, "21 more in the Inbox", which starts the vault's review.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { answerLabel, answerRatings } from '@shared/cardSchedule'
import { cardSides, hiddenCount } from '@shared/cardText'
import type { GestureAction } from '@shared/keys'
import type { CardRating } from '@shared/cardLine'
import type { ExploreVault } from '../explore/ExploreNote'
import type { CardReviewApi, CardReviewSession } from './useCardReview'
import { NoteCardBody, NoteCardId, NoteCardNextChip, noteCardWait } from './noteCardParts'
import { noteCardInboxHints, noteCardInboxKey } from './noteCardInboxKeys'
import { NOTE_CARD_MEDIA, NOTE_CARD_OPENS, stopCardAudio, textHasAudio, toggleCardAudio } from '../editor/noteCard/noteCardMedia'
import { HoverTip } from '../components/HoverTip'
import type { NoticeAction, NoticeKind, NoticeType } from '../lib/notice'
import { CARD_FILTERS, NoteCardInboxBar } from './NoteCardInboxBar'
import { NoteCardStateChip, answerIcon, answerToast } from './noteCardInboxChip'
import { useInboxCardWidth } from './inboxCardWidth'
import { NoteCardInboxHints } from './NoteCardInboxHints'
import '../explore/explore.css'

export interface NoteCardInboxProps {
  /** The Inbox tab is the one on show (YAZ-5011); false: behind a page tab, hidden, and deaf to keys. Default true. */
  shown?: boolean
  review: CardReviewApi
  session: CardReviewSession
  vaultOf: (path: string) => ExploreVault
  nameOf: (path: string) => string
  /** O and the page name: the page on top as an Explore layer, at its TOP (YAZ-5022: no scroll to the card). */
  openPage: (path: string) => void
  /** The card window on top (⋯ › Open card); `edit` in Edit card (E, YAZ-5003). */
  openCard: (path: string, id: string, index: number, edit: boolean) => void
  /** ⌘↵: the page in a background tab. */
  openInTab: (path: string) => void
  /** A link's bound gesture (⌘-click): App's link door. */
  openLinkIn: (path: string, where: GestureAction) => void
  /** A plain click on a link in the card: the page on top. */
  openLayer: (path: string) => void
  /** App's toast. The answer's toast (YAZ-5025) gives a kind, a type and its Undo; other notices are the text alone. */
  onNotice: (message: string, icon?: NoticeKind, type?: NoticeType, action?: NoticeAction) => void
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
/** The ⋯ row's icons (YAZ-5004): undo, an archive box (review off), up to the top, a card window. */
const ICON_UNDO = icon('M6 4 3 7l3 3M3 7h7a3 3 0 0 1 0 6H8')
const ICON_OFF = icon('M2.5 3.5h11v3h-11zM3.5 6.5v6h9v-6M6.5 9h3')
const ICON_TOP = icon('M3 2.5h10M8 13.5V5.5M5 8.5l3-3 3 3')
const ICON_CARD = icon('M2.5 3.5h11v9h-11zM2.5 6.5h11')

/** The step a card is at (D18): how many sides show, and how many hidden words, in page order over the card. */
interface Step {
  key: string | null
  sides: number
  shown: number
}

export function NoteCardInbox({ shown = true, review, session, vaultOf, nameOf, openPage, openCard, openInTab, openLinkIn, openLayer, onNotice }: NoteCardInboxProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const { width, startDrag } = useInboxCardWidth(columnRef, rootRef)
  const card = session.card
  const text = card?.page?.text ?? null
  const cardKey = card === null ? null : `${session.position}\n${card.path}\n${card.id}`

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
  const live = useRef({ step, done, counts, card, session, review, ratings, moreOpen, shown })
  live.current = { step, done, counts, card, session, review, ratings, moreOpen, shown }

  // The answer's toast (YAZ-5025): its words fixed when the answer is given, shown once the session counts it.
  const toast = useRef<{ text: string; count: number } | null>(null)
  const answerWith = useCallback((rating: CardRating) => {
    const { session, review } = live.current
    // The answers as the hook fixed them (a digit can come before the buttons show: they are fixed now, as `answer` would).
    const fixed = (session.answers ?? review.showAnswers())?.find((a) => a.review.rating === rating)
    toast.current = fixed === undefined ? null : { text: answerToast(rating, fixed.interval, review.settings), count: session.answered.length }
    void review.answer(rating)
  }, [])
  const answeredCount = session.answered.length
  useEffect(() => {
    const pending = toast.current
    if (pending === null || answeredCount !== pending.count + 1) return
    toast.current = null
    onNotice(pending.text, 'info', 'undo', { label: 'Undo', run: () => void live.current.review.undo(), fades: true })
  }, [answeredCount, onNotice])
  useEffect(() => {
    if (!moreOpen) return
    const away = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || event.target.closest('.note-card-inbox__more') === null) setMore(null)
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
      const key = noteCardInboxKey(event)
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
        if (!event.repeat) toggleCardAudio(rootRef.current?.querySelector('.note-card-inbox__card') ?? null)
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
      if (key.kind === 'open') return openPage(card.path)
      // E edits only the card (YAZ-5003): the card window in Edit card, in every vault (YAZ-5009, Yaseen: "e should go
      // directly into edit mode"). A read-only vault unlocks this card's text alone, for this edit (`ExploreCard`).
      if (key.kind === 'edit') return openCard(card.path, card.id, card.index, true)
      if (key.kind === 'tab') return openInTab(card.path)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, answerWith, openPage, openCard, openInTab])

  const doors = useMemo(() => ({ openLayer, openTab: openLinkIn, onNotice }), [openLayer, openLinkIn, onNotice])
  // The rest of the vault, after a review of one page or one folder: the way on.
  const more = session.scope === 'vault' ? 0 : review.dueCount
  const hints = noteCardInboxHints({ card: card !== null, answering: done, canUndo: session.canUndo, moves: session.canBack || session.canNext, audio: text !== null && textHasAudio(cardSides(text).slice(0, step.sides).join('\n')) })
  /** The ⋯ row's actions (YAZ-5004): the hook's own, with their names and keys for the hover box. */
  const moreActions =
    card === null
      ? []
      : [
          { id: 'undo', label: 'Undo last review', keys: '⌘Z', icon: ICON_UNDO, disabled: !session.canUndo, run: () => void review.undo() },
          { id: 'off', label: 'Turn review off', icon: ICON_OFF, disabled: card.page === null, run: () => void review.turnOff() },
          card.page?.next === true
            ? { id: 'next', label: 'Remove from top of Inbox', icon: ICON_TOP, disabled: false, run: () => void review.setNext(card.path, card.id, false) }
            : { id: 'next', label: 'Put at top of Inbox', icon: ICON_TOP, disabled: card.page === null, run: () => void review.setNext(card.path, card.id, true) },
          { id: 'card', label: 'Open card', icon: ICON_CARD, disabled: false, run: () => openCard(card.path, card.id, card.index, false) },
        ]

  return (
    <div ref={rootRef} className="note-card-inbox" hidden={!shown} tabIndex={-1} role="region" aria-label={session.label === 'Inbox' ? 'Inbox' : `Review: ${session.label}`}>
      <NoteCardInboxBar session={session} setFilter={review.setFilter} />
      <div ref={columnRef} className="note-card-inbox__column" style={width === null ? undefined : { width: `min(${width}px, 100%)` }}>
        {/* YAZ-5027: the state chip sits right above the card, outside its frame, on the left. The row keeps its height
            with no chip (the done screen), so the card does not move; the page name always starts at the head's left. */}
        <div className="note-card-inbox__above">{card !== null && <NoteCardStateChip card={card} />}</div>
        <div className="note-card-inbox__panel">
          {/* The card's edges (YAZ-5019): a drag of either sizes the card, centred. */}
          <div className="note-card-inbox__edge" data-side="left" role="separator" aria-orientation="vertical" aria-label="Card width" onPointerDown={startDrag(-1)} />
          <div className="note-card-inbox__edge" data-side="right" role="separator" aria-orientation="vertical" aria-label="Card width" onPointerDown={startDrag(1)} />
          <div className="explore__head note-card-inbox__head">
            {/* YAZ-5012: the page first, on the left (O opens it), then the ID in brackets, small and grey (a click copies it);
                no card title: the card is right below (say each thing once). A long page name gives way before the ID. */}
            {card === null ? (
              <span className="explore__title">{session.label}</span>
            ) : (
              <>
                <button type="button" className="note-card-strip__page note-card-inbox__page" onMouseDown={(e) => e.preventDefault()} onClick={() => openPage(card.path)}>
                  {nameOf(card.path)}
                </button>
                <NoteCardId id={card.id} onNotice={onNotice} brackets />
                {card.page?.next === true && <NoteCardNextChip onRemove={() => void review.setNext(card.path, card.id, false)} />}
              </>
            )}
          </div>
          <div className="note-card-inbox__body">
            {card === null ? (
              <div className="note-card-inbox__done" role="status">
                {session.filter !== 'all' && session.counts.all > 0 ? (
                  // The filter's cards are done, others are left (YAZ-5017): the way back to All cards.
                  <>
                    <p className="note-card-inbox__done-title">{session.filter === 'due' ? 'No due cards left.' : 'No new cards left.'}</p>
                    <button type="button" className="note-card-inbox__done-more" onMouseDown={(e) => e.preventDefault()} onClick={() => review.setFilter('all')}>
                      {session.counts.all} more in {CARD_FILTERS[0].label}
                    </button>
                  </>
                ) : session.scope === 'vault' ? (
                  <>
                    <p className="note-card-inbox__done-title">Inbox complete.</p>
                    <p className="note-card-inbox__done-line">Nothing else is due today. Enjoy your day!</p>
                  </>
                ) : (
                  <>
                    <p className="note-card-inbox__done-title">{session.scope === 'page' ? 'This page is done.' : 'This folder is done.'}</p>
                    {more > 0 ? (
                      <button type="button" className="note-card-inbox__done-more" onMouseDown={(e) => e.preventDefault()} onClick={() => review.start({})}>
                        {more} more in the Inbox
                      </button>
                    ) : (
                      <p className="note-card-inbox__done-line">Nothing else is due today. Enjoy your day!</p>
                    )}
                  </>
                )}
              </div>
            ) : (
              text !== null &&
              card.page !== null && (
                <div className="note-card note-card-screen note-card-inbox__card" onClick={(e) => e.target instanceof Element && e.target.closest(`a[href], ${NOTE_CARD_OPENS}, ${NOTE_CARD_MEDIA}`) === null && advance()}>
                  <NoteCardBody text={text} path={card.path} vault={vaultOf(card.path)} show={{ sides: step.sides, shown: step.shown }} doors={doors} />
                </div>
              )
            )}
          </div>
        </div>
        {/* Under the card, outside its frame, as in Mochi (YAZ-5002): the answer buttons, then the keys. No "Press Space"
            line between them (YAZ-5021): the key row at the bottom already says Space. */}
        {card !== null && (
          <div className="note-card-inbox__actions">
            <div className="note-card-inbox__moves">
              <HoverTip text="Previous card (←)">
                <button type="button" className="explore__button note-card-inbox__move" aria-label="Previous card" disabled={!session.canBack} onMouseDown={(e) => e.preventDefault()} onClick={() => review.move(-1)}>
                  ←
                </button>
              </HoverTip>
              <HoverTip text="Next card (→)">
                <button type="button" className="explore__button note-card-inbox__move" aria-label="Next card" disabled={!session.canNext} onMouseDown={(e) => e.preventDefault()} onClick={() => review.move(1)}>
                  →
                </button>
              </HoverTip>
            </div>
            <div className="note-card-inbox__answers">
              {/* YAZ-5029: the buttons are the setting's, always there — never only once the card's answers are fixed, so
                  fast ← → never takes them away for a frame. The hover says when the card comes back once it is known. */}
              {ratings.map((rating, i) => {
                const a = session.answers?.find((x) => x.review.rating === rating)
                const label = answerLabel(rating, review.settings)
                // The app's own hover box (a native title shows nothing in the app, YAZ-4772): when the card comes back.
                const comesBack = a === undefined ? label : `${label} · ${noteCardWait(a.interval, a.inSteps)}`
                return (
                  <HoverTip key={rating} text={comesBack}>
                    <button type="button" className="explore__button note-card-inbox__answer" data-rating={rating} aria-description={comesBack} onMouseDown={(e) => e.preventDefault()} onClick={() => live.current.card?.page != null && answerWith(rating)}>
                      {answerIcon(rating, review.settings.buttons)}
                      <span className="note-card-inbox__answer-label">{label}</span>
                      <kbd>{i + 1}</kbd>
                    </button>
                  </HoverTip>
                )
              })}
            </div>
            <div className="note-card-inbox__more">
              {moreOpen && (
                <div className="note-card-inbox__more-row" role="toolbar" aria-label="Card actions">
                  {moreActions.map((a) => (
                    <HoverTip key={a.id} text={a.keys === undefined ? a.label : `${a.label} (${a.keys})`}>
                      <button
                        type="button"
                        className="explore__button note-card-inbox__more-action"
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
                <button type="button" className="explore__button note-card-inbox__more-button" aria-label="More" aria-expanded={moreOpen} onMouseDown={(e) => e.preventDefault()} onClick={() => setMore(moreOpen ? null : cardKey)}>
                  ⋯
                </button>
              </HoverTip>
            </div>
          </div>
        )}
        <NoteCardInboxHints hints={hints} />
      </div>
    </div>
  )
}
