import { describe, expect, it } from 'vitest'
import type { CardRecord } from '@shared/cardLine'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { defaultLabel, propertyKeys, runView } from './engine'
import { allPropertyKeys } from './view/properties'
import { propertyValues } from './view/filterRows'
import { typeWord } from './view/typeWord'
import { cardRowRecords } from './cardRows'

/**
 * The folder tables' card counts (YAZ-4967, idea 2; YAZ-5046) — "Cards" (`file.cards`), "Due" (`file.due`) and
 * "Archived" (`file.archived`) — left the Pages table with YAZ-5793 (D3): card facts are the Card table's. A saved
 * Pages view that names one drops it silently (`GONE_PAGE_KEYS`), with no error and no write.
 */
const NOW = new Date(2026, 10, 12, 9, 0).getTime()
const page = (name: string, cards?: CardRecord[]): IndexRecord => ({
  path: `/v/Deck/${name}.md`, name: `${name}.md`, basename: name, title: name, folder: 'Deck', ext: 'md', size: 1, ctime: 1, mtime: 1,
  properties: {}, aliases: [], tags: [], links: [], embeds: [], ...(cards !== undefined && { cards }),
})
const RECORDS = [
  // Due (a review long ago), new, learned an hour ago (two Remembered, out of its steps: not due), turned off.
  page('Mixed', [
    { id: 'V-1', off: false, next: false, reviews: [{ at: '2025-01-01T09:00:00.000Z', rating: 'good' }] },
    { id: 'V-2', off: false, next: false, reviews: [] },
    { id: 'V-3', off: false, next: false, reviews: [{ at: '2026-11-12T07:00:00.000Z', rating: 'good' }, { at: '2026-11-12T07:01:00.000Z', rating: 'good' }] },
    { id: 'V-4', off: true, next: false, reviews: [] },
  ]),
  page('Learned', [{ id: 'V-5', off: false, next: false, reviews: [{ at: '2026-11-12T07:00:00.000Z', rating: 'good' }, { at: '2026-11-12T07:01:00.000Z', rating: 'good' }] }]),
  page('Plain'),
]
const GONE = ['file.cards', 'file.due', 'file.archived']

describe('YAZ-5793 (D3): the Pages table no longer has Cards, Due or Archived (YAZ-4967, YAZ-5046)', () => {
  it('none is offered, not even where a row holds a card', () => {
    const plain = { type: 'table' as const, name: 'T' }
    const keys = allPropertyKeys({ views: [plain] }, plain, RECORDS)
    for (const key of GONE) expect(keys).not.toContain(key)
    expect(propertyKeys({ views: [plain] }, plain, RECORDS).filter((k) => GONE.includes(k))).toEqual([])
  })

  it('a saved order with `file.due` (and the others) renders without them, with no error; its other columns stay in order', () => {
    const view = { type: 'table' as const, name: 'T', order: ['file.name', 'file.cards', 'file.due', 'file.archived', 'file.folder'] }
    const def = { views: [view] }
    expect(propertyKeys(def, view, RECORDS)).toEqual(['file.name', 'file.folder'])
    for (const cardSettings of [DEFAULT_REVIEW_SETTINGS, undefined]) {
      const out = runView(def, view, RECORDS, { now: NOW, cardSettings })
      expect(out.errors).toEqual([])
      expect(out.rows.map((r) => r.values['file.name'])).toEqual(['Mixed', 'Learned', 'Plain'])
      for (const r of out.rows) for (const key of GONE) expect(r.values[key] ?? null).toBeNull()
    }
    // The saved view is not rewritten by a read: its order is written again only with the next change.
    expect(view.order).toEqual(['file.name', 'file.cards', 'file.due', 'file.archived', 'file.folder'])
  })

  it('a saved sort on `file.due` or `file.archived` runs with no error and keeps every page', () => {
    for (const property of ['file.due', 'file.archived']) {
      const view = { type: 'table' as const, name: 'T', order: ['file.name', property], sort: [{ property, direction: 'DESC' as const }] }
      const out = runView({ views: [view] }, view, RECORDS, { now: NOW, cardSettings: DEFAULT_REVIEW_SETTINGS })
      expect(out.errors).toEqual([])
      expect(out.rows.map((r) => r.values['file.name']).sort()).toEqual(['Learned', 'Mixed', 'Plain'])
    }
  })
})

