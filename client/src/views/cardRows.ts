/**
 * Cards as rows (YAZ-5319, Yaseen: "you edit the table view settings to allow for show all cards"): a view whose `rows`
 * is `cards` lists ONE row per card under the folder, card files and cards inside pages alike, and no page. The rows
 * are records the table's one pipeline runs on (filters, sorts, groups, hide and show), made here from the folder's
 * pages, off the index's `cards` (`cardsWithIds`, search's card rows' source): no file read.
 *
 *  - A card file's row is the file itself (its path). A card inside a page has its search row's path,
 *    `cardRowPath(page, id)`: no file has it, it keys the row.
 *  - The name is the card's title, off its card line (YAZ-5308); a card with none reads as its ID.
 *  - The page's properties do not apply to a card (YAZ-5349 scopes card properties): a row holds only the two card
 *    fields a cell edits, `card.status` and `card.upNext`, under those keys.
 *  - The card columns are `card.*` keys, read through the scope's `card` (`cardValues`): `card.status == "Archived"`
 *    filters as a page column does. Review numbers come from `cardSchedule.ts` and are read-only.
 *
 * The setting is on the VIEW (`ViewDef.rows`), so a Board or a Calendar can read it later; this round only the Table
 * does (`cardRowsOf`). It is offered only while the vault has Cards and IDs on; off, a view shows its pages again.
 */
import { cardsWithIds, type CardRecord } from '@shared/cardLine'
import { cardDueAt, cardReviewNumbers } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { cardRowPath } from '../search/searchCandidates'
import { DateValue, type Value } from './expr'
import type { ViewDef } from './viewSchema'

/** What a card row is: its card, its ID and place, and where it lives. */
export interface CardRow {
  card: CardRecord
  id: string
  /** Its place among the page's cards (`findCards` order). */
  index: number
  /** The file the card is in (absolute): a card file's own path, or the page that holds it. */
  page: string
  /** The page's title; null for a card file, which lives in itself. */
  pageTitle: string | null
}

/** The card columns, in the order a view in cards mode shows them first (Yaseen's Q40 list). */
export const CARD_KEYS = ['card.page', 'card.status', 'card.nextReview', 'card.lastReview', 'card.reviews', 'card.successRate', 'card.upNext', 'card.id'] as const

/** Their names, each "Card …" but the Page (YAZ-5319). */
export const CARD_FIELD_LABELS: Readonly<Record<string, string>> = {
  'card.page': 'Page',
  'card.status': 'Card status',
  'card.nextReview': 'Card next review',
  'card.lastReview': 'Card last review',
  'card.reviews': 'Card reviews',
  'card.successRate': 'Card success rate',
  'card.upNext': 'Card up next',
  'card.id': 'Card ID',
}

/** Card status's two words: what the cell, the filter and the line's `off` mean. */
export const CARD_STATUSES = ['Active', 'Archived'] as const

/** A key of the card columns: `card.status`, … (they are no page's property). */
export const isCardKey = (key: string): boolean => key.startsWith('card.')

/** The two card columns a cell edits (status writes the line's `off`, Up next its `next`); null for any other key. */
export const cardEditKey = (key: string): 'card.status' | 'card.upNext' | null => (key === 'card.status' || key === 'card.upNext' ? key : null)

/** A card column's cell as text where it is not the value as written (YAZ-5319): the success rate in percent, "67%". Else null. */
export const cardCellText = (key: string, value: Value): string | null => (key === 'card.successRate' && typeof value === 'number' ? `${value}%` : null)

/** Whether a view lists cards (`rows: cards`): only a Table, this round. */
export const cardRowsOf = (view: ViewDef): boolean => view.rows === 'cards' && view.type === 'table'

/** The columns a view in cards mode shows by itself: the name, then every card column. */
export const DEFAULT_CARD_ORDER: readonly string[] = ['file.name', ...CARD_KEYS]

const rowOf = new WeakMap<object, CardRow>()

/** The card a row stands for; undefined for a page's row. */
export const cardRowOfRecord = (record: object): CardRow | undefined => rowOf.get(record)

const madeFor = new WeakMap<readonly IndexRecord[], IndexRecord[]>()

/**
 * One record per card of `pages` (a card file's card, and each card with an ID inside a page), in the pages' order,
 * then page order. The same array back for the same `pages`: a run that the records start reads no card twice.
 */
export function cardRowRecords(pages: readonly IndexRecord[]): IndexRecord[] {
  const known = madeFor.get(pages)
  if (known !== undefined) return known
  const out: IndexRecord[] = []
  for (const r of pages) {
    const { id: _pageId, properties: _properties, ...file } = r
    for (const { card, id, index } of cardsWithIds(r.cards)) {
      const own = r.kind === 'card'
      // A card file holds one card: a second is no card of its (YAZ-5037).
      if (own && index > 0) break
      const record: IndexRecord = {
        ...file,
        path: own ? r.path : cardRowPath(r.path, id),
        title: card.title ?? id,
        kind: 'card',
        properties: { 'card.status': card.off ? 'Archived' : 'Active', 'card.upNext': card.next },
        aliases: [],
        links: own ? r.links : [],
        embeds: own ? r.embeds : [],
        cards: [card],
      }
      rowOf.set(record, { card, id, index, page: r.path, pageTitle: own ? null : r.title })
      out.push(record)
    }
  }
  madeFor.set(pages, out)
  return out
}

/**
 * A card row's columns as the scope's `card` (`card.status`, `card.nextReview`, …). Next review: when a card in review
 * is due (the schedule's own date); blank for a new card, an archived one, or with no settings. Last review, the
 * number of reviews and the success rate (how often it was remembered, whole percent): off its reviews; blank for none.
 */
export function cardValues(row: CardRow, settings: ReviewSettings | undefined): Record<string, Value> {
  const { card } = row
  const numbers = cardReviewNumbers(card.reviews)
  const due = settings === undefined || card.off || card.reviews.length === 0 ? Number.NaN : cardDueAt(card.reviews, settings)
  return {
    page: row.pageTitle,
    status: card.off ? 'Archived' : 'Active',
    nextReview: Number.isNaN(due) ? null : new DateValue(due, false),
    lastReview: numbers.last === null ? null : new DateValue(numbers.last, false),
    reviews: numbers.reviews === 0 ? null : numbers.reviews,
    successRate: numbers.successRate,
    upNext: card.next,
    id: row.id,
  }
}
