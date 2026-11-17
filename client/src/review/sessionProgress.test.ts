import { describe, expect, it } from 'vitest'
import type { CardRating } from '@shared/cardLine'
import { dueFirsts, filterCount, type SessionAnswer, type SessionCard } from './sessionProgress'

const key = (id: string) => `P.md\n${id}`
const due = (id: string, rating: CardRating, first = true): SessionAnswer => ({ key: key(id), rating, isNew: false, next: false, first })
const fresh = (id: string, rating: CardRating): SessionAnswer => ({ key: key(id), rating, isNew: true, next: false, first: false })
const card = (id: string, isNew = false, forgot = false): SessionCard => ({ path: 'P.md', id, isNew, next: false, forgot })
/** A learned new card back for its second ✓: a Due today card now. */
const learned = (id: string): SessionCard => ({ path: 'P.md', id, isNew: false, next: false })

/** The top right and the bar as Mochi shows them (YAZ-5671 finding 15): "✕ K · done / total", grey %, red %. */
const read = (answers: SessionAnswer[], queue: SessionCard[], filter: 'all' | 'due' | 'new' = 'due') => {
  const c = filterCount(answers, queue, filter)
  return { top: `${c.waiting > 0 ? `✕ ${c.waiting} · ` : ''}${c.done} / ${c.total}`, grey: Math.round((100 * c.done) / c.total), red: Math.round((100 * (c.done + c.waiting)) / c.total) }
}

describe('YAZ-5675: the numbers move as Mochi`s (YAZ-5671 finding 15, a 4-card session, measured after every answer)', () => {
  it('first pass: each miss adds 1 to the total and 1 to ✕; the bar is full at the end of the pass', () => {
    const answers: SessionAnswer[] = []
    expect(read(answers, [card('a'), card('b'), card('c'), card('d')])).toEqual({ top: '0 / 4', grey: 0, red: 0 })
    answers.push(due('a', 'again'))
    expect(read(answers, [card('b'), card('c'), card('d'), card('a', false, true)])).toEqual({ top: '✕ 1 · 1 / 5', grey: 20, red: 40 })
    answers.push(due('b', 'again'))
    expect(read(answers, [card('c'), card('d'), card('a', false, true), card('b', false, true)])).toEqual({ top: '✕ 2 · 2 / 6', grey: 33, red: 67 })
    answers.push(due('c', 'good'))
    expect(read(answers, [card('d'), card('a', false, true), card('b', false, true)])).toEqual({ top: '✕ 2 · 3 / 6', grey: 50, red: 83 })
    answers.push(due('d', 'good'))
    expect(read(answers, [card('a', false, true), card('b', false, true)])).toEqual({ top: '✕ 2 · 4 / 6', grey: 67, red: 100 })
    // "You remembered 50% of cards."
    expect(dueFirsts(answers).percent).toBe(50)
  })

  it('the missed pass: done stays; a Forgot moves nothing; each Remembered takes 1 off the total', () => {
    const answers = [due('a', 'again'), due('b', 'again'), due('c', 'good'), due('d', 'good')]
    const c = (q: SessionCard[]) => filterCount(answers, q, 'due')
    expect(c([card('a', false, true), card('b', false, true)])).toEqual({ done: 4, total: 6, waiting: 2 })
    answers.push(due('a', 'again', false))
    expect(c([card('b', false, true), card('a', false, true)])).toEqual({ done: 4, total: 6, waiting: 2 })
    answers.push(due('b', 'good', false))
    expect(c([card('a', false, true)])).toEqual({ done: 4, total: 5, waiting: 1 })
    answers.push(due('a', 'good', false))
    expect(c([])).toEqual({ done: 4, total: 4, waiting: 0 })
  })
})

