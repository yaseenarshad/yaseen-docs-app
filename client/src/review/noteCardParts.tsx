/**
 * The pieces the card window (`explore/ExploreCard.tsx`) and the Inbox (`NoteCardInbox.tsx`) share (YAZ-4962): the
 * card drawn read-only (`renderNoteCard`, the page's own function) with its pills and links live, the grey card ID
 * that copies on a click (D20), and the Reviews section with the full table (D3, D13). The table is the page card's
 * too (`noteCardView.ts`, YAZ-5000); the Inbox has no Reviews section.
 */
import { useCallback, useContext, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { CardReview } from '@shared/cardLine'
import { answerLabel, cardHistory, dayCount, isCardDue } from '@shared/cardSchedule'
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

/**
 * "Reviews (n)" (D3, D13): a section with a title, as "Linked mentions" is, CLOSED until asked for: the strip says the
 * state ("a footer lets the table expand", D13). Open, the full table (`NoteCardReviewsTable`). The card window has
 * it; the page's card block draws the same title and mounts the same table when opened (`noteCardView.ts`, YAZ-5000).
 */
export function NoteCardReviews({ reviews, settings, onDelete, now }: NoteCardReviewsProps) {
  const [open, setOpen] = useState(false)
  return (
    <section className="note-card-reviews">
      <button type="button" className="backlinks__header" aria-expanded={open} onClick={() => setOpen((o) => !o)} onMouseDown={(e) => e.preventDefault()}>
        <svg className="backlinks__chevron" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m4 6 4 4 4-4" />
        </svg>
        <span className="backlinks__title">
          Reviews <span className="backlinks__count">({reviews.length})</span>
        </span>
      </button>
      {open && <NoteCardReviewsTable reviews={reviews} settings={settings} onDelete={onDelete} now={now} />}
    </section>
  )
}

/**
 * The full table (D3, D13): one row per review in time order — Answer, Days (since the review before), Review date,
 * Next due, a delete — and a last row for the review to come: its due date under Next due ("Overdue · Oct 18" when
 * that day is past). The history is replayed only here, so a closed section costs nothing but its count.
 */
export function NoteCardReviewsTable({ reviews, settings, onDelete, now = Date.now() }: NoteCardReviewsProps) {
  // One replay: each row is a review's step; the last row's step is the card's state.
  const rows = cardHistory(reviews, settings)
  const last = rows.at(-1)
  const next = last?.due ?? now
  const nextDue = noteCardDue(next, now)
  return (
    <table className="note-card-reviews__table">
      <thead>
        <tr>
          <th>Answer</th>
          <th>Days</th>
          <th>Review date</th>
          <th>Next due</th>
          <th aria-label="Delete" />
        </tr>
      </thead>
      <tbody>
        {/* Keyed by place: two reviews in one minute are two rows (`withoutCardReview` takes the last of them). */}
        {rows.map((row, i) => (
          <tr key={i}>
            <td>{answerLabel(row.review.rating, settings)}</td>
            <td>{row.elapsed}</td>
            <td>{noteCardDate(Date.parse(row.review.at), now)}</td>
            <td>{noteCardDate(row.due, now)}</td>
            <td>
              {onDelete !== undefined && (
                <button type="button" className="comments__action comments__action--danger" aria-label={`Delete the review of ${noteCardDate(Date.parse(row.review.at), now)}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onDelete(row.review)}>
                  ×
                </button>
              )}
            </td>
          </tr>
        ))}
        {/* The review to come: no answer and no review date yet; when it is due. */}
        <tr className="note-card-reviews__next">
          <td>Next</td>
          <td>{last === undefined ? '' : last.interval}</td>
          <td />
          <td>{nextDue}</td>
          <td />
        </tr>
      </tbody>
    </table>
  )
}
