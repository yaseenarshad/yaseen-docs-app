import { describe, expect, it } from 'vitest'
import type { CardRecord } from '@shared/cardLine'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { CARD_KEYS, CARD_STATUSES, DEFAULT_CARD_ORDER, cardCellText, cardLineChange, cardRowOfRecord, cardRowRecords, cardStatusOf, cardValues } from './cardRows'
import { cardTime, formatCardLine, parseCardLine, type CardReview } from '@shared/cardLine'
import { cardDueAt, cardState, recallChance } from '@shared/cardSchedule'
import { defaultLabel, propertyKeys, propertyLabel, runView } from './engine'
import { DateValue } from './expr'
import type { ViewDef, ViewSet } from './viewSchema'
import { allPropertyKeys } from './view/properties'
import { exprToRule, inferType, propertyValues, ruleToExpr } from './view/filterRows'
import { columnTyping } from './editorType'
import { setViewOrder } from './view/columnOrder'
import { cardLensOn, throughCardLens } from './cardView'

/**
 * YAZ-5319: a table that lists cards. One row per card under the folder (a card file's card, each card with an ID in
 * a page), off the index's `cards`; the card columns; filters, sorts and hide or show as for pages. YAZ-5793 (the
 * Card table): no column says "Card", the name column is "Title", and a new table shows seven columns, offering the rest.
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
      card('GEO-1', { title: 'Capital of Spain', off: true, reviews: [{ at: '2026-11-01T09:00:00.000Z', rating: 'good' }, { at: '2026-11-03T09:00:00.000Z', rating: 'again' }] }),
      card('GEO-2', { next: true }),
      // No ID yet (before the sweep), and a copy of an ID the page holds already: no row.
      card(null),
      card('GEO-1', { title: 'Copy' }),
    ],
  }),
  record('GEO-3', { kind: 'card', title: 'Longest river', cards: [card('GEO-3', { title: 'Longest river', reviews: [{ at: '2026-11-10T09:00:00.000Z', rating: 'good' }] })] }),
  record('Plain'),
]
const CARDS: ViewDef = { type: 'table', name: 'Cards', rows: 'cards' }
const DEF: ViewSet = { views: [CARDS] }
/** A Card table that shows every card column, hidden ones too (YAZ-5793 hides some by default). */
const ALL: ViewDef = { ...CARDS, order: ['file.name', ...CARD_KEYS] }
/** The new Card table's columns (YAZ-5793, Yaseen's list; YAZ-6150 D4 adds `card.created`), then the ones Columns ⚙ offers hidden. */
const SHOWN = ['file.name', 'card.status', 'card.nextReview', 'card.wait', 'card.forgotten', 'card.recall', 'card.lastReview', 'card.created']
const OFFERED = ['card.overdue', 'card.upNext', 'card.fix', 'card.reviews', 'card.successRate', 'card.page', 'card.id', 'card.file']
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

  it('YAZ-5793: a new Card table shows Title, Status, Next review date, Wait time, Times forgotten, Recall chance, Last review date; no name says "Card"', () => {
    expect(DEFAULT_CARD_ORDER).toEqual(SHOWN)
    expect(propertyKeys(DEF, CARDS, [])).toEqual(SHOWN)
    const seen = cardLensOn(DEF, 0)
    expect(propertyKeys(seen, seen.views[0], []).map((k) => propertyLabel(seen, k))).toEqual(['Title', 'Status', 'Next review date', 'Wait time', 'Times forgotten', 'Recall chance', 'Last review date', 'Created'])
    // Every card key: the shown ones, then the ones Columns ⚙ offers hidden.
    expect(CARD_KEYS).toEqual([...SHOWN.slice(1), ...OFFERED])
    expect(OFFERED.map(defaultLabel)).toEqual(['Days overdue', 'Up next status', 'Fix status', 'Reviews', 'Success rate', 'Page', 'ID', 'File name'])
    expect(CARD_KEYS.map(defaultLabel).filter((l) => /card/i.test(l))).toEqual([])
  })

  it('YAZ-5793: "Title" is the name column only in a Card table; the Pages table says "Name"', () => {
    const pages: ViewSet = { views: [{ type: 'table', name: 'Pages' }] }
    expect(propertyLabel(pages, 'file.name')).toBe('Name')
    expect(propertyLabel(cardLensOn(DEF, 0), 'file.name')).toBe('Title')
    // A label the reader gave wins.
    const renamed = cardLensOn({ views: [{ ...CARDS, cardView: { properties: { 'file.name': { displayName: 'Question' } } } }] }, 0)
    expect(propertyLabel(renamed, 'file.name')).toBe('Question')
  })

  it('YAZ-5793: a card`s own column that would wear a card column`s name says "(card property)" in a Card table, and only there', () => {
    const seen = cardLensOn(DEF, 0)
    expect(['note.status', 'note.Status', 'note.title', 'note.reviews', 'note.file name', 'note.level'].map((k) => propertyLabel(seen, k))).toEqual([
      'Status (card property)',
      'Status (card property)',
      'Title (card property)',
      'Reviews (card property)',
      'File name (card property)',
      'Level',
    ])
    // The card columns themselves keep their names; the Pages table's `status` is "Status".
    expect(propertyLabel(seen, 'card.status')).toBe('Status')
    expect(propertyLabel({ views: [{ type: 'table', name: 'Pages' }] }, 'note.status')).toBe('Status')
    // A card with a `status` property: its column and the Status column side by side, told apart.
    const rows = cardRowRecords([record('Trip', { cards: [card('GEO-1', { properties: { status: 'draft' } })] })])
    const keys = propertyKeys(seen, seen.views[0], rows)
    expect(keys.map((k) => propertyLabel(seen, k))).toEqual(['Title', 'Status', 'Next review date', 'Wait time', 'Times forgotten', 'Recall chance', 'Last review date', 'Created', 'Status (card property)'])
  })

  it('each column\'s value: the page, the status, the reviews from the schedule, Up next, the ID, the file', () => {
    const values = run(ALL).rows.map((r) => r.values)
    const [spain, plain, river] = values
    expect([spain['file.name'], spain['card.page'], spain['card.status'], spain['card.reviews'], spain['card.successRate'], spain['card.upNext'], spain['card.id'], spain['card.file']]).toEqual(['Capital of Spain', 'Europe trip', 'Archived', 2, 50, false, 'GEO-1', 'Europe trip.md'])
    // An archived card is out of review: no next review, no memory numbers. Its last review is its latest.
    expect([spain['card.nextReview'], spain['card.wait'], spain['card.forgotten'], spain['card.recall'], spain['card.overdue']]).toEqual([null, null, null, null, null])
    expect((spain['card.lastReview'] as DateValue).ms).toBe(Date.parse('2026-11-03T09:00:00.000Z'))
    // A new card (YAZ-5793: Status New): nothing reviewed, nothing scheduled; it is Up next.
    expect([plain['card.status'], plain['card.nextReview'], plain['card.lastReview'], plain['card.reviews'], plain['card.successRate'], plain['card.upNext']]).toEqual(['New', null, null, null, null, true])
    expect([plain['card.wait'], plain['card.forgotten'], plain['card.recall'], plain['card.overdue']]).toEqual([null, null, null, null])
    // A card file lives in itself: no Page; its File name is its own. Its next review is the schedule's date: its one ✓
    // (a new card's first) added it to that day's reviews (YAZ-5702), so it is due from that answer on.
    expect([river['card.page'], river['card.status'], river['card.reviews'], river['card.successRate'], river['card.id'], river['card.file']]).toEqual([null, 'Active', 1, 100, 'GEO-3', 'GEO-3.md'])
    expect((river['card.nextReview'] as DateValue).ms).toBe(Date.parse('2026-11-10T09:00:00.000Z'))
  })

  it('"Status is Archived" finds the archived card inside a page; the rule reads back as the Filter menu row', () => {
    const rule = { property: 'card.status', op: 'is' as const, value: 'Archived' }
    const expr = ruleToExpr(rule, inferType('card.status', [], columnTyping('card.status', [])))
    expect(expr).toBe('card.status == "Archived"')
    expect(exprToRule(expr)).toEqual(rule)
    expect(run({ ...CARDS, filters: expr }).rows.map((r) => r.record.path)).toEqual(['/v/Geo/Europe trip.md#GEO-1'])
    // Status's Select writes Active or Archived (YAZ-5838); the filter also offers New, from the rows' own values. Up next a checkbox; the reviews dates and numbers.
    expect(propertyValues('card.status', cardRowRecords(PAGES), columnTyping('card.status', []))).toEqual(['Active', 'Archived', 'New'])
    expect(['card.upNext', 'card.nextReview', 'card.reviews', 'card.id'].map((k) => inferType(k, []))).toEqual(['checkbox', 'date', 'number', 'text'])
    // YAZ-5793's new columns: the numbers filter as numbers; the File name as text.
    expect(['card.wait', 'card.forgotten', 'card.recall', 'card.overdue', 'card.file'].map((k) => inferType(k, []))).toEqual(['number', 'number', 'number', 'number', 'text'])
    expect(run({ ...CARDS, filters: ruleToExpr({ property: 'card.status', op: 'is', value: 'New' }, 'select') }).rows.map((r) => r.record.title)).toEqual(['GEO-2'])
    expect(run({ ...CARDS, filters: ruleToExpr({ property: 'card.upNext', op: 'checked', value: '' }) }).rows.map((r) => r.record.title)).toEqual(['GEO-2'])
  })

  it('sorts and groups by a card column', () => {
    const sorted = run({ ...CARDS, sort: [{ property: 'card.successRate', direction: 'DESC' }] })
    expect(sorted.rows.map((r) => r.record.title)).toEqual(['Longest river', 'Capital of Spain', 'GEO-2'])
    const grouped = run({ ...CARDS, groupBy: { property: 'card.status', direction: 'ASC' } })
    expect(grouped.groups?.map((g) => [g.label, g.rows.length]).sort()).toEqual([['Active', 1], ['Archived', 1], ['New', 1]])
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
      { tags: ['europe', 'capitals'], level: 'A2', 'card.status': 'New', 'card.upNext': false },
      { level: 'B1', 'card.status': 'New', 'card.upNext': false },
      { 'card.status': 'New', 'card.upNext': false },
    ])
    // By default: the title, the shown card columns, then each card property (no "Page tags": the page's own are not a card's).
    expect(propertyKeys(DEF, CARDS, rows)).toEqual([...SHOWN, 'note.level', 'note.tags'])
    // A view with its own card order keeps a card property it holds, and the menus offer the rest.
    const own: ViewDef = { ...CARDS, order: ['file.name', 'note.level'] }
    expect(propertyKeys({ views: [own] }, own, rows)).toEqual(['file.name', 'note.level'])
    expect(allPropertyKeys({ views: [own] }, own, rows)).toEqual(['file.name', 'note.level', ...SHOWN.slice(1), ...OFFERED, 'note.tags', 'file.folder'])
    // Filter and sort as a page's column.
    const filtered: ViewDef = { ...CARDS, filters: 'note.tags.contains("europe")' }
    expect(runView({ views: [filtered] }, filtered, rows, { now: NOW }).rows.map((r) => r.record.title)).toEqual(['A'])
    const sorted: ViewDef = { ...CARDS, sort: [{ property: 'note.level', direction: 'DESC' }] }
    expect(runView({ views: [sorted] }, sorted, rows, { now: NOW }).rows.map((r) => r.record.title)).toEqual(['B', 'A', 'C'])
  })

  it('YAZ-5385: a row`s writes are its card line`s: Card status, Card up next, and a property set or cleared', () => {
    const line = parseCardLine('<!-- card: GEO-1, title "A", level "A2", 2026-11-12T14:05:00.000Z good -->')!
    const change = cardLineChange([{ key: 'level', value: 'B1' }, { key: 'tags', value: ['x'] }, { key: 'card.upNext', value: true }])
    expect(formatCardLine(change(line))).toBe('<!-- card: GEO-1, title "A", level "B1", tags ["x"], next, 2026-11-12T14:05:00.000Z good -->')
    expect(formatCardLine(cardLineChange([{ key: 'level', value: undefined }])(line))).toBe('<!-- card: GEO-1, title "A", 2026-11-12T14:05:00.000Z good -->')
    expect(() => cardLineChange([{ key: 'next', value: 'x' }])(line)).toThrow()
  })

  it('offers the shown card columns, then the hidden ones (YAZ-5793), the cards\' declared columns, the Folder and the formulas; no page property (YAZ-5349 scopes card properties)', () => {
    // `columns` is the Cards table's: the card columns' types through the card lens, never the page's.
    const keys = allPropertyKeys({ views: [CARDS], formulas: { x: '1' } }, CARDS, cardRowRecords(PAGES), { level: { kind: 'text' } })
    // The shown columns first (a declared card column shows by default), then the hidden card columns.
    expect(keys).toEqual([...SHOWN, 'note.level', ...OFFERED, 'file.folder', 'formula.x'])
    // Shown by default: the seven; the rest are offered, hidden.
    const shown = propertyKeys(DEF, CARDS, cardRowRecords(PAGES))
    expect(keys.filter((k) => k.startsWith('card.') && !shown.includes(k))).toEqual(OFFERED)
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

  it('YAZ-5793: "Fix status" is offered hidden; a marked card reads "Needs fixing", any other blank; an archived card can need a fix', () => {
    expect(propertyKeys(DEF, CARDS, [])).not.toContain('card.fix')
    expect(allPropertyKeys(DEF, CARDS, [])).toContain('card.fix')
    expect(defaultLabel('card.fix')).toBe('Fix status')
    const rows = fixRun({ ...CARDS, order: ['file.name', 'card.status', 'card.fix'] }).rows.map((r) => [r.record.title, r.values['card.status'], r.values['card.fix']])
    expect(rows).toEqual([
      ['Capital of Spain', 'New', 'Needs fixing'],
      ['Capital of Peru', 'New', null],
      ['Both', 'Archived', 'Needs fixing'],
      ['Longest river', 'New', null],
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
    const line = parseCardLine('<!-- card: GEO-1, title "Capital of Spain", level "A2", off, 2026-11-01T09:00:00.000Z good -->')!
    const on = cardLineChange([{ key: 'card.fix', value: 'Needs fixing' }])(line)
    expect(formatCardLine(on)).toBe('<!-- card: GEO-1, title "Capital of Spain", level "A2", off, fix, 2026-11-01T09:00:00.000Z good -->')
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

describe('YAZ-5793: Status is New, Active or Archived', () => {
  it('New: no ✓ yet (none, or only ✕); Active: a ✓; Archived: the line`s `off`, whatever its reviews', () => {
    expect(CARD_STATUSES).toEqual(['New', 'Active', 'Archived'])
    const at = '2026-11-01T09:00:00.000Z'
    expect([
      cardStatusOf(card('A')),
      cardStatusOf(card('A', { reviews: [{ at, rating: 'again' }] })),
      cardStatusOf(card('A', { reviews: [{ at, rating: 'again' }, { at: '2026-11-02T09:00:00.000Z', rating: 'good' }] })),
      cardStatusOf(card('A', { off: true })),
      cardStatusOf(card('A', { off: true, reviews: [{ at, rating: 'good' }] })),
    ]).toEqual(['New', 'New', 'Active', 'Archived', 'Archived'])
  })

  it('the Select writes Active or Archived (YAZ-5838); the filter finds "is New", "is Active" and "is Archived" each', () => {
    expect(columnTyping('card.status', [])).toMatchObject({ assigned: 'select', options: ['Active', 'Archived'] })
    const is = (value: string) => run({ ...CARDS, filters: ruleToExpr({ property: 'card.status', op: 'is', value }, 'select') }).rows.map((r) => r.record.title)
    expect([is('New'), is('Active'), is('Archived')]).toEqual([['GEO-2'], ['Longest river'], ['Capital of Spain']])
  })

  it('a write of Archived sets `off`; New or Active clears it; other parts keep their bytes', () => {
    const line = parseCardLine('<!-- card: GEO-1, title "A", 2026-11-12T14:05:00.000Z good -->')!
    const off = cardLineChange([{ key: 'card.status', value: 'Archived' }])(line)
    expect(formatCardLine(off)).toBe('<!-- card: GEO-1, title "A", off, 2026-11-12T14:05:00.000Z good -->')
    for (const value of ['Active', 'New']) expect(formatCardLine(cardLineChange([{ key: 'card.status', value }])(off))).toBe(formatCardLine(line))
  })
})

/**
 * YAZ-5793's new values, off one fixed history with fuzz off: Oct 1 ✓ (a new card's first, added to the day), Oct 1 ✓,
 * Oct 5 ✓, Oct 15 ✕ (a lapse), Oct 16 ✓. Noon local times, so the local days are the same in any time zone.
 */
describe('YAZ-5793: Wait time, Times forgotten, Recall chance, Days overdue, File name', () => {
  const S = { ...DEFAULT_REVIEW_SETTINGS, fuzz: false }
  const DAY = 86_400_000
  const at = (day: number, hour = 12) => cardTime(new Date(2026, 9, day, hour, 0).getTime())
  const REVIEWS: CardReview[] = [
    { at: at(1), rating: 'good' },
    { at: at(1, 13), rating: 'good' },
    { at: at(5), rating: 'good' },
    { at: at(15), rating: 'again' },
    { at: at(17), rating: 'good' }, // the ✕'s due day: counted (YAZ-5789 rule 1)
  ]
  const rowOf = (c: CardRecord, over: Partial<IndexRecord> = {}) => cardRowOfRecord(cardRowRecords([record('Trip', { cards: [c], ...over })])[0])!
  const DUE = cardDueAt(REVIEWS, S)

  it('the history is due Oct 23 at noon, 6 days after its last ✓', () => {
    expect(DUE).toBe(new Date(2026, 9, 23, 12, 0).getTime())
  })

  it('3 days past the due date: wait 6 days, forgotten once, 87% recall, 3 days overdue; File name is the page`s file', () => {
    const now = new Date(2026, 9, 26, 12, 0).getTime()
    const v = cardValues(rowOf(card('GEO-1', { reviews: REVIEWS })), S, now)
    expect([v.status, v.wait, v.forgotten, v.recall, v.overdue, v.file]).toEqual(['Active', 6, 1, 87, 3, 'Trip.md'])
    // The same numbers as the schedule's own: the interval, the lapses, the recall chance in whole percent.
    const state = cardState(REVIEWS, S)
    expect([v.wait, v.forgotten, v.recall]).toEqual([state.interval, state.lapses, Math.round(100 * recallChance(REVIEWS, S, now)!)])
    expect((v.nextReview as DateValue).ms).toBe(DUE)
  })

  it('Days overdue: 0 on the due day (before or after its hour), blank the day before', () => {
    const value = (now: number) => cardValues(rowOf(card('GEO-1', { reviews: REVIEWS })), S, now).overdue
    expect(value(new Date(2026, 9, 23, 0, 30).getTime())).toBe(0)
    expect(value(new Date(2026, 9, 23, 23, 30).getTime())).toBe(0)
    expect(value(new Date(2026, 9, 24, 0, 30).getTime())).toBe(1)
    expect(value(new Date(2026, 9, 22, 23, 30).getTime())).toBeNull()
    expect(value(DUE - 10 * DAY)).toBeNull()
  })

  it('Recall chance falls as time passes, and reads off `now`', () => {
    const recall = (now: number) => cardValues(rowOf(card('GEO-1', { reviews: REVIEWS })), S, now).recall as number
    expect(recall(DUE - DAY)).toBe(91)
    expect(recall(DUE)).toBe(90)
    expect(recall(DUE + 3 * DAY)).toBe(87)
  })

  it('blank for a New card, an Archived one, and with no settings; File name still reads', () => {
    const now = DUE + 3 * DAY
    const blank = (v: Record<string, unknown>) => [v.nextReview, v.wait, v.forgotten, v.recall, v.overdue]
    const fresh = cardValues(rowOf(card('GEO-1')), S, now)
    expect([fresh.status, ...blank(fresh)]).toEqual(['New', null, null, null, null, null])
    const missed = cardValues(rowOf(card('GEO-1', { reviews: [{ at: at(1), rating: 'again' }] })), S, now)
    expect([missed.status, ...blank(missed)]).toEqual(['New', null, null, null, null, null])
    const archived = cardValues(rowOf(card('GEO-1', { off: true, reviews: REVIEWS })), S, now)
    expect([archived.status, ...blank(archived), archived.reviews]).toEqual(['Archived', null, null, null, null, null, 5])
    const unset = cardValues(rowOf(card('GEO-1', { reviews: REVIEWS })), undefined, now)
    expect([unset.status, ...blank(unset), unset.file]).toEqual(['Active', null, null, null, null, null, 'Trip.md'])
  })

  it('File name: a card file`s own; a card inside a page, the page`s, with no folder', () => {
    const file = record('GEO-3', { path: '/v/Geo/Sub/GEO-3.md', kind: 'card', cards: [card('GEO-3', { title: 'River' })] })
    expect(cardValues(cardRowOfRecord(cardRowRecords([file])[0])!, S, DUE).file).toBe('GEO-3.md')
    expect(cardValues(rowOf(card('GEO-1'), { path: '/v/Geo/Deep/Europe trip.md' }), S, DUE).file).toBe('Europe trip.md')
  })

  it('the cells say "91%" and "4 days"; "1 day" for one; the rest as written', () => {
    expect([cardCellText('card.recall', 91), cardCellText('card.successRate', 67), cardCellText('card.wait', 4), cardCellText('card.wait', 1), cardCellText('card.wait', 0)]).toEqual(['91%', '67%', '4 days', '1 day', '0 days'])
    expect([cardCellText('card.recall', null), cardCellText('card.wait', null), cardCellText('card.forgotten', 2), cardCellText('card.overdue', 3), cardCellText('card.file', 'Trip.md')]).toEqual([null, null, null, null, null])
  })

  it('a run reads them at its `now`: sort by Days overdue, filter Recall chance 90 and up', () => {
    const pages = [
      record('Trip', {
        cards: [card('GEO-1', { title: 'Late', reviews: REVIEWS }), card('GEO-2', { title: 'Soon', reviews: [{ at: at(25), rating: 'good' }, { at: at(25, 13), rating: 'good' }] }), card('GEO-4', { title: 'Fresh' })],
      }),
    ]
    const view: ViewDef = { ...CARDS, order: ['file.name', 'card.overdue', 'card.recall'], sort: [{ property: 'card.overdue', direction: 'DESC' }] }
    const now = DUE + 3 * DAY
    const out = runView({ views: [view] }, view, cardRowRecords(pages), { now, cardSettings: S })
    expect(out.rows.map((r) => [r.record.title, r.values['card.overdue']])).toEqual([['Late', 3], ['Soon', null], ['Fresh', null]])
    // Late is at 87%, Soon (learned Oct 25) higher; a New card has none.
    const high: ViewDef = { ...view, filters: 'card.recall >= 90' }
    expect(runView({ views: [high] }, high, cardRowRecords(pages), { now, cardSettings: S }).rows.map((r) => r.record.title)).toEqual(['Soon'])
  })

  it('YAZ-6167: card.created reads stamped timestamp, falls back to file ctime only for standalone card files, displays date-only, sorts by exact ms', () => {
    const t1 = new Date(2026, 10, 21, 9, 0, 0).getTime()
    const t2 = new Date(2026, 10, 21, 16, 30, 0).getTime()
    const tFile = new Date(2026, 10, 10, 12, 0, 0).getTime()
    const pages = [
      record('Notes', {
        ctime: tFile,
        cards: [
          card('C-1', { title: 'Inline later', created: new Date(t2).toISOString() } as Partial<CardRecord>),
          card('C-2', { title: 'Inline earlier', created: new Date(t1).toISOString() } as Partial<CardRecord>),
          card('C-3', { title: 'Inline unstamped' }),
        ],
      }),
      record('C-4', { kind: 'card', ctime: tFile, cards: [card('C-4', { title: 'File unstamped' })] }),
      record('C-5', { kind: 'card', ctime: tFile, cards: [card('C-5', { title: 'File stamped', created: new Date(t1 + 60_000).toISOString() } as Partial<CardRecord>)] }),
    ]
    expect(inferType('card.created', [])).toBe('date')
    const view: ViewDef = { ...CARDS, sort: [{ property: 'card.created', direction: 'ASC' }] }
    const out = runView({ views: [view] }, view, cardRowRecords(pages), { now: NOW, cardSettings: S })
    expect(out.rows.map((r) => r.record.title)).toEqual([
      'File unstamped',
      'Inline earlier',
      'File stamped',
      'Inline later',
      'Inline unstamped',
    ])
    const byTitle = Object.fromEntries(out.rows.map((r) => [r.record.title, r.values['card.created']]))
    expect(byTitle['File unstamped']).toEqual(new DateValue(tFile, false))
    expect(byTitle['Inline earlier']).toEqual(new DateValue(t1, false))
    expect(byTitle['File stamped']).toEqual(new DateValue(t1 + 60_000, false))
    expect(byTitle['Inline later']).toEqual(new DateValue(t2, false))
    expect(byTitle['Inline unstamped']).toBeNull()
  })
})
