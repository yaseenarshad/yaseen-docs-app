/**
 * MORE OF THE APP, IN THE COURSE (YAZ-5121, chapters 4 and 10 to 12): copies of real parts, built from the app's own class
 * names (as `AppFrame` is), with made-up data. The real components need the vault, the index and the bridge.
 *
 * - `LinkPicker`: the `[[` list (`wikilinkPicker.ts`: `.wikilink-picker`, `.wikilink-picker__item`, the card row's
 *   `.wikilink-picker__card-icon`), pages first, then cards with the card icon.
 * - `CardPill`: a link to a card, as `wikilinkPlugin.ts` `cardPillSpan` draws it (`.wikilink.wikilink--card`, its ID in
 *   `.wikilink__card-id`): the kit's one pill (a card's text draws its own through `renderCard`).
 * - `LinkedMentions`: "Linked mentions (n)" under a card (`cardPane.tsx`: `.card-backlinks`).
 * - `FilterMenu`: the Inbox's All cards menu (`CardInboxBar.tsx`: its rows, counts, the line above Archived, and
 *   "Add [10] more new cards").
 * - `ReviewsStrip`: a card's Reviews strip (`cardParts.tsx`): the kit's one strip.
 */
import type { ReactElement } from 'react'
import { ArchiveIcon, DueIcon, ForgotIcon, InboxTrayIcon, NewIcon, RememberedIcon, ReviewsIcon, TrashIcon, UpNextIcon } from '../../../review/cardInboxIcons'
import { reviewsTitle } from '../../../review/cardParts'
import { glowStyle } from './AppFrame'
import { clamp, ease, rise, type Beat } from './beat'
import './kitMore.css'

/** The `[[` list: its rows, one of them under the pointer (`active` 0..1). */
export function LinkPicker({ beat, p, rows }: { beat: Beat; p: number; rows: readonly { label: string; kind: 'page' | 'card'; active?: number }[] }) {
  const q = clamp(p)
  if (q <= 0) return null
  return (
    <div className="wikilink-picker kit-picker" data-show="true" role="listbox" aria-label="Link suggestions" style={rise(beat, q, -4)}>
      {rows.map((row) => {
        const a = clamp(row.active ?? 0)
        return (
          <span key={row.label} role="option" aria-selected={a > 0.5} className="wikilink-picker__item kit-picker__item" data-card={row.kind === 'card' ? 'true' : undefined} style={a > 0 ? { background: `color-mix(in srgb, var(--accent-soft) ${(a * 100).toFixed(0)}%, transparent)`, color: a > 0.5 ? 'var(--accent)' : undefined } : undefined}>
            {row.kind === 'card' ? <span className="wikilink-picker__card-icon" aria-hidden="true" /> : <span className="kit-app__icon kit-app__icon--page kit-picker__page" aria-hidden="true" />}
            {row.label}
          </span>
        )
      })}
    </div>
  )
}

/** A link to a card: the card icon, its title, its ID small and grey. `glow` lights the pill; `part` lights its title or its ID. */
export function CardPill({ title, id, glow = 0, part }: { title: string; id: string; glow?: number; part?: { title?: number; id?: number } }) {
  const g = clamp(glow)
  const lit = (v: number | undefined) => (v !== undefined && v > 0 ? { backgroundColor: `color-mix(in srgb, var(--accent) ${(clamp(v) * 22).toFixed(1)}%, transparent)`, borderRadius: 3 } : undefined)
  return (
    <span className="wikilink wikilink--card kit-pill" style={g > 0 ? { boxShadow: `0 0 0 ${(3 * g).toFixed(2)}px color-mix(in srgb, var(--accent) 35%, transparent)` } : undefined}>
      <span style={lit(part?.title)}>{title}</span>
      <span className="wikilink__card-id" style={lit(part?.id)}>
        {id}
      </span>
    </span>
  )
}

