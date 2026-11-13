/**
 * The pieces the card window (`explore/ExploreCard.tsx`) and the Inbox (`NoteCardInbox.tsx`) share (YAZ-4962): the
 * card drawn read-only (`renderNoteCard`, the page's own function) with its pills and links live, the grey card ID
 * that copies on a click (D20), and the Reviews section with the full table (D3, D13). The table is the page card's
 * too (`noteCardView.ts`, YAZ-5000); the Inbox has no Reviews section.
 */
import { useCallback, useContext, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { CardReview } from '@shared/cardLine'
import { answerLabel, cardHistory, cardState, dayCount, isCardDue, recallChance } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'
import type { GestureAction } from '@shared/keys'
import { api } from '../api'
import { noteCardLook } from '../editor/createCrepe'
import { copyText } from '../editor/linkMenu'
import { NOTE_CARD_BOARD_ATTR, NOTE_CARD_MEDIA, NOTE_CARD_OPENS } from '../editor/noteCard/noteCardMedia'
import { NOTE_CARD_LINK_ATTR, noteCardLinkWhere, refreshNoteCardLook, renderNoteCard, type NoteCardShow } from '../editor/noteCard/noteCardRender'
import { hrefTarget } from '../editor/pathPaste'
import { linkCard, linkPath } from '../editor/wikilink/wikilinkPlugin'
import { landOnCard, openCardWindow } from '../editor/noteCard/noteCardOpen'
import type { ExploreVault } from '../explore/ExploreNote'
import { storage } from '../lib/storage'
import { fileIconDecoration, IconsContext } from '../sidebar/FileIcon'
import { answerIcon } from './noteCardInboxChip'
import { DueTrayIcon, IntervalIcon, ReviewsIcon, TrashIcon } from './noteCardInboxIcons'
import '../editor/noteCard/noteCard.css'
import './noteCardScreens.css'

/** A date as the card screens say it: "Nov 21", with the year when it is not this year's. */
export function noteCardDate(ms: number, now = Date.now()): string {
  const date = new Date(ms)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' })
}

/**
 * A wait as the screens say it: "later today" for a card in its same-day steps (YAZ-5020: it comes back in this
 * session), "today" for 0, else "9 days".
 */
export const noteCardWait = (days: number, inSteps = false): string => (inSteps ? 'later today' : days === 0 ? 'today' : dayCount(days))

/** The card ID in a head (D20): small and grey, FIRST in the head; a click copies it. The page's card block has the same (`noteCardView.ts`). */
/** `brackets`: "(DEMO-59)", after the page name in the Inbox head (YAZ-5012); the click still copies the bare ID. */
export function NoteCardId({ id, onNotice, brackets = false }: { id: string; onNotice: (message: string) => void; brackets?: boolean }) {
  return (
    <button
      type="button"
      className="note-card__id"
      aria-label="Copy card ID"
      onMouseDown={(e) => {
        // Not the head's drag, and the keyboard stays where it is.
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={() => copyText(id, 'card ID', onNotice, undefined, true)}
    >
      {brackets ? `(${id})` : id}
    </button>
  )
}

/**
 * The "Up next" chip in a head (YAZ-4999 D3): the card is at the top of the Inbox. Its × removes the mark (`onRemove`).
 * The page's card block draws the same chip (`noteCardView.ts`).
 */
export function NoteCardNextChip({ onRemove }: { onRemove?: () => void }) {
  return (
    <span className="note-card__next">
      Up next
      {onRemove !== undefined && (
        <button
          type="button"
          className="note-card__next-remove"
          aria-label="Remove from top of Inbox"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </span>
  )
}

/** Where a link in a card goes: a page of the vault (on top, or in a tab by the bound gesture), or an address to the system. */
export interface NoteCardLinkDoors {
  /** A plain click on a page link: the page on top (an Explore layer). */
  openLayer: (path: string) => void
  /** A bound gesture (⌘-click by default): a tab, as the note's links. */
  openTab: (path: string, where: GestureAction) => void
  onNotice: (message: string) => void
}

interface NoteCardBodyProps {
  /** The card's raw Markdown. */
  text: string
  /** The page the card is on: its images and Markdown links resolve against it. */
  path: string
  vault: ExploreVault
  show?: NoteCardShow
  doors: NoteCardLinkDoors
}

/**
 * The card read-only (D11, D13): `renderNoteCard` into a box, drawn again when the text or the steps change, never per
 * render; an index change redraws only the pills (`refreshNoteCardLook`). A pill and a Markdown link open as the
 * page's do (idea 6, `noteCardLinkWhere`).
 */
export function NoteCardBody({ text, path, vault, show, doors }: NoteCardBodyProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const icons = useContext(IconsContext)
  const { root, wikilinks, viewOnlyLinks } = vault
  const sides = show?.sides
  const shown = show?.shown
  // `icons` is read at each draw; a change of the icon rules alone draws no card again (the preview panel's rule).
  const iconsRef = useRef(icons)
  iconsRef.current = icons
  const lookOf = useCallback(() => noteCardLook(wikilinks, viewOnlyLinks, { root, notePath: path }, { icon: (target, folder) => fileIconDecoration(iconsRef.current, target, folder) }), [wikilinks, viewOnlyLinks, root, path])
  useEffect(() => {
    boxRef.current?.replaceChildren(renderNoteCard(text, { sides, shown }, lookOf()))
  }, [text, sides, shown, lookOf])
  // The pills follow the index: on each snapshot only they draw again.
  const hasLink = text.includes('[[')
  useEffect(() => (hasLink ? wikilinks.subscribe(() => boxRef.current !== null && refreshNoteCardLook(boxRef.current, lookOf())) : undefined), [hasLink, wikilinks, lookOf])

  const doorsRef = useRef(doors)
  doorsRef.current = doors
  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null
    if (target === null || event.button !== 0) return
    const { openLayer, openTab, onNotice } = doorsRef.current
    // A sound's player is its own (YAZ-5014).
    if (target.closest(NOTE_CARD_MEDIA) !== null) return
    // A pill, or a board's picture (YAZ-5015): its board on top, as its link.
    const pill = target.closest<HTMLElement>(NOTE_CARD_OPENS)
    if (pill !== null) {
      event.preventDefault()
      event.stopPropagation()
      const where = noteCardLinkWhere(event, storage.getSettings()?.hotkeys)
      if (where === null) return
      const inner = pill.getAttribute(NOTE_CARD_LINK_ATTR) ?? pill.getAttribute(NOTE_CARD_BOARD_ATTR) ?? ''
      // A link to a note card (YAZ-5030): its card window on top; a tab gesture, its page there, landed on the card.
      const card = pill.hasAttribute(NOTE_CARD_LINK_ATTR) ? linkCard(inner, wikilinks) : null
      if (card !== null) {
        if (where === 'explore' || where === 'thisTab') return openCardWindow(card.path, card.id, card.index, event.currentTarget)
        landOnCard(card.path, card.id)
        return openTab(card.path, where)
      }
      const to = linkPath(inner, wikilinks, viewOnlyLinks)
      if (to === null) return onNotice(`"${inner}" is not in this vault`)
      if (where === 'explore' || where === 'thisTab') openLayer(to)
      else openTab(to, where)
      return
    }
    const link = target.closest<HTMLAnchorElement>('a[href]')
    if (link === null) return
    event.preventDefault()
    event.stopPropagation()
    const href = link.getAttribute('href') ?? ''
    const inApp = /^[a-z][a-z0-9+.-]*:/i.test(href) ? null : hrefTarget(href, { root, notePath: path, candidates: vault.wikilinkCandidates })
    if (inApp !== null) openLayer(inApp)
    else void api.shell.openLink({ href, sourcePath: path })
  }
  // A Markdown link never navigates the window.
  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('a[href]') !== null) event.preventDefault()
  }
  return <div ref={boxRef} className="note-card__body note-card-screen__body" onMouseDown={onMouseDown} onClick={onClick} />
}

interface NoteCardReviewsProps {
  reviews: readonly CardReview[]
  settings: ReviewSettings
  /** The table's delete of one review (its notice has Undo). Absent (a card with no ID yet): no delete. */
  onDelete?: (review: CardReview) => void
  now?: number
}

/** The next due date in words, the same in the table and the card window's strip: "Overdue · Oct 18" when that day is past, "Today", else the date. */
export function noteCardDue(due: number, now: number): string {
  const today = new Date(now).setHours(0, 0, 0, 0)
  return due < today ? `Overdue · ${noteCardDate(due, now)}` : isCardDue(due, now) ? 'Today' : noteCardDate(due, now)
}

/** The day `due` is past (the strip then says "Overdue · …" with no "Due" label). */
export const noteCardOverdue = (due: number, now: number): boolean => due < new Date(now).setHours(0, 0, 0, 0)

/** A date in full, as the Reviews table says it (YAZ-5032, as Mochi's): "Sep 24, 2026". */
export const noteCardFullDate = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** The toggle's words (YAZ-5032, as Mochi's): "1 Review", "4 Reviews". The page's card block says the same (`noteCardView.ts`). */
export const reviewsTitle = (n: number): string => `${n} Review${n === 1 ? '' : 's'}`

/** What review knows of a card, for the strip (YAZ-5032): its last answer, the wait it set, when it is due, the recall chance. Null for a new card. */
export interface NoteCardFactsData {
  last: CardReview
  interval: number
  inSteps: boolean
  due: number
  recall: number | null
}

export function noteCardFacts(reviews: readonly CardReview[], settings: ReviewSettings, now: number): NoteCardFactsData | null {
  const state = cardState(reviews, settings)
  const last = state.lastReview === null ? undefined : reviews.filter((r) => r.at === state.lastReview).at(-1)
  if (state.isNew || last === undefined || state.due === null) return null
  return { last, interval: state.interval, inSteps: state.inSteps, due: state.due, recall: recallChance(reviews, settings, now) }
}

/** An answer as its glyph (YAZ-5032): ✓ Remembered / ✕ Forgot (↺ ~ ✓ ⇈ with four buttons, YAZ-5018); the word is the hover. */
function NoteCardAnswer({ review, settings, hover }: { review: CardReview; settings: ReviewSettings; hover?: string }) {
  const word = answerLabel(review.rating, settings)
  return (
    <span className="note-card-answer" data-rating={review.rating} title={hover ?? word} aria-label={word} role="img">
      {answerIcon(review.rating, settings.buttons)}
    </span>
  )
}

/**
 * The quiet one-line strip (YAZ-5032, as Mochi's): the last answer's glyph · the interval ("20 DAYS") · the next due
 * date ("DEC 17") · the recall chance as a small badge ("100%"). Each fact's name is its hover. A fragment: the card
 * window's strip holds it after the page name; the page's card block holds it on the Reviews row, closed or open.
 */
export function NoteCardFacts({ reviews, settings, now = Date.now() }: { reviews: readonly CardReview[]; settings: ReviewSettings; now?: number }) {
  const facts = noteCardFacts(reviews, settings, now)
  if (facts === null) return null
  const { last, interval, inSteps, due, recall } = facts
  return (
    <>
      <span className="note-card-strip__fact note-card-strip__fact--answer">
        <NoteCardAnswer review={last} settings={settings} hover={`Last answer: ${answerLabel(last.rating, settings)}, ${noteCardDate(Date.parse(last.at), now)}`} />
      </span>
      <span className="note-card-strip__fact" title="Interval">
        <IntervalIcon />
        {noteCardWait(interval, inSteps)}
      </span>
      <span className="note-card-strip__fact" title="Next due" data-overdue={noteCardOverdue(due, now) || undefined}>
        <DueTrayIcon />
        {noteCardDue(due, now)}
      </span>
      {recall !== null && (
        <span className="note-card-strip__fact note-card-strip__recall" title="Chance to remember it now">
          {`${Math.round(recall * 100)}%`}
        </span>
      )}
    </>
  )
}

/**
 * "4 Reviews" (D3, D13, YAZ-5032): a toggle with a ✓, as Mochi's, CLOSED until asked for: the strip above it says the
 * state. Open, the full table (`NoteCardReviewsTable`). The card window has it; the page's card block draws the same
 * toggle and mounts the same table when opened (`noteCardView.ts`, YAZ-5000).
 */
export function NoteCardReviews({ reviews, settings, onDelete, now }: NoteCardReviewsProps) {
  const [open, setOpen] = useState(false)
  return (
    <section className="note-card-reviews">
      <div className="note-card-reviews__bar">
        <button type="button" className="backlinks__header note-card-reviews__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)} onMouseDown={(e) => e.preventDefault()}>
          <ReviewsIcon />
          <span className="backlinks__title">{reviewsTitle(reviews.length)}</span>
        </button>
      </div>
      {open && <NoteCardReviewsTable reviews={reviews} settings={settings} onDelete={onDelete} now={now} />}
    </section>
  )
}

/** "**4** days": the number bold, the unit muted (YAZ-5032, as Mochi's). */
function Days({ n }: { n: number }) {
  return (
    <>
      <b className="note-card-reviews__num">{n}</b> <span className="note-card-reviews__unit">{n === 1 ? 'day' : 'days'}</span>
    </>
  )
}

/**
 * The full table (D3, D13; the look is Mochi's, YAZ-5032): one row per review in time order — the answer's glyph, the
 * days since the review before ("**4** days"; blank for the first), the review date and the next due date in full
 * ("Sep 24, 2026"), a bin to delete — and a last, muted row for the review to come: the wait, the day it comes due,
 * "--", no delete. The history is replayed only here, so a closed section costs nothing but its count.
 */
export function NoteCardReviewsTable({ reviews, settings, onDelete, now = Date.now() }: NoteCardReviewsProps) {
  // One replay: each row is a review's step; the last row's step is the card's state.
  const rows = cardHistory(reviews, settings)
  const last = rows.at(-1)
  const next = last?.due ?? now
  return (
    <table className="note-card-reviews__table">
      <thead>
        <tr>
          <th>Answer</th>
          <th># of days</th>
          <th>Review date</th>
          <th>Next due</th>
          <th aria-label="Delete" />
        </tr>
      </thead>
      <tbody>
        {/* Keyed by place: two reviews in one minute are two rows (`withoutCardReview` takes the last of them). */}
        {rows.map((row, i) => (
          <tr key={i}>
            <td>
              <NoteCardAnswer review={row.review} settings={settings} />
            </td>
            <td>{i === 0 ? '' : <Days n={row.elapsed} />}</td>
            <td>{noteCardFullDate(Date.parse(row.review.at))}</td>
            <td>{noteCardFullDate(row.due)}</td>
            <td>
              {onDelete !== undefined && (
                <button type="button" className="note-card-reviews__delete" title="Delete this review" aria-label={`Delete the review of ${noteCardFullDate(Date.parse(row.review.at))}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onDelete(row.review)}>
                  <TrashIcon />
                </button>
              )}
            </td>
          </tr>
        ))}
        {/* The review to come: no answer yet; the wait, the day it comes due, no next due, no delete. */}
        <tr className="note-card-reviews__next">
          <td />
          <td>{last === undefined ? '' : last.inSteps ? 'later today' : <Days n={last.interval} />}</td>
          <td>{noteCardFullDate(next)}</td>
          <td>--</td>
          <td />
        </tr>
      </tbody>
    </table>
  )
}
