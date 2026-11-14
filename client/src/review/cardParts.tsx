/**
 * The pieces the card window (`explore/ExploreCard.tsx`) and the Inbox (`CardInbox.tsx`) share (YAZ-4962): the
 * card drawn read-only (`renderCard`, the page's own function) with its pills and links live, the grey card ID
 * that copies on a click (D20), and the Reviews section with the full table (D3, D13). The table is the page card's
 * too (`cardBlockView.ts`, YAZ-5000); the Inbox has no Reviews section.
 */
import { useCallback, useContext, useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { CardReview } from '@shared/cardLine'
import { answerLabel, cardHistory, cardState, cardStateWithout, dayCount, recallChance } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'
import type { GestureAction } from '@shared/keys'
import { api } from '../api'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { InfoTip } from '../components/InfoTip'
import { cardLook } from '../editor/createCrepe'
import { copyText } from '../editor/linkMenu'
import { CARD_BOARD_ATTR, CARD_MEDIA, CARD_OPENS } from '../editor/card/cardMedia'
import { CARD_LINK_ATTR, cardLinkWhere, refreshCardLook, renderCard, type CardShow } from '../editor/card/cardRender'
import { hrefTarget } from '../editor/pathPaste'
import { linkCard, linkPath } from '../editor/wikilink/wikilinkPlugin'
import { landOnCard, openCardWindow } from '../editor/card/cardOpen'
import type { ExploreVault } from '../explore/ExplorePage'
import { storage } from '../lib/storage'
import { fileIconDecoration, IconsContext } from '../sidebar/FileIcon'
import { answerIcon } from './cardInboxChip'
import { reviewDuration } from './reviewTime'
import { ReviewsIcon, TrashIcon } from './cardInboxIcons'
import '../editor/card/card.css'
import './cardScreens.css'

/** A date as the card screens say it: "Nov 21", with the year when it is not this year's. */
export function cardDate(ms: number, now = Date.now()): string {
  const date = new Date(ms)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric' })
}

/**
 * A wait as the screens say it: "later today" for a card in its same-day steps (YAZ-5020: it comes back in this
 * session), "today" for 0, else "9 days".
 */
export const cardWait = (days: number, inSteps = false): string => (inSteps ? 'later today' : days === 0 ? 'today' : dayCount(days))

/** The card ID in a head (D20): small and grey, FIRST in the head; a click copies it. The page's card block has the same (`cardBlockView.ts`). */
export function CardId({ id, onNotice }: { id: string; onNotice: (message: string) => void }) {
  return (
    <button
      type="button"
      className="card__id"
      aria-label="Copy card ID"
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

/**
 * The "Up next" chip in a head (YAZ-4999 D3): the card is at the top of the Inbox. Its × removes the mark (`onRemove`).
 * The page's card block draws the same chip (`cardBlockView.ts`).
 */
export function CardNextChip({ onRemove }: { onRemove?: () => void }) {
  return (
    <span className="card__next">
      Up next
      {onRemove !== undefined && (
        <button
          type="button"
          className="card__next-remove"
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
export interface CardLinkDoors {
  /** A plain click on a page link: the page on top (an Explore layer). */
  openLayer: (path: string) => void
  /** A bound gesture (⌘-click by default): a tab, as the page's links. */
  openTab: (path: string, where: GestureAction) => void
  onNotice: (message: string) => void
}

interface CardBodyProps {
  /** The card's raw Markdown. */
  text: string
  /** The page the card is on: its images and Markdown links resolve against it. */
  path: string
  vault: ExploreVault
  show?: CardShow
  doors: CardLinkDoors
}

/**
 * The card read-only (D11, D13): `renderCard` into a box, drawn again when the text or the steps change, never per
 * render; an index change redraws only the pills (`refreshCardLook`). A pill and a Markdown link open as the
 * page's do (idea 6, `cardLinkWhere`).
 */
export function CardBody({ text, path, vault, show, doors }: CardBodyProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const icons = useContext(IconsContext)
  const { root, wikilinks, viewOnlyLinks } = vault
  const sides = show?.sides
  const shown = show?.shown
  // `icons` is read at each draw; a change of the icon rules alone draws no card again (the preview panel's rule).
  const iconsRef = useRef(icons)
  iconsRef.current = icons
  const lookOf = useCallback(() => cardLook(wikilinks, viewOnlyLinks, { root, pagePath: path }, { icon: (target, folder) => fileIconDecoration(iconsRef.current, target, folder) }), [wikilinks, viewOnlyLinks, root, path])
  useEffect(() => {
    boxRef.current?.replaceChildren(renderCard(text, { sides, shown }, lookOf()))
  }, [text, sides, shown, lookOf])
  // The pills follow the index: on each snapshot only they draw again.
  const hasLink = text.includes('[[')
  useEffect(() => (hasLink ? wikilinks.subscribe(() => boxRef.current !== null && refreshCardLook(boxRef.current, lookOf())) : undefined), [hasLink, wikilinks, lookOf])

  const doorsRef = useRef(doors)
  doorsRef.current = doors
  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null
    if (target === null || event.button !== 0) return
    const { openLayer, openTab, onNotice } = doorsRef.current
    // A sound's player is its own (YAZ-5014).
    if (target.closest(CARD_MEDIA) !== null) return
    // A pill, or a board's picture (YAZ-5015): its board on top, as its link.
    const pill = target.closest<HTMLElement>(CARD_OPENS)
    if (pill !== null) {
      event.preventDefault()
      event.stopPropagation()
      const where = cardLinkWhere(event, storage.getSettings()?.hotkeys)
      if (where === null) return
      const inner = pill.getAttribute(CARD_LINK_ATTR) ?? pill.getAttribute(CARD_BOARD_ATTR) ?? ''
      // A link to a card (YAZ-5030): its card window on top; a tab gesture, its page there, landed on the card.
      const card = pill.hasAttribute(CARD_LINK_ATTR) ? linkCard(inner, wikilinks) : null
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
    const inApp = /^[a-z][a-z0-9+.-]*:/i.test(href) ? null : hrefTarget(href, { root, pagePath: path, candidates: vault.wikilinkCandidates })
    if (inApp !== null) openLayer(inApp)
    else void api.shell.openLink({ href, sourcePath: path })
  }
  // A Markdown link never navigates the window.
  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('a[href]') !== null) event.preventDefault()
  }
  return <div ref={boxRef} className="card__body card-screen__body" onMouseDown={onMouseDown} onClick={onClick} />
}

interface CardReviewsProps {
  reviews: readonly CardReview[]
  settings: ReviewSettings
  /** The table's delete of one review (its notice has Undo). Absent (a card with no ID yet): no delete. */
  onDelete?: (review: CardReview) => void
  now?: number
}

/** The day `due` is past (the strip then says "Overdue · …" with no "Due" label). */
export const cardOverdue = (due: number, now: number): boolean => due < new Date(now).setHours(0, 0, 0, 0)

/** A date in full, as the Reviews table says it (YAZ-5032, as Mochi's): "Sep 24, 2026". */
export const cardFullDate = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** The toggle's words (YAZ-5032, as Mochi's): "1 Review", "4 Reviews". The page's card block says the same (`cardBlockView.ts`). */
export const reviewsTitle = (n: number): string => `${n} Review${n === 1 ? '' : 's'}`

/** What review knows of a card, for the strip (YAZ-5032): its last answer, the wait it set, when it is due, the recall chance. Null for a new card. */
export interface CardFactsData {
  last: CardReview
  interval: number
  inSteps: boolean
  due: number
  recall: number | null
}

export function cardFacts(reviews: readonly CardReview[], settings: ReviewSettings, now: number): CardFactsData | null {
  const state = cardState(reviews, settings)
  const last = state.lastReview === null ? undefined : reviews.filter((r) => r.at === state.lastReview).at(-1)
  if (state.isNew || last === undefined || state.due === null) return null
  return { last, interval: state.interval, inSteps: state.inSteps, due: state.due, recall: recallChance(reviews, settings, now) }
}

/** An answer as its glyph (YAZ-5032): ✓ Remembered / ✕ Forgot (↺ ~ ✓ ⇈ with four buttons, YAZ-5018); the word is the hover. */
function CardAnswerView({ review, settings, hover }: { review: CardReview; settings: ReviewSettings; hover?: string }) {
  const word = answerLabel(review.rating, settings)
  return (
    <span className="card-answer" data-rating={review.rating} title={hover ?? word} aria-label={word} role="img">
      {answerIcon(review.rating, settings.buttons)}
    </span>
  )
}

/** The (i) of the recall chance (YAZ-5032; round 2, plain words): the strip's one help. */
export const RECALL_HELP = 'How likely you are to remember this card today. It drops the longer the card waits. A review brings it back up.'

/** Whole local days from today to the day of `ms`: 0 today, 1 tomorrow, -3 three days ago. */
const daysUntil = (ms: number, now: number): number => Math.round((new Date(ms).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000)

/**
 * The review to come in words (YAZ-5032), the strip's and the table's last row: its date in full (none for today and
 * for a card in its same-day steps), and how far it is — "in 183 days", "3 days ago", "today", "later today".
 */
export function cardNextReview(due: number, inSteps: boolean, now: number): { date: string | null; days: number | null; when: string } {
  const days = daysUntil(due, now)
  // A step of a day gone by is overdue like any card: its date, and how long ago.
  if (inSteps && days >= 0) return { date: null, days: null, when: 'later today' }
  if (days === 0) return { date: null, days: 0, when: 'today' }
  const n = Math.abs(days)
  // Round 2 (plain words): a day ahead or behind is "tomorrow" or "yesterday".
  const when = days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : days > 0 ? `in ${dayCount(n)}` : `${dayCount(n)} ago`
  return { date: cardFullDate(due), days, when }
}

/**
 * The review to come in words (YAZ-5032 round 2, Yaseen: "the next review … needs better copy"): "Due" first, the
 * app's one word for it (the Inbox's "due today", the Next due column), then how far, then the date —
 * "Due in 183 days (Apr 28, 2027)", "Due today", "Due later today", "Due 3 days ago (Oct 24, 2026)". The strip and the
 * table's last row say the same words.
 */
export const cardDueWords = (next: ReturnType<typeof cardNextReview>): string => `Due ${next.when}${next.date === null ? '' : ` (${next.date})`}`

/** "in **183** days": the number emphasised, the words muted (YAZ-5032). */
function When({ next }: { next: ReturnType<typeof cardNextReview> }) {
  if (next.days === null || Math.abs(next.days) <= 1) return <b className="card-strip__value">{next.when}</b>
  const n = Math.abs(next.days)
  const unit = n === 1 ? 'day' : 'days'
  return next.days > 0 ? (
    <>
      in <b className="card-strip__value">{n}</b> {unit}
    </>
  ) : (
    <>
      <b className="card-strip__value">{n}</b> {unit} ago
    </>
  )
}

const Dot = () => <span className="card-strip__dot"> · </span>

/**
 * The strip (YAZ-5032, Yaseen's pick; round 2, his pages): one calm line of words, no icons to guess — "Due in 183
 * days (Apr 28, 2027) · 99% chance you remember it". No "Last: …" (round 2: "i think thats useless"). The values are
 * emphasised, the words muted; the recall chance alone has a small (i), the app's own tip (`InfoTip`: a native title
 * shows nothing in the app, which was round 2's "the tool tip doesnt work"). An overdue date shows in red. A fragment
 * of one span: the card window's strip holds it after the page name; the page's card block holds it on the Reviews
 * row, closed or open.
 */
export function CardFacts({ reviews, settings, now = Date.now() }: { reviews: readonly CardReview[]; settings: ReviewSettings; now?: number }) {
  const facts = cardFacts(reviews, settings, now)
  if (facts === null) return null
  const { inSteps, due, recall } = facts
  const next = cardNextReview(due, inSteps, now)
  return (
    <span className="card-strip__fact card-strip__line">
      <span className="card-strip__next" data-overdue={cardOverdue(due, now) || undefined}>
        Due <When next={next} />
        {next.date !== null && <span className="card-strip__date"> ({next.date})</span>}
      </span>
      {recall !== null && (
        <>
          <Dot />
          <span className="card-strip__recall">
            <b className="card-strip__value">{`${Math.round(recall * 100)}%`}</b> chance you remember it
            {/* A press on the (i) keeps the page's caret where it is; the hover, the focus and the click show the tip. */}
            <span className="card-strip__info" onMouseDown={(e) => e.preventDefault()}>
              <InfoTip text={RECALL_HELP} />
            </span>
          </span>
        </>
      )}
    </span>
  )
}

/** The strip's own props (YAZ-5105 round 4): the table's, and where it is open, and its extras. */
export interface CardReviewsStripProps extends CardReviewsProps {
  /** Open or closed, held by the caller (a page's card keeps it when the page draws again). Absent: the strip holds it. */
  open?: boolean
  /** A click on "✓ 4 Reviews", with `open`. */
  onToggle?: () => void
  /** The card's facts on the strip's right, "Due in 3 days · 92% chance you remember it": where they show today (a page's card, an embed). */
  facts?: boolean
}

/**
 * THE REVIEWS STRIP (D3, D13, YAZ-5032; YAZ-5105): "✓ 4 Reviews", a toggle as Mochi's, CLOSED until asked for. Open,
 * the full table (`CardReviewsTable`) inside it.
 * YAZ-5105 round 2 (Yaseen: "this clean slip that shows up at the bottom", as Mochi's): a slim strip tucked under the
 * card box. Round 4 (Yaseen: "should be the same in the card page, and on inbox and in embeds and in cards that are on
 * pages"): this ONE component everywhere a card's reviews show — the Inbox's last side, the card file tab and the card
 * window, and, mounted by `editor/card/reviewsStrip.ts`, a card in a page and a card embed. A page's card and an embed
 * add the card's facts on the strip's right (`facts`); the look is `cardScreens.css`'s one strip, a step darker than
 * what it sits on.
 */
export function CardReviews({ reviews, settings, onDelete, now, open: held, onToggle, facts = false }: CardReviewsStripProps) {
  const [own, setOwn] = useState(false)
  const open = held ?? own
  return (
    <section className="card-reviews card-reviews--strip">
      <div className="card-reviews__bar">
        <button type="button" className="backlinks__header card-reviews__toggle" aria-expanded={open} onClick={() => (onToggle ?? (() => setOwn((o) => !o)))()} onMouseDown={(e) => e.preventDefault()}>
          <ReviewsIcon />
          <span className="backlinks__title">{reviewsTitle(reviews.length)}</span>
        </button>
        {facts && (
          <span className="card-strip card-reviews__facts">
            <CardFacts reviews={reviews} settings={settings} now={now} />
          </span>
        )}
      </div>
      {open && <CardReviewsTable reviews={reviews} settings={settings} onDelete={onDelete} now={now} />}
    </section>
  )
}

/** A gap as the table says it (YAZ-5032): "Same day" for 0, else "**4** days", the number bold, the unit muted. */
function Gap({ n }: { n: number }) {
  if (n === 0) return <span className="card-reviews__unit">Same day</span>
  return (
    <>
      <b className="card-reviews__num">{n}</b> <span className="card-reviews__unit">{n === 1 ? 'day' : 'days'}</span>
    </>
  )
}

/** The table's columns, in Yaseen's order (YAZ-5032); the last, unnamed one holds the delete. */
export const REVIEW_COLUMNS = ['Reviewed on', 'Answer', 'Gap', 'Time', 'Next due'] as const

/**
 * What removing `review` does to the card, in words (YAZ-5032 round 2, Yaseen: "a pop up that would show the
 * consequences"): the schedule run again without it (`cardStateWithout`) — "The due date moves from Apr 28, 2027 to
 * Mar 3, 2027 (in 110 days).", "The due date stays Apr 28, 2027.", or, for the card's only review, "This is the card's
 * only review. The card becomes new again."
 */
export function cardRemoveOutcome(reviews: readonly CardReview[], review: CardReview, settings: ReviewSettings, now: number): string {
  const after = cardStateWithout(reviews, review.at, settings)
  if (after.isNew || after.due === null) return "This is the card's only review. The card becomes new again."
  const before = cardState(reviews, settings)
  const was = before.due === null ? cardNextReview(now, false, now) : cardNextReview(before.due, before.inSteps, now)
  const will = cardNextReview(after.due, after.inSteps, now)
  const from = was.date ?? was.when
  const to = will.date ?? will.when
  if (from === to) return `The due date stays ${to}.`
  return `The due date moves from ${from} to ${to}${will.date === null ? '' : ` (${will.when})`}.`
}

/**
 * The full table (D3, D13; YAZ-5032, Yaseen's columns): one row per review in time order — Reviewed on (the date in
 * full, "Sep 24, 2026"), Answer (the glyph and its word), Gap (the days since the review before: "Same day", "**4**
 * days"; blank for the first), Time ("13 s"; "—" for a review made before YAZ-5033), Next due (the date that answer
 * set), and a bin to remove it. A last, muted row says the review to come in the strip's words: "Due in 183 days
 * (Apr 28, 2027)", with no bin. The history is replayed only here, so a closed section costs nothing but its count.
 *
 * Round 2 (Yaseen's pages): the bin asks first, in the app's confirm sheet, and says what the remove does
 * (`cardRemoveOutcome`): Remove review / Cancel, the focus on Cancel, Enter (⌘↵ too) removes, Esc cancels. The
 * sheet is in a portal on the page, so the page's card and the Explore layer that hold the table cannot clip it, and
 * its keys stay its own (`contained`): an Esc closes the sheet, not the card window under it. A narrow table folds
 * its columns by the room it has (`cardScreens.css`), and its box scrolls sideways at the last.
 */
export function CardReviewsTable({ reviews, settings, onDelete, now = Date.now() }: CardReviewsProps) {
  // One replay: each row is a review's step; the last row's step is the card's state.
  const rows = cardHistory(reviews, settings)
  const last = rows.at(-1)
  // A new card is due today, as the Inbox shows it.
  const next = last === undefined ? cardNextReview(now, false, now) : cardNextReview(last.due, last.inSteps, now)
  const [asking, setAsking] = useState<CardReview | null>(null)
  const askId = useId()
  return (
    <div className="card-reviews__scroll">
      <table className="card-reviews__table">
        <thead>
          <tr>
            {REVIEW_COLUMNS.map((name) => (
              <th key={name}>{name}</th>
            ))}
            <th aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {/* Keyed by place: two reviews in one minute are two rows (`withoutCardReview` takes the last of them). */}
          {rows.map((row, i) => (
            <tr key={i}>
              <td>{cardFullDate(Date.parse(row.review.at))}</td>
              <td className="card-reviews__answer">
                <CardAnswerView review={row.review} settings={settings} />
                <span className="card-reviews__word">{answerLabel(row.review.rating, settings)}</span>
              </td>
              <td>{i === 0 ? '' : <Gap n={row.elapsed} />}</td>
              <td className="card-reviews__time">{reviewDuration(row.review.seconds)}</td>
              <td>{cardFullDate(row.due)}</td>
              <td>
                {onDelete !== undefined && (
                  <button type="button" className="card-reviews__delete" title="Remove this review" aria-label={`Remove the review of ${cardFullDate(Date.parse(row.review.at))}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setAsking(row.review)}>
                    <TrashIcon />
                  </button>
                )}
              </td>
            </tr>
          ))}
          {/* The review to come, in the strip's words: no answer yet, no bin. Across every column, the bin's too. */}
          <tr className="card-reviews__next">
            <td colSpan={REVIEW_COLUMNS.length + 1}>{cardDueWords(next)}</td>
          </tr>
        </tbody>
      </table>
      {asking !== null &&
        onDelete !== undefined &&
        createPortal(
          <ConfirmSheet
            labelId={`${askId}-remove-review`}
            text={
              <>
                <span className="confirm__title">{`Remove the review of ${cardFullDate(Date.parse(asking.at))}?`}</span>
                {cardRemoveOutcome(reviews, asking, settings, now)}
              </>
            }
            confirmLabel="Remove review"
            danger
            keys="contained"
            onConfirm={() => {
              setAsking(null)
              onDelete(asking)
            }}
            onCancel={() => setAsking(null)}
          />,
          document.body,
        )}
    </div>
  )
}
