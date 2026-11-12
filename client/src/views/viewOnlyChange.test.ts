/**
 * The view / content split of a folder page's settings write (YAZ-4939 round 3): what read only lets through and what
 * it refuses. The host (`FolderView`) asks this before every settings write; the DOM tests in
 * `FolderView.readOnlyVault.test.tsx` and `FolderView.toolbar.test.tsx` pin the doors.
 */
import { describe, expect, it } from 'vitest'
import type { ColumnDecl } from './folderSettings'
import type { ViewDef, ViewSet } from './viewSchema'
import { isViewOnlyChange } from './viewOnlyChange'

const columns: Record<string, ColumnDecl> = { priority: { kind: 'text' }, due: { kind: 'date' } }
const table: ViewDef = { type: 'table', name: 'Pipeline', order: ['file.name', 'note.priority', 'note.due'] }
const calendar: ViewDef = { type: 'calendar', name: 'Dates' }
const def: ViewSet = { views: [table, calendar], properties: { priority: { displayName: 'Prio' } }, formulas: { late: 'due < today()' } }

const withViews = (views: ViewDef[], rest: Partial<ViewSet> = {}): ViewSet => ({ ...def, views, ...rest })
const edit = (change: Partial<ViewDef>, index = 0): ViewSet => withViews(def.views.map((v, i) => (i === index ? { ...v, ...change } : v)))

describe('isViewOnlyChange (YAZ-4939 round 3)', () => {
  it.each<[string, ViewSet]>([
    ['a sort', edit({ sort: [{ property: 'note.priority', direction: 'ASC' }] })],
    ['a filter', edit({ filters: { and: ['note.priority == "High"'] } })],
    ['a group', edit({ groupBy: { property: 'note.priority' } })],
    ['the shown columns (a hide)', edit({ order: ['file.name', 'note.due'] })],
    ['a column width', edit({ columnSize: { 'note.priority': 240 } })],
    ['the column order', edit({ order: ['note.due', 'file.name', 'note.priority'] })],
    ['frozen columns', edit({ frozenColumns: 2 })],
    ['wrap or clip', edit({ columnWrap: { 'note.priority': false }, textInCells: 'clip' })],
    ['the row height', edit({ rowHeight: 'tall' })],
    ["a calendar's dates", edit({ dateProperty: 'note.due', endDateProperty: 'note.due', calendarScale: 'week', hideWeekends: true }, 1)],
    ['a new view tab', withViews([...def.views, { type: 'board', name: 'Board' }])],
    ['a renamed view tab', edit({ name: 'Deals' })],
    ['a deleted view tab', withViews([table])],
    ['reordered view tabs', withViews([calendar, table])],
    ['the default view', withViews(def.views, { defaultView: 'Dates' })],
  ])('%s is a view change: it goes while the page is read only', (_name, after) => {
    expect(isViewOnlyChange({ columns, ...def }, { columns, ...after })).toBe(true)
  })

  it.each<[string, { columns?: Record<string, ColumnDecl>; properties?: ViewSet['properties']; formulas?: ViewSet['formulas'] }]>([
    ["a column's type", { columns: { ...columns, priority: { kind: 'number' } } }],
    ['a new column', { columns: { ...columns, owner: { kind: 'text' } } }],
    ['a deleted column', { columns: { due: columns.due } }],
    ["a column's options", { columns: { ...columns, priority: { kind: 'select', options: ['High', 'Low'] } } }],
    ["a column's label", { properties: { priority: { displayName: 'Importance' } } }],
    ['a cleared label', { properties: undefined }],
    ['a formula', { formulas: { late: 'due < today() - 1' } }],
  ])('%s is a content change: read only refuses it', (_name, change) => {
    expect(isViewOnlyChange({ columns, ...def }, { columns, properties: def.properties, formulas: def.formulas, ...change })).toBe(false)
  })

  it('a mixed write — a new column and its place in the view — is a content change', () => {
    const after = { columns: { ...columns, owner: { kind: 'text' } as ColumnDecl }, ...edit({ order: [...table.order!, 'note.owner'] }) }
    expect(isViewOnlyChange({ columns, ...def }, after)).toBe(false)
  })

  it('the same content in another key order, or with an undefined field, is no change', () => {
    const same = { columns: { due: { kind: 'date', target: undefined } as ColumnDecl, priority: { kind: 'text' } as ColumnDecl }, properties: { priority: { displayName: 'Prio' } }, formulas: { late: 'due < today()' } }
    expect(isViewOnlyChange({ columns, ...def }, same)).toBe(true)
    expect(isViewOnlyChange({}, { properties: undefined })).toBe(true)
  })
})
