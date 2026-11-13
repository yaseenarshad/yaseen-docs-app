/**
 * The least scroll that shows a thing (⌘F's rule, `views/view/viewFind.ts`; the Inbox's next hidden word, YAZ-5049):
 * none when it shows already, else just enough, never centred.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { leastScroll, revealInScroller } from './leastScroll'

describe('leastScroll', () => {
  const room = { start: 100, end: 500 }
  it('is 0 when the thing shows whole (no movement)', () => {
    expect(leastScroll({ start: 200, end: 220 }, room, 6)).toBe(0)
    expect(leastScroll({ start: 106, end: 494 }, room, 6)).toBe(0)
  })
  it('below the room: just enough to bring its bottom in, with the gap', () => {
    expect(leastScroll({ start: 600, end: 620 }, room, 6)).toBe(126)
    expect(leastScroll({ start: 490, end: 510 }, room, 6)).toBe(16)
  })
  it('above the room: just enough to bring its top in, with the gap', () => {
    expect(leastScroll({ start: 40, end: 60 }, room, 6)).toBe(-66)
  })
  it('taller than the room: its top comes in first, never past it', () => {
    expect(leastScroll({ start: 300, end: 900 }, room, 6)).toBe(194)
  })
})

describe('revealInScroller', () => {
  afterEach(() => vi.restoreAllMocks())
  const box = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

  it('scrolls the scroller smoothly by the least amount when the thing is off screen, and not at all when it shows', () => {
    const scroller = document.createElement('div')
    const word = document.createElement('span')
    scroller.append(word)
    scroller.scrollTop = 40
    const scrollTo = vi.fn()
    scroller.scrollTo = scrollTo as never
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(box(100, 500))
    const at = vi.spyOn(word, 'getBoundingClientRect').mockReturnValue(box(200, 220))
    expect(revealInScroller(word, scroller, { smooth: true })).toBe(false)
    expect(scrollTo).not.toHaveBeenCalled()
    at.mockReturnValue(box(600, 620))
    expect(revealInScroller(word, scroller, { smooth: true })).toBe(true)
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 40 + 126, behavior: 'smooth' })
  })
})
