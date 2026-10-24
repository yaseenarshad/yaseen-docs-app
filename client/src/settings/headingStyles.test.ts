import { describe, expect, it } from 'vitest'
import { HEADING_KEYS } from '@shared/types'
import { defaultHeadingSize, HEADING_SCALE, headingVars, isChanged, lineDefaultsOf, lineVars, textVars, withHeadingStyle, withLineDefaults, withoutHeadingStyle } from './headingStyles'

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

  it('yellow is the plain mark colour, the others are named; no level gets a width (the wash is on the words, YAZ-3049)', () => {
    expect(headingVars({ h2: { highlight: 'yellow' } })).toEqual({ '--h2-bg': 'var(--mark-bg)' })
    for (const colour of ['green', 'blue', 'pink'] as const) expect(headingVars({ h4: { highlight: colour } })).toEqual({ '--h4-bg': `var(--mark-bg-${colour})` })
    expect(Object.keys(headingVars({ h1: { size: 30, bold: false, underline: true, highlight: 'pink' } })).some((name) => name.endsWith('-width'))).toBe(false)
  })

  it('the default sizes are the em scale × the Text size, rounded: 16px by default (D5; YAZ-3067 D17)', () => {
    expect(HEADING_SCALE).toEqual({ h1: 1.802, h2: 1.602, h3: 1.424, h4: 1.266, h5: 1.125, h6: 1 })
    expect(HEADING_KEYS.map((key) => defaultHeadingSize(key))).toEqual([29, 26, 23, 20, 18, 16])
    // D17's example: Text 18px gives an H2 with no size of its own 29px.
    expect(defaultHeadingSize('h2', 18)).toBe(29)
    expect(HEADING_KEYS.map((key) => defaultHeadingSize(key, 24))).toEqual([43, 38, 34, 30, 27, 24])
    expect(HEADING_KEYS.map((key) => defaultHeadingSize(key, 12))).toEqual([22, 19, 17, 15, 14, 12])
  })

  it('textVars: `--text-size` only when the Text size is set, then the heading variables (YAZ-3067 D12)', () => {
    expect(textVars({})).toEqual({})
    expect(textVars({ text: {} })).toEqual({})
    expect(textVars({ text: { size: 18 } })).toEqual({ '--text-size': '18px' })
    expect(textVars({ text: { size: 14 }, h2: { size: 21, underline: true } })).toEqual({ '--text-size': '14px', '--h2-size': '21px', '--h2-decoration': 'underline' })
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

describe('the default line (YAZ-3208 D8, D10)', () => {
  it('S90: no `line` sets no line variable; each set field sets its own (S91)', () => {
    expect(lineVars(undefined)).toEqual({})
    expect(textVars({ text: { size: 18 } })).toEqual({ '--text-size': '18px' })
    expect(textVars({ line: { darkness: 70, thickness: 4, pattern: 'dashed' } })).toEqual({
      '--line-default-darkness': '70%',
      '--line-default-thickness': '4px',
      '--line-default-pattern': 'dashed',
    })
    expect(lineVars({ thickness: 6 })).toEqual({ '--line-default-thickness': '6px' })
  })

  it('lineDefaultsOf: the vault’s fields over the app’s 50%, 3px, solid', () => {
    expect(lineDefaultsOf(undefined)).toEqual({ darkness: 50, thickness: 3, pattern: 'solid' })
    expect(lineDefaultsOf({ pattern: 'dotted' })).toEqual({ darkness: 50, thickness: 3, pattern: 'dotted' })
  })

  it('S97: withLineDefaults keeps only the fields off the app default; none left removes `line`, and the other keys stay', () => {
    expect(withLineDefaults({ text: { size: 18 } }, { darkness: 70 })).toEqual({ text: { size: 18 }, line: { darkness: 70 } })
    expect(withLineDefaults({ line: { darkness: 70 } }, { pattern: 'dashed' })).toEqual({ line: { darkness: 70, pattern: 'dashed' } })
    expect(withLineDefaults({ line: { darkness: 70, pattern: 'dashed' } }, { pattern: 'solid' })).toEqual({ line: { darkness: 70 } })
    expect(withLineDefaults({ h1: { size: 30 }, line: { darkness: 70 } }, { darkness: 50 })).toEqual({ h1: { size: 30 } })
  })
})
