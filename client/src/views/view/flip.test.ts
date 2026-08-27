/**
 * FLIP core (YAZ-944): the measured half of the board's motion. `flipPlan` is pure — given the
 * card rectangles before and after a reflow it answers which cards MOVED (and by how much, for
 * the inverted transform) and which are NEW (they get the entrance animation instead). The DOM
 * choreography around it stays thin and is proven visually in the e2e evidence; the math is
 * what can quietly go wrong, so the math is what is pinned.
 */
import { describe, expect, it } from 'vitest'
import { flipPlan, type FlipRect } from './flip'

const at = (x: number, y: number): FlipRect => ({ x, y })
const rects = (entries: Record<string, FlipRect>): Map<string, FlipRect> => new Map(Object.entries(entries))

describe('flipPlan', () => {
  it('a moved card gets the INVERTED delta (previous minus next) — the play-from position', () => {
    const plan = flipPlan(rects({ a: at(0, 0), b: at(0, 100) }), rects({ a: at(0, 100), b: at(0, 0) }))
    expect(plan.moves.get('a')).toEqual({ dx: 0, dy: -100 })
    expect(plan.moves.get('b')).toEqual({ dx: 0, dy: 100 })
    expect(plan.entered).toEqual([])
  })

  it('cross-column moves carry both axes', () => {
    const plan = flipPlan(rects({ a: at(0, 40) }), rects({ a: at(300, 80) }))
    expect(plan.moves.get('a')).toEqual({ dx: -300, dy: -40 })
  })

  it('sub-pixel jitter is NOT a move — nothing below one pixel animates', () => {
    const plan = flipPlan(rects({ a: at(0, 0) }), rects({ a: at(0.4, 0.4) }))
    expect(plan.moves.size).toBe(0)
  })

  it('a card only in the NEXT frame is entered, never moved; a card only in the PREVIOUS frame is neither', () => {
    const plan = flipPlan(rects({ gone: at(0, 0) }), rects({ fresh: at(0, 0) }))
    expect(plan.entered).toEqual(['fresh'])
    expect(plan.moves.size).toBe(0)
  })

  it('an unchanged board plans nothing at all', () => {
    const plan = flipPlan(rects({ a: at(10, 20) }), rects({ a: at(10, 20) }))
    expect(plan.moves.size).toBe(0)
    expect(plan.entered).toEqual([])
  })
})
