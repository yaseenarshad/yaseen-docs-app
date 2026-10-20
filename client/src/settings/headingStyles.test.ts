import { describe, expect, it } from 'vitest'
import { HEADING_KEYS } from '@shared/types'
import { HEADING_DEFAULT_SIZES, headingVars, isChanged, withHeadingStyle, withoutHeadingStyle } from './headingStyles'

describe('headingVars (YAZ-3049 D2)', () => {
  it('an empty map sets no variable, so every heading keeps the look of 1.0.14', () => {
    expect(headingVars({})).toEqual({})
    // Fields at their default set nothing either: bold on, underline off.
    expect(headingVars({ h3: { bold: true, underline: false } })).toEqual({})
  })

  it('each changed field sets its own variable for its own level only', () => {
    expect(headingVars({ h2: { size: 24 } })).toEqual({ '--h2-size': '24px' })
    expect(headingVars({ h1: { bold: false } })).toEqual({ '--h1-weight': '400' })
    expect(headingVars({ h6: { underline: true } })).toEqual({ '--h6-decoration': 'underline' })
    expect(headingVars({ h1: { size: 48 }, h5: { size: 12, bold: false, underline: true } })).toEqual({
      '--h1-size': '48px',
      '--h5-size': '12px',
      '--h5-weight': '400',
      '--h5-decoration': 'underline',
    })
  })

  it('yellow is the plain mark colour, the others are named; only a highlight hugs the words', () => {
    expect(headingVars({ h2: { highlight: 'yellow' } })).toEqual({ '--h2-bg': 'var(--mark-bg)', '--h2-width': 'fit-content' })
    for (const colour of ['green', 'blue', 'pink'] as const) expect(headingVars({ h4: { highlight: colour } })).toEqual({ '--h4-bg': `var(--mark-bg-${colour})`, '--h4-width': 'fit-content' })
    expect(Object.keys(headingVars({ h1: { size: 30, bold: false, underline: true } }))).not.toContain('--h1-width')
  })

  it('the default sizes are the em scale × 16px, rounded (D5)', () => {
    const scale = { h1: 1.802, h2: 1.602, h3: 1.424, h4: 1.266, h5: 1.125, h6: 1 }
    for (const key of HEADING_KEYS) expect(HEADING_DEFAULT_SIZES[key]).toBe(Math.round(scale[key] * 16))
    expect(Object.values(HEADING_DEFAULT_SIZES)).toEqual([29, 26, 23, 20, 18, 16])
  })
})

describe('withHeadingStyle / withoutHeadingStyle (YAZ-3049 D1)', () => {
  it('stores only what changed: a field back at its default, and then an empty level, leave the map', () => {
    let map = withHeadingStyle({}, 'h2', { underline: true })
    expect(map).toEqual({ h2: { underline: true } })
    map = withHeadingStyle(map, 'h2', { bold: false })
    expect(map).toEqual({ h2: { underline: true, bold: false } })
    map = withHeadingStyle(map, 'h2', { underline: false })
    expect(map).toEqual({ h2: { bold: false } })
    expect(withHeadingStyle(map, 'h2', { bold: true })).toEqual({})
    expect(withHeadingStyle({ h3: { highlight: 'blue' } }, 'h3', { highlight: undefined })).toEqual({})
  })

  it('Reset removes the level key and keeps the other levels', () => {
    expect(withoutHeadingStyle({ h1: { size: 30 }, h2: { underline: true } }, 'h1')).toEqual({ h2: { underline: true } })
    expect(isChanged(undefined)).toBe(false)
    expect(isChanged({ bold: true, underline: false })).toBe(false)
    expect(isChanged({ size: 29 })).toBe(true)
  })
})
