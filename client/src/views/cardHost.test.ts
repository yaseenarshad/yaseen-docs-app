/**
 * YAZ-5349 follow-up: the Cards table's column doors (`cardHost.ts`). Each acts on the cards — the view's card columns
 * and the cards' lines — and never on the folder's page columns or a page's front matter (the page host's doors throw
 * if they are reached).
 */
import { describe, expect, it, vi } from 'vitest'
import { formatCardLine, parseCardLine, type CardLine, type CardRecord } from '@shared/cardLine'
import type { IndexRecord } from '@shared/types'
import { cardFolderHost } from './cardHost'
import { cardRowRecords } from './cardRows'
import { cardColumnsOf, cardLensOn, throughCardLens } from './cardView'
import { testFolderHost } from './testFolderHost'
import type { Mutate, ViewSet } from './viewSchema'

const card = (id: string, over: Partial<CardRecord> = {}): CardRecord => ({ id, off: false, next: false, reviews: [], ...over })
const page = (name: string, cards: CardRecord[], over: Partial<IndexRecord> = {}): IndexRecord => ({
  path: `/vault/Geo/${name}.md`, name: `${name}.md`, basename: name, title: name, folder: 'Geo', ext: 'md', size: 1, ctime: 1, mtime: 1,
  properties: { Topic: 'Art' }, aliases: [], tags: [], links: [], embeds: [], cards, ...over,
})
const PAGES = [
  page('Trip', [card('GEO-1', { title: 'A', properties: { level: 'A2', tags: ['europe', 'west'] } }), card('GEO-2', { title: 'B', properties: { level: 'B1' } })]),
  page('Locked', [card('GEO-4', { title: 'D', properties: { level: 'A2' } })]),
  page('GEO-3', [card('GEO-3', { title: 'C' })], { kind: 'card' }),
]

/** A Cards table on `Geo`, its views written through the card lens as `ViewsPane` writes them. */
function setup(stored: ViewSet = { views: [{ type: 'table', name: 'T', rows: 'cards' }] }) {
  let d = structuredClone(stored)
  const toasts: string[] = []
  const afters: Array<() => void> = []
  const update: Mutate = (mutate, undo, after) => {
    const next = structuredClone(d)
    throughCardLens(0, mutate)(next)
    d = next
    if (undo !== undefined) toasts.push(undo)
    if (after !== undefined) afters.push(after)
  }
  const changeLine = vi.fn(async (_path: string, _id: string, _change: (l: CardLine) => CardLine, _index?: number) => undefined)
  const createCard = vi.fn(async (dir: string, title: string, _line: (l: CardLine) => CardLine) => `${dir}/${title}.md`)
  const records = cardRowRecords(PAGES)
  const make = () =>
    cardFolderHost(testFolderHost(), {
      viewIndex: 0,
      columns: cardColumnsOf(cardLensOn(d, 0).views[0]),
      records,
      here: 'Geo',
      dir: '/vault/Geo',
      readOnly: new Set(['/vault/Geo/Locked.md']),
      update,
      def: () => cardLensOn(d, 0),
      changeLine,
      createCard,
    })
  return { host: make, def: () => d, toasts, afters, changeLine, createCard }
}
/** What a card line change does to `text`. */
const applied = (change: (l: CardLine) => CardLine, text: string): string => formatCardLine(change(parseCardLine(text)!))!

