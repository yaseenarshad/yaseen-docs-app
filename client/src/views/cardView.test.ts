/**
 * YAZ-5349 follow-up (Yaseen, 2026-11-14 23:49): a view that shows cards as rows is a table OF CARDS. Every part of a
 * table a folder page has — its columns, their types and labels, its sorts, filters, groups, widths, wraps, alignments,
 * fills, frozen columns and rows, calculations — is the cards' own while it lists cards, and the pages' own while it
 * lists pages: a write in one never reaches the other. `cardView.ts` is the one place that knows which kind it shows.
 */
import { describe, expect, it } from 'vitest'
import { cardColumnsOf, cardLensOn, throughCardLens } from './cardView'
import type { ViewDef, ViewSet } from './viewSchema'

const PAGES_TABLE = {
  order: ['file.name', 'note.Topic'],
  filters: 'note.Topic == "Art"',
  sort: [{ property: 'note.Topic', direction: 'ASC' as const }],
  groupBy: { property: 'note.Topic' },
  summaries: { 'note.Topic': 'count' },
  columnSize: { 'file.name': 300 },
  columnWrap: { 'note.Topic': false },
  columnAlign: { 'note.Topic': 'right' as const },
  columnFill: { 'note.Topic': 'blue' },
  frozenColumns: 1,
  frozenRows: 2,
  fills: [{ page: '[[Art]]', fill: 'yellow' }],
}
const def = (): ViewSet => ({
  views: [{ type: 'table', name: 'Table', rows: 'cards', rowNumbers: false, ...structuredClone(PAGES_TABLE) }, { type: 'board', name: 'Board' }],
  properties: { 'note.Topic': { displayName: 'Subject' } },
  formulas: { x: '1' },
})
/** A write while the first view lists cards, as `ViewsPane` makes it. */
const inCards = (d: ViewSet, mutate: (d: ViewSet) => void): ViewSet => {
  throughCardLens(0, mutate)(d)
  return d
}
/** The pages' table of the first view, as stored. */
const pagesOf = (d: ViewSet): Record<string, unknown> => Object.fromEntries(Object.keys(PAGES_TABLE).map((k) => [k, d.views[0][k]]))

/** Each thing a folder page's table writes on its view, and the value a Cards table writes there. */
const WRITES: Array<[string, keyof typeof PAGES_TABLE, unknown]> = [
  ['shows, hides or reorders a column', 'order', ['file.name', 'card.status', 'note.level']],
  ['filters', 'filters', 'card.status == "Archived"'],
  ['sorts', 'sort', [{ property: 'note.level', direction: 'DESC' }]],
  ['groups', 'groupBy', [{ property: 'card.status' }]],
  ['adds a calculation', 'summaries', { 'card.reviews': 'sum' }],
  ['sets a column width', 'columnSize', { 'note.level': 120 }],
  ['wraps or clips a column', 'columnWrap', { 'note.level': true }],
  ['aligns a column', 'columnAlign', { 'card.reviews': 'center' }],
  ['fills a column', 'columnFill', { 'note.level': 'green' }],
  ['freezes columns', 'frozenColumns', 2],
  ['freezes rows', 'frozenRows', 1],
  ['fills a cell or a row', 'fills', [{ page: '[[Trip]]', column: 'note.level', fill: 'pink' }]],
]

