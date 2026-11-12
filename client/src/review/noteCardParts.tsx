/**
 * The pieces the card window (`explore/ExploreCard.tsx`) and the Inbox (`NoteCardInbox.tsx`) share (YAZ-4962): the
 * card drawn read-only (`renderNoteCard`, the page's own function) with its pills and links live, the grey card ID
 * that copies on a click (D20), and the Reviews section with the full table (D3, D13).
 */
import { useContext, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { CardReview } from '@shared/cardLine'
import { answerLabel, cardHistory, cardState, dayCount, isCardDue } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'
import type { GestureAction } from '@shared/keys'
import { api } from '../api'
import { noteCardLook } from '../editor/createCrepe'
import { linkClickAction } from '../editor/linkGesture'
import { copyText } from '../editor/linkMenu'
import { NOTE_CARD_LINK_ATTR, renderNoteCard, type NoteCardShow } from '../editor/noteCard/noteCardRender'
import { hrefTarget } from '../editor/pathPaste'
import { linkPath } from '../editor/wikilink/wikilinkPlugin'
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

/** A wait as the screens say it: "today" for 0 (Forgot brings the card back the same day), else "9 days". */
export const noteCardWait = (days: number): string => (days === 0 ? 'today' : dayCount(days))

/** The card ID in a head (D20): small and grey, after the title; a click copies it. The page's card block has the same (`noteCardView.ts`). */
export function NoteCardId({ id, onNotice }: { id: string; onNotice: (message: string) => void }) {
  return (
    <button
      type="button"
      className="note-card__id"
      title="Copy card ID"
      onMouseDown={(e) => {
        // Not the head's drag, and the keyboard stays where it is.
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={() => copyText(id, 'card ID', onNotice, undefined, true)}
    >
      {id}
    </button>
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
 * The card read-only (D11, D13): `renderNoteCard` into a box, drawn again when the text, the steps or the index (the
 * pills' labels) change, never per render. A pill and a Markdown link open as the page's do (idea 6, `linkClickAction`).
 */
export function NoteCardBody({ text, path, vault, show, doors }: NoteCardBodyProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const icons = useContext(IconsContext)
  const { root, wikilinks, viewOnlyLinks } = vault
  // The pills follow the index: a card with a link draws again on each snapshot.
  const [indexTick, setIndexTick] = useState(0)
  const hasLink = text.includes('[[')
  useEffect(() => (hasLink ? wikilinks.subscribe(() => setIndexTick((n) => n + 1)) : undefined), [hasLink, wikilinks])
  const sides = show?.sides
  const shown = show?.shown
  useEffect(() => {
    const box = boxRef.current
    if (box === null) return
    const look = noteCardLook(wikilinks, viewOnlyLinks, { root, notePath: path }, { icon: (target, folder) => fileIconDecoration(icons, target, folder) })
    box.replaceChildren(renderNoteCard(text, { sides, shown }, look))
    // `icons` is read at each draw; a change of the icon rules alone draws no card again (the preview panel's rule).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, sides, shown, path, root, wikilinks, viewOnlyLinks, indexTick])

  const doorsRef = useRef(doors)
  doorsRef.current = doors
  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null
    if (target === null || event.button !== 0) return
    const { openLayer, openTab, onNotice } = doorsRef.current
    const pill = target.closest<HTMLElement>(`[${NOTE_CARD_LINK_ATTR}]`)
    if (pill !== null) {
      event.preventDefault()
      event.stopPropagation()
      const where = linkClickAction({ editable: true }, event, storage.getSettings()?.hotkeys) ?? (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ? null : 'explore')
      if (where === null) return
      const inner = pill.getAttribute(NOTE_CARD_LINK_ATTR) ?? ''
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
  /** The table's delete: the review made at `at`. Absent (a card with no ID yet): no delete. */
  onDelete?: (at: string) => void
  /** Open when it mounts: the card window's; the Inbox's starts closed (silence). */
  defaultOpen: boolean
  now?: number
}

/**
 * "Reviews (n)" (D3, D13): the full table, one row per review in time order — Answer, Days (since the review before),
 * Review date, Next due, a delete — and a last row for the review to come (its due date, no answer). A section with
 * a title, as "Linked mentions" is: the card window has no second footer section, so no tab strip.
 */
export function NoteCardReviews({ reviews, settings, onDelete, defaultOpen, now = Date.now() }: NoteCardReviewsProps) {
  const [open, setOpen] = useState(defaultOpen)
  const rows = cardHistory(reviews, settings)
  const state = cardState(reviews, settings)
  const next = state.due ?? now
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
      {open && (
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
            {rows.map((row) => (
              <tr key={row.review.at}>
                <td>{answerLabel(row.review.rating, settings)}</td>
                <td>{row.elapsed}</td>
                <td>{noteCardDate(Date.parse(row.review.at), now)}</td>
                <td>{noteCardDate(row.due, now)}</td>
                <td>
                  {onDelete !== undefined && (
                    <button type="button" className="comments__action comments__action--danger" aria-label={`Delete the review of ${noteCardDate(Date.parse(row.review.at), now)}`} title="Delete this review" onMouseDown={(e) => e.preventDefault()} onClick={() => onDelete(row.review.at)}>
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {/* The review to come: its due date, no answer yet. */}
            <tr className="note-card-reviews__next">
              <td>Next</td>
              <td>{rows.length === 0 ? '' : state.interval}</td>
              <td>{isCardDue(next, now) ? 'Today' : noteCardDate(next, now)}</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </section>
  )
}