describe('YAZ-5047: the Type column (`file.kind`): Page, Card, Folder', () => {
  /** A card file as the index holds it (YAZ-5037): `kind: 'card'`, its one card. */
  const cardFile = (name: string, id: string): IndexRecord => ({ ...page(name, [{ id, off: false, next: false, reviews: [], title: name }]), properties: { kind: 'card' }, kind: 'card' })
  /** A subfolder's row (YAZ-4579 D31): its `.folder.md`. */
  const folderRow: IndexRecord = { ...page('Sub'), path: '/v/Deck/Sub/.folder.md', name: '.folder.md', basename: '.folder' }
  const recs = [page('Plain'), cardFile('Capital of France', 'GEO-140'), folderRow]
  const TV = { type: 'table' as const, name: 'T', order: ['file.name', 'file.kind'] }
  // Folders first (YAZ-4579 D33): the folder row leads.
  const kinds = (opts: Parameters<typeof runView>[3]) => runView({ views: [TV] }, TV, recs, { now: NOW, ...opts }).rows.map((r) => [r.record.title, r.values['file.kind']])
  const ON = { ...DEFAULT_REVIEW_SETTINGS, enabled: true }

  it('is labelled "Type"; with Review on its values are page, card and folder, which the cell says as Page, Card and Folder', () => {
    expect(defaultLabel('file.kind')).toBe('Type')
    expect(kinds({ cardSettings: ON })).toEqual([['Sub', 'folder'], ['Plain', 'page'], ['Capital of France', 'card']])
    expect(['page', 'card', 'folder'].map(typeWord)).toEqual(['Page', 'Card', 'Folder'])
  })

  it('with Review off (or no settings for the vault) a card file reads as a Page', () => {
    for (const cardSettings of [{ ...DEFAULT_REVIEW_SETTINGS, enabled: false }, undefined]) expect(kinds({ cardSettings })[2]).toEqual(['Capital of France', 'page'])
  })

  it('the formula value `file.kind` is `card` for a card file; a page is `page` (YAZ-5036)', () => {
    const view = { type: 'table' as const, name: 'T', order: ['file.name', 'formula.k'] }
    const values = runView({ views: [view], formulas: { k: 'file.kind' } }, view, recs.slice(0, 2), { now: NOW }).rows.map((r) => r.values['formula.k'])
    expect(values).toEqual(['page', 'card'])
  })

  it('is off by default; offered among the hidden columns where a row is a card file, and its filter offers card', () => {
    const plain = { type: 'table' as const, name: 'T' }
    expect(propertyKeys({ views: [plain] }, plain, recs)).not.toContain('file.kind')
    expect(allPropertyKeys({ views: [plain] }, plain, recs)).toContain('file.kind')
    expect(allPropertyKeys({ views: [plain] }, plain, [page('Plain')])).not.toContain('file.kind')
    expect(propertyValues('file.kind', recs, null)).toEqual(['page', 'card', 'folder'])
    expect(propertyValues('file.kind', [page('Plain')], null)).toEqual(['page', 'folder'])
  })

  it('YAZ-5793: a Card table lists the cards that live in a file, never the cards it embeds (the card counts it replaces counted the same)', () => {
    const embedder: IndexRecord = { ...page('Embeds'), embeds: ['GEO-140'] }
    const rows = cardRowRecords([embedder, cardFile('Capital of France', 'GEO-140')])
    expect(rows.map((r) => [r.path, r.title])).toEqual([['/v/Deck/Capital of France.md', 'Capital of France']])
  })
})