describe('the Cards table keeps its own table: each write lands on the cards, never on the pages', () => {
  it.each(WRITES)('%s', (_what, key, value) => {
    const d = inCards(def(), (seen) => {
      // The table writes the key as it always does: through the lens it is the cards' own.
      ;(seen.views[0] as Record<string, unknown>)[key] = structuredClone(value)
    })
    expect(d.views[0].cardView).toEqual({ [key]: value })
    expect(pagesOf(d)).toEqual(PAGES_TABLE)
    // The table sees it while it lists cards; the pages' table is out of sight.
    expect(cardLensOn(d, 0).views[0][key]).toEqual(value)
    for (const other of Object.keys(PAGES_TABLE).filter((k) => k !== key)) expect(cardLensOn(d, 0).views[0][other], other).toBeUndefined()
  })

  it('a new Cards table starts empty: the pages\' sorts, filters and columns are not the cards\'', () => {
    const seen = cardLensOn(def(), 0).views[0]
    for (const key of Object.keys(PAGES_TABLE)) expect(seen[key], key).toBeUndefined()
    // The view's own look stays the view's, in both kinds.
    expect(seen).toMatchObject({ type: 'table', name: 'Table', rows: 'cards', rowNumbers: false })
  })

  it('a renamed column is the cards\' label; the page\'s label for the same key stays', () => {
    const d = inCards(def(), (seen) => {
      seen.properties = { ...seen.properties, 'note.Topic': { displayName: 'Card topic' } }
    })
    expect(d.properties).toEqual({ 'note.Topic': { displayName: 'Subject' } })
    expect(d.views[0].cardView).toEqual({ properties: { 'note.Topic': { displayName: 'Card topic' } } })
    expect(cardLensOn(d, 0).properties).toEqual({ 'note.Topic': { displayName: 'Card topic' } })
  })

  it('a column\'s type is the cards\' table\'s: on the view, never in the folder\'s columns', () => {
    const d = inCards(def(), (seen) => {
      seen.views[0].cardColumns = { Topic: { kind: 'select', options: ['Art'] } }
    })
    expect(d.views[0].cardView).toEqual({ columns: { Topic: { kind: 'select', options: ['Art'] } } })
    expect(cardColumnsOf(cardLensOn(d, 0).views[0])).toEqual({ Topic: { kind: 'select', options: ['Art'] } })
    expect(d.columns).toBeUndefined()
  })

  it('back to Pages: every part of the pages\' table is as it was, and the cards\' waits for the next switch', () => {
    let d = inCards(def(), (seen) => {
      seen.views[0].order = ['file.name', 'note.level']
      seen.views[0].sort = [{ property: 'note.level', direction: 'ASC' }]
    })
    d = inCards(d, (seen) => {
      delete seen.views[0].rows
    })
    expect(pagesOf(d)).toEqual(PAGES_TABLE)
    expect(d.views[0].rows).toBeUndefined()
    expect(d.views[0].cardView).toEqual({ order: ['file.name', 'note.level'], sort: [{ property: 'note.level', direction: 'ASC' }] })
    expect(d.properties).toEqual({ 'note.Topic': { displayName: 'Subject' } })
  })

  it('a write in the Pages table never reaches the cards\'', () => {
    const d = inCards(def(), (seen) => {
      seen.views[0].order = ['file.name', 'card.id']
    })
    // Pages: no lens, as `ViewsPane` writes a view that lists pages.
    delete d.views[0].rows
    d.views[0].order = ['file.name']
    d.views[0].sort = []
    expect(d.views[0].cardView).toEqual({ order: ['file.name', 'card.id'] })
  })

  it('the other views and the def\'s other keys are left as they are', () => {
    const d = inCards(def(), (seen) => {
      seen.views[0].sort = [{ property: 'card.id', direction: 'ASC' }]
    })
    expect(d.views[1]).toEqual({ type: 'board', name: 'Board' })
    expect(d.formulas).toEqual({ x: '1' })
  })

  it('a view copied or moved by the write is put back too: no lens key reaches the file', () => {
    const d = inCards(def(), (seen) => {
      seen.views[0].sort = [{ property: 'card.id', direction: 'ASC' }]
      seen.views = [seen.views[1], seen.views[0], { ...structuredClone(seen.views[0]), name: 'Copy' }]
    })
    for (const v of [d.views[1], d.views[2]]) {
      expect(Object.keys(v)).not.toContain('pageTable')
      expect(Object.keys(v)).not.toContain('cardColumns')
      expect(v.cardView).toEqual({ sort: [{ property: 'card.id', direction: 'ASC' }] })
      expect(v.order).toEqual(PAGES_TABLE.order)
    }
  })

  it('a YAZ-5319 view\'s `cardOrder` is the cards\' order, and the next write moves it into `cardView`', () => {
    const old: ViewSet = { views: [{ type: 'table', name: 'T', rows: 'cards', order: ['file.name', 'note.Topic'], cardOrder: ['file.name', 'card.id'] } as ViewDef] }
    expect(cardLensOn(old, 0).views[0].order).toEqual(['file.name', 'card.id'])
    const d = inCards(old, (seen) => {
      seen.views[0].sort = [{ property: 'card.id', direction: 'ASC' }]
    })
    expect(d.views[0]).toEqual({ type: 'table', name: 'T', rows: 'cards', order: ['file.name', 'note.Topic'], cardView: { order: ['file.name', 'card.id'], sort: [{ property: 'card.id', direction: 'ASC' }] } })
  })
})
