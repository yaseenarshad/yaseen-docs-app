/**
 * `sanitizeTextFormatting` (YAZ-3066, D10): the vault file `.yaseendocs/text-formatting.json` as the
 * app uses it. The module is in `shared/`; its test is here because no vitest project reads
 * `shared/` (the precedent of `shared/reviews.ts` and `review/reviews.test.ts`).
 */
import { describe, expect, it } from 'vitest'
import { isHeadingStyle, sanitizeTextFormatting, textFormattingFile } from '@shared/textFormatting'

describe('sanitizeTextFormatting (YAZ-3066 D10)', () => {
  it('a good file loads as it is, without its version', () => {
    const file = { version: 1, text: { size: 17 }, h1: { size: 12, bold: false, underline: true, highlight: 'yellow' }, h2: { size: 21, underline: true }, h6: { size: 48, highlight: 'pink' } }
    const { version: _v, ...formatting } = file
    expect(sanitizeTextFormatting(file)).toEqual(formatting)
    // The edges of each range are good values.
    expect(sanitizeTextFormatting({ text: { size: 12 } })).toEqual({ text: { size: 12 } })
    expect(sanitizeTextFormatting({ text: { size: 24 } })).toEqual({ text: { size: 24 } })
  })

  it('a bad level falls back alone: the good levels and the Text line beside it stay', () => {
    expect(sanitizeTextFormatting({ text: { size: 18 }, h1: { size: 30 }, h2: { size: 100 }, h3: { highlight: 'red' }, h4: { bold: 'no' }, h5: { size: 20, colour: 'red' } })).toEqual({ text: { size: 18 }, h1: { size: 30 } })
    expect(sanitizeTextFormatting({ text: { size: 'big' }, h2: { underline: true } })).toEqual({ h2: { underline: true } })
    // An unknown level, a key that only looks like one, and a level that is not an object: left out.
    expect(sanitizeTextFormatting({ h7: { size: 20 }, H2: { size: 20 }, h3: null, h4: 20, h5: [], h6: {} })).toEqual({})
  })

  it('sizes out of range or not whole fall back: Text 11 and 25, a heading 11 and 49', () => {
    for (const size of [11, 25, 16.5, Number.NaN, '16']) expect(sanitizeTextFormatting({ text: { size } }), String(size)).toEqual({})
    for (const size of [11, 49, 20.5, '20']) expect(sanitizeTextFormatting({ h2: { size } }), String(size)).toEqual({})
    expect(sanitizeTextFormatting({ text: { size: 16, weight: 700 } })).toEqual({})
  })

  it('a missing file and a file that is not an object are the app\'s look', () => {
    for (const raw of [null, undefined, [], 'big', 42, true]) expect(sanitizeTextFormatting(raw), JSON.stringify(raw)).toEqual({})
  })

  it('the version is ignored, whatever it says; the writer always writes version 1 and only the changes', () => {
    expect(sanitizeTextFormatting({ version: 2, h2: { size: 21 } })).toEqual({ h2: { size: 21 } })
    expect(sanitizeTextFormatting({ version: 'x' })).toEqual({})
    expect(textFormattingFile({ text: { size: 17 }, h2: { size: 21 } })).toEqual({ version: 1, text: { size: 17 }, h2: { size: 21 } })
    expect(textFormattingFile({})).toEqual({ version: 1 })
  })

  it('isHeadingStyle, moved from store.ts: only the four known fields, each absent or valid', () => {
    expect(isHeadingStyle({})).toBe(true)
    expect(isHeadingStyle({ size: 20, bold: true, underline: false, highlight: 'green' })).toBe(true)
    for (const bad of [{ highlight: null }, { size: 20, color: 'red' }, null, [], 'h2']) expect(isHeadingStyle(bad), JSON.stringify(bad)).toBe(false)
  })
})
