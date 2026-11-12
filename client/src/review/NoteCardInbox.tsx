/**
 * THE INBOX SCREEN (YAZ-4962, D11, D18; idea 14): the due cards one at a time, Mochi style — a calm card in the
 * middle, in the Explore window's look, over the tab stack. The page under it never renders for it. Read-only: the
 * card is `renderNoteCard`, the page's own render. The session is `useCardReview`'s (YAZ-4967): this screen draws it.
 *
 *  - Head: the card title, the card ID small and grey (a click copies it, D20), "3 of 12", the page's name, ×.
 *  - SPACE (D18): each Space shows the NEXT hidden word, in page order. When the side showing has none left, the next
 *    Space shows the next side, whose hidden words then show one by one. After the last step the answer buttons show,
 *    and `showAnswers()` fixes what each one writes then (the hover is the truth, D13). A card with one side and no
 *    hidden word shows its buttons at once.
 *  - The buttons (D5): Forgot · Remembered, or Again · Hard · Good · Easy, by the setting; the hover says when the
 *    card comes back ("Remembered · 9 days").
 *  - The keys (`noteCardInboxKeys.ts`): Space, 1–2 / 1–4 (once the buttons show), ⌘Z, O (the page on top, landed on
 *    the card; Esc there comes back to this card at the same step), E (the same, in edit), ⌘↵ (the page in a
 *    background tab: the review stays), Esc (the review closes). A key typed in a field, or while a dialog or a menu
 *    is open (Explore is a dialog), is not the Inbox's; a key with the keyboard elsewhere (the sidebar) neither.
 *  - Under the card, "Reviews (n)", closed (silence). Nothing left: "Inbox complete."
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { answerLabel, answerRatings } from '@shared/cardSchedule'
import { cardSides, cardTitle, hiddenCount } from '@shared/cardText'
import type { GestureAction } from '@shared/keys'
import type { ExploreVault } from '../explore/ExploreNote'
import type { CardReviewApi, CardReviewSession } from './useCardReview'
import { NoteCardBody, NoteCardId, NoteCardReviews, noteCardWait } from './noteCardParts'
import { noteCardInboxHints, noteCardInboxKey } from './noteCardInboxKeys'
import { HoverTip } from '../components/HoverTip'
import '../explore/explore.css'

export interface NoteCardInboxProps {
  review: CardReviewApi
  session: CardReviewSession
  vaultOf: (path: string) => ExploreVault
  nameOf: (path: string) => string
  /** The page on top as an Explore layer, landed on card `index`; `edit` in edit mode (O and E). */
  openPage: (path: string, index: number, edit: boolean) => void
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

/** The step a card is at (D18): how many sides show, and how many hidden words, in page order over the card. */
interface Step {
  key: string | null
  sides: number
  shown: number
}

export function NoteCardInbox({ review, session, vaultOf, nameOf, openPage, openInTab, openLinkIn, openLayer, onNotice }: NoteCardInboxProps) {
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

  // The buttons show: their reviews are fixed now, so the hover and the write agree (D13). Again after a delete re-reads the card.
  const { showAnswers } = review
  useEffect(() => {
    if (done && session.answers === null) showAnswers()
  }, [done, session.answers, showAnswers])

  // The keyboard comes to the Inbox when it opens and with each card; back from the Explore stack, App gives it back here.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [cardKey])

  const ratings = answerRatings(review.settings)
  const live = useRef({ step, done, counts, card, session, review, ratings })
  live.current = { step, done, counts, card, session, review, ratings }

  /** One Space (D18): the next hidden word of the sides showing, else the next side. */
  const advance = useCallback(() => {
    const { step, done, counts, card } = live.current
    if (done || card?.page == null) return
    const before = counts.slice(0, step.sides).reduce((a, b) => a + b, 0)
    setStep(step.shown < before ? { ...step, shown: step.shown + 1 } : { ...step, sides: step.sides + 1 })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isInboxKeyTarget(event, rootRef.current)) return
      const key = noteCardInboxKey(event)
      if (key === null) return
      const { done, card, session, review, ratings } = live.current
      event.preventDefault()
      event.stopPropagation()
      if (key.kind === 'close') return review.close()
      if (key.kind === 'undo') {
        if (session.canUndo && !event.repeat) void review.undo()
        return
      }
      if (card === null) return
      if (key.kind === 'step') return advance()
      if (key.kind === 'answer') {
        const rating = ratings[key.button]
        if (done && rating !== undefined && !event.repeat) void review.answer(rating)
        return
      }
      if (key.kind === 'open' || key.kind === 'edit') return openPage(card.path, card.index, key.kind === 'edit')
      if (key.kind === 'tab') return openInTab(card.path)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, openPage, openInTab])

  const doors = useMemo(() => ({ openLayer, openTab: openLinkIn, onNotice }), [openLayer, openLinkIn, onNotice])
  const title = text === null ? '' : cardTitle(text)

  return (
    <div ref={rootRef} className="note-card-inbox" tabIndex={-1} role="region" aria-label={session.label === 'Inbox' ? 'Inbox' : `Review: ${session.label}`}>
      <div className="note-card-inbox__panel">
        <div className="explore__head note-card-inbox__head">
          {card === null ? (
            <span className="explore__title">{session.label}</span>
          ) : (
            <>
              <span className="explore__title" title={card.path}>
                {title}
              </span>
              <NoteCardId id={card.id} onNotice={onNotice} />
              <span className="note-card-inbox__place">
                {session.position} of {session.total}
              </span>
              <button type="button" className="note-card-strip__page" title="Open the page at this card (O)" onMouseDown={(e) => e.preventDefault()} onClick={() => openPage(card.path, card.index, false)}>
                {nameOf(card.path)}
              </button>
            </>
          )}
          <button type="button" className="explore__button" onMouseDown={(e) => e.preventDefault()} onClick={review.close} title="Close the review (Esc)" aria-label="Close the review">
            ×
          </button>
        </div>
        <div className="note-card-inbox__body">
          {card === null ? (
            <div className="note-card-inbox__done" role="status">
              <p className="note-card-inbox__done-title">{session.label === 'Inbox' ? 'Inbox complete.' : `${session.label}: done.`}</p>
              <p className="note-card-inbox__done-line">Nothing else is due today. Enjoy your day!</p>
            </div>
          ) : (
            text !== null &&
            card.page !== null && (
              <>
                <div className="note-card note-card-screen note-card-inbox__card" onClick={(e) => e.target instanceof Element && e.target.closest('a[href], [data-note-card-link]') === null && advance()}>
                  <NoteCardBody text={text} path={card.path} vault={vaultOf(card.path)} show={{ sides: step.sides, shown: step.shown }} doors={doors} />
                </div>
                {done && session.answers !== null && (
                  <div className="note-card-inbox__answers">
                    {session.answers.map((a, i) => {
                      const label = answerLabel(a.review.rating, review.settings)
                      // The app's own hover box (a native title shows nothing in the app): when the card comes back.
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
                )}
                <NoteCardReviews key={cardKey ?? ''} reviews={card.page.reviews} settings={review.settings} onDelete={(at) => void review.deleteReview(card.path, card.id, at)} defaultOpen={false} />
              </>
            )
          )}
        </div>
        <div className="explore__foot note-card-inbox__hints" aria-hidden="true">
          {noteCardInboxHints(ratings.length)
            .filter((h) => card !== null || h.keys === 'Esc' || (h.keys === '⌘Z' && session.canUndo))
            .map((h) => (
              <span key={h.label}>
                <kbd>{h.keys}</kbd> {h.label}
              </span>
            ))}
        </div>
      </div>
    </div>
  )
}