/** "Linked mentions (n)" and its rows (the cards and pages that link here). `rows[i].p` brings each in. */
export function LinkedMentions({ beat, count, rows, p = 1, glow = 0 }: { beat: Beat; count: number; rows: readonly { label: string; kind?: 'card' | 'page'; p?: number }[]; p?: number; glow?: number }) {
  return (
    <section className="card-backlinks kit-mentions" style={{ ...rise(beat, p, 8), boxShadow: glow > 0 ? `0 0 0 ${(2 * clamp(glow)).toFixed(2)}px var(--accent-soft)` : undefined }}>
      <p className="backlinks__header kit-mentions__head">
        <span className="backlinks__title">
          Linked mentions ({count.toLocaleString('en-US')})
        </span>
      </p>
      <ul className="card-backlinks__list kit-mentions__list">
        {rows.map((row) => (
          <li key={row.label} style={rise(beat, row.p ?? 1, 4)}>
            <span className={`kit-app__icon kit-app__icon--${row.kind ?? 'card'}`} aria-hidden="true" />
            <span className="card-strip__page card-backlinks__page">{row.label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export type FilterId = 'all' | 'next' | 'due' | 'new' | 'archived'
const FILTERS: readonly { id: FilterId; label: string; icon: () => ReactElement }[] = [
  { id: 'all', label: 'All cards', icon: InboxTrayIcon },
  { id: 'next', label: 'Up next', icon: UpNextIcon },
  { id: 'due', label: 'Due today', icon: DueIcon },
  { id: 'new', label: 'New cards', icon: () => <NewIcon /> },
  { id: 'archived', label: 'Archived', icon: ArchiveIcon },
]

/**
 * The All cards menu, open over `p`. `counts` per row (a string: "10 / 48"); `active` lights a row; `countGlow` lights
 * a count (look: it is clickable); `adding` turns the New cards row into "Add [n] more new cards", `enter` presses it.
 */
export function FilterMenu({ beat, p, counts, active = {}, countGlow = {}, adding, enter = 0 }: { beat: Beat; p: number; counts: Readonly<Record<FilterId, string>>; active?: Partial<Record<FilterId, number>>; countGlow?: Partial<Record<FilterId, number>>; adding?: { n: number; p: number }; enter?: number }) {
  const q = clamp(p)
  if (q <= 0) return null
  return (
    <div className="ctx-menu card-inbox__filter-menu kit-filter" role="menu" aria-label="All cards" style={rise(beat, q, -4)}>
      {FILTERS.map((f) => {
        const a = clamp(active[f.id] ?? 0)
        const g = clamp(countGlow[f.id] ?? 0)
        const addingHere = f.id === 'new' && adding !== undefined && adding.p > 0
        return (
          <div key={f.id}>
            {f.id === 'archived' && <div className="card-inbox__filter-sep kit-filter__sep" role="separator" />}
            <span className="ctx-menu__item card-inbox__filter-item kit-filter__row" data-filter={f.id} style={a > 0 ? { background: `color-mix(in srgb, var(--accent-soft) ${(a * 100).toFixed(0)}%, transparent)` } : undefined}>
              <span className="card-inbox__filter-name kit-filter__name">
                <f.icon />
                {addingHere ? (
                  <span className="kit-filter__add" style={{ opacity: clamp(adding.p * 2) }}>
                    Add <span className="kit-filter__field" data-pressed={enter > 0 ? 'true' : undefined}>{adding.n}</span> more new cards
                  </span>
                ) : (
                  f.label
                )}
              </span>
              {!addingHere && (
                <span className="card-inbox__count kit-filter__count" data-filter={f.id} style={g > 0 ? { boxShadow: `0 0 0 ${(2 * g).toFixed(2)}px var(--accent)`, borderRadius: 999 } : undefined}>
                  {counts[f.id]}
                </span>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export interface ReviewRow {
  when: string
  answer: 'forgot' | 'remembered'
  /** 0..1: the row goes (its bin was clicked). */
  gone?: number
  /** 0..1: the bin is under the pointer. */
  bin?: number
}

/**
 * A card's Reviews strip, as the app's one strip (`cardParts.tsx` `CardReviews`: "✓ 4 Reviews", closed until asked
 * for; its class names, so the app's `cardScreens.css` gives its look). `count` (absent: the rows), `next` the card's
 * next due day on the strip's right; `open` unfolds the rows: each answer, its day and its bin. `p` brings the strip in;
 * `glow` lights it.
 */
export function ReviewsStrip({ beat, rows = [], count, next, open = 0, empty, p = 1, glow = 0 }: { beat: Beat; rows?: readonly ReviewRow[]; count?: number; next?: string; open?: number; empty?: string; p?: number; glow?: number }) {
  const o = beat.reduced ? (open > 0 ? 1 : 0) : ease.out(clamp(open))
  const live = rows.filter((r) => (r.gone ?? 0) < 1)
  const q = clamp(p)
  return (
    <section className="card-reviews card-reviews--strip kit-reviews" style={{ ...rise(beat, q, 4), ...glowStyle(glow) }}>
      <div className="card-reviews__bar">
        <span className="backlinks__header card-reviews__toggle">
          <ReviewsIcon />
          <span className="backlinks__title">{reviewsTitle(count ?? live.length)}</span>
        </span>
        {next !== undefined && <span className="card-strip card-reviews__facts">Next due {next}</span>}
      </div>
      {o > 0 && (
        <div className="kit-reviews__table" style={{ maxHeight: `${(o * 12).toFixed(2)}em`, opacity: clamp(open * 2) }}>
          {live.length === 0 ? (
            <p className="kit-reviews__empty">{empty ?? 'No reviews yet.'}</p>
          ) : (
            rows.map((row) => {
              const gone = clamp(row.gone ?? 0)
              if (gone >= 1) return null
              return (
                <p key={row.when} className="kit-reviews__row" style={{ opacity: 1 - gone, transform: beat.reduced || gone === 0 ? undefined : `translateX(${(gone * 24).toFixed(1)}px)` }}>
                  <span className="kit-reviews__when">{row.when}</span>
                  <span className="card-answer kit-reviews__answer" data-rating={row.answer === 'forgot' ? 'again' : 'good'}>
                    {row.answer === 'forgot' ? <ForgotIcon /> : <RememberedIcon />}
                    {row.answer === 'forgot' ? 'Forgot' : 'Remembered'}
                  </span>
                  <span className="kit-reviews__bin" style={(row.bin ?? 0) > 0 ? { color: 'var(--danger)', opacity: 0.5 + 0.5 * clamp(row.bin ?? 0) } : undefined} aria-hidden="true">
                    <TrashIcon size={13} />
                  </span>
                </p>
              )
            })
          )}
        </div>
      )}
    </section>
  )
}

