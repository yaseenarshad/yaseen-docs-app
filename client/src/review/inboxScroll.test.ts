import { expect, it, vi } from 'vitest'
import { ARROW_SCROLL_FRACTION, LAND_LINE, READ_LINE, SPACE_PAGE_FRACTION, arrowGlide, glideToBottomIfNear, readingScroll, spaceMove } from './inboxScroll'

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

it('YAZ-6058: glideToBottomIfNear glides only when <= half a viewport remains; no-op on long tails or short cards', () => {
  const scrollTo = vi.fn()
  const near = document.createElement('div')
  Object.defineProperty(near, 'clientHeight', { value: 500, configurable: true })
  Object.defineProperty(near, 'scrollHeight', { value: 900, configurable: true })
  Object.defineProperty(near, 'scrollTop', { value: 200, writable: true, configurable: true })
  near.scrollTo = scrollTo as unknown as typeof near.scrollTo
  glideToBottomIfNear(near)
  expect(scrollTo).toHaveBeenCalledWith({ top: 400, behavior: 'smooth' })

  const far = document.createElement('div')
  Object.defineProperty(far, 'clientHeight', { value: 500, configurable: true })
  Object.defineProperty(far, 'scrollHeight', { value: 1500, configurable: true })
  Object.defineProperty(far, 'scrollTop', { value: 200, writable: true, configurable: true })
  far.scrollTo = vi.fn() as unknown as typeof far.scrollTo
  glideToBottomIfNear(far)
  expect(far.scrollTo).not.toHaveBeenCalled()

  const short = document.createElement('div')
  Object.defineProperty(short, 'clientHeight', { value: 500, configurable: true })
  Object.defineProperty(short, 'scrollHeight', { value: 500, configurable: true })
  Object.defineProperty(short, 'scrollTop', { value: 0, writable: true, configurable: true })
  short.scrollTo = vi.fn() as unknown as typeof short.scrollTo
  glideToBottomIfNear(short)
  expect(short.scrollTo).not.toHaveBeenCalled()
})

it('YAZ-6058: spaceMove("end") pages down in ~70% chunks on long tails and snaps cleanly to bottom when close', () => {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 800, width: 800, height: 500, x: 0, y: 0, toJSON: () => ({}) })
  Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true })
  Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true })
  // Long tail (1500px left): pages down one readable chunk (~70% of 500 = 350px)
  expect(spaceMove(el, 'end')).toBe(Math.round(500 * SPACE_PAGE_FRACTION))
  // Within 1.2× a page step (400px <= 420px): snaps cleanly to the bottom (400px)
  el.scrollTop = 1100
  expect(spaceMove(el, 'end')).toBe(400)
})
