import { describe, expect, it } from 'vitest'
import { frozenColumnCount, frozenGapCover, frozenGapShadow } from './frozenColumns'

describe('frozenColumnCount', () => {
  it.each([undefined, null, '2', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -2])('treats %s as no frozen columns', (value) => {
    expect(frozenColumnCount(value, 4)).toBe(0)
  })

  it('truncates fractions and clamps the result to the visible column count', () => {
    expect(frozenColumnCount(2.9, 4)).toBe(2)
    expect(frozenColumnCount(8, 4)).toBe(4)
    expect(frozenColumnCount(2, 0)).toBe(0)
  })
})

/**
 * The cover of the live gap in the frozen part (YAZ-4643 S2): while the table is scrolled sideways, the columns under
 * the frozen cells would show through the empty place the drag opens. The frozen cell beside that place paints the
 * grabbed column's room of background on its gap side; `col` -1 is the `#` gutter.
 */
describe('frozenGapCover (YAZ-4643 S2)', () => {
  it('a column dragged LEFT into the frozen part: the first parted frozen cell covers its left', () => {
    expect(frozenGapCover(0, 5, 2, 150)).toEqual({ col: 0, side: 'left', room: 150 })
    expect(frozenGapCover(1, 5, 2, 150)).toEqual({ col: 1, side: 'left', room: 150 })
  })

  it('a frozen column dragged RIGHT within the frozen part, or to the freeze line: the last parted frozen cell covers its right', () => {
    expect(frozenGapCover(2, 0, 2, 150)).toEqual({ col: 1, side: 'right', room: 150 })
    expect(frozenGapCover(3, 0, 3, 150)).toEqual({ col: 2, side: 'right', room: 150 })
  })

  it('no gap: a lifted FROZEN column\'s own place is covered by the cell on its left — the gutter for the first', () => {
    expect(frozenGapCover(null, 0, 2, 150)).toEqual({ col: -1, side: 'right', room: 150 })
    expect(frozenGapCover(null, 1, 2, 150)).toEqual({ col: 0, side: 'right', room: 150 })
  })

  it('nothing right of the freeze line, and nothing with no frozen columns: the drag there stays as it is', () => {
    expect(frozenGapCover(null, 3, 2, 150)).toBeNull() // a lifted scrolled column
    expect(frozenGapCover(2, 5, 2, 150)).toBeNull() // the gap at the first scrolled slot
    expect(frozenGapCover(4, 2, 2, 150)).toBeNull() // dragged right among the scrolled columns
    expect(frozenGapCover(0, 3, 0, 150)).toBeNull()
    expect(frozenGapCover(null, 0, 0, 150)).toBeNull()
  })
})

describe('frozenGapShadow (YAZ-4643 S2)', () => {
  it('a cell as wide as the room, or wider: one shadow, one room along its gap side', () => {
    expect(frozenGapShadow({ col: 0, side: 'left', room: 150 }, 150)).toBe('-150px 0 0 var(--bg)')
    expect(frozenGapShadow({ col: 1, side: 'right', room: 100 }, 200)).toBe('100px 0 0 var(--bg)')
  })

  it('a narrower cell lays its shadows end to end, the last ending at the room\'s end: the 44px gutter under a 150px column', () => {
    expect(frozenGapShadow({ col: -1, side: 'right', room: 150 }, 44)).toBe('44px 0 0 var(--bg),88px 0 0 var(--bg),132px 0 0 var(--bg),150px 0 0 var(--bg)')
    expect(frozenGapShadow({ col: 0, side: 'left', room: 150 }, 75)).toBe('-75px 0 0 var(--bg),-150px 0 0 var(--bg)')
  })

  it('a cell with no width: the one shadow at the room, no endless loop', () => {
    expect(frozenGapShadow({ col: 0, side: 'left', room: 150 }, 0)).toBe('-150px 0 0 var(--bg)')
  })
})
