import { describe, expect, it } from 'vitest'
import type { NoteCardRecord } from '@shared/cardLine'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { defaultLabel, propertyKeys, runView } from './engine'
import { allPropertyKeys } from './view/properties'
import { propertyValues } from './view/filterRows'
import { typeWord } from './view/typeWord'

/**
 * The folder tables' note card counts (YAZ-4967, idea 2): "Cards" (`file.cards`) and "Due" (`file.due`), one row per
 * page, read off the index's `cards` — no file read. Opt-in like the other file fields: offered among the hidden
 * columns only where a row holds a card. Blank, not 0, where there is nothing to count.
 */
const NOW = new Date(2026, 10, 12, 9, 0).getTime()
const page = (name: string, cards?: NoteCardRecord[]): IndexRecord => ({
  path: `/v/Deck/${name}.md`, name: `${name}.md`, basename: name, title: name, folder: 'Deck', ext: 'md', size: 1, ctime: 1, mtime: 1,
  properties: {}, aliases: [], tags: [], links: [], embeds: [], ...(cards !== undefined && { cards }),
})
const RECORDS = [
  // Due (a review long ago), new, learned an hour ago (two Remembered, out of its steps: not due), turned off.
  page('Mixed', [
    { id: 'V-1', off: false, next: false, reviews: [{ at: '2025-01-01T09:00Z', rating: 'good' }] },
    { id: 'V-2', off: false, next: false, reviews: [] },
    { id: 'V-3', off: false, next: false, reviews: [{ at: '2026-11-12T07:00Z', rating: 'good' }, { at: '2026-11-12T07:01Z', rating: 'good' }] },
    { id: 'V-4', off: true, next: false, reviews: [] },
  ]),
  page('Learned', [{ id: 'V-5', off: false, next: false, reviews: [{ at: '2026-11-12T07:00Z', rating: 'good' }, { at: '2026-11-12T07:01Z', rating: 'good' }] }]),
  page('Plain'),
]
const VIEW = { type: 'table' as const, name: 'T', order: ['file.name', 'file.cards', 'file.due'] }
const cells = (opts: Parameters<typeof runView>[3]) =>
  runView({ views: [VIEW] }, VIEW, RECORDS, { now: NOW, ...opts }).rows.map((r) => [r.values['file.name'], r.values['file.cards'], r.values['file.due']])

describe('YAZ-5046: the Archived column', () => {
  const AV = { type: 'table' as const, name: 'T', order: ['file.name', 'file.archived'] }
  const archived = (view: typeof AV & { sort?: unknown }) => runView({ views: [view as never] }, view as never, RECORDS, { now: NOW }).rows.map((r) => [r.values['file.name'], r.values['file.archived']])

  it('counts each page\'s archived cards (the line\'s `off`), with or without review settings; none: blank; its name is "Archived"', () => {
    expect(archived(AV)).toEqual([['Mixed', 1], ['Learned', null], ['Plain', null]])
    expect(defaultLabel('file.archived')).toBe('Archived')
  })

  it('sorts as the Cards and Due columns do: by the number', () => {
    const recs = [...RECORDS, page('Two', [{ id: 'V-8', off: true, next: false, reviews: [] }, { id: 'V-9', off: true, next: false, reviews: [] }])]
    const view = { ...AV, sort: [{ property: 'file.archived', direction: 'DESC' as const }] }
    expect(runView({ views: [view] }, view, recs, { now: NOW }).rows.slice(0, 2).map((r) => [r.values['file.name'], r.values['file.archived']])).toEqual([['Two', 2], ['Mixed', 1]])
  })

  it('is offered as a hidden column only where a row holds a card, as Cards and Due are', () => {
    const plain = { type: 'table' as const, name: 'T' }
    expect(allPropertyKeys({ views: [plain] }, plain, RECORDS)).toEqual(expect.arrayContaining(['file.cards', 'file.due', 'file.archived']))
    expect(allPropertyKeys({ views: [plain] }, plain, [page('Plain')])).not.toContain('file.archived')
  })
})

