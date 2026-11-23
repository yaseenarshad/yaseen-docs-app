// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LINES_LINGER, guideLines } from './guideLines'

/**
 * YAZ-5507: the guide lines of Search's tree, the Mac sidebar's level lines (YAZ-3309). When they show (`data-lines`,
 * `data-touch` on the list). Where they are drawn: `stickyFolders.test.ts` (it reads the CSS in Node).
 */
let list: HTMLElement
let scroller: HTMLElement
beforeEach(() => {
  vi.useFakeTimers()
  scroller = document.createElement('div')
  list = document.createElement('ul')
  scroller.append(list)
  document.body.append(scroller)
})
afterEach(() => {
  vi.useRealTimers()
  scroller.remove()
})
const touch = (type: string) => list.dispatchEvent(new Event(type))

describe('when the guide lines show', () => {
  it('"always" and "off": as on the Mac, written on the list; nothing listens', () => {
    for (const mode of ['always', 'off'] as const) {
      const stop = guideLines(list, scroller, mode)
      expect(list.dataset.lines).toBe(mode)
      touch('touchstart')
      expect(list.hasAttribute('data-touch')).toBe(false)
      stop()
      expect(list.hasAttribute('data-lines')).toBe(false)
    }
  })

  it('"hover" (the Mac default): while a finger is on the list, then a moment after it lifts', () => {
    const stop = guideLines(list, scroller, 'hover')
    expect(list.dataset.lines).toBe('hover')
    expect(list.hasAttribute('data-touch')).toBe(false)
    touch('touchstart')
    expect(list.hasAttribute('data-touch')).toBe(true)
    // The finger stays: the lines stay.
    vi.advanceTimersByTime(5000)
    expect(list.hasAttribute('data-touch')).toBe(true)
    touch('touchend')
    vi.advanceTimersByTime(LINES_LINGER - 1)
    expect(list.hasAttribute('data-touch')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(list.hasAttribute('data-touch')).toBe(false)
    stop()
  })

  it('a scroll that goes on after the finger lifts keeps them until it stops', () => {
    const stop = guideLines(list, scroller, 'hover')
    touch('touchstart')
    touch('touchend')
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(LINES_LINGER - 100)
      scroller.dispatchEvent(new Event('scroll'))
    }
    expect(list.hasAttribute('data-touch')).toBe(true)
    vi.advanceTimersByTime(LINES_LINGER)
    expect(list.hasAttribute('data-touch')).toBe(false)
    // A scroll with no finger first (a page restoring its place) shows nothing.
    scroller.dispatchEvent(new Event('scroll'))
    expect(list.hasAttribute('data-touch')).toBe(false)
    stop()
  })

  it('touchcancel lifts the finger too; the cleanup clears both marks', () => {
    const stop = guideLines(list, scroller, 'hover')
    touch('touchstart')
    touch('touchcancel')
    vi.advanceTimersByTime(LINES_LINGER)
    expect(list.hasAttribute('data-touch')).toBe(false)
    touch('touchstart')
    stop()
    expect(list.hasAttribute('data-touch')).toBe(false)
    expect(list.hasAttribute('data-lines')).toBe(false)
  })
})
