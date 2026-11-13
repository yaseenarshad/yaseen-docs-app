import { describe, expect, it } from 'vitest'
import { cardTime, type CardRating, type NoteCardRecord } from '@shared/cardLine'
import { cardPlan, cardQueue } from '@shared/cardSchedule'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { budgetMs, timeMedian } from '../test-perf'

/**
 * The sidebar Inbox count (YAZ-4967): `cardQueue(...).length` runs on every index change, over every card of the
 * vault. A snapshot is new objects each time (IPC), so the cache is keyed by each page's path, mtime and size.
 * 10,000 cards with 10 reviews each, on 1,000 pages: cold (no cache), then a new snapshot in which one page changed.
 */
const DAY = 86_400_000
const NOW = new Date(2026, 10, 12, 9, 0).getTime()
const RATINGS: CardRating[] = ['good', 'good', 'again', 'good', 'hard', 'good', 'easy', 'good', 'good', 'good']

function cards(page: number, extra = 0): NoteCardRecord[] {
  return Array.from({ length: 10 }, (_, c) => {
    const start = NOW - 500 * DAY + ((page * 10 + c) % 97) * DAY
    const reviews = RATINGS.map((rating, r) => ({ at: cardTime(start + r * 20 * DAY + c * 60_000), rating }))
    for (let e = 0; e < extra; e++) reviews.push({ at: cardTime(NOW - DAY + e * 60_000), rating: 'good' })
    return { id: `WIKI-${page * 10 + c}`, off: false, next: false, reviews }
  })
}

/** A fresh snapshot, every object new; `changed` is the page that gained a review on each card. */
const snapshot = (changed = -1, extra = 0) =>
  Array.from({ length: 1000 }, (_, p) => ({ path: `/vault/Deck ${String(p).padStart(4, '0')}.md`, folder: '', mtime: p === changed ? NOW + extra : 1, size: 1000, cards: cards(p, p === changed ? extra : 0) }))

describe('Inbox count perf (YAZ-4967)', () => {
  it('counts 10,000 cards with 10 reviews each: cold under 500 ms, after one page changes under 16 ms (one frame)', () => {
    const settings = { ...DEFAULT_REVIEW_SETTINGS } // a new settings object: an empty cache
    const cold = snapshot()
    const start = performance.now()
    const first = cardQueue(cold, settings, NOW).length
    const coldMs = performance.now() - start
    // Each run: a new snapshot (built before the clock starts) in which one more page changed.
    const inputs = Array.from({ length: 9 }, (_, i) => snapshot(i * 37, i + 1))
    const { median, worst, result } = timeMedian(9, (i) => cardQueue(inputs[i], settings, NOW).length)
    console.log(`Inbox count 10,000 cards: cold ${coldMs.toFixed(1)} ms; one page changed: median ${median.toFixed(2)} ms, worst ${worst.toFixed(2)} ms`)
    expect(first).toBeGreaterThan(0)
    expect(result).toBeGreaterThan(0)
    expect(coldMs).toBeLessThan(budgetMs(500))
    expect(median).toBeLessThan(budgetMs(16))
  })
})

/**
 * CARD FILES (YAZ-5037 phase 8): an import makes 5,000 card files, one card each, and 500 pages each embed 10 of them.
 * Each card file is one more record, so the vault-wide count is the same work as before; "Review this page" and
 * "Review this folder" also resolve each page's embeds (`cardsById`, once per plan).
 */
describe('card files perf (YAZ-5037)', () => {
  const cardFiles = (changed = -1) =>
    Array.from({ length: 5000 }, (_, i) => ({ path: `/vault/Cards/card-${i}-wiki-${20000 + i}.md`, folder: 'Cards', mtime: i === changed ? NOW : 1, size: 300, embeds: [] as string[], cards: [{ ...cards(i % 1000)[i % 10], id: `WIKI-${20000 + i}` }] }))
  const pages = Array.from({ length: 500 }, (_, p) => ({ path: `/vault/Decks/deck-${p}.md`, folder: 'Decks', mtime: 1, size: 1000, embeds: Array.from({ length: 10 }, (_, e) => `WIKI-${20000 + ((p * 10 + e) % 5000)}`) }))

  it('5,000 card files: the Inbox count cold under 500 ms, after one file changes under 16 ms; Review this page and this folder with embeds under 50 ms', () => {
    const settings = { ...DEFAULT_REVIEW_SETTINGS }
    const start = performance.now()
    const first = cardQueue([...cardFiles(), ...pages], settings, NOW).length
    const coldMs = performance.now() - start
    const inputs = Array.from({ length: 9 }, (_, i) => [...cardFiles(i * 311), ...pages])
    const { median } = timeMedian(9, (i) => cardQueue(inputs[i], settings, NOW).length)
    const all = [...cardFiles(), ...pages]
    const page = timeMedian(9, () => cardPlan(all, settings, NOW, '', '/vault/Decks/deck-7.md').queue.length)
    const folder = timeMedian(9, () => cardPlan(all, settings, NOW, 'Decks').queue.length)
    console.log(`5,000 card files: Inbox count cold ${coldMs.toFixed(1)} ms, one file changed ${median.toFixed(2)} ms; Review this page ${page.median.toFixed(2)} ms (${page.result} cards); Review this folder ${folder.median.toFixed(2)} ms (${folder.result} cards)`)
    expect(first).toBeGreaterThan(0)
    // The page embeds 10 card files; the folder's 500 pages embed all 5,000, each one time (the new-card limit applies).
    expect(page.result).toBeGreaterThan(0)
    expect(page.result).toBeLessThanOrEqual(10)
    expect(folder.result).toBeGreaterThan(page.result)
    expect(coldMs).toBeLessThan(budgetMs(500))
    expect(median).toBeLessThan(budgetMs(16))
    expect(page.median).toBeLessThan(budgetMs(50))
    expect(folder.median).toBeLessThan(budgetMs(50))
  })
})
