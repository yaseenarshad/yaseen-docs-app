import { expect, it, vi } from 'vitest'
import { ARROW_SCROLL_FRACTION, LAND_LINE, READ_LINE, arrowGlide, glideToBottom, readingScroll, spaceMove } from './inboxScroll'

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

it('YAZ-6057: arrowGlide smooth-scrolls a larger step and chains rapid repeats without stalling', () => {
  const scrollTo = vi.fn()
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true })
  Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true })
  el.scrollTo = scrollTo as unknown as typeof el.scrollTo
  arrowGlide(el, 1)
  const step = Math.round(600 * ARROW_SCROLL_FRACTION)
  expect(scrollTo).toHaveBeenLastCalledWith({ top: step, behavior: 'smooth' })
  // Second rapid press while scrollTop is still 0 chains from the prior target.
  arrowGlide(el, 1)
  expect(scrollTo).toHaveBeenLastCalledWith({ top: step * 2, behavior: 'smooth' })
  arrowGlide(el, -1)
  expect(scrollTo).toHaveBeenLastCalledWith({ top: step, behavior: 'smooth' })
})

it('YAZ-6058: glideToBottom smooth-scrolls to max on long cards and is a no-op on short cards', () => {
  const scrollTo = vi.fn()
  const long = document.createElement('div')
  Object.defineProperty(long, 'clientHeight', { value: 500, configurable: true })
  Object.defineProperty(long, 'scrollHeight', { value: 1200, configurable: true })
  Object.defineProperty(long, 'scrollTop', { value: 200, writable: true, configurable: true })
  long.scrollTo = scrollTo as unknown as typeof long.scrollTo
  glideToBottom(long)
  expect(scrollTo).toHaveBeenCalledWith({ top: 700, behavior: 'smooth' })

  const short = document.createElement('div')
  Object.defineProperty(short, 'clientHeight', { value: 500, configurable: true })
  Object.defineProperty(short, 'scrollHeight', { value: 500, configurable: true })
  Object.defineProperty(short, 'scrollTop', { value: 0, writable: true, configurable: true })
  short.scrollTo = vi.fn() as unknown as typeof short.scrollTo
  glideToBottom(short)
  expect(short.scrollTo).not.toHaveBeenCalled()
})

it('YAZ-6058: spaceMove("end") returns remaining scroll distance to reach the bottom dock', () => {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 800, width: 800, height: 500, x: 0, y: 0, toJSON: () => ({}) })
  Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
  Object.defineProperty(el, 'scrollTop', { value: 100, writable: true, configurable: true })
  expect(spaceMove(el, 'end')).toBe(400)
})
