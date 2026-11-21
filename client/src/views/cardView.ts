/**
 * Each row kind keeps its own table (YAZ-5349 follow-up; Yaseen, 2026-11-14 23:49: "if I have Show rows as cards, and
 * then I add a column. Shouldn't it add that column to the cards and not the page?"). A view that shows cards as rows
 * (YAZ-5319) is a table OF CARDS: its columns, their labels and types, its sorts, filters, groups, widths, wraps,
 * alignments, fills, frozen columns and rows and its calculations are the cards', and none of them is the pages'. The
 * reverse too: nothing the Pages table does reaches the Cards table.
 *
 * ONE place knows which kind a view shows: this lens. On disk a table view holds its pages' table where it always has
 * (`order`, `sort`, … on the view; the labels in the def's `properties`; the columns' types in the folder's `columns`)
 * and its cards' table in ONE key of its own, `cardView`, with the same keys, plus `columns` (each card column's
 * type, `ColumnDecl`, by its bare name) and `properties` (the labels). While the view shows cards, `ViewsPane` hands
 * every reader the def through the lens (`cardLensOn`): the cards' table where the pages' stands, so the table, the
 * menus and the engine read and write `order`, `sort`, `properties` … as they always do, and know nothing of kinds.
 * Every write goes back through it (`throughCardLens`), which puts each part where it lives. The pages' table rides
 * along, out of sight, untouched (`PAGE_TABLE`).
 *
 * A view from before this (YAZ-5319) holds its cards' columns in `cardOrder`: read as the cards' `order`; the next write
 * moves it into `cardView`.
 */
import { isRecord } from '@shared/guards'
import type { ColumnDecl } from './folderSettingsRead'
import type { ViewDef, ViewSet } from './viewSchema'

/** The keys of a view that are its table's, one set per row kind (the rest — its name, type, look — is the view's). */
export const TABLE_KEYS = ['order', 'filters', 'sort', 'groupBy', 'summaries', 'columnSize', 'columnWrap', 'columnAlign', 'columnFill', 'frozenColumns', 'frozenRows', 'fills'] as const
type TableKey = (typeof TABLE_KEYS)[number]

/** The cards' table of a view, as it is stored (`view.cardView`). */
export type CardTable = Partial<Pick<ViewDef, TableKey>> & {
  /** Each card column's type, by its bare name: what the folder's `columns` is to the pages. */
  columns?: Record<string, ColumnDecl>
  /** The card columns' labels: what the def's `properties` is to the pages. */
  properties?: ViewSet['properties']
}

/** Where a view keeps its cards' table. */
export const CARD_TABLE = 'cardView'
/** YAZ-5319's cards' order, read once, never written again. */
const LEGACY_CARD_ORDER = 'cardOrder'
/** Through the lens: the card columns' types, on the view. */
export const CARD_COLUMNS = 'cardColumns'
/** Through the lens: the pages' table, out of sight on the view it belongs to. Never written to disk. */
const PAGE_TABLE = 'pageTable'

const pick = (o: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))
const omit = (o: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
const filled = (o: Record<string, unknown> | undefined): o is Record<string, unknown> => o !== undefined && Object.keys(o).length > 0

/** Whether `def` is seen through the card lens (`cardLensOn`): the open view is a Card table (YAZ-5793 reads it for the labels). */
export const isCardLens = (def: ViewSet): boolean => def.views.some((v) => isRecord((v as ViewDef & Record<string, unknown>)[PAGE_TABLE]))

/** A view's cards' table as stored; a YAZ-5319 view's `cardOrder` reads as its order. */
export function cardTableOf(view: ViewDef): CardTable {
  const stored = view[CARD_TABLE]
  if (isRecord(stored)) return stored as CardTable
  const legacy = view[LEGACY_CARD_ORDER]
  return Array.isArray(legacy) ? { order: legacy as string[] } : {}
}

/** The card columns' types of a view seen through the lens (`ViewsPane`'s card host reads and writes them here). */
export const cardColumnsOf = (view: ViewDef): Readonly<Record<string, ColumnDecl>> => (isRecord(view[CARD_COLUMNS]) ? (view[CARD_COLUMNS] as Record<string, ColumnDecl>) : NO_COLUMNS)
const NO_COLUMNS: Readonly<Record<string, ColumnDecl>> = {}

/**
 * The def as the view at `index` shows it while it lists cards: that view's table is its cards' (the pages' rides along
 * unseen), and the labels are the cards'. Pure: `def` is not touched; the other views are the same objects.
 */
export function cardLensOn(def: ViewSet, index: number): ViewSet {
  const stored = def.views[index] as ViewDef & Record<string, unknown>
  const { columns, properties, ...table } = cardTableOf(stored)
  const view = {
    ...omit(stored, [...TABLE_KEYS, CARD_TABLE, LEGACY_CARD_ORDER]),
    ...pick(table as Record<string, unknown>, TABLE_KEYS),
    ...(filled(columns) && { [CARD_COLUMNS]: columns }),
    [PAGE_TABLE]: pick(stored, TABLE_KEYS),
  } as unknown as ViewDef
  const out: ViewSet = { ...def, views: def.views.map((v, i) => (i === index ? view : v)) }
  if (properties === undefined) delete out.properties
  else out.properties = properties
  return out
}

/**
 * Back from the lens, in place: each view seen through it (found by the pages' table it carries, so a view moved or
 * copied by the write is found too) holds its pages' table again and its cards' in `cardView`; the labels written are
 * the cards', and `pageLabels` are the def's again.
 */
export function cardLensOff(d: ViewSet, pageLabels: ViewSet['properties']): void {
  const cardLabels = d.properties
  if (pageLabels === undefined) delete d.properties
  else d.properties = pageLabels
  d.views = d.views.map((v) => {
    const lensed = v as ViewDef & Record<string, unknown>
    if (!isRecord(lensed[PAGE_TABLE])) return v
    const table: CardTable = {
      ...(pick(lensed, TABLE_KEYS) as CardTable),
      ...(filled(lensed[CARD_COLUMNS] as Record<string, unknown> | undefined) && { columns: lensed[CARD_COLUMNS] as Record<string, ColumnDecl> }),
      ...(filled(cardLabels) && { properties: cardLabels }),
    }
    const view = { ...omit(lensed, [...TABLE_KEYS, PAGE_TABLE, CARD_COLUMNS]), ...(lensed[PAGE_TABLE] as Record<string, unknown>) } as ViewDef
    if (filled(table)) view[CARD_TABLE] = table
    return view
  })
}

/** A write made through the lens on the view at `index`: `mutate` sees the def as `cardLensOn` shows it, and every part lands where it lives. */
export const throughCardLens =
  (index: number, mutate: (def: ViewSet) => void) =>
  (d: ViewSet): void => {
    const pageLabels = d.properties
    const seen = cardLensOn(d, index)
    for (const k of Object.keys(d)) if (!Object.hasOwn(seen, k)) delete d[k]
    Object.assign(d, seen)
    mutate(d)
    cardLensOff(d, pageLabels)
  }
