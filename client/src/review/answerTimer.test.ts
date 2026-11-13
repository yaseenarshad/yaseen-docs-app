import { describe, expect, it } from 'vitest'
import { CARD_SECONDS_MAX } from '@shared/cardLine'
import { AnswerClock } from './answerTimer'
import { reviewDuration, todayDuration, todayWork } from './reviewTime'

/** YAZ-5033: the answer timer with no DOM, and the words for its time. */
describe('AnswerClock', () => {
  const clock = (idle = 60_000) => {
    let t = 0
    const c = new AnswerClock(idle, () => t)
    return { c, at: (ms: number) => void (t = ms) }
  }

  it('counts the time between touches; a stretch longer than the setting counts nothing (10 s · 90 s idle · 5 s = 15 s)', () => {
    const { c, at } = clock()
    c.restart(true)
    for (let s = 1; s <= 10; s++) at(s * 1000), c.touch()
    at(100_000)
    c.touch()
    for (let s = 101; s <= 105; s++) at(s * 1000), c.touch()
    expect(c.seconds()).toBe(15)
  })

  it('a stretch exactly as long as the setting still counts; one ms more does not', () => {
    const { c, at } = clock(60_000)
    c.restart(true)
    at(60_000)
    c.touch()
    expect(c.seconds()).toBe(60)
    at(120_001)
    expect(c.seconds()).toBe(60)
  })

  it('paused, touches count nothing; resume goes on from then; restart is from zero', () => {
    const { c, at } = clock()
    c.restart(true)
    at(4000)
    c.pause()
    expect(c.running).toBe(false)
    at(9000)
    c.touch()
    at(20_000)
    c.resume()
    at(23_000)
    expect(c.seconds()).toBe(7)
    c.restart(false)
    at(30_000)
    expect(c.seconds()).toBe(0)
    c.resume()
    at(31_000)
    expect(c.seconds()).toBe(1)
  })

  it('a new setting holds from the next stretch; the time is whole seconds and at most a day', () => {
    const { c, at } = clock(60_000)
    c.restart(true)
    c.setIdle(30_000)
    at(45_000)
    expect(c.seconds()).toBe(0)
    at(45_400)
    expect(c.seconds()).toBe(0)
    at(46_000)
    expect(c.seconds()).toBe(1)
    const long = clock(Number.MAX_SAFE_INTEGER)
    long.c.restart(true)
    long.at(3 * 86_400_000)
    expect(long.c.seconds()).toBe(CARD_SECONDS_MAX)
  })
})

describe('the words for the time', () => {
  it('one answer: "13 s", "1 min 4 s", "2 min"; "—" for a review with none', () => {
    expect([0, 13, 59, 60, 64, 120, 3725, undefined].map(reviewDuration)).toEqual(['0 s', '13 s', '59 s', '1 min', '1 min 4 s', '2 min', '62 min 5 s', '—'])
  })

  it('today: seconds under a minute, else whole minutes; the cards with the right word', () => {
    expect([0, 45, 60, 89, 90, 9 * 60 + 29].map(todayDuration)).toEqual(['0 s', '45 s', '1 min', '1 min', '2 min', '9 min'])
    expect(todayWork({ cards: 0, reviews: 0, seconds: 0 })).toBe('')
    expect(todayWork({ cards: 31, reviews: 40, seconds: 540 })).toBe('Today: 31 cards · 9 min')
    expect(todayWork({ cards: 1, reviews: 1, seconds: 0 })).toBe('Today: 1 card')
  })
})
