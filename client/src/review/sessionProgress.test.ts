import { describe, expect, it } from 'vitest'
import type { CardRating } from '@shared/cardLine'
import { dueFirsts, filterPlace, filterProgress, type SessionAnswer, type SessionCard } from './sessionProgress'

const key = (id: string) => `P.md\n${id}`
const due = (id: string, rating: CardRating, first = true): SessionAnswer => ({ key: key(id), rating, isNew: false, next: false, first })
const fresh = (id: string, rating: CardRating): SessionAnswer => ({ key: key(id), rating, isNew: true, next: false, first: false })
const card = (id: string, isNew = false, next = false): SessionCard => ({ path: 'P.md', id, isNew, next })
const share = (p: { done: number; size: number }) => p.done / p.size

describe('YAZ-5432: the progress bar counts only the tab on show', () => {
  // A session: 4 due cards (2 missed, then their pass), 2 new cards answered (y missed, back), 2 new cards not yet.
  const answers = [due('a', 'good'), due('b', 'again'), due('c', 'good'), due('d', 'again'), due('b', 'good', false), due('d', 'good', false), fresh('x', 'good'), fresh('y', 'again')]
  const queue = [card('y', true), card('n1', true), card('n2', true)]

  it('per tab, the filled share is that tab`s cards done / its cards', () => {
    expect(filterProgress(answers, queue, 'due')).toMatchObject({ done: 4, size: 4 })
    expect(filterProgress(answers, queue, 'new')).toMatchObject({ done: 1, size: 4 })
    expect(filterProgress(answers, queue, 'all')).toMatchObject({ done: 5, size: 8 })
    expect(filterProgress(answers, queue, 'next')).toMatchObject({ done: 0, size: 0, runs: [] })
  })

  it('Due today done: the bar is full, whatever waits under New cards', () => {
    expect(share(filterProgress(answers, queue, 'due'))).toBe(1)
  })

  it('the first pass done, the missed cards wait: red, not done, and the bar no bigger', () => {
    // On the % screen the reds stand where they were missed; on to the missed cards, they wait at the right end (YAZ-5660).
    expect(filterProgress(answers.slice(0, 4), [card('b'), card('d')], 'due')).toMatchObject({ runs: [{ missed: false, count: 2 }, { missed: true, count: 2 }], done: 2, size: 4 })
    expect(filterProgress(answers.slice(0, 4), [card('b'), card('d')], 'due', { paused: true })).toEqual({
      runs: [
        { missed: false, count: 1 },
        { missed: true, count: 1 },
        { missed: false, count: 1 },
        { missed: true, count: 1 },
      ],
      done: 2,
      size: 4,
    })
  })

  // Review rules v1, rule 7 (YAZ-5655): each card is in one list only. Before, an Up next card counted under its own kind too.
  it('rule 7: an Up next card counts under Up next and All cards only, never under its own kind', () => {
    const marked: SessionAnswer = { ...fresh('m', 'good'), next: true }
    expect(filterProgress([marked], [card('o', true, true)], 'next')).toMatchObject({ done: 1, size: 2 })
    expect(filterProgress([marked], [card('o', true, true)], 'all')).toMatchObject({ done: 1, size: 2 })
    expect(filterProgress([marked], [card('o', true, true)], 'new')).toMatchObject({ done: 0, size: 0 })
    expect(filterProgress([marked], [], 'due')).toMatchObject({ done: 0, size: 0 })
  })

  it('the ring reads the same answers: the due cards` first answers only', () => {
    expect(dueFirsts(answers)).toEqual({ count: 4, remembered: 2, percent: 50 })
    expect(dueFirsts([])).toEqual({ count: 0, remembered: 0, percent: 100 })
    expect(dueFirsts([due('a', 'good'), due('b', 'good'), due('c', 'again')]).percent).toBe(66)
  })
})

describe('YAZ-5594, YAZ-5610: one step and one count per CARD, never per answer', () => {
  it('3 cards, the last one forgotten 3 times then remembered: 3 steps and "3 / 3" all the way; it turns grey when let go', () => {
    const answers: SessionAnswer[] = []
    const read = (queue: SessionCard[]) => ({ ...filterProgress(answers, queue, 'due'), ...filterPlace(answers, queue, 0, 'due') })
    expect(read([card('a'), card('b'), card('c')])).toEqual({ runs: [], done: 0, size: 3, position: 1, total: 3 })
    answers.push(due('a', 'good'))
    expect(read([card('b'), card('c')])).toEqual({ runs: [{ missed: false, count: 1 }], done: 1, size: 3, position: 2, total: 3 })
    answers.push(due('b', 'good'))
    expect(read([card('c')])).toEqual({ runs: [{ missed: false, count: 2 }], done: 2, size: 3, position: 3, total: 3 })
    for (let i = 0; i < 3; i++) {
      answers.push(due('c', 'again', i === 0))
      expect(read([card('c')])).toEqual({ runs: [{ missed: false, count: 2 }, { missed: true, count: 1 }], done: 2, size: 3, position: 3, total: 3 })
    }
    answers.push(due('c', 'good', false))
    expect(filterProgress(answers, [], 'due')).toEqual({ runs: [{ missed: false, count: 3 }], done: 3, size: 3 })
  })

  it('a forgotten first card: the next card is "2 / 3", the bar has one red step and is no bigger', () => {
    const answers = [due('a', 'again')]
    const queue = [card('b'), card('c'), card('a')]
    expect(filterPlace(answers, queue, 0, 'all')).toEqual({ position: 2, total: 3 })
    expect(filterProgress(answers, queue, 'all')).toEqual({ runs: [{ missed: true, count: 1 }], done: 0, size: 3 })
  })

  it('a new card back after its first Remembered: its step stays empty (not done), the count stays', () => {
    const answers = [fresh('x', 'good')]
    const queue = [card('y', true), card('x', true)]
    expect(filterProgress(answers, queue, 'new')).toEqual({ runs: [{ missed: false, count: 1, open: true }], done: 0, size: 2 })
    expect(filterPlace(answers, queue, 0, 'new')).toEqual({ position: 2, total: 2 })
    expect(filterPlace(answers, queue, 1, 'new')).toEqual({ position: 2, total: 2 })
  })
})

