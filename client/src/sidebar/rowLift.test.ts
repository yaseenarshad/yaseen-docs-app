import { describe, expect, it } from 'vitest'
import { liftsAt, movedOrder, overFor, settleOffset, slotFor } from './rowLift'

/** The smooth row drag's math (YAZ-5916 Q1, Q2): when a press lifts, where the gap opens, and where a drop lands. */
describe('rowLift', () => {
  it('a 9 px move is a click, a 10 px vertical move is a drag, a sideways wobble is no drag', () => {
    expect(liftsAt(0, 9)).toBe(false)
    expect(liftsAt(6, 6)).toBe(false) // 8.5 px
    expect(liftsAt(0, 10)).toBe(true)
    expect(liftsAt(0, -10)).toBe(true)
    expect(liftsAt(12, 3)).toBe(false)
    expect(liftsAt(7, 8)).toBe(true)
  })

  // Four rows of 24 px from y 100; the third is an open folder of 72 px.
  const tops = [100, 124, 148, 220]
  const heights = [24, 24, 72, 24]
  it('the slot is before the first row whose middle is below the pointer', () => {
    expect(slotFor(90, tops, heights)).toBe(0)
    expect(slotFor(111, tops, heights)).toBe(0)
    expect(slotFor(113, tops, heights)).toBe(1)
    expect(slotFor(183, tops, heights)).toBe(2)
    expect(slotFor(185, tops, heights)).toBe(3)
    expect(slotFor(400, tops, heights)).toBe(4)
  })

  it('a slot next to the lifted row is no move; any other lands before the row at it, or after the last', () => {
    const paths = ['a', 'b', 'c', 'd']
    expect(overFor(1, 1, paths)).toBeNull()
    expect(overFor(2, 1, paths)).toBeNull()
    expect(overFor(0, 1, paths)).toEqual({ path: 'a', edge: 'before' })
    expect(overFor(4, 1, paths)).toEqual({ path: 'd', edge: 'after' })
    expect(movedOrder(paths, 1, 4)).toEqual(['a', 'c', 'd', 'b'])
    expect(movedOrder(paths, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(movedOrder(paths, 1, 2)).toEqual(paths)
    expect(movedOrder(paths, 1, null)).toEqual(paths)
  })

  it('the drop settles the row exactly into the gap', () => {
    // Row b (24 px) down past the folder: it lands where the folder's bottom is once the folder slid up by 24.
    expect(settleOffset(3, 1, tops, heights, 24)).toBe(148 + 72 - 24 - 124)
    // Row d up to the top: it lands at a's top.
    expect(settleOffset(0, 3, tops, heights, 24)).toBe(100 - 220)
    expect(settleOffset(2, 1, tops, heights, 24)).toBe(0)
  })
})
