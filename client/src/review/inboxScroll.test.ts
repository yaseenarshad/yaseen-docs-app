import { describe, expect, it, vi } from 'vitest'
import {
  ARROW_SCROLL_FRACTION,
  ARROW_SCROLL_MIN_PX,
  BLANK_BOTTOM_MARGIN_PX,
  LAND_LINE,
  READ_LINE,
  SPACE_PAGE_FRACTION,
  arrowGlide,
  glideToBottomIfNear,
  glideView,
  planSpaceMove,
  readingScroll,
  resetScrollChain,
  spaceMove,
} from './inboxScroll'

const rect = (top: number, bottom: number): DOMRect => ({ top, bottom, left: 0, right: 800, width: 800, height: bottom - top, x: 0, y: top, toJSON: () => ({}) })

function makeView({ height = 600, topBar = 100, scrollHeight = 2600, scrollTop = 0, zoom }: { height?: number; topBar?: number; scrollHeight?: number; scrollTop?: number; zoom?: number } = {}) {
  const scale = zoom ?? 1
  const view = document.createElement('div')
  const scrollTo = vi.fn()
  view.scrollTo = scrollTo as unknown as typeof view.scrollTo
  view.getBoundingClientRect = () => rect(0, height * scale)
  Object.defineProperty(view, 'clientHeight', { value: height, configurable: true })
  Object.defineProperty(view, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(view, 'scrollTop', { value: scrollTop, writable: true, configurable: true })
  if (zoom !== undefined) Object.defineProperty(view, 'currentCSSZoom', { value: zoom, configurable: true })
  if (topBar > 0) {
    const top = document.createElement('div')
    top.className = 'card-inbox__top'
    top.getBoundingClientRect = () => rect(0, topBar * scale)
    view.append(top)
  }
  return { view, scrollTo }
}

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

it('YAZ-6058 / YAZ-6598: spaceMove("end") pages down in ~70% chunks in jump mode and ~35% reading steps in scroll mode, snapping when close', () => {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 800, width: 800, height: 500, x: 0, y: 0, toJSON: () => ({}) })
  Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true })
  Object.defineProperty(el, 'scrollTop', { value: 0, writable: true, configurable: true })
  // Jump mode: long tail (1500px left) pages down ~70% of 500 = 350px.
  expect(spaceMove(el, 'end', 'jump')).toBe(Math.round(500 * SPACE_PAGE_FRACTION))
  // Scroll mode (default): long tail pages down in reading steps (max(180, round(500 * 0.35)) = 180px).
  expect(spaceMove(el, 'end')).toBe(ARROW_SCROLL_MIN_PX)
  expect(spaceMove(el, 'end', 'scroll')).toBe(ARROW_SCROLL_MIN_PX)
  // Jump mode within 1.2× a page step (400px <= 420px): snaps cleanly to bottom (400px).
  el.scrollTop = 1100
  expect(spaceMove(el, 'end', 'jump')).toBe(400)
  // Scroll mode: 400px > 180 * 1.2 (216px) -> steps by 180px; 200px <= 216px -> snaps cleanly to 200px.
  expect(spaceMove(el, 'end', 'scroll')).toBe(180)
  el.scrollTop = 1300
  expect(spaceMove(el, 'end', 'scroll')).toBe(200)
})

it('YAZ-6393: arrowGlide returns true when scrolling and false when already at the edge', () => {
  const short = document.createElement('div')
  Object.defineProperty(short, 'clientHeight', { value: 500, configurable: true })
  Object.defineProperty(short, 'scrollHeight', { value: 500, configurable: true })
  Object.defineProperty(short, 'scrollTop', { value: 0, writable: true, configurable: true })
  short.scrollTo = vi.fn() as unknown as typeof short.scrollTo
  expect(arrowGlide(short, 1)).toBe(false)

  const tall = document.createElement('div')
  Object.defineProperty(tall, 'clientHeight', { value: 500, configurable: true })
  Object.defineProperty(tall, 'scrollHeight', { value: 900, configurable: true })
  Object.defineProperty(tall, 'scrollTop', { value: 0, writable: true, configurable: true })
  tall.scrollTo = vi.fn() as unknown as typeof tall.scrollTo
  expect(arrowGlide(tall, 1)).toBe(true)

  const atBottom = document.createElement('div')
  Object.defineProperty(atBottom, 'clientHeight', { value: 500, configurable: true })
  Object.defineProperty(atBottom, 'scrollHeight', { value: 900, configurable: true })
  Object.defineProperty(atBottom, 'scrollTop', { value: 400, writable: true, configurable: true })
  atBottom.scrollTo = vi.fn() as unknown as typeof atBottom.scrollTo
  expect(arrowGlide(atBottom, 1)).toBe(false)
  expect(arrowGlide(atBottom, -1)).toBe(true)
})

