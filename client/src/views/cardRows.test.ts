import { describe, expect, it } from 'vitest'
import type { CardRecord } from '@shared/cardLine'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { cardLineChange, cardRowRecords } from './cardRows'
import { formatCardLine, parseCardLine } from '@shared/cardLine'
import { defaultLabel, propertyKeys, runView } from './engine'
import { DateValue } from './expr'
import type { ViewDef, ViewSet } from './viewSchema'
import { allPropertyKeys } from './view/properties'
import { exprToRule, inferType, propertyValues, ruleToExpr } from './view/filterRows'
import { columnTyping } from './editorType'
import { setViewOrder } from './view/columnOrder'
import { cardLensOn, throughCardLens } from './cardView'

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
    expect(propertyKeys(DEF, CARDS, [])).toEqual(['file.name', 'card.page', 'card.status', 'card.fix', 'card.nextReview', 'card.lastReview', 'card.reviews', 'card.successRate', 'card.upNext', 'card.id'])
    expect(propertyKeys(DEF, CARDS, []).map(defaultLabel)).toEqual(['Name', 'Page', 'Card status', 'Card fix status', 'Card next review', 'Card last review', 'Card reviews', 'Card success rate', 'Card up next', 'Card ID'])
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
    // Through the card lens (`cardView.ts`), as `ViewsPane` writes a view that lists cards.
    throughCardLens(0, (d) => setViewOrder(d, 0, ['file.name', 'card.status']))(def)
    expect(def.views[0]).toMatchObject({ order: ['file.name', 'note.status'], cardView: { order: ['file.name', 'card.status'] } })
    const seen = cardLensOn(def, 0)
    expect(propertyKeys(seen, seen.views[0], [])).toEqual(['file.name', 'card.status'])
    const pages = { ...def.views[0], rows: undefined }
    expect(propertyKeys(def, pages, PAGES)).toEqual(['file.name', 'note.status'])
    // A page's column in the card columns never shows there; a YAZ-5319 `cardOrder` reads as the cards' order.
    const legacy = cardLensOn({ views: [{ ...CARDS, cardOrder: ['file.name', 'note.status', 'card.id'] }] }, 0)
    expect(propertyKeys(legacy, legacy.views[0], [])).toEqual(['file.name', 'card.id'])
  })

  it('YAZ-5385: a card`s own properties are its row`s: a column each, after the card columns, that filters and sorts; the page`s never', () => {
    const pages = [
      record('Trip', { properties: { tags: ['page-tag'] }, cards: [card('GEO-1', { title: 'A', properties: { tags: ['europe', 'capitals'], level: 'A2' } }), card('GEO-2', { title: 'B', properties: { level: 'B1' } })] }),
      record('GEO-3', { kind: 'card', cards: [card('GEO-3', { title: 'C' })] }),
    ]
    const rows = cardRowRecords(pages)
    expect(rows.map((r) => r.properties)).toEqual([
      { tags: ['europe', 'capitals'], level: 'A2', 'card.status': 'Active', 'card.upNext': false },
      { level: 'B1', 'card.status': 'Active', 'card.upNext': false },
      { 'card.status': 'Active', 'card.upNext': false },
    ])
    // By default: the name, the card columns, then each card property (no "Page tags": the page's own are not a card's).
    expect(propertyKeys(DEF, CARDS, rows)).toEqual(['file.name', 'card.page', 'card.status', 'card.fix', 'card.nextReview', 'card.lastReview', 'card.reviews', 'card.successRate', 'card.upNext', 'card.id', 'note.level', 'note.tags'])
    // A view with its own card order keeps a card property it holds, and the menus offer the rest.
    const own: ViewDef = { ...CARDS, order: ['file.name', 'note.level'] }
    expect(propertyKeys({ views: [own] }, own, rows)).toEqual(['file.name', 'note.level'])
    expect(allPropertyKeys({ views: [own] }, own, rows)).toEqual(['file.name', 'note.level', 'card.page', 'card.status', 'card.fix', 'card.nextReview', 'card.lastReview', 'card.reviews', 'card.successRate', 'card.upNext', 'card.id', 'note.tags', 'file.folder'])
    // Filter and sort as a page's column.
    const filtered: ViewDef = { ...CARDS, filters: 'note.tags.contains("europe")' }
    expect(runView({ views: [filtered] }, filtered, rows, { now: NOW }).rows.map((r) => r.record.title)).toEqual(['A'])
    const sorted: ViewDef = { ...CARDS, sort: [{ property: 'note.level', direction: 'DESC' }] }
    expect(runView({ views: [sorted] }, sorted, rows, { now: NOW }).rows.map((r) => r.record.title)).toEqual(['B', 'A', 'C'])
  })

  it('YAZ-5385: a row`s writes are its card line`s: Card status, Card up next, and a property set or cleared', () => {
    const line = parseCardLine('<!-- card: GEO-1, title "A", level "A2", 2026-11-12T14:05Z good -->')!
    const change = cardLineChange([{ key: 'level', value: 'B1' }, { key: 'tags', value: ['x'] }, { key: 'card.upNext', value: true }])
    expect(formatCardLine(change(line))).toBe('<!-- card: GEO-1, title "A", level "B1", tags ["x"], next, 2026-11-12T14:05Z good -->')
    expect(formatCardLine(cardLineChange([{ key: 'level', value: undefined }])(line))).toBe('<!-- card: GEO-1, title "A", 2026-11-12T14:05Z good -->')
    expect(() => cardLineChange([{ key: 'next', value: 'x' }])(line)).toThrow()
  })

  it('offers the card columns, the cards\' declared columns, the Folder and the formulas; no page property (YAZ-5349 scopes card properties)', () => {
    // `columns` is the Cards table's: the card columns' types through the card lens, never the page's.
    const keys = allPropertyKeys({ views: [CARDS], formulas: { x: '1' } }, CARDS, cardRowRecords(PAGES), { level: { kind: 'text' } })
    expect(keys).toEqual(['file.name', 'card.page', 'card.status', 'card.fix', 'card.nextReview', 'card.lastReview', 'card.reviews', 'card.successRate', 'card.upNext', 'card.id', 'note.level', 'file.folder', 'formula.x'])
  })

  it('only a Table lists cards this round; the setting is on the view for a Board or a Calendar later', () => {
    const board: ViewDef = { type: 'board', name: 'B', rows: 'cards' }
    expect(propertyKeys({ views: [board] }, board, PAGES)).not.toContain('card.status')
  })
})

