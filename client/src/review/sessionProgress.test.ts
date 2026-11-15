import { describe, expect, it } from 'vitest'
import type { CardRating } from '@shared/cardLine'
import { dueFirsts, filterProgress, type SessionAnswer } from './sessionProgress'

const due = (key: string, rating: CardRating, first = true): SessionAnswer => ({ key, rating, isNew: false, next: false, first })
const fresh = (key: string, rating: CardRating): SessionAnswer => ({ key, rating, isNew: true, next: false, first: false })
const share = (p: { done: number; size: number }) => p.done / p.size

describe('YAZ-5432: the progress bar counts only the tab on show', () => {
  // A session: 4 due cards (2 missed, then their pass), 2 new cards answered, 3 new cards left.
  const answers = [due('a', 'good'), due('b', 'again'), due('c', 'good'), due('d', 'again'), due('b', 'good', false), due('d', 'good', false), fresh('x', 'good'), fresh('y', 'again')]
  const left = { all: 3, due: 0, new: 3, next: 0 }

  it('per tab, the filled share is that tab`s done / total', () => {
    expect(filterProgress(answers, 'due', left.due)).toMatchObject({ done: 6, size: 6 })
    expect(filterProgress(answers, 'new', left.new)).toMatchObject({ done: 2, size: 5 })
    expect(filterProgress(answers, 'all', left.all)).toMatchObject({ done: 8, size: 11 })
    expect(filterProgress(answers, 'next', left.next)).toMatchObject({ done: 0, size: 0, runs: [] })
  })

  it('Due today done: the bar is full, whatever waits under New cards', () => {
    expect(share(filterProgress(answers, 'due', 0))).toBe(1)
  })

  it('the first pass done, the missed cards wait: they are the bar`s empty part, and the first answers are its red and grey', () => {
    const first = answers.slice(0, 4)
    expect(filterProgress(first, 'due', 2)).toEqual({
      runs: [
        { missed: false, count: 1 },
        { missed: true, count: 1 },
        { missed: false, count: 1 },
        { missed: true, count: 1 },
      ],
      done: 4,
      size: 6,
    })
  })

  it('an Up next card counts under Up next and under its own kind', () => {
    const marked: SessionAnswer = { ...fresh('m', 'good'), next: true }
    expect(filterProgress([marked], 'next', 1)).toMatchObject({ done: 1, size: 2 })
    expect(filterProgress([marked], 'new', 0)).toMatchObject({ done: 1, size: 1 })
    expect(filterProgress([marked], 'due', 0)).toMatchObject({ done: 0, size: 0 })
  })

  it('the ring reads the same answers: the due cards` first answers only', () => {
    expect(dueFirsts(answers)).toEqual({ count: 4, remembered: 2, percent: 50 })
    expect(dueFirsts([])).toEqual({ count: 0, remembered: 0, percent: 100 })
    expect(dueFirsts([due('a', 'good'), due('b', 'good'), due('c', 'again')]).percent).toBe(66)
  })
})
