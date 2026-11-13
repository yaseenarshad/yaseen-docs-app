/**
 * The pieces the card window (`explore/ExploreCard.tsx`) and the Inbox (`NoteCardInbox.tsx`) share (YAZ-4962): the
 * card drawn read-only (`renderNoteCard`, the page's own function) with its pills and links live, the grey card ID
 * that copies on a click (D20), and the Reviews section with the full table (D3, D13). The table is the page card's
 * too (`noteCardView.ts`, YAZ-5000); the Inbox has no Reviews section.
 */
import { useCallback, useContext, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { CardReview } from '@shared/cardLine'
import { answerLabel, cardHistory, cardState, dayCount, recallChance } from '@shared/cardSchedule'
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
import { reviewDuration } from './reviewTime'
import { ReviewsIcon, TrashIcon } from './noteCardInboxIcons'
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

/** The (i) of the recall chance (YAZ-5032): the strip's one help. */
export const RECALL_HELP = "FSRS's guess of your chance to remember this card today. It falls as the card waits."

/** Whole local days from today to the day of `ms`: 0 today, 1 tomorrow, -3 three days ago. */
const daysUntil = (ms: number, now: number): number => Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000)

/**
 * The review to come in words (YAZ-5032), the strip's and the table's last row: its date in full (none for today and
 * for a card in its same-day steps), and how far it is — "in 183 days", "3 days ago", "today", "later today".
 */
export function noteCardNextReview(due: number, inSteps: boolean, now: number): { date: string | null; days: number | null; when: string } {
  const days = daysUntil(due, now)
  // A step of a day gone by is overdue like any card: its date, and how long ago.
  if (inSteps && days >= 0) return { date: null, days: null, when: 'later today' }
  if (days === 0) return { date: null, days: 0, when: 'today' }
  const n = Math.abs(days)
  return { date: noteCardFullDate(due), days, when: days > 0 ? `in ${dayCount(n)}` : `${dayCount(n)} ago` }
}

/** "in **183** days": the number emphasised, the words muted (YAZ-5032). */
function When({ next }: { next: ReturnType<typeof noteCardNextReview> }) {
  if (next.days === null || next.days === 0) return <b className="note-card-strip__value">{next.when}</b>
  const n = Math.abs(next.days)
  const unit = n === 1 ? 'day' : 'days'
  return next.days > 0 ? (
    <>
      in <b className="note-card-strip__value">{n}</b> {unit}
    </>
  ) : (
    <>
      <b className="note-card-strip__value">{n}</b> {unit} ago
    </>
  )
}

const Dot = () => <span className="note-card-strip__dot"> · </span>

/**
 * The strip (YAZ-5032, Yaseen's pick): one calm line of words, no icons to guess — "Last: Remembered · Next review
 * Apr 28, 2027 (in 183 days) · 99% you remember it now". The values are emphasised, the words muted; the recall
 * chance alone has a small (i) (`RECALL_HELP`). An overdue date shows in red. A fragment of one span: the card
 * window's strip holds it after the page name; the page's card block holds it on the Reviews row, closed or open.
 */
export function NoteCardFacts({ reviews, settings, now = Date.now() }: { reviews: readonly CardReview[]; settings: ReviewSettings; now?: number }) {
  const facts = noteCardFacts(reviews, settings, now)
  if (facts === null) return null
  const { last, inSteps, due, recall } = facts
  const next = noteCardNextReview(due, inSteps, now)
  return (
    <span className="note-card-strip__fact note-card-strip__line">
      <span className="note-card-strip__last" title={`Answered ${noteCardFullDate(Date.parse(last.at))}`}>
        Last: <b className="note-card-strip__value">{answerLabel(last.rating, settings)}</b>
      </span>
      <Dot />
      <span className="note-card-strip__next" data-overdue={noteCardOverdue(due, now) || undefined}>
        Next review{' '}
        {next.date === null ? (
          <When next={next} />
        ) : (
          <>
            <b className="note-card-strip__value">{next.date}</b> (<When next={next} />)
          </>
        )}
      </span>
      {recall !== null && (
        <>
          <Dot />
          <span className="note-card-strip__recall">
            <b className="note-card-strip__value">{`${Math.round(recall * 100)}%`}</b> you remember it now
            {/* The "i" is the CSS's: the words read clean. */}
            <span className="note-card-strip__info" role="img" aria-label={RECALL_HELP} title={RECALL_HELP} />
          </span>
        </>
      )}
    </span>
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

/** A gap as the table says it (YAZ-5032): "Same day" for 0, else "**4** days", the number bold, the unit muted. */
function Gap({ n }: { n: number }) {
  if (n === 0) return <span className="note-card-reviews__unit">Same day</span>
  return (
    <>
      <b className="note-card-reviews__num">{n}</b> <span className="note-card-reviews__unit">{n === 1 ? 'day' : 'days'}</span>
    </>
  )
}

/** The table's columns, in Yaseen's order (YAZ-5032); the last, unnamed one holds the delete. */
export const REVIEW_COLUMNS = ['Reviewed on', 'Answer', 'Gap', 'Time', 'Next due'] as const

/**
 * The full table (D3, D13; YAZ-5032, Yaseen's columns): one row per review in time order — Reviewed on (the date in
 * full, "Sep 24, 2026"), Answer (the glyph and its word), Gap (the days since the review before: "Same day", "**4**
 * days"; blank for the first), Time ("13 s"; "—" for a review made before YAZ-5033), Next due (the date that answer
 * set), and a bin to delete. A last, muted row says the review to come: "Next review · Apr 28, 2027 · in 183 days",
 * with no delete. The history is replayed only here, so a closed section costs nothing but its count.
 */
export function NoteCardReviewsTable({ reviews, settings, onDelete, now = Date.now() }: NoteCardReviewsProps) {
  // One replay: each row is a review's step; the last row's step is the card's state.
  const rows = cardHistory(reviews, settings)
  const last = rows.at(-1)
  // A new card is due today, as the Inbox shows it.
  const next = last === undefined ? noteCardNextReview(now, false, now) : noteCardNextReview(last.due, last.inSteps, now)
  return (
    <table className="note-card-reviews__table">
      <thead>
        <tr>
          {REVIEW_COLUMNS.map((name) => (
            <th key={name}>{name}</th>
          ))}
          <th aria-label="Delete" />
        </tr>
      </thead>
      <tbody>
        {/* Keyed by place: two reviews in one minute are two rows (`withoutCardReview` takes the last of them). */}
        {rows.map((row, i) => (
          <tr key={i}>
            <td>{noteCardFullDate(Date.parse(row.review.at))}</td>
            <td className="note-card-reviews__answer">
              <NoteCardAnswer review={row.review} settings={settings} />
              {answerLabel(row.review.rating, settings)}
            </td>
            <td>{i === 0 ? '' : <Gap n={row.elapsed} />}</td>
            <td className="note-card-reviews__time">{reviewDuration(row.review.seconds)}</td>
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
        {/* The review to come, in words: no answer yet, no delete. */}
        <tr className="note-card-reviews__next">
          <td colSpan={REVIEW_COLUMNS.length}>{['Next review', ...(next.date === null ? [] : [next.date]), next.when].join(' · ')}</td>
          <td />
        </tr>
      </tbody>
    </table>
  )
}
