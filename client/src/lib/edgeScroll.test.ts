/**
 * The strip's ends while a drag is held there (YAZ-3808 D5). jsdom has no layout: the strip is given its rect.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EDGE_PX, EDGE_SPEED, edgeScroller } from './edgeScroll'

/** A strip from x 100 to 500, y 0 to 40. */
const RECT = { left: 100, right: 500, top: 0, bottom: 40, width: 400, height: 40 }

describe('edgeScroller (YAZ-3808 D5)', () => {
  let frames: FrameRequestCallback[] = []
  let clock = 0
  /** Runs `n` frames, `ms` apart. */
  const run = (n: number, ms = 1000 / 60) => {
    for (let i = 0; i < n; i++) {
      clock += ms
      frames.splice(0).forEach((f) => f(clock))
    }
  }
  const strip = { scrollLeft: 0, getBoundingClientRect: () => RECT } as unknown as HTMLElement

  beforeEach(() => {
    frames = []
    clock = 0
    strip.scrollLeft = 0
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f))
    vi.stubGlobal('cancelAnimationFrame', () => (frames = []))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('in the middle nothing scrolls and no frame loop starts', () => {
    edgeScroller(() => strip).at(300)
    expect(frames).toHaveLength(0)
  })

  it('at the right end the strip scrolls right, at the left end left; past the end is full speed, halfway in is half', () => {
    const onScroll = vi.fn()
    const s = edgeScroller(() => strip, onScroll)
    s.at(560) // past the end, over the "+"
    run(60)
    expect(strip.scrollLeft).toBeCloseTo(EDGE_SPEED, 0) // one second
    expect(onScroll).toHaveBeenCalledTimes(60)
    s.at(500 - EDGE_PX / 2) // halfway into the right zone
    run(60)
    expect(strip.scrollLeft).toBeCloseTo(EDGE_SPEED * 1.5, 0)
    s.at(100) // at the left end
    run(60)
    expect(strip.scrollLeft).toBeCloseTo(EDGE_SPEED / 2, 0)
    // One loop at a time, whatever the number of `dragover`s.
    s.at(40)
    s.at(40)
    expect(frames).toHaveLength(1)
  })

  it('the speed is per second: a 120 Hz display scrolls as far in one second as a 60 Hz one', () => {
    const s = edgeScroller(() => strip)
    s.at(560)
    run(120, 1000 / 120)
    // Within one 60 Hz frame: the loop's first step has no frame before it to measure from.
    expect(Math.abs(strip.scrollLeft - EDGE_SPEED)).toBeLessThan(EDGE_SPEED / 60 + 1)
  })

  it('back to the middle the loop ends by itself; `stop` ends it at once', () => {
    const s = edgeScroller(() => strip)
    s.at(499)
    run(1)
    s.at(300)
    run(1)
    expect(frames).toHaveLength(0)
    const before = strip.scrollLeft
    s.at(499)
    s.stop()
    run(1)
    expect(strip.scrollLeft).toBe(before)
    expect(frames).toHaveLength(0)
  })
})
