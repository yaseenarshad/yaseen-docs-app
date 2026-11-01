/**
 * The slot under a point of a strip, for a drag that is no HTML5 drag: a tab board card held over the tab strip
 * (YAZ-3808 D1). jsdom has no layout: the strip and its tabs are given their rects.
 */
import { describe, expect, it } from 'vitest'
import { slotUnder } from './dragSlot'

/** A strip from x 100 to 500, y 0 to 40. */
const RECT = { left: 100, right: 500, top: 0, bottom: 40, width: 400, height: 40 }

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
    expect([150, 170, 255, 265, 470].map((x) => slotUnder(strip(), x, 20))).toEqual([0, 1, 1, 2, 3])
  })

  it('past the right end (the "+") is the end slot; past the left end (‹ ›) is the first slot on show; off the strip is none', () => {
    expect(slotUnder(strip(), 530, 20)).toBe(3)
    expect(slotUnder(strip(), 70, 20)).toBe(0)
    expect(slotUnder(strip(), 300, 80)).toBeNull()
    expect(slotUnder(strip(), -80, 20)).toBeNull()
    expect(slotUnder(null, 300, 20)).toBeNull()
  })
})
