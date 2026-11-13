import { describe, expect, it } from 'vitest'
import type { NoteCardRecord } from '@shared/cardLine'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { defaultLabel, runView } from './engine'
import { allPropertyKeys } from './view/properties'

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