/** The bar as Yaseen reads it: g grey, r red, . empty, one letter per card. */
const bar = (p: { runs: { missed: boolean; count: number; open?: boolean }[]; size: number }): string =>
  p.runs.map((r) => (r.open === true ? '.' : r.missed ? 'r' : 'g').repeat(r.count)).join('').padEnd(p.size, '.')

describe('YAZ-5660: option B — a red stays where it was missed; the pass over, the reds slide to the right end', () => {
  // Yaseen's mockup: 17 due cards, missed 3, 5, 6 and 12. Made-up cards.
  const ids = Array.from({ length: 17 }, (_, i) => `c${i + 1}`)
  const missed = new Set(['c3', 'c5', 'c6', 'c12'])
  const firstPass = (upTo: number): SessionAnswer[] => ids.slice(0, upTo).map((id) => due(id, missed.has(id) ? 'again' : 'good'))
  const waiting = (upTo: number): SessionCard[] => [...ids.slice(upTo), ...ids.slice(0, upTo).filter((id) => missed.has(id))].map((id) => card(id))

  it('first pass: each answer fills the next piece from the left; a red stays in its place', () => {
    expect(bar(filterProgress(firstPass(1), waiting(1), 'due'))).toBe('g' + '.'.repeat(16))
    expect(bar(filterProgress(firstPass(3), waiting(3), 'due'))).toBe('ggr' + '.'.repeat(14))
    expect(bar(filterProgress(firstPass(6), waiting(6), 'due'))).toBe('ggrgrr' + '.'.repeat(11))
    expect(bar(filterProgress(firstPass(12), waiting(12), 'due'))).toBe('ggrgrrgggggr' + '.'.repeat(5))
  })

  it('card 17: the bar is FULL with the reds in place (the % screen); on to the missed cards, 13 grey then 4 red', () => {
    const answers = firstPass(17)
    const pausedBar = filterProgress(answers, waiting(17), 'due', { paused: true })
    expect(bar(pausedBar)).toBe('ggrgrrgggggrggggg')
    expect(pausedBar.moved).toBeUndefined()
    const slid = filterProgress(answers, waiting(17), 'due')
    expect(bar(slid)).toBe('g'.repeat(13) + 'rrrr')
    expect(slid).toMatchObject({ done: 13, size: 17 })
    // The slide (drawn once): each red, left to right, moved from 3, 5, 6 and 12 to 14, 15, 16 and 17.
    expect(slid.moved).toEqual([11, 10, 10, 5])
  })

  it('Review missed cards: each ✓ turns the leftmost red grey; a ✕ leaves it red; all grey = done', () => {
    const answers = firstPass(17)
    let queue = waiting(17)
    const answer = (id: string, rating: CardRating) => {
      answers.push(due(id, rating, false))
      queue = queue.filter((c) => c.id !== id)
      if (rating === 'again') queue.push(card(id))
      return filterProgress(answers, queue, 'due')
    }
    expect(bar(answer('c3', 'good'))).toBe('g'.repeat(14) + 'rrr')
    const again = answer('c5', 'again')
    expect(bar(again)).toBe('g'.repeat(14) + 'rrr')
    expect(again.moved).toBeUndefined()
    expect(bar(answer('c6', 'good'))).toBe('g'.repeat(15) + 'rr')
    expect(bar(answer('c12', 'good'))).toBe('g'.repeat(16) + 'r')
    expect(answer('c5', 'good')).toEqual({ runs: [{ missed: false, count: 17 }], done: 17, size: 17 })
  })

  it('a card joins mid-session (the other device, Add more): the bar grows and the pass is not over', () => {
    expect(bar(filterProgress(firstPass(17), [...waiting(17), card('c18')], 'due'))).toBe('ggrgrrgggggrggggg.')
  })

  it('New cards: a new card`s ✕ keeps it New and red; the pass over, it slides right', () => {
    const answers = [fresh('x', 'again'), fresh('y', 'good')]
    expect(bar(filterProgress(answers, [card('z', true), card('x', true)], 'new'))).toBe('rg.')
    answers.push(fresh('z', 'good'))
    expect(bar(filterProgress(answers, [card('x', true)], 'new'))).toBe('ggr')
  })
})
