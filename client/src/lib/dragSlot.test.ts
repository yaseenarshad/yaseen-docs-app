/**
 * The slot under a point of a strip, for a drag that is no HTML5 drag: a tab board card held over the tab strip
 * (YAZ-3808 D1). jsdom has no layout: the strip is given its rect, and its tabs their places in the layout.
 */
import { describe, expect, it } from 'vitest'
import { slotAt, slotUnder } from './dragSlot'

/** A strip from x 100 to 500, y 0 to 40. */
const RECT = { left: 100, right: 500, top: 0, bottom: 40, width: 400, height: 40 }

describe('slotUnder (YAZ-3808 D1)', () => {
  /** Three tabs of 100 px from x 110: midpoints 160, 260, 360. */
  /** In a row that ends at x 1000, where the right panel starts. */
  const strip = () => {
    const row = document.createElement('div')
    row.getBoundingClientRect = () => ({ ...RECT, right: 1000 }) as DOMRect
    const el = document.createElement('div')
    row.appendChild(el)
    el.getBoundingClientRect = () => RECT as DOMRect
    for (let i = 0; i < 3; i++) {
      const tab = document.createElement('div')
      tab.dataset.tab = `t${i}`
      Object.defineProperties(tab, { offsetLeft: { value: 10 + i * 100 }, offsetWidth: { value: 100 } })
      el.appendChild(tab)
    }
    return el
  }

  it('a tab\'s halves are the slots before and after it; past the last tab is the end', () => {
    expect([150, 170, 255, 265, 470].map((x) => slotUnder(strip(), x, 20))).toEqual([0, 1, 1, 2, 3])
  })

  it('anywhere past the right end (the "+", the tail) is the end slot; past the left end (‹ ›) is the first slot on show; off the strip is none', () => {
    expect(slotUnder(strip(), 530, 20)).toBe(3)
    expect(slotUnder(strip(), 900, 20)).toBe(3) // the row's tail, far past the "+"
    expect(slotUnder(strip(), 1100, 20)).toBeNull() // past the row: the right panel
    expect(slotUnder(strip(), 70, 20)).toBe(0)
    expect(slotUnder(strip(), 300, 80)).toBeNull()
    expect(slotUnder(strip(), -80, 20)).toBeNull()
    expect(slotUnder(null, 300, 20)).toBeNull()
  })
})

describe('slotAt (YAZ-3808 6A)', () => {
  it('reads where the layout puts each tab, not where the live gap draws it, and follows the scroll', () => {
    const el = document.createElement('div')
    el.getBoundingClientRect = () => RECT as DOMRect
    for (let i = 0; i < 3; i++) {
      const tab = document.createElement('div')
      tab.dataset.tab = `t${i}`
      Object.defineProperties(tab, { offsetLeft: { value: 10 + i * 100 }, offsetWidth: { value: 100 } })
      // The gap draws the tab 100 px to the right: the slot does not move with it.
      tab.style.transform = 'translateX(100px)'
      tab.getBoundingClientRect = () => ({ left: 210 + i * 100, width: 100 }) as DOMRect
      el.appendChild(tab)
    }
    expect([150, 170, 255, 265, 470].map((x) => slotAt(el, x))).toEqual([0, 1, 1, 2, 3])
    Object.defineProperty(el, 'scrollLeft', { value: 100 })
    expect([55, 65, 155, 165].map((x) => slotAt(el, x))).toEqual([0, 1, 1, 2])
  })
})
