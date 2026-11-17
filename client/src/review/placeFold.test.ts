import { describe, expect, it } from 'vitest'
import { foldedParts } from './placeFold'

/** YAZ-5713: a card's place folds from the start, the fewest parts that make it fit; the page always shows. Made-up widths. */
describe('foldedParts: which parts of a card`s place show', () => {
  it('a path that fits is unchanged', () => {
    expect(foldedParts([120, 70, 90], 300, 20)).toBe(0)
    expect(foldedParts([120, 70, 90], 280, 20)).toBe(0)
  })

  it('a long path drops from the left, one part at a time, the fewest that fit', () => {
    // 120 + 70 + 90 = 280: at 200, "… " (20) + 70 + 90 = 180 fits with one folded.
    expect(foldedParts([120, 70, 90], 200, 20)).toBe(1)
    // At 120 only "…" + the page fit.
    expect(foldedParts([120, 70, 90], 120, 20)).toBe(2)
    // Four folders and the page: the first two give way.
    expect(foldedParts([60, 60, 60, 60, 90], 230, 20)).toBe(2)
  })

  it('the box`s gap counts between every shown part, the "…" too', () => {
    // 20 + 70 + 90 + 2 gaps of 5 = 190.
    expect(foldedParts([120, 70, 90], 189, 20, 5)).toBe(2)
    expect(foldedParts([120, 70, 90], 190, 20, 5)).toBe(1)
  })

  it('a very long page name: every folder folds and the page stays (it cuts itself)', () => {
    expect(foldedParts([60, 60, 900], 200, 20)).toBe(2)
  })

  it('a one-part path never folds, however long', () => {
    expect(foldedParts([900], 100, 20)).toBe(0)
    expect(foldedParts([], 100, 20)).toBe(0)
  })
})
