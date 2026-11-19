/**
 * The pieces the card window (`explore/ExploreCard.tsx`) and the Inbox (`CardInbox.tsx`) share (YAZ-4962): the
 * card drawn read-only (`renderCard`, the page's own function) with its pills and links live, the grey card ID
 * that copies on a click (D20), and the Reviews section with the full table (D3, D13). The table is the page card's
 * too (`cardBlockView.ts`, YAZ-5000); the Inbox has no Reviews section.
 *
 * DESKTOP ONLY (YAZ-5161): it reads the desktop bridge (`api`), the app's settings (`storage`) and the Files tree
 * icons, so the phone's build stops it. What the phone's Review screen shares is in bridge-free files: the drawing
 * (`renderCard`, `cardLook`), the words (`cardWords.ts`), the answer labels (`cardInboxChip.tsx`), the review hook.
 */
import { Suspense, lazy, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { CardLine, CardPropertyValue, CardReview } from '@shared/cardLine'
import { cardBacklinks, cardEmbedders } from '@shared/cardLinks'
import type { IndexRecord } from '@shared/types'
import { answerLabel, cardHistory, recallChance } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'
import type { GestureAction } from '@shared/keys'
import { api } from '../api'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { InfoTip } from '../components/InfoTip'
import { cardLook } from '../editor/card/cardLook'
import { desktopBoardPicture } from '../editor/card/boardPictureDesktop'
import { copyText } from '../lib/copyText'
import { CARD_BOARD_ATTR, CARD_MEDIA, CARD_OPENS } from '../editor/card/cardMedia'
import { CARD_LINK_ATTR, cardLinkWhere, refreshCardLook, renderCard, type CardShow } from '../editor/card/cardRender'
import { hrefTarget } from '../editor/pathLinks'
import { cardResolverOf, linkCard, linkPath, type WikilinkResolveSource } from '../editor/wikilink/linkResolve'
import { useIndexFeed } from '../editor/wikilink/useIndexFeed'
import { pageLabel, pathTitles } from '../lib/pageLabel'
import type { FrontmatterPanelProps } from '../editor/FrontmatterPanel'
import { useProperties } from '../views/useProperties'
import { landOnCard, openCardWindow } from '../editor/card/cardOpen'
import type { ExploreVault } from '../explore/ExplorePage'
import { storage } from '../lib/storage'
import { fileIconDecoration, IconsContext } from '../sidebar/FileIcon'
import { PlaceName } from '../sidebar/PlaceName'
import { dirname } from '../lib/paths'
import { answerIcon } from './cardInboxChip'
import { reviewDuration } from './reviewTime'
import { ReviewsIcon, TrashIcon } from './cardInboxIcons'
import '../editor/card/card.css'
import './cardScreens.css'
import { cardDueWords, cardFacts, cardFullDate, cardNextReview, cardOverdue, cardRemoveOutcome, reviewsTitle, NOT_COUNTED, NOT_COUNTED_HELP, RECALL_HELP, REVIEW_COLUMNS } from './cardWords'

// The words of the card screens moved to `cardWords.ts` (YAZ-5161), so the phone's Review screen reads them with no
// bridge; their names stay here too.
export { type CardFactsData, REVIEW_COLUMNS, RECALL_HELP, cardDate, cardDueWords, cardFacts, cardFullDate, cardNextReview, cardOverdue, cardRemoveOutcome, cardWait, reviewsTitle } from './cardWords'

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
 * The card's title band (YAZ-5308 A3, `editor/card/cardBand.ts`): the shaded band under the card's top bar, the title
 * bold, a long title wrapping. Read, no label, and nothing at all for a card with no title. Explore's card, the Inbox
 * and its Preview; a card in a page and an embed draw the same band without React.
 */
export function CardBand({ children, waiting = false }: { children: ReactNode; waiting?: boolean }) {
  // YAZ-5696: a title that waits (`titleShows`) keeps the band's room, so the card never moves down when it comes; the
  // words are not seen and not read until then.
  return waiting ? (
    <div className="card-band card-band--waiting" aria-hidden="true">
      {children}
    </div>
  ) : (
    <div className="card-band">{children}</div>
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
          aria-label="Remove from Up next"
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
  // Round 4 (YAZ-5049): the words a click showed, and the marked blank; by value, so a new array draws nothing again.
  const pickedKey = show?.picked?.join(',') ?? ''
  const next = show?.next
  // `icons` is read at each draw; a change of the icon rules alone draws no card again (the preview panel's rule).
  const iconsRef = useRef(icons)
  iconsRef.current = icons
  const lookOf = useCallback(() => cardLook(wikilinks, viewOnlyLinks, { root, pagePath: path, boardPicture: desktopBoardPicture }, { icon: (target, folder) => fileIconDecoration(iconsRef.current, target, folder) }), [wikilinks, viewOnlyLinks, root, path])
  useEffect(() => {
    const picked = pickedKey === '' ? undefined : pickedKey.split(',').map(Number)
    boxRef.current?.replaceChildren(renderCard(text, { sides, shown, picked, next }, lookOf()))
  }, [text, sides, shown, pickedKey, next, lookOf])
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

/** An answer as its glyph (YAZ-5032): ✓ Remembered / ✕ Forgot (↺ ~ ✓ ⇈ with four buttons, YAZ-5018); the word is the hover. */
function CardAnswerView({ review, settings, hover }: { review: CardReview; settings: ReviewSettings; hover?: string }) {
  const word = answerLabel(review.rating, settings)
  return (
    <span className="card-answer" data-rating={review.rating} title={hover ?? word} aria-label={word} role="img">
      {answerIcon(review.rating, settings.buttons)}
    </span>
  )
}

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
 * of one span: the card window's facts strip holds it after the page name. The card's strip says nothing on its right
 * (YAZ-5381): its Reviews table's last line holds the due date and the chance.
 */
export function CardFacts({ reviews, settings, now = Date.now() }: { reviews: readonly CardReview[]; settings: ReviewSettings; now?: number }) {
  const facts = cardFacts(reviews, settings, now)
  if (facts === null) return null
  const { comesBack, due, recall } = facts
  const next = cardNextReview(due, comesBack, now)
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

/** The parts of the card's strip (YAZ-5380; YAZ-5382 Linked mentions and Embedded in): one open at a time, each a toggle on the strip's bar. */
export type CardStripPart = 'reviews' | 'properties' | 'links' | 'embeds'

/**
 * The strip's page parts (YAZ-5382): "Linked mentions" (YAZ-5030: the pages whose links name the card's ID,
 * `cardBacklinks`) and, on a card file, "Embedded in" (YAZ-5037: the pages whose `![[…]]` names it, `cardEmbedders`).
 * From the index, live with it. Absent: neither part (a card in a page, an embed, the Inbox).
 */
export interface CardStripPages {
  id: string
  wikilinks: WikilinkResolveSource
  /** A click on a page of the list: it opens. */
  onOpen: (path: string) => void
  /** The card file tab's "Embedded in" too. */
  embeds?: boolean
}

const PAGE_PARTS = {
  links: { label: 'Linked mentions', none: 'No page links to this card yet.', of: cardBacklinks },
  embeds: { label: 'Embedded in', none: 'No page embeds this card yet.', of: cardEmbedders },
} as const

/** The strip's Properties part (YAZ-5380): the card's own properties, off its card line (YAZ-5379). Absent: no part. */
export interface CardStripProperties {
  values: Readonly<Record<string, CardPropertyValue>>
  /** How an edit writes (YAZ-5383); absent: the rows read only. */
  edit?: CardPropertiesEdit
}

/** The Properties part's door (YAZ-5383): the card's one line write, and the vault its rows read. */
export interface CardPropertiesEdit {
  /** Changes the card's line: a transaction for a card in a page, else one write of its file. */
  change: (change: (line: CardLine) => CardLine) => Promise<void>
  /** The vault root: its `properties.json` types the rows. */
  root: string | null
  /** The index feed: link values and their suggestions. */
  wikilinks?: WikilinkResolveSource
  /** The file the card is in. */
  path: string
  /** Locked (a read-only page or vault): the rows read only, as the page panel's. */
  readOnly?: boolean
  /** The toast: "Removed …" with Undo. */
  onNotice?: FrontmatterPanelProps['onNotice']
}

/** The strip's own props (YAZ-5105 round 4; YAZ-5380 its parts): the table's, which part is open, and its extras. */
export interface CardStripProps extends CardReviewsProps {
  /** The open part, held by the caller (a page's card keeps it when the page draws again); null: none. Absent: the strip holds it. */
  open?: CardStripPart | null
  /** A click on a part's toggle, with `open`: the caller opens it, or closes it when it is the open one. */
  onToggle?: (part: CardStripPart) => void
  properties?: CardStripProperties
  pages?: CardStripPages
}

/** A page part's list, worked out by `StripWithPages`: its pages and their names. */
interface PageLists {
  links: IndexRecord[]
  embeds: IndexRecord[] | null
  titles: ReturnType<typeof pathTitles>
  onOpen: (path: string) => void
}

/** One part's toggle on the strip's bar: its words and its count; a part with 0 is dimmed, and still opens (YAZ-5380). */
function StripToggle({ part, open, label, count, empty = count === 0, icon, onToggle }: { part: CardStripPart; open: boolean; label: string; count?: number; empty?: boolean; icon?: ReactNode; onToggle: (part: CardStripPart) => void }) {
  return (
    <button type="button" className="backlinks__header card-reviews__toggle" data-part={part} data-empty={empty || undefined} aria-expanded={open} onClick={() => onToggle(part)} onMouseDown={(e) => e.preventDefault()}>
      {icon}
      <span className="backlinks__title">{label}</span>
      {count !== undefined && <span className="card-strip__count">{count}</span>}
    </button>
  )
}

/**
 * The page properties panel, loaded when a Properties part first opens (YAZ-5067: the Inbox and the card body load
 * without the editor; the panel's image cell reaches ProseMirror). The app loads the panel for every page anyway, so
 * the part opens at once after the first page.
 */
const FrontmatterPanel = lazy(() => import('../editor/FrontmatterPanel').then((m) => ({ default: m.FrontmatterPanel })))

/**
 * The Properties part open (YAZ-5383): the page properties panel's own rows (`FrontmatterPanel` with its card target) —
 * the same look, types, menus and "+ Add property" — over the card's own properties; an edit writes the card's line.
 * Typed by the vault's declarations (`properties.json`). With no `edit` door (a preview), the rows read only.
 */
function CardPropertiesPart({ values, edit }: CardStripProperties) {
  const decls = useProperties(edit?.root ?? null).properties
  const change = edit?.change
  const card = useMemo(() => ({ values, change: change ?? (() => Promise.resolve()) }), [values, change])
  const file = useMemo(() => ({ path: edit?.path ?? '', content: '', mtime: 0 }), [edit?.path])
  return (
    <Suspense fallback={null}>
      <FrontmatterPanel
        file={file}
        root={edit?.root ?? null}
        properties={decls}
        wikilinks={edit?.wikilinks}
        readOnly={change === undefined || edit?.readOnly === true}
        card={card}
        onNotice={edit?.onNotice === undefined ? undefined : (message, icon, type, action) => edit.onNotice?.(message, icon, type, action)}
      />
    </Suspense>
  )
}

/**
 * THE CARD'S STRIP (D3, D13, YAZ-5032; YAZ-5105; YAZ-5380): the slim band tucked under the card box, CLOSED until
 * asked for. Its bar holds the card's parts — "✓ 4 Reviews", "Properties 3" — as toggles: ONE part opens at a time, a
 * click on the open one closes it (YAZ-5349, Yaseen's pick). Open, Reviews shows the full table (`CardReviewsTable`)
 * and Properties the card's own properties.
 * YAZ-5105 round 2 (Yaseen: "this clean slip that shows up at the bottom", as Mochi's). Round 4 (Yaseen: "should be the
 * same in the card page, and on inbox and in embeds and in cards that are on pages"): this ONE component everywhere a
 * card shows — the Inbox's last side and its Preview, the card file tab and the card window, and, mounted by
 * `editor/card/reviewsStrip.ts`, a card in a page and a card embed. Its right side is empty (YAZ-5381): the due date
 * and the recall chance are the open table's last line. The look is `cardScreens.css`'s one strip, a step darker
 * than what it sits on.
 */
export function CardStrip(props: CardStripProps) {
  return props.pages === undefined ? <StripView {...props} lists={null} /> : <StripWithPages {...props} pages={props.pages} />
}

/** The strip with its page parts: the lists off the index, live with it (the hook needs the index feed, so its own component). */
function StripWithPages({ pages, ...props }: CardStripProps & { pages: CardStripPages }) {
  const { id, wikilinks, onOpen, embeds } = pages
  const feed = useIndexFeed(wikilinks)
  const lists = useMemo((): PageLists => {
    const resolve = feed.resolve === null ? null : cardResolverOf(wikilinks)
    const of = (which: keyof typeof PAGE_PARTS) => (resolve === null ? [] : PAGE_PARTS[which].of(feed.records, id, resolve))
    return { links: of('links'), embeds: embeds === true ? of('embeds') : null, titles: pathTitles(feed.records, feed.folders), onOpen }
  }, [feed, id, wikilinks, embeds, onOpen])
  return <StripView {...props} lists={lists} />
}

/** A page part open: one page a row, its name and its folder on the right; a click opens it. None: the part's own words. */
function StripPageList({ which, lists }: { which: keyof typeof PAGE_PARTS; lists: PageLists }) {
  const pages = which === 'links' ? lists.links : (lists.embeds ?? [])
  if (pages.length === 0) return <p className="card-strip__none">{PAGE_PARTS[which].none}</p>
  return (
    <ul className="card-backlinks__list">
      {pages.map((page) => (
        <li key={page.path}>
          <button type="button" className="card-strip__page card-backlinks__page" onMouseDown={(e) => e.preventDefault()} onClick={() => lists.onOpen(page.path)}>
            <span className="card-backlinks__name">{pageLabel(page.path, false, lists.titles)}</span>
            {/* YAZ-5402: the folder's last name with the folder icon; the whole path in its tooltip. */}
            {page.folder !== '' && <PlaceName className="card-backlinks__folder" path={dirname(page.path)} kind="folder" label={page.folder.slice(page.folder.lastIndexOf('/') + 1)} full={page.folder} />}
          </button>
        </li>
      ))}
    </ul>
  )
}

function StripView({ reviews, settings, onDelete, now, open: held, onToggle, properties, lists }: CardStripProps & { lists: PageLists | null }) {
  const [own, setOwn] = useState<CardStripPart | null>(null)
  const open = held === undefined ? own : held
  const toggle = onToggle ?? ((part: CardStripPart) => setOwn((o) => (o === part ? null : part)))
  const propertyCount = properties === undefined ? 0 : Object.keys(properties.values).length
  return (
    <section className="card-reviews card-reviews--strip">
      <div className="card-reviews__bar">
        <StripToggle part="reviews" open={open === 'reviews'} label={reviewsTitle(reviews.length)} empty={reviews.length === 0} icon={<ReviewsIcon />} onToggle={toggle} />
        {properties !== undefined && <StripToggle part="properties" open={open === 'properties'} label="Properties" count={propertyCount} onToggle={toggle} />}
        {lists !== null && <StripToggle part="links" open={open === 'links'} label={PAGE_PARTS.links.label} count={lists.links.length} onToggle={toggle} />}
        {lists?.embeds != null && <StripToggle part="embeds" open={open === 'embeds'} label={PAGE_PARTS.embeds.label} count={lists.embeds.length} onToggle={toggle} />}
      </div>
      {open === 'reviews' && <CardReviewsTable reviews={reviews} settings={settings} onDelete={onDelete} now={now} />}
      {open === 'properties' && properties !== undefined && (
        <div className="card-strip__part">
          <CardPropertiesPart {...properties} />
        </div>
      )}
      {(open === 'links' || open === 'embeds') && lists !== null && (open === 'links' || lists.embeds !== null) && (
        <div className="card-strip__part">
          <StripPageList which={open} lists={lists} />
        </div>
      )}
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
  const next = last === undefined ? cardNextReview(now, false, now) : cardNextReview(last.due, last.comesBack, now)
  // The chance for a card with reviews (none for a new card: there is nothing to remember yet).
  const recall = last === undefined ? null : recallChance(reviews, settings, now)
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
          {/* Keyed by place: each review is one row. */}
          {rows.map((row, i) => (
            <tr key={i} className={row.counted ? undefined : 'card-reviews__row--uncounted'}>
              <td>{cardFullDate(Date.parse(row.review.at))}</td>
              <td className="card-reviews__answer">
                <CardAnswerView review={row.review} settings={settings} />
                <span className="card-reviews__word">{answerLabel(row.review.rating, settings)}</span>
                {!row.counted && (
                  <span className="card-reviews__tag" title={NOT_COUNTED_HELP}>
                    {NOT_COUNTED}
                  </span>
                )}
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
          {/* The review to come: no answer yet, no bin, across every column. YAZ-5381 (Yaseen): the due date on the LEFT,
              "90% chance you remember it" on the RIGHT, with its (i). */}
          <tr className="card-reviews__next">
            <td colSpan={REVIEW_COLUMNS.length + 1}>
              <div className="card-reviews__next-line">
                <span className="card-reviews__due">{cardDueWords(next)}</span>
                {recall !== null && (
                  <span className="card-reviews__chance card-strip__recall">
                    <b className="card-strip__value">{`${Math.round(recall * 100)}%`}</b> chance you remember it
                    <span className="card-strip__info" onMouseDown={(e) => e.preventDefault()}>
                      <InfoTip text={RECALL_HELP} />
                    </span>
                  </span>
                )}
              </div>
            </td>
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
