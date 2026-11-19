/**
 * Cards as rows (YAZ-5319, Yaseen: "you edit the table view settings to allow for show all cards"): a view whose `rows`
 * is `cards` lists ONE row per card under the folder, card files and cards inside pages alike, and no page. The rows
 * are records the table's one pipeline runs on (filters, sorts, groups, hide and show), made here from the folder's
 * pages, off the index's `cards` (`cardsWithIds`, search's card rows' source): no file read.
 *
 *  - A card file's row is the file itself (its path). A card inside a page has its search row's path,
 *    `cardRowPath(page, id)`: no file has it, it keys the row.
 *  - The name is the card's title, off its card line (YAZ-5308); a card with none reads as its ID.
 *  - The page's properties do not apply to a card: a row holds the card's OWN properties, off its card line (YAZ-5349
 *    option A, YAZ-5385), and the card fields a cell edits, `card.status`, `card.fix` (YAZ-5430) and `card.upNext`,
 *    under those keys. A card property is a column as a page's is (`note.level`): it filters, sorts and groups; its cell edit writes the
 *    card line (`cardLineChange`). No page's own property is a card's column (Yaseen: no pre-made "Page tags").
 *  - The card columns are `card.*` keys, read through the scope's `card` (`cardValues`): `card.status == "Archived"`
 *    filters as a page column does. Review numbers come from `cardSchedule.ts` and are read-only.
 *
 * The setting is on the VIEW (`ViewDef.rows`), so a Board or a Calendar can read it later; this round only the Table
 * does (`cardRowsOf`). It is offered only while the vault has Cards and IDs on; off, a view shows its pages again.
 */
import { cardsWithIds, withCardFix, withCardNext, withCardOff, withCardProperty, withoutCardProperty, type CardLine, type CardRecord } from '@shared/cardLine'
import { cardDueAt, cardMemory, cardReviewNumbers, dayCount, isNewCard } from '@shared/cardSchedule'
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

/**
 * The card columns (YAZ-5793, Yaseen's list): the ones a new Card table shows, in this order, then the ones Columns ⚙
 * offers hidden. Anki's Interval, Lapses and Retrievability are Wait time, Times forgotten and Recall chance.
 */
export const CARD_SHOWN_KEYS = ['card.status', 'card.nextReview', 'card.wait', 'card.forgotten', 'card.recall', 'card.lastReview'] as const
export const CARD_KEYS = [...CARD_SHOWN_KEYS, 'card.overdue', 'card.upNext', 'card.fix', 'card.reviews', 'card.successRate', 'card.page', 'card.id', 'card.file'] as const

/** Their names (YAZ-5793): the table holds only cards, so no name says "Card". The title column is "Title" (`propertyLabel`). */
export const CARD_FIELD_LABELS: Readonly<Record<string, string>> = {
  'card.status': 'Status',
  'card.nextReview': 'Next review date',
  'card.wait': 'Wait time',
  'card.forgotten': 'Times forgotten',
  'card.recall': 'Recall chance',
  'card.lastReview': 'Last review date',
  'card.overdue': 'Days overdue',
  'card.upNext': 'Up next status',
  'card.fix': 'Fix status',
  'card.reviews': 'Reviews',
  'card.successRate': 'Success rate',
  'card.page': 'Page',
  'card.id': 'ID',
  'card.file': 'File name',
}

/** Status's three words (YAZ-5793): New (no ✓ yet, `isNewCard`), Active, or Archived (the line's `off`). Only Archived is written. */
export const CARD_STATUSES = ['New', 'Active', 'Archived'] as const

/** A card's Status word. */
export const cardStatusOf = (card: CardRecord): (typeof CARD_STATUSES)[number] => (card.off ? 'Archived' : isNewCard(card.reviews) ? 'New' : 'Active')

/**
 * Card fix status's one word (YAZ-5430, Yaseen's Q53): "Needs fixing" while the line holds `fix` (Fix later, YAZ-5097);
 * blank when it does not. A card can be Active AND need a fix, so it is not a Card status.
 */
export const CARD_FIX_STATUS = 'Needs fixing'
export const CARD_FIX_STATUSES = [CARD_FIX_STATUS] as const

/** A key of the card columns: `card.status`, … (they are no page's property). */
export const isCardKey = (key: string): boolean => key.startsWith('card.')

/** The card columns a cell edits (status writes the line's `off`, fix status its `fix`, Up next its `next`); null for any other key. */
export const cardEditKey = (key: string): 'card.status' | 'card.fix' | 'card.upNext' | null => (key === 'card.status' || key === 'card.fix' || key === 'card.upNext' ? key : null)