describe('Cards and Due columns (YAZ-4967, idea 2)', () => {
  it('count each page\'s cards and its reviewed cards due now (a new card is not "due": the daily limit is the vault\'s); none: blank', () => {
    expect(cells({ cardSettings: DEFAULT_REVIEW_SETTINGS })).toEqual([
      ['Mixed', 4, 1],
      ['Learned', 1, null],
      ['Plain', null, null],
    ])
    expect([defaultLabel('file.cards'), defaultLabel('file.due')]).toEqual(['Cards', 'Due'])
  })

  it('with review off, or no settings for the vault, "Due" is blank and "Cards" still counts', () => {
    for (const cardSettings of [{ ...DEFAULT_REVIEW_SETTINGS, enabled: false }, undefined]) {
      expect(cells({ cardSettings }).map(([, cards, due]) => [cards, due])).toEqual([[4, null], [1, null], [null, null]])
    }
  })

  it('are offered as hidden columns only where a row holds a card', () => {
    const plain = { type: 'table' as const, name: 'T' }
    expect(allPropertyKeys({ views: [plain] }, plain, RECORDS)).toEqual(expect.arrayContaining(['file.cards', 'file.due']))
    expect(allPropertyKeys({ views: [plain] }, plain, [page('Plain')])).not.toContain('file.cards')
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

  it('is labelled "Type"; with Review on its values are note, card and folder, which the cell says as Page, Card and Folder', () => {
    expect(defaultLabel('file.kind')).toBe('Type')
    expect(kinds({ cardSettings: ON })).toEqual([['Sub', 'folder'], ['Plain', 'note'], ['Capital of France', 'card']])
    expect(['note', 'card', 'folder'].map(typeWord)).toEqual(['Page', 'Card', 'Folder'])
  })

  it('with Review off (or no settings for the vault) a card file reads as a Page', () => {
    for (const cardSettings of [{ ...DEFAULT_REVIEW_SETTINGS, enabled: false }, undefined]) expect(kinds({ cardSettings })[2]).toEqual(['Capital of France', 'note'])
  })

  it('the formula value `file.kind` is `card` for a card file; a page stays `note` (until YAZ-5036)', () => {
    const view = { type: 'table' as const, name: 'T', order: ['file.name', 'formula.k'] }
    const values = runView({ views: [view], formulas: { k: 'file.kind' } }, view, recs.slice(0, 2), { now: NOW }).rows.map((r) => r.values['formula.k'])
    expect(values).toEqual(['note', 'card'])
  })

  it('is off by default; offered among the hidden columns where a row is a card file, and its filter offers card', () => {
    const plain = { type: 'table' as const, name: 'T' }
    expect(propertyKeys({ views: [plain] }, plain, recs)).not.toContain('file.kind')
    expect(allPropertyKeys({ views: [plain] }, plain, recs)).toContain('file.kind')
    expect(allPropertyKeys({ views: [plain] }, plain, [page('Plain')])).not.toContain('file.kind')
    expect(propertyValues('file.kind', recs, null)).toEqual(['note', 'card', 'folder'])
    expect(propertyValues('file.kind', [page('Plain')], null)).toEqual(['note', 'folder'])
  })

  it('Cards, Due and Archived count the cards that live in the file, never the cards it embeds', () => {
    const embedder: IndexRecord = { ...page('Embeds'), embeds: ['GEO-140'] }
    const view = { type: 'table' as const, name: 'T', order: ['file.name', 'file.cards', 'file.archived'] }
    const rows = runView({ views: [view] }, view, [embedder, cardFile('Capital of France', 'GEO-140')], { now: NOW }).rows.map((r) => [r.record.title, r.values['file.cards'], r.values['file.archived']])
    expect(rows).toEqual([['Embeds', null, null], ['Capital of France', 1, null]])
  })
})
