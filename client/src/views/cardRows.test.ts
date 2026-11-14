import { describe, expect, it } from 'vitest'
import type { CardRecord } from '@shared/cardLine'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { cardRowRecords } from './cardRows'
import { defaultLabel, propertyKeys, runView } from './engine'
import { DateValue } from './expr'
import type { ViewDef, ViewSet } from './viewSchema'
import { allPropertyKeys } from './view/properties'
import { exprToRule, inferType, propertyValues, ruleToExpr } from './view/filterRows'
import { columnTyping } from './editorType'
import { setViewOrder } from './view/columnOrder'

/**
 * YAZ-5319: a table that lists cards. One row per card under the folder (a card file's card, each card with an ID in
 * a page), off the index's `cards`; the card columns, named "Card …"; filters, sorts and hide or show as for pages.
 */
const NOW = new Date(2026, 10, 14, 9, 0).getTime()
const record = (name: string, over: Partial<IndexRecord> = {}): IndexRecord => ({
  path: `/v/Geo/${name}.md`, name: `${name}.md`, basename: name, title: name, folder: 'Geo', ext: 'md', size: 1, ctime: 1, mtime: 1,
  properties: { status: 'draft' }, aliases: [], tags: [], links: [], embeds: [], ...over,
})
const card = (id: string | null, over: Partial<CardRecord> = {}): CardRecord => ({ id, off: false, next: false, reviews: [], ...over })
const PAGES = [
  record('Europe trip', {
    cards: [
      card('GEO-1', { title: 'Capital of Spain', off: true, reviews: [{ at: '2026-11-01T09:00Z', rating: 'good' }, { at: '2026-11-03T09:00Z', rating: 'again' }] }),
      card('GEO-2', { next: true }),
      // No ID yet (before the sweep), and a copy of an ID the page holds already: no row.
      card(null),
      card('GEO-1', { title: 'Copy' }),
    ],
  }),
  record('GEO-3', { kind: 'card', title: 'Longest river', cards: [card('GEO-3', { title: 'Longest river', reviews: [{ at: '2026-11-10T09:00Z', rating: 'good' }] })] }),
  record('Plain'),
]
const CARDS: ViewDef = { type: 'table', name: 'Cards', rows: 'cards' }
const DEF: ViewSet = { views: [CARDS] }
const run = (view: ViewDef = CARDS, records = cardRowRecords(PAGES)) => runView({ views: [view] }, view, records, { now: NOW, cardSettings: DEFAULT_REVIEW_SETTINGS })