describe('YAZ-5430: Card fix status (Q53): "Needs fixing" or blank, next to Card status', () => {
  const FIX_PAGES = [
    record('Europe trip', { cards: [card('GEO-1', { title: 'Capital of Spain', fix: true }), card('GEO-2', { title: 'Capital of Peru' }), card('GEO-4', { title: 'Both', off: true, fix: true })] }),
    record('GEO-3', { kind: 'card', title: 'Longest river', cards: [card('GEO-3', { title: 'Longest river' })] }),
  ]
  const fixRun = (view: ViewDef) => run(view, cardRowRecords(FIX_PAGES))
  const titles = (view: ViewDef) => fixRun(view).rows.map((r) => r.record.title)

  it('the column sits right after Card status; a marked card reads "Needs fixing", any other blank; an archived card can need a fix', () => {
    expect(propertyKeys(DEF, CARDS, []).slice(0, 4)).toEqual(['file.name', 'card.page', 'card.status', 'card.fix'])
    expect(defaultLabel('card.fix')).toBe('Card fix status')
    const rows = fixRun(CARDS).rows.map((r) => [r.record.title, r.values['card.status'], r.values['card.fix']])
    expect(rows).toEqual([
      ['Capital of Spain', 'Active', 'Needs fixing'],
      ['Capital of Peru', 'Active', null],
      ['Both', 'Archived', 'Needs fixing'],
      ['Longest river', 'Active', null],
    ])
    // The row's record holds the edited value as Card status does; none when blank.
    expect(cardRowRecords(FIX_PAGES).map((r) => r.properties['card.fix'])).toEqual(['Needs fixing', undefined, 'Needs fixing', undefined])
  })

  it('a Select with one option, Needs fixing; filter "is Needs fixing" and "is empty"; the rules read back as the Filter menu rows', () => {
    const typing = columnTyping('card.fix', [])
    expect(typing).toMatchObject({ assigned: 'select', options: ['Needs fixing'] })
    expect(inferType('card.fix', [], typing)).toBe('select')
    const is = { property: 'card.fix', op: 'is' as const, value: 'Needs fixing' }
    const expr = ruleToExpr(is, inferType('card.fix', [], typing))
    expect(expr).toBe('card.fix == "Needs fixing"')
    expect(exprToRule(expr)).toEqual(is)
    expect(titles({ ...CARDS, filters: expr })).toEqual(['Capital of Spain', 'Both'])
    const empty = ruleToExpr({ property: 'card.fix', op: 'isEmpty', value: '' }, 'select')
    expect(titles({ ...CARDS, filters: empty })).toEqual(['Capital of Peru', 'Longest river'])
  })

  it('sorts and groups by it', () => {
    expect(titles({ ...CARDS, sort: [{ property: 'card.fix', direction: 'DESC' }, { property: 'file.name', direction: 'ASC' }] })).toEqual(['Both', 'Capital of Spain', 'Capital of Peru', 'Longest river'])
    const asc = titles({ ...CARDS, sort: [{ property: 'card.fix', direction: 'ASC' }, { property: 'file.name', direction: 'ASC' }] })
    // Blanks sort last either way, as in any column: the marked cards come first.
    expect(asc).toEqual(['Both', 'Capital of Spain', 'Capital of Peru', 'Longest river'])
    expect(fixRun({ ...CARDS, groupBy: { property: 'card.fix', direction: 'ASC' } }).groups?.map((g) => [g.label, g.rows.length])).toEqual([['Needs fixing', 2], ['No value', 2]])
  })

  it('its cell writes `fix` on the card line: Needs fixing sets it in the phone`s place; blank (Clear) takes it off; other parts keep their bytes', () => {
    const line = parseCardLine('<!-- card: GEO-1, title "Capital of Spain", level "A2", off, 2026-11-01T09:00Z good -->')!
    const on = cardLineChange([{ key: 'card.fix', value: 'Needs fixing' }])(line)
    expect(formatCardLine(on)).toBe('<!-- card: GEO-1, title "Capital of Spain", level "A2", off, fix, 2026-11-01T09:00Z good -->')
    for (const blank of [null, undefined, '']) expect(formatCardLine(cardLineChange([{ key: 'card.fix', value: blank }])(on))).toBe(formatCardLine(line))
    // Set twice: one mark.
    expect(cardLineChange([{ key: 'card.fix', value: 'Needs fixing' }])(on)).toBe(on)
  })
})

describe('YAZ-5466: a card file`s comments are never a Cards table column', () => {
  it('the row`s properties are its card line`s: a `comments` the file holds is not one, and makes no column', () => {
    const file = record('river', { kind: 'card', properties: { kind: 'card', comments: [{ id: 'aaaaaaaa', body: 'Hi' }] } as IndexRecord['properties'], cards: [card('GEO-9', { properties: { level: 'A2' } } as Partial<CardRecord>)] })
    const [row] = cardRowRecords([file])
    expect(row.properties).not.toHaveProperty('comments')
    expect(row.properties.level).toBe('A2')
  })
})