describe('YAZ-6598: unified step-scroll planner and rapid-Space chaining', () => {
  it('long card with non-cloze sections: scroll walks down in 35% steps before landing and revealing; jump skips directly', () => {
    // Viewport 600px, room [100, 600] (height 500, land line 266.67), readStep = round(600 * 0.35) = 210.
    const viewRoom = { start: 100, end: 600 }
    const readStep = Math.round(600 * ARROW_SCROLL_FRACTION)
    expect(readStep).toBe(210)

    // Blank far below at [1200, 1220]: jump skips directly to land line (1200 - 266.67 = 933.33).
    const jumpMove = planSpaceMove({
      target: 0,
      room: viewRoom,
      blank: { start: 1200, end: 1220 },
      remainingDown: 2000,
      remainingUp: 0,
      viewportHeight: 600,
      mode: 'jump',
    })
    expect(jumpMove).toBeCloseTo(1200 - (100 + 500 * LAND_LINE))

    // Scroll mode walks down in 210px steps until blank is comfortably above the 32px bottom margin.
    let offset = 0
    const steps: number[] = []
    for (let i = 0; i < 10; i++) {
      const move = planSpaceMove({
        target: 0,
        room: viewRoom,
        blank: { start: 1200 - offset, end: 1220 - offset },
        remainingDown: 2000 - offset,
        remainingUp: offset,
        viewportHeight: 600,
        mode: 'scroll',
      })
      if (move === 0) break
      steps.push(move)
      offset += move
    }
    // 1200 -> 990 -> 780 -> 570 (bottom 590 > 568 margin!) -> 360 (bottom 380 <= 568 -> reveals!).
    expect(steps).toEqual([210, 210, 210, 210])
    expect(1220 - offset).toBeLessThanOrEqual(viewRoom.end - BLANK_BOTTOM_MARGIN_PX)
  })

  it('snaps cleanly when remaining wanted distance is within 1.2x of readStep, and jumps directly when scrolling UP', () => {
    const viewRoom = { start: 100, end: 600 } // land line 266.67, readStep 210, 1.2x = 252
    // Blank at [500, 520] is already comfortably in view (520 <= 568) -> reveals immediately.
    expect(
      planSpaceMove({ target: 0, room: viewRoom, blank: { start: 500, end: 520 }, remainingDown: 1000, remainingUp: 0, viewportHeight: 600, mode: 'scroll' }),
    ).toBe(0)

    // Blank cut at bottom [595, 615]: readingScroll = 595 - 266.67 = 328.33 (> 252) -> capped at 210.
    expect(
      planSpaceMove({ target: 0, room: viewRoom, blank: { start: 595, end: 615 }, remainingDown: 1000, remainingUp: 0, viewportHeight: 600, mode: 'scroll' }),
    ).toBe(210)

    // Side edge at [500]: readingScroll = 500 - 266.67 = 233.33 (<= 252) -> snaps cleanly to 233.33!
    expect(
      planSpaceMove({ target: 'side', room: viewRoom, edge: 500, remainingDown: 1000, remainingUp: 0, viewportHeight: 600, mode: 'scroll' }),
    ).toBeCloseTo(500 - (100 + 500 * LAND_LINE))

    // Blank far ABOVE the viewport [-400, -380]: scrolling up is never step-capped.
    expect(
      planSpaceMove({ target: 0, room: viewRoom, blank: { start: -400, end: -380 }, remainingDown: 1000, remainingUp: 1000, viewportHeight: 600, mode: 'scroll' }),
    ).toBe(-400 - 100 - 6)
  })

  it('32 px bottom breathing room: scrolls when scroll room remains, reveals immediately at scroll bottom, and handles tiny viewports', () => {
    const viewRoom = { start: 100, end: 600 } // margin threshold = 568
    expect(BLANK_BOTTOM_MARGIN_PX).toBe(32)

    // Inside the bottom 32px strip (570..590) with scroll room remaining -> scrolls in scroll mode, reveals in jump mode.
    expect(
      planSpaceMove({ target: 0, room: viewRoom, blank: { start: 570, end: 590 }, remainingDown: 400, remainingUp: 0, viewportHeight: 600, mode: 'scroll' }),
    ).toBe(210)
    expect(
      planSpaceMove({ target: 0, room: viewRoom, blank: { start: 570, end: 590 }, remainingDown: 400, remainingUp: 0, viewportHeight: 600, mode: 'jump' }),
    ).toBe(0)

    // Clamps to remainingDown when only 25px remain.
    expect(
      planSpaceMove({ target: 0, room: viewRoom, blank: { start: 570, end: 590 }, remainingDown: 25, remainingUp: 0, viewportHeight: 600, mode: 'scroll' }),
    ).toBe(25)

    // At scroll bottom (remainingDown < 1) with blank wholly inside room -> reveals immediately!
    expect(
      planSpaceMove({ target: 0, room: viewRoom, blank: { start: 570, end: 590 }, remainingDown: 0, remainingUp: 400, viewportHeight: 600, mode: 'scroll' }),
    ).toBe(0)

    // Tiny viewport (height 80, room [100, 180], read line 153.33, margin line 148):
    // blank [130, 150] has readingScroll === 0, yet sits inside the 32px strip -> falls back to 150 - 148 = 2px so it always moves.
    expect(
      planSpaceMove({ target: 0, room: { start: 100, end: 180 }, blank: { start: 130, end: 150 }, remainingDown: 200, remainingUp: 0, viewportHeight: 80, mode: 'scroll' }),
    ).toBe(2)
  })

  it('side target step-scrolls in scroll mode vs jumps directly in jump mode', () => {
    const viewRoom = { start: 100, end: 600 }
    expect(
      planSpaceMove({ target: 'side', room: viewRoom, edge: 1200, remainingDown: 2000, remainingUp: 0, viewportHeight: 600, mode: 'scroll' }),
    ).toBe(210)
    expect(
      planSpaceMove({ target: 'side', room: viewRoom, edge: 1200, remainingDown: 2000, remainingUp: 0, viewportHeight: 600, mode: 'jump' }),
    ).toBeCloseTo(1200 - (100 + 500 * LAND_LINE))
  })

  it('rapid Space presses within 300 ms chain smoothly from pending target without stalling or prematurely revealing', () => {
    // Viewport 600, topBar 100 -> room [100, 600], bottom margin = 568, readStep = 210.
    const { view, scrollTo } = makeView({ height: 600, topBar: 100, scrollHeight: 2600, scrollTop: 0 })
    const blank = document.createElement('span')
    blank.dataset.hidden = '0'
    // Live rect at scrollTop=0 is [900, 920]; smooth scroll hasn't moved view.scrollTop yet.
    blank.getBoundingClientRect = () => rect(900 - view.scrollTop, 920 - view.scrollTop)
    view.append(blank)

    // Press 1 (scrollTop = 0): blank 900..920 -> move 210 -> glide target 210 (predicted blank 690..710).
    const m1 = spaceMove(view, 0, 'scroll')
    expect(m1).toBe(210)
    glideView(view, m1)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 210, behavior: 'smooth' })

    // Press 2 (view.scrollTop progressed only to 40): predicted blank = (900-40) + (40-210) = 690..710 -> move 210 -> target 420.
    view.scrollTop = 40
    const m2 = spaceMove(view, 0, 'scroll')
    expect(m2).toBe(210)
    glideView(view, m2)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 420, behavior: 'smooth' })

    // Press 3 (view.scrollTop at 80): predicted blank = 480..500 (comfortably <= 568!) -> returns 0 (reveal!).
    view.scrollTop = 80
    expect(spaceMove(view, 0, 'scroll')).toBe(0)

    // arrowGlide shares the same scrollState chainer: pressing Down chains from 420 -> 630!
    expect(arrowGlide(view, 1)).toBe(true)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 630, behavior: 'smooth' })

    // resetScrollChain clears pending target (e.g. new card / restart).
    resetScrollChain(view)
    view.scrollTop = 0
    expect(spaceMove(view, 0, 'scroll')).toBe(210)
  })

  it('rapid Space chaining scales pendingShift and scroll targets cleanly under CSS zoom', () => {
    // Zoom 1.25: clientHeight 480 CSS px -> 600 screen px; room [0, 600], readStep = 210 screen px -> 168 CSS px.
    const { view, scrollTo } = makeView({ height: 480, topBar: 0, scrollHeight: 2480, scrollTop: 0, zoom: 1.25 })
    const blank = document.createElement('span')
    blank.dataset.hidden = '0'
    blank.getBoundingClientRect = () => rect(900, 920)
    view.append(blank)

    const m1 = spaceMove(view, 0, 'scroll')
    expect(m1).toBe(210)
    glideView(view, m1)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 210 / 1.25, behavior: 'smooth' })

    // Second rapid press while scrollTop is still 0 shifts blank by -210 screen px (to 690..710) and chains to 420 / 1.25.
    const m2 = spaceMove(view, 0, 'scroll')
    expect(m2).toBe(210)
    glideView(view, m2)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 420 / 1.25, behavior: 'smooth' })

    // Third rapid press shifts blank to 480..500 (<= 568) -> reveals!
    expect(spaceMove(view, 0, 'scroll')).toBe(0)
  })
})
