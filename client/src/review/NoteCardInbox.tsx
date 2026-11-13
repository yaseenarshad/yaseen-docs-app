/**
 * THE INBOX SCREEN (YAZ-4962, D11, D18; idea 14): the due cards one at a time, Mochi style — a calm card in the
 * middle, in the Explore window's look, over the tab stack. The page under it never renders for it. Read-only: the
 * card is `renderNoteCard`, the page's own render. The session is `useCardReview`'s (YAZ-4967): this screen draws it.
 *
 *  - THE INBOX IS A TAB (YAZ-5011): App draws this screen for the window's Inbox tab, over the tab stack. Behind a page
 *    tab it stays mounted, hidden (`shown` false), so it comes back at its card and step; hidden, it hears no key. It
 *    closes as any tab does (its ✕, ⌘W): no × of its own, and Esc does not close it.
 *  - Head: the card ID first, small and grey (a click copies it, D20; its place in the page's card and the card window
 *    too), the chip "Up next ×" for a card at the top of the Inbox (YAZ-4999 D3), the page's name (O), "3 of 12". No card title: the card is right below it.
 *  - SPACE (D18): each Space shows the NEXT hidden word, in page order. When the side showing has none left, the next
 *    Space shows the next side, whose hidden words then show one by one. The answer buttons show from the moment the
 *    card shows (YAZ-5010, Yaseen: "Should always be there"): `showAnswers()` fixes what each one writes then (the
 *    hover is the truth, D13), and 1–2 / 1–4 answer at any step.
 *  - The buttons (D5): Forgot · Remembered, or Again · Hard · Good · Easy, by the setting; the hover says when the
 *    card comes back ("Remembered · 9 days").
 *  - The keys (`noteCardInboxKeys.ts`): Space, 1–2 / 1–4 (at any step, YAZ-5010), ⌘Z, O (the page on top, landed on
 *    the card; Esc there comes back to this card at the same step), E (YAZ-5003: the CARD WINDOW on top, in Edit card;
 *    Done, Esc or ⌘↵ there saves and comes back to this card at the same step; nothing in a read-only vault, where
 *    Edit card is blocked as in the page), ← → (YAZ-5004: the card before or after, no answer), ⌘↵ (the page in a
 *    background tab: the review stays), Esc (only the ⋯ row; then the Esc order goes on, YAZ-5011). A key typed in a field, or while a dialog or a menu
 *    is open (Explore is a dialog), is not the Inbox's; a key with the keyboard elsewhere (the sidebar) neither.
 *  - Under the card, OUTSIDE its frame, as in Mochi (YAZ-5002): the answer buttons; the key hint row last, at the bottom.
 *    No "Press Space" line over the buttons (YAZ-5021): the key row already says Space.
 *  - The buttons row (YAZ-5004, as in Mochi): ← → on its left, the answers in the middle, ⋯ on its right. ⋯ opens a
 *    small row of icons, each with the app's hover box (its name and key): Undo last review (⌘Z), Turn review off,
 *    Put at top of Inbox / Remove from top of Inbox, Open card. They are the hook's own actions.
 *  - The hint row shows a key only while it does something; the digits are on the buttons.
 *  - No Reviews section (YAZ-5000: it lives only under the card in the page, and in the card window). Nothing left: "Inbox complete." for the vault; for one page or
 *    folder "This page is done." and, quiet, "21 more in the Inbox", which starts the vault's review.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { answerLabel, answerRatings } from '@shared/cardSchedule'
import { cardSides, hiddenCount } from '@shared/cardText'
import type { GestureAction } from '@shared/keys'
import type { ExploreVault } from '../explore/ExploreNote'
import type { CardReviewApi, CardReviewSession } from './useCardReview'
import { NoteCardBody, NoteCardId, NoteCardNextChip, noteCardWait } from './noteCardParts'
import { noteCardInboxHints, noteCardInboxKey } from './noteCardInboxKeys'
import { HoverTip } from '../components/HoverTip'
import '../explore/explore.css'

export interface NoteCardInboxProps {
  /** The Inbox tab is the one on show (YAZ-5011); false: behind a page tab, hidden, and deaf to keys. Default true. */
  shown?: boolean
  review: CardReviewApi
  session: CardReviewSession
  vaultOf: (path: string) => ExploreVault
  nameOf: (path: string) => string
  /** The page on top as an Explore layer, landed on card `index` (O). */
  openPage: (path: string, index: number, edit: boolean) => void
  /** The card window on top (⋯ › Open card); `edit` in Edit card (E, YAZ-5003). */
  openCard: (path: string, id: string, index: number, edit: boolean) => void
  /** ⌘↵: the page in a background tab. */
  openInTab: (path: string) => void
  /** A link's bound gesture (⌘-click): App's link door. */
  openLinkIn: (path: string, where: GestureAction) => void
  /** A plain click on a link in the card: the page on top. */
  openLayer: (path: string) => void
  onNotice: (message: string) => void
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
  const card = session.card
  const text = card?.page?.text ?? null
  const cardKey = card === null ? null : `${session.position}\n${card.path}\n${card.id}`

  // The sides and their hidden words, once per card text.
  const counts = useMemo(() => (text === null ? [] : cardSides(text).map(hiddenCount)), [text])
  const [stepState, setStep] = useState<Step>({ key: cardKey, sides: 1, shown: 0 })
  const step = stepState.key === cardKey ? stepState : { key: cardKey, sides: 1, shown: 0 }
  // A card that goes and comes back (⌘Z after the last answer) starts again from its first step.
  useEffect(() => setStep((s) => (s.key === cardKey ? s : { key: cardKey, sides: 1, shown: 0 })), [cardKey])
  const hiddenUpTo = (sides: number): number => counts.slice(0, sides).reduce((a, b) => a + b, 0)
  const done = text !== null && step.sides >= counts.length && step.shown >= hiddenUpTo(counts.length)

  // The buttons show with the card (YAZ-5010): their reviews are fixed now, so the hover and the write agree (D13). Again after a delete re-reads the card.
  const { showAnswers } = review
  useEffect(() => {
    if (text !== null && session.answers === null) showAnswers()
  }, [text, session.answers, showAnswers])

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
      if (key.kind === 'move') {
        if (key.delta < 0 ? session.canBack : session.canNext) review.move(key.delta)
        return
      }
      if (key.kind === 'answer') {
        // At any step (YAZ-5010): the buttons show from the moment the card shows.
        const rating = ratings[key.button]
        if (card.page !== null && rating !== undefined && !event.repeat) void review.answer(rating)
        return
      }
      if (key.kind === 'open') return openPage(card.path, card.index, false)
      // E edits only the card (YAZ-5003): the card window in Edit card. Read only blocks Edit card, as in the page.
      if (key.kind === 'edit') {
        if (!vaultOf(card.path).readOnly) openCard(card.path, card.id, card.index, true)
        return
      }
      if (key.kind === 'tab') return openInTab(card.path)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, openPage, openCard, openInTab, vaultOf])

  const doors = useMemo(() => ({ openLayer, openTab: openLinkIn, onNotice }), [openLayer, openLinkIn, onNotice])
  // The rest of the vault, after a review of one page or one folder: the way on.
  const more = session.scope === 'vault' ? 0 : review.dueCount
  const hints = noteCardInboxHints({ card: card !== null, answering: done, canUndo: session.canUndo, editable: card !== null && !vaultOf(card.path).readOnly, moves: session.canBack || session.canNext })
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
      <div className="note-card-inbox__column">
        <div className="note-card-inbox__panel">
          <div className="explore__head note-card-inbox__head">
            {/* YAZ-5012: the page first, on the left (O opens it), then the ID in brackets, small and grey (a click copies it);
                no card title: the card is right below (say each thing once). A long page name gives way before the ID. */}
            {card === null ? (
              <span className="explore__title">{session.label}</span>
            ) : (
              <>
                <button type="button" className="note-card-strip__page note-card-inbox__page" onMouseDown={(e) => e.preventDefault()} onClick={() => openPage(card.path, card.index, false)}>
                  {nameOf(card.path)}
                </button>
                <NoteCardId id={card.id} onNotice={onNotice} brackets />
                {card.page?.next === true && <NoteCardNextChip onRemove={() => void review.setNext(card.path, card.id, false)} />}
                <span className="note-card-inbox__place">
                  {session.position} of {session.total}
                </span>
              </>
            )}
          </div>
          <div className="note-card-inbox__body">
            {card === null ? (
              <div className="note-card-inbox__done" role="status">
                {session.scope === 'vault' ? (
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
                <div className="note-card note-card-screen note-card-inbox__card" onClick={(e) => e.target instanceof Element && e.target.closest('a[href], [data-note-card-link]') === null && advance()}>
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
              {session.answers !== null &&
                session.answers.map((a, i) => {
                  const label = answerLabel(a.review.rating, review.settings)
                  // The app's own hover box (a native title shows nothing in the app, YAZ-4772): when the card comes back.
                  const comesBack = `${label} · ${noteCardWait(a.interval)}`
                  return (
                    <HoverTip key={a.review.rating} text={comesBack}>
                      <button type="button" className="explore__button note-card-inbox__answer" data-rating={a.review.rating} aria-description={comesBack} onMouseDown={(e) => e.preventDefault()} onClick={() => void review.answer(a.review.rating)}>
                        {label}
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
        <div className="explore__foot note-card-inbox__hints" aria-hidden="true">
          {hints.map((h) => (
            <span key={h.label}>
              <kbd>{h.keys}</kbd> {h.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
