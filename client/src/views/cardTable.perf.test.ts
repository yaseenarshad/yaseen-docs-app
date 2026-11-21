import { describe, expect, it } from 'vitest'
import { cardTime, type CardRating, type CardRecord } from '@shared/cardLine'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { budgetMs, timeMedian } from '../test-perf'
import { CARD_KEYS, cardRowRecords } from './cardRows'
import { runView } from './engine'
import type { ViewDef } from './viewSchema'

/**
 * The Card table (YAZ-5793): every run of the view reads each card row's columns (`cardValues`) — the due date, and
 * Wait time, Times forgotten and Recall chance off one cached replay (`cardMemory`). 3,000 cards with 10 reviews each,
 * on 300 pages: the first run (nothing cached: a replay per card), then runs as a re-render or a sort makes them, each
 * on a new snapshot of the same vault (the index hands new objects; the caches are keyed by the review log).
 */
const DAY = 86_400_000
const NOW = new Date(2026, 10, 18, 9, 0).getTime()
const RATINGS: CardRating[] = ['good', 'good', 'again', 'good', 'hard', 'good', 'easy', 'good', 'good', 'good']

function cards(page: number): CardRecord[] {
  return Array.from({ length: 10 }, (_, c) => {
    const n = page * 10 + c
    const start = NOW - 400 * DAY + (n % 97) * DAY
    // One card in five is New (no ✓ yet), one in ten Archived: the columns are blank for them.
    const reviews = n % 5 === 0 ? [] : RATINGS.map((rating, r) => ({ at: cardTime(start + r * 20 * DAY + c * 60_000), rating }))
    return { id: `WIKI-${n}`, title: `Card ${n}`, off: n % 10 === 1, next: false, reviews, properties: { level: `L${n % 4}` } }
  })
}

/** A fresh snapshot, every object new. */
const snapshot = (): IndexRecord[] =>
  Array.from({ length: 300 }, (_, p) => ({
    path: `/vault/Deck/Page ${String(p).padStart(3, '0')}.md`, name: `Page ${p}.md`, basename: `Page ${p}`, title: `Page ${p}`, folder: 'Deck', ext: 'md',
    size: 1000, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], cards: cards(p),
  }))

/** A Card table showing every card column, sorted by Recall chance as a reader would to find the weak cards. */
const VIEW: ViewDef = { type: 'table', name: 'Card table', rows: 'cards', order: ['file.name', ...CARD_KEYS], sort: [{ property: 'card.recall', direction: 'ASC' }] }

describe('Card table perf (YAZ-5793)', () => {
  it('3,000 cards, every column, sorted by Recall chance: the first run under 600 ms, a run on a new snapshot under 80 ms (CI measured 55 ms on PR #275)', () => {
    const settings = { ...DEFAULT_REVIEW_SETTINGS } // a new settings object: empty caches
    const run = (pages: IndexRecord[]) => runView({ views: [VIEW] }, VIEW, cardRowRecords(pages), { now: NOW, cardSettings: settings })
    const cold = snapshot()
    const start = performance.now()
    const first = run(cold)
    const coldMs = performance.now() - start
    // Each run: a new snapshot (built before the clock starts), as the index hands one on every change.
    const inputs = Array.from({ length: 9 }, () => snapshot())
    const { median, worst, result } = timeMedian(9, (i) => run(inputs[i]))
    console.log(`Card table 3,000 cards: first run ${coldMs.toFixed(1)} ms; new snapshot: median ${median.toFixed(2)} ms, worst ${worst.toFixed(2)} ms`)
    expect(first.rows).toHaveLength(3000)
    expect(result.rows).toHaveLength(3000)
    // The weak cards first; New and Archived cards have no recall chance and sort last.
    const recalls = result.rows.map((r) => r.values['card.recall'])
    expect(typeof recalls[0]).toBe('number')
    expect(recalls.filter((v) => v === null)).toHaveLength(900)
    expect(coldMs).toBeLessThan(budgetMs(600))
    expect(median).toBeLessThan(budgetMs(80))
  })
})