describe('YAZ-5675: new cards (YAZ-5671 findings 3, 4, 11, 18)', () => {
  it('New cards, 4 new: a Forgot moves nothing; each Remembered is done +1; the total stays 4', () => {
    const answers: SessionAnswer[] = [fresh('w', 'again')]
    expect(filterCount(answers, [card('x', true), card('y', true), card('z', true), card('w', true)], 'new')).toEqual({ done: 0, total: 4, waiting: 0 })
    answers.push(fresh('x', 'good'))
    // The learned card left New cards: it waits under Due today now.
    expect(filterCount(answers, [card('y', true), card('z', true), card('w', true), learned('x')], 'new')).toEqual({ done: 1, total: 4, waiting: 0 })
    answers.push(fresh('y', 'good'), fresh('z', 'good'), fresh('w', 'again'))
    expect(filterCount(answers, [card('w', true), learned('x'), learned('y'), learned('z')], 'new')).toEqual({ done: 3, total: 4, waiting: 0 })
    answers.push(fresh('w', 'good'))
    expect(filterCount(answers, [learned('x'), learned('y'), learned('z'), learned('w')], 'new')).toEqual({ done: 4, total: 4, waiting: 0 })
    // A Forgot on a new card never makes a ✕ (finding 11).
    expect(filterCount([fresh('w', 'again')], [card('w', true, true)], 'all').waiting).toBe(0)
  })

  it('All cards: a new card learned adds 1 to the total (it comes back today); its second ✓ is done +1', () => {
    const answers: SessionAnswer[] = [due('a', 'good'), due('b', 'good'), due('c', 'good')]
    expect(filterCount(answers, [card('n', true)], 'all')).toEqual({ done: 3, total: 4, waiting: 0 })
    answers.push(fresh('n', 'good'))
    expect(filterCount(answers, [learned('n')], 'all')).toEqual({ done: 4, total: 5, waiting: 0 })
    answers.push(due('n', 'good', false))
    expect(filterCount(answers, [], 'all')).toEqual({ done: 5, total: 5, waiting: 0 })
  })

  it('the numbers survive a filter switch: each filter reads its own share of the same answers', () => {
    const answers = [due('a', 'again'), fresh('n', 'good'), due('b', 'good')]
    const queue = [card('m', true), card('a', false, true), learned('n')]
    const all = filterCount(answers, queue, 'all')
    expect(filterCount(answers, queue, 'new')).toEqual({ done: 1, total: 2, waiting: 0 })
    expect(filterCount(answers, queue, 'due')).toEqual({ done: 2, total: 4, waiting: 1 })
    expect(filterCount(answers, queue, 'all')).toEqual(all)
    expect(all).toEqual({ done: 3, total: 6, waiting: 1 })
    // YAZ-5681: the ✕ is each filter's own (New cards none), not the session's.
    expect(filterCount(answers, queue, 'new').waiting).toBe(0)
  })
})

describe('the ring reads the due cards` first answers only', () => {
  it('a card missed then got right counts as missed; a new card never counts', () => {
    expect(dueFirsts([due('a', 'good'), due('b', 'again'), due('b', 'good', false), fresh('x', 'good')])).toEqual({ count: 2, remembered: 1, percent: 50 })
    expect(dueFirsts([])).toEqual({ count: 0, remembered: 0, percent: 100 })
    // YAZ-5680 check (Mochi, finding 8): 2 of 3 is 67%, to the nearest; never 100 while one was missed.
    expect(dueFirsts([due('a', 'good'), due('b', 'good'), due('c', 'again')]).percent).toBe(67)
    expect(dueFirsts([due('a', 'good'), due('b', 'again'), due('c', 'again')]).percent).toBe(33)
    const many = Array.from({ length: 200 }, (_, i) => due(`m${i}`, i === 0 ? 'again' : 'good'))
    expect(dueFirsts(many).percent).toBe(99)
  })
})

// Review rules v1, rule 7 (YAZ-5655): each card is in one list only.
it('rule 7: an Up next card counts under Up next and All cards only, never under its own kind', () => {
  const marked: SessionAnswer = { ...due('m', 'good'), next: true }
  const waiting: SessionCard = { path: 'P.md', id: 'o', isNew: true, next: true }
  expect(filterCount([marked], [waiting], 'next')).toEqual({ done: 1, total: 2, waiting: 0 })
  expect(filterCount([marked], [waiting], 'all')).toEqual({ done: 1, total: 2, waiting: 0 })
  expect(filterCount([marked], [waiting], 'new')).toEqual({ done: 0, total: 0, waiting: 0 })
  expect(filterCount([marked], [], 'due')).toEqual({ done: 0, total: 0, waiting: 0 })
})
