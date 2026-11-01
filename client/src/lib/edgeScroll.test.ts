/**
 * The strip's ends while a drag is held there (YAZ-3808 D5), and the slot under a point of a strip for a drag that is
 * no HTML5 drag, a tab board card (D1). jsdom has no layout: the strip and its tabs are given their rects.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EDGE_PX, EDGE_SPEED, edgeScroller } from './edgeScroll'
import { slotUnder } from './dragSlot'

/** A strip from x 100 to 500, y 0 to 40. */
const RECT = { left: 100, right: 500, top: 0, bottom: 40, width: 400, height: 40 }

describe('edgeScroller (YAZ-3808 D5)', () => {
  let frames: FrameRequestCallback[] = []
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) frames.splice(0).forEach((f) => f(0))
  }
  const strip = { scrollLeft: 0, getBoundingClientRect: () => RECT } as unknown as HTMLElement

  beforeEach(() => {
    frames = []
    strip.scrollLeft = 0
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f))
    vi.stubGlobal('cancelAnimationFrame', () => (frames = []))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('in the middle nothing scrolls and no frame loop starts', () => {
    edgeScroller(() => strip).at(300)
    expect(frames).toHaveLength(0)
  })

  it('at the right end the strip scrolls right, at the left end left; nearer the end is faster, past it the most', () => {
    const onScroll = vi.fn()
    const s = edgeScroller(() => strip, onScroll)
    s.at(500 - EDGE_PX / 2) // halfway into the right zone
    step(2)
    expect(strip.scrollLeft).toBe(2 * Math.round(EDGE_SPEED / 2))
    expect(onScroll).toHaveBeenCalledTimes(2)
    s.at(560) // past the end, over the "+"
    step()
    expect(strip.scrollLeft).toBe(2 * Math.round(EDGE_SPEED / 2) + EDGE_SPEED)
    s.at(100) // at the left end
    step()
    expect(strip.scrollLeft).toBe(2 * Math.round(EDGE_SPEED / 2))
    // One loop at a time, whatever the number of `dragover`s.
    s.at(40)
    s.at(40)
    expect(frames).toHaveLength(1)
  })

  it('back to the middle the loop ends by itself; `stop` ends it at once', () => {
    const s = edgeScroller(() => strip)
    s.at(499)
    step()
    s.at(300)
    step()
    expect(frames).toHaveLength(0)
    const before = strip.scrollLeft
    s.at(499)
    s.stop()
    step()
    expect(strip.scrollLeft).toBe(before)
    expect(frames).toHaveLength(0)
  })
})

describe('slotUnder (YAZ-3808 D1)', () => {
  /** Three tabs of 100 px from x 110: midpoints 160, 260, 360. */
  const strip = () => {
    const el = document.createElement('div')
    el.getBoundingClientRect = () => RECT as DOMRect
    for (let i = 0; i < 3; i++) {
      const tab = document.createElement('div')
      tab.dataset.tab = `t${i}`
      tab.getBoundingClientRect = () => ({ left: 110 + i * 100, width: 100 }) as DOMRect
      el.appendChild(tab)
    }
    return el
  }

  it('a tab\'s halves are the slots before and after it; past the last tab is the end', () => {
    expect([150, 170, 255, 265, 470].map((x) => slotUnder(strip(), x, 20, 3))).toEqual([0, 1, 1, 2, 3])
  })

  it('past the right end (the "+") is the end slot; past the left end (‹ ›) is the first slot on show; off the strip is none', () => {
    expect(slotUnder(strip(), 530, 20, 3)).toBe(3)
    expect(slotUnder(strip(), 70, 20, 3)).toBe(0)
    expect(slotUnder(strip(), 300, 80, 3)).toBeNull()
    expect(slotUnder(strip(), 20, 20, 3)).toBeNull()
    expect(slotUnder(null, 300, 20, 3)).toBeNull()
  })
})
