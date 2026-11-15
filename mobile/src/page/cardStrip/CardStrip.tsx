import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { cardDueWords, cardFullDate, cardNextReview, reviewsTitle } from '@client/review/cardWords'
import { cardResolverOf } from '@client/editor/wikilink/linkResolve'
import type { CardPropertyValue, CardReview } from '@shared/cardLine'
import { cardBacklinks, cardEmbedders } from '@shared/cardLinks'
import { answerLabel, cardHistory, recallChance } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import type { VaultData } from '../../search/vaultData'
import { openLink, type LinkDoor } from '../openLink'
import { resolveSourceOf } from '../pageLook'
import { PropertyRows, cardPropertyRows } from '../properties/PropertiesPanel'
import '@client/review/cardScreens.css'
import '../properties/properties.css'
import './cardStrip.css'

/**
 * THE CARD'S STRIP ON THE PHONE: the Mac's strip under a card (`client/src/review/cardParts.tsx`,
 * `CardStrip`; its look `cardScreens.css`, whose classes this wears), made for a phone. A slim band tucked under the
 * card; its bar holds the card's parts as toggles, in the Mac's order and words:
 *  - "✓ 4 Reviews" (the count is in the words), "Properties 3", "Linked mentions 2", and on a card file "Embedded in 1".
 *    A part with 0 is dimmed, and still opens.
 *  - CLOSED by default. A tap opens that part's drawer; a tap on the open one, or on another part, closes it (one open
 *    at a time). The drawer slides open by its height; with Reduce Motion it opens at once.
 *  - Reviews: the phone's review table (Reviewed on, Answer, Next due), its last, muted line the Mac's (*    YAZ-5528): when the card is due on the left ("Due in 144 days (Apr 8, 2027)", a new card "Due today"), "100% chance
 *    you remember it" on the right (none for a new card). Properties: the card's own properties in the
 *    page properties panel's rows. Linked mentions / Embedded in: the Mac's list, one page a row, its name and
 *    its folder (`cardBacklinks`, `cardEmbedders`: the same lists "Linked mentions" reads, off the phone's index); a tap opens it.
 *
 * Where it shows, as on the Mac: the card view (a card file: all four parts; a card in a page: no "Embedded in", as the
 * Mac's card window), and a card in a page or a card embed (`pageStrips.tsx`: Reviews and Properties). Review off: none.
 * Read only, as all of the phone's cards: no bin in the table, no edit of a property.
 */
export type StripPart = 'reviews' | 'properties' | 'links' | 'embeds'

export interface CardStripProps {
  reviews: readonly CardReview[]
  settings: ReviewSettings
  properties: Readonly<Record<string, CardPropertyValue>>
  data: VaultData
  door: LinkDoor
  /** Linked mentions (and, with `embeds`, Embedded in) of the card with this ID. Absent: neither part. */
  pages?: { id: string; embeds?: boolean }
  /** The time the Reviews drawer's last line counts from (the app's clock). */
  now?: number
}

/** How long the drawer's slide takes (`cardStrip.css`); its content stays this long after a close, so it slides shut. */
export const DRAWER_MS = 220