/**
 * A card column's cell as text where it is not the value as written: the success rate and the recall chance in
 * percent, "67%" (YAZ-5319, YAZ-5793), and the wait in days, "4 days". Else null.
 */
export const cardCellText = (key: string, value: Value): string | null =>
  typeof value !== 'number' ? null : key === 'card.successRate' || key === 'card.recall' ? `${value}%` : key === 'card.wait' ? dayCount(value) : null

/**
 * The card line change a card row's writes make (YAZ-5319, YAZ-5385), in one write of its page: Card status writes
 * `off`, Card fix status `fix` (YAZ-5430: "Needs fixing" sets it, blank clears it; `withCardFix`, the phone's place),
 * Card up next writes `next`, any other key the card's own property (`withCardProperty`; no value: it goes).
 * A name the line cannot hold (a card line word) throws, and the cell says why.
 */
export const cardLineChange =
  (writes: readonly { key: string; value: unknown }[]) =>
  (line: CardLine): CardLine =>
    writes.reduce(
      (l, w) =>
        w.key === 'card.status'
          ? withCardOff(l, w.value === 'Archived')
          : w.key === 'card.fix'
            ? withCardFix(l, w.value === CARD_FIX_STATUS)
            : w.key === 'card.upNext'
              ? withCardNext(l, w.value === true)
              : w.value === undefined
                ? withoutCardProperty(l, w.key)
                : withCardProperty(l, w.key, w.value),
      line,
    )

/** The card properties of card rows, as `note.` keys in name order: a column each (YAZ-5385). */
export const cardPropertyKeys = (records: readonly { properties: Record<string, unknown> }[]): string[] =>
  [...new Set(records.flatMap((r) => Object.keys(r.properties).filter((k) => !isCardKey(k))))].sort().map((k) => `note.${k}`)

/** Whether a view lists cards (`rows: cards`): only a Table, this round. */
export const cardRowsOf = (view: ViewDef): boolean => view.rows === 'cards' && view.type === 'table'

/** The columns a new Card table shows (YAZ-5793): the title, then the shown card columns. Columns ⚙ offers the rest. */
export const DEFAULT_CARD_ORDER: readonly string[] = ['file.name', ...CARD_SHOWN_KEYS]

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
        properties: { ...card.properties, 'card.status': cardStatusOf(card), ...(card.fix === true && { 'card.fix': CARD_FIX_STATUS }), 'card.upNext': card.next },
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

/** Whole local days from the day of `due` to the day of `now`: 0 on the due day; negative before it. */
const daysPast = (due: number, now: number): number => Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(due).setHours(0, 0, 0, 0)) / 86_400_000)

/**
 * A card row's columns as the scope's `card` (`card.status`, `card.nextReview`, …) at `now`. Next review: when a card
 * in review is due (the schedule's own date). Wait time, Times forgotten and Recall chance (whole percent): off one
 * cached replay (`cardMemory`, YAZ-5793). Days overdue: whole days past the due date, 0 on it, blank before it. Each of
 * these is blank for a new card, an archived one, or with no settings. Last review, the number of reviews and the
 * success rate (how often it was remembered, whole percent): off its reviews; blank for none.
 */
export function cardValues(row: CardRow, settings: ReviewSettings | undefined, now: number): Record<string, Value> {
  const { card } = row
  const numbers = cardReviewNumbers(card.reviews)
  const status = cardStatusOf(card)
  const scheduled = settings !== undefined && status === 'Active'
  const due = scheduled ? cardDueAt(card.reviews, settings) : Number.NaN
  const memory = scheduled ? cardMemory(card.reviews, settings, now) : null
  const overdue = Number.isNaN(due) ? null : daysPast(due, now)
  return {
    page: row.pageTitle,
    status,
    fix: card.fix === true ? CARD_FIX_STATUS : null,
    nextReview: Number.isNaN(due) ? null : new DateValue(due, false),
    wait: memory?.wait ?? null,
    forgotten: memory?.forgotten ?? null,
    recall: memory === null ? null : Math.round(100 * memory.recall),
    overdue: overdue === null || overdue < 0 ? null : overdue,
    lastReview: numbers.last === null ? null : new DateValue(numbers.last, false),
    reviews: numbers.reviews === 0 ? null : numbers.reviews,
    successRate: numbers.successRate,
    upNext: card.next,
    id: row.id,
    file: row.page.slice(Math.max(row.page.lastIndexOf('/'), row.page.lastIndexOf('\\')) + 1),
  }
}
