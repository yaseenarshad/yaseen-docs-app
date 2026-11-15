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
    expect(filterProgress(answers.slice(0, 4), [card('b'), card('d')], 'due')).toEqual({
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

  it('an Up next card counts under Up next and under its own kind', () => {
    const marked: SessionAnswer = { ...fresh('m', 'good'), next: true }
    expect(filterProgress([marked], [card('o', true, true)], 'next')).toMatchObject({ done: 1, size: 2 })
    expect(filterProgress([marked], [], 'new')).toMatchObject({ done: 1, size: 1 })
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