export function CardStrip({ reviews, settings, properties, data, door, pages, now = Date.now() }: CardStripProps) {
  const [open, setOpen] = useState<StripPart | null>(null)
  // What the drawer shows: the open part, or the one closing while the drawer slides shut.
  const [shown, setShown] = useState<StripPart | null>(null)
  useEffect(() => {
    if (open !== null) return setShown(open)
    const timer = setTimeout(() => setShown(null), DRAWER_MS)
    return () => clearTimeout(timer)
  }, [open])
  const toggle = (part: StripPart) => setOpen((o) => (o === part ? null : part))
  const lists = useMemo(() => {
    if (pages === undefined) return null
    const resolve = resolveSourceOf(data).resolve === null ? null : cardResolverOf(resolveSourceOf(data))
    const onPhone = (records: IndexRecord[]) => records.filter((r) => data.byPath[r.path] !== undefined && !r.path.endsWith('.folder.md'))
    return {
      links: resolve === null ? [] : onPhone(cardBacklinks(data.records, pages.id, resolve)),
      embeds: pages.embeds !== true ? null : resolve === null ? [] : onPhone(cardEmbedders(data.records, pages.id, resolve)),
    }
  }, [data, pages?.id, pages?.embeds])
  const propertyCount = Object.keys(properties).length
  const part = open ?? shown
  return (
    <section className="card-reviews card-reviews--strip phone-strip" aria-label="Card strip">
      <div className="card-reviews__bar">
        <Toggle part="reviews" open={open} label={reviewsTitle(reviews.length)} empty={reviews.length === 0} icon={<ReviewsIcon />} onToggle={toggle} />
        <Toggle part="properties" open={open} label="Properties" count={propertyCount} onToggle={toggle} />
        {lists !== null && <Toggle part="links" open={open} label="Linked mentions" count={lists.links.length} onToggle={toggle} />}
        {lists?.embeds != null && <Toggle part="embeds" open={open} label="Embedded in" count={lists.embeds.length} onToggle={toggle} />}
      </div>
      <div className="phone-strip__drawer" data-open={open !== null || undefined} data-part={part ?? undefined} inert={open === null} aria-hidden={open === null || undefined}>
        <div className="phone-strip__inner">
          {part === 'reviews' && <ReviewsTable reviews={reviews} settings={settings} now={now} />}
          {part === 'properties' && (
            <div className="card-strip__part">
              {propertyCount === 0 ? (
                <p className="card-strip__none">No properties on this card.</p>
              ) : (
                <PropertyRows rows={cardPropertyRows(properties)} data={data} open={(path) => openLink(door, { kind: 'page', path })} className="props__rows phone-strip__props" />
              )}
            </div>
          )}
          {(part === 'links' || part === 'embeds') && lists !== null && (
            <div className="card-strip__part">
              <PageList pages={part === 'links' ? lists.links : lists.embeds ?? []} none={part === 'links' ? 'No page links to this card yet.' : 'No page embeds this card yet.'} door={door} />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** The Mac's check glyph of "✓ 4 Reviews" (`cardInboxIcons.tsx`'s `ReviewsIcon`), drawn here so the chunk stays small. */
const ReviewsIcon = () => (
  <svg className="card-inbox__glyph" width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m3 8.5 3.25 3.25L13 4.75" />
  </svg>
)

/** One part's toggle on the bar (the Mac's `StripToggle`): its words and its count; a part with 0 is dimmed. */
function Toggle({
  part,
  open,
  label,
  count,
  empty = count === 0,
  icon,
  onToggle,
}: {
  part: StripPart
  open: StripPart | null
  label: string
  count?: number
  empty?: boolean
  icon?: ReactNode
  onToggle: (part: StripPart) => void
}) {
  return (
    <button
      type="button"
      className="backlinks__header card-reviews__toggle"
      data-part={part}
      data-empty={empty || undefined}
      aria-expanded={open === part}
      aria-label={count === undefined ? label : `${label}, ${count}`}
      onClick={() => onToggle(part)}
    >
      {icon}
      <span className="backlinks__title">{label}</span>
      {count !== undefined && <span className="card-strip__count">{count}</span>}
    </button>
  )
}

/**
 * The card's review history (one row for each answer, read only), then the Mac's last line (`CardReviewsTable`,
 * YAZ-5381): the review to come, muted, across the table: the due words on the LEFT, the recall chance on the RIGHT (a
 * narrow table puts the chance on its own line, still on the right). A new card: the header and "Due today", as the Mac.
 * The Mac's (i) by the chance is a hover tip; the phone has none.
 */
function ReviewsTable({ reviews, settings, now }: { reviews: readonly CardReview[]; settings: ReviewSettings; now: number }) {
  const rows = cardHistory(reviews, settings)
  const last = rows.at(-1)
  // A new card is due today, as the Inbox shows it; it has no chance yet (there is nothing to remember).
  const next = last === undefined ? cardNextReview(now, false, now) : cardNextReview(last.due, last.inSteps, now)
  const recall = last === undefined ? null : recallChance(reviews, settings, now)
  return (
    <div className="phone-strip__scroll">
      <table className="card-view__table" aria-label="Review history">
        <thead>
          <tr>
            <th>Reviewed on</th>
            <th>Answer</th>
            <th>Next due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>{cardFullDate(Date.parse(row.review.at))}</td>
              <td>{answerLabel(row.review.rating, settings)}</td>
              <td>{cardFullDate(row.due)}</td>
            </tr>
          ))}
          <tr className="card-reviews__next">
            <td colSpan={3}>
              <div className="card-reviews__next-line">
                <span className="card-reviews__due">{cardDueWords(next)}</span>
                {recall !== null && (
                  <span className="card-reviews__chance card-strip__recall">
                    <b className="card-strip__value">{`${Math.round(recall * 100)}%`}</b> chance you remember it
                  </span>
                )}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** A page part open (the Mac's `StripPageList`): one page a row, its name and its folder; a tap opens the page. */
function PageList({ pages, none, door }: { pages: readonly IndexRecord[]; none: string; door: LinkDoor }) {
  if (pages.length === 0) return <p className="card-strip__none">{none}</p>
  return (
    <ul className="card-backlinks__list">
      {pages.map((page) => (
        <li key={page.path}>
          <button type="button" className="card-strip__page card-backlinks__page" onClick={() => openLink(door, { kind: 'page', path: page.path })}>
            <span className="card-backlinks__name">{page.title.trim() !== '' ? page.title : page.basename}</span>
            {page.folder !== '' && <span className="card-backlinks__folder">{page.folder.slice(page.folder.lastIndexOf('/') + 1)}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}
