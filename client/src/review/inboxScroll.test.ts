import { expect, it } from 'vitest'
import { LAND_LINE, READ_LINE, readingScroll } from './inboxScroll'

// A room of 300 px from 100 to 400: the read line at 300, the land line at 200.
const room = { start: 100, end: 400 }

it('YAZ-5049 round 2: a word in the top two thirds does not move the view', () => {
  expect(READ_LINE).toBeCloseTo(2 / 3)
  expect(readingScroll({ start: 120, end: 140 }, room)).toBe(0)
  expect(readingScroll({ start: 280, end: 300 }, room)).toBe(0)
})

it('YAZ-5049 round 2: a word past the read line, or below the room, comes to the land line (a third down, never the centre)', () => {
  expect(LAND_LINE).toBeCloseTo(1 / 3)
  expect(readingScroll({ start: 290, end: 310 }, room)).toBe(90)
  expect(readingScroll({ start: 900, end: 920 }, room)).toBe(700)
  // Where it lands: a third of the way down, with two thirds of the room under it.
  expect(290 - readingScroll({ start: 290, end: 310 }, room)).toBe(200)
})

it('YAZ-5049 round 2: a word above the room comes in by the least scroll, a gap kept; an empty room never moves', () => {
  expect(readingScroll({ start: 40, end: 60 }, room)).toBe(40 - 100 - 6)
  expect(readingScroll({ start: 900, end: 920 }, { start: 100, end: 100 })).toBe(0)
})