describe('YAZ-5319: card rows', () => {
  it('one row per card: a card in a page (its search row path) and a card file (its own path); the name is the card title, else its ID', () => {
    const rows = cardRowRecords(PAGES)
    expect(rows.map((r) => [r.path, r.title, r.kind])).toEqual([
      ['/v/Geo/Europe trip.md#GEO-1', 'Capital of Spain', 'card'],
      ['/v/Geo/Europe trip.md#GEO-2', 'GEO-2', 'card'],
      ['/v/Geo/GEO-3.md', 'Longest river', 'card'],
    ])
    // The page's properties do not apply to a card this round (YAZ-5349): only the two card fields a cell edits.
    expect(rows[0].properties).toEqual({ 'card.status': 'Archived', 'card.upNext': false })
    // The same records for the same pages: a run reads no card twice.
    expect(cardRowRecords(PAGES)).toBe(rows)
  })

  it('shows the name and every card column by default, each named "Card …" but the Page', () => {
    expect(propertyKeys(DEF, CARDS, [])).toEqual(['file.name', 'card.page', 'card.status', 'card.nextReview', 'card.lastReview', 'card.reviews', 'card.successRate', 'card.upNext', 'card.id'])
    expect(propertyKeys(DEF, CARDS, []).map(defaultLabel)).toEqual(['Name', 'Page', 'Card status', 'Card next review', 'Card last review', 'Card reviews', 'Card success rate', 'Card up next', 'Card ID'])
  })

  it('each column\'s value: the page, the status, the reviews from the schedule, Up next, the ID', () => {
    const values = run().rows.map((r) => r.values)
    const [spain, plain, river] = values
    expect([spain['file.name'], spain['card.page'], spain['card.status'], spain['card.reviews'], spain['card.successRate'], spain['card.upNext'], spain['card.id']]).toEqual(['Capital of Spain', 'Europe trip', 'Archived', 2, 50, false, 'GEO-1'])
    // An archived card is out of review: no next review. Its last review is its latest.
    expect(spain['card.nextReview']).toBeNull()
    expect((spain['card.lastReview'] as DateValue).ms).toBe(Date.parse('2026-11-03T09:00Z'))
    // A new card: nothing reviewed, nothing scheduled; it is Up next.
    expect([plain['card.status'], plain['card.nextReview'], plain['card.lastReview'], plain['card.reviews'], plain['card.successRate'], plain['card.upNext']]).toEqual(['Active', null, null, null, null, true])
    // A card file lives in itself: no Page. Its next review is the schedule's date, after its last.
    expect([river['card.page'], river['card.status'], river['card.reviews'], river['card.successRate'], river['card.id']]).toEqual([null, 'Active', 1, 100, 'GEO-3'])
    expect((river['card.nextReview'] as DateValue).ms).toBeGreaterThan(Date.parse('2026-11-10T09:00Z'))
  })

  it('"Card status is Archived" finds the archived card inside a page; the rule reads back as the Filter menu row', () => {
    const rule = { property: 'card.status', op: 'is' as const, value: 'Archived' }
    const expr = ruleToExpr(rule, inferType('card.status', [], columnTyping('card.status', [])))
    expect(expr).toBe('card.status == "Archived"')
    expect(exprToRule(expr)).toEqual(rule)
    expect(run({ ...CARDS, filters: expr }).rows.map((r) => r.record.path)).toEqual(['/v/Geo/Europe trip.md#GEO-1'])
    // Card status is a Select of Active and Archived; Up next a checkbox; the reviews dates and numbers.
    expect(propertyValues('card.status', cardRowRecords(PAGES), columnTyping('card.status', []))).toEqual(['Active', 'Archived'])
    expect(['card.upNext', 'card.nextReview', 'card.reviews', 'card.id'].map((k) => inferType(k, []))).toEqual(['checkbox', 'date', 'number', 'text'])
    expect(run({ ...CARDS, filters: ruleToExpr({ property: 'card.upNext', op: 'checked', value: '' }) }).rows.map((r) => r.record.title)).toEqual(['GEO-2'])
  })

  it('sorts and groups by a card column', () => {
    const sorted = run({ ...CARDS, sort: [{ property: 'card.successRate', direction: 'DESC' }] })
    expect(sorted.rows.map((r) => r.record.title)).toEqual(['Longest river', 'Capital of Spain', 'GEO-2'])
    const grouped = run({ ...CARDS, groupBy: { property: 'card.status', direction: 'ASC' } })
    expect(grouped.groups?.map((g) => [g.label, g.rows.length])).toEqual([['Active', 2], ['Archived', 1]])
  })

  it('hide and show write the view\'s own card columns, so the pages\' columns come back as they were; a page\'s view shows no card column', () => {
    const def: ViewSet = { views: [{ ...CARDS, order: ['file.name', 'note.status'] }] }
    setViewOrder(def, 0, ['file.name', 'card.status'])
    expect(def.views[0]).toMatchObject({ order: ['file.name', 'note.status'], cardOrder: ['file.name', 'card.status'] })
    expect(propertyKeys(def, def.views[0], [])).toEqual(['file.name', 'card.status'])
    const pages = { ...def.views[0], rows: undefined }
    expect(propertyKeys(def, pages, PAGES)).toEqual(['file.name', 'note.status'])
    // A page's column in the card columns never shows there.
    expect(propertyKeys(def, { ...CARDS, cardOrder: ['file.name', 'note.status', 'card.id'] }, [])).toEqual(['file.name', 'card.id'])
  })

  it('offers the card columns, the Folder and the formulas; no page property (YAZ-5349 scopes card properties)', () => {
    const keys = allPropertyKeys({ views: [CARDS], formulas: { x: '1' } }, CARDS, cardRowRecords(PAGES), { status: { kind: 'text' } })
    expect(keys).toEqual(['file.name', 'card.page', 'card.status', 'card.nextReview', 'card.lastReview', 'card.reviews', 'card.successRate', 'card.upNext', 'card.id', 'file.folder', 'formula.x'])
  })

  it('only a Table lists cards this round; the setting is on the view for a Board or a Calendar later', () => {
    const board: ViewDef = { type: 'board', name: 'B', rows: 'cards' }
    expect(propertyKeys({ views: [board] }, board, PAGES)).not.toContain('card.status')
  })
})