describe('the Cards table\'s host', () => {
  it('"+ Add column": the card column\'s type and its place in the cards\' order, in the views\' one write with an Undo toast; no page column', () => {
    const t = setup()
    const host = t.host()
    const views = cardLensOn(t.def(), 0).views.map((v, i) => (i === 0 ? { ...v, order: ['file.name', 'note.Topic'] } : v))
    host.addColumn!('Topic', { kind: 'text' }, views, 0, 'Added Topic to Cards')
    expect(t.def().views[0]).toEqual({ type: 'table', name: 'T', rows: 'cards', cardView: { order: ['file.name', 'note.Topic'], columns: { Topic: { kind: 'text' } } } })
    expect(t.toasts).toEqual(['Added Topic to Cards'])
    // The new column is a column before any card holds it.
    expect(t.host().settings.columns).toEqual({ Topic: { kind: 'text' } })
  })

  it('"Add column to the right…" (`setColumns`) declares on the cards too', () => {
    const t = setup()
    const views = cardLensOn(t.def(), 0).views.map((v) => ({ ...v, order: ['file.name', 'note.Due', 'card.id'] }))
    t.host().setColumns({ Due: { kind: 'date' } }, views)
    expect(t.def().views[0].cardView).toEqual({ order: ['file.name', 'note.Due', 'card.id'], columns: { Due: { kind: 'date' } } })
  })

  it('Edit column: a new type is the cards\' column\'s', async () => {
    const t = setup()
    await t.host().setColumn('level', { kind: 'select', options: ['A2', 'B1'] }, undefined)
    expect(t.def().views[0].cardView).toEqual({ columns: { level: { kind: 'select', options: ['A2', 'B1'] } } })
    expect(t.changeLine).not.toHaveBeenCalled()
  })

  it('Edit column: a renamed option is renamed on every card that holds it, on its line; the filters on it follow; a read-only page is not written', async () => {
    const t = setup({ views: [{ type: 'table', name: 'T', rows: 'cards', cardView: { filters: 'note.level == "A2"' } }] })
    await t.host().setColumn('level', { kind: 'select', options: ['A1', 'B1'] }, undefined, { from: 'A2', to: 'A1' })
    expect(t.changeLine).toHaveBeenCalledOnce()
    const [path, id, change, index] = t.changeLine.mock.calls[0]
    expect([path, id, index]).toEqual(['/vault/Geo/Trip.md', 'GEO-1', 0])
    expect(applied(change, '<!-- card: GEO-1, title "A", level "A2" -->')).toBe('<!-- card: GEO-1, title "A", level "A1" -->')
    expect(t.def().views[0].cardView?.filters).toBe('note.level == "A1"')
  })

  it('Delete column and clear: the column, its references and its label go from the cards\' table; the property leaves each card\'s line; the Undo puts the values back', async () => {
    const t = setup({ views: [{ type: 'table', name: 'T', rows: 'cards', cardView: { order: ['file.name', 'note.level'], sort: [{ property: 'note.level', direction: 'ASC' }], columns: { level: { kind: 'text' } }, properties: { 'note.level': { displayName: 'Level' } } } }] })
    expect(t.host().valueCount('note.level')).toBe(2)
    await t.host().deleteColumn!('note.level', true)
    expect(t.def().views[0]).toEqual({ type: 'table', name: 'T', rows: 'cards', cardView: { order: ['file.name'] } })
    expect(t.toasts).toEqual(['Deleted Level'])
    expect(t.changeLine.mock.calls.map(([p, id]) => [p, id])).toEqual([['/vault/Geo/Trip.md', 'GEO-1'], ['/vault/Geo/Trip.md', 'GEO-2']])
    expect(applied(t.changeLine.mock.calls[0][2], '<!-- card: GEO-1, level "A2", tags "europe" "west" -->')).toBe('<!-- card: GEO-1, tags "europe" "west" -->')
    t.changeLine.mockClear()
    t.afters[0]()
    await vi.waitFor(() => expect(t.changeLine).toHaveBeenCalledTimes(2))
    expect(applied(t.changeLine.mock.calls[1][2], '<!-- card: GEO-2 -->')).toBe('<!-- card: GEO-2, level "B1" -->')
  })

  it('Delete column and keep the values: no card is written', async () => {
    const t = setup()
    await t.host().deleteColumn!('note.level', false)
    expect(t.changeLine).not.toHaveBeenCalled()
  })

  it('every card property is a column of this folder page: no "Other properties", no parent folder, no separate value, no relation', () => {
    const host = setup().host()
    expect(Object.fromEntries(Object.entries(host.columns).map(([k, c]) => [k, c.owner]))).toEqual({ level: 'Geo', tags: 'Geo' })
    expect(host.sources.of('level')).toEqual({})
    expect(host.sources.columnOn('level')).toBeNull()
    expect(host.sources.folderName).toBe('Cards')
    expect(host.separate).toBeUndefined()
    expect(host.relation).toBeUndefined()
  })

  it('"+ New" makes a card file in the folder, its card line seeded as a page\'s front matter would be', async () => {
    const t = setup()
    await expect(t.host().create({ properties: { level: 'B1' } })).resolves.toBe('/vault/Geo/Title.md')
    const [dir, title, line] = t.createCard.mock.calls[0]
    expect([dir, title]).toEqual(['/vault/Geo', 'Title'])
    expect(applied(line, '<!-- card: GEO-9 -->')).toBe('<!-- card: GEO-9, level "B1" -->')
    await t.host().create({ properties: {} }, 'Rivers')
    expect(t.createCard.mock.calls[1].slice(0, 2)).toEqual(['/vault/Geo', 'Rivers'])
  })
})
