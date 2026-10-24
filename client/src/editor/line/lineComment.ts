/**
 * The line comment itself (YAZ-3164, 🔒 D1 / D4 / D6 / D7 / D9; CONTRACTS rule 41): the one reader
 * and writer of `<!-- line: … -->`. The values, ranges and app defaults are `@shared/line` (YAZ-3208
 * D8), re-exported here. No editor imports, on purpose: the line-number worker
 * (`lineNumbers/blockLines.ts`, rule 34) reads the same comment to know that it is no block of the
 * page (YAZ-3204), and its bundle must hold the parser only. `lineStyle.ts` re-exports all of it.
 *
 * 🔒 D9 (YAZ-3208): `null` means "follow the vault's default", and only the menu's "Default" item
 * stores it. Every value in the comment is read as written, and every set value is written, also
 * when it equals the default — a line set on purpose must not move when the vault's default does.
 */
import {
  DARKNESS_MAX,
  DARKNESS_MIN,
  LINE_WIDTH_MAX,
  MIN_LINE_WIDTH,
  THICKNESS_MAX,
  THICKNESS_MIN,
  type LinePattern,
} from '@shared/line'

export * from '@shared/line'

/** The `hr` attributes. `null` follows the vault's default (D9); a set value is written as it is. */
export interface LineStyle {
  darkness: number | null
  thickness: number | null
  pattern: LinePattern | null
  width: number | null
}

export const PLAIN_LINE: LineStyle = { darkness: null, thickness: null, pattern: null, width: null }

/** The number parts: the word in the comment, its unit, the attribute and its range. The one table of the ranges. */
export const NUMBER_PARTS = [
  { word: 'darkness', unit: '%', attr: 'darkness', min: DARKNESS_MIN, max: DARKNESS_MAX },
  { word: 'thickness', unit: 'px', attr: 'thickness', min: THICKNESS_MIN, max: THICKNESS_MAX },
  { word: 'length', unit: '%', attr: 'width', min: MIN_LINE_WIDTH, max: LINE_WIDTH_MAX },
] as const

/** Every word in its fixed order (S3, S71). */
const ORDER = ['darkness', 'thickness', 'style', 'length'] as const

/** `<!-- line: … -->`, any spaces inside the delimiters; the parts are read one by one. */
const COMMENT = /^<!--\s*line:\s*([^]*?)\s*-->$/
/** A number part: a word, a space, a whole number with no leading zero, its unit. */
const PART = /^(\w+)\s+([1-9]\d{0,2})(%|px)$/
/** The style part: `solid` is a value like the others (D9, S100). */
const STYLE_PART = /^style\s+(solid|dotted|dashed)$/

/**
 * The style a comment holds, or `null` when it is not the line comment (S5, S6, S72): one to four
 * parts joined by commas, in the fixed order and each at most once — a number part with its own
 * unit and a whole number in its range, or `style` with `solid`, `dotted` or `dashed`. Each value
 * is read as written, the default too (D9, S93).
 */
export function parseLineComment(value: string): LineStyle | null {
  const body = COMMENT.exec(value.trim())?.[1]
  if (body === undefined || body === '') return null
  const style: LineStyle = { ...PLAIN_LINE }
  let next = 0
  for (const text of body.split(/\s*,\s*/)) {
    const word = /^\w+/.exec(text)?.[0] ?? ''
    const index = ORDER.indexOf(word as (typeof ORDER)[number])
    if (index < next) return null
    next = index + 1
    if (word === 'style') {
      const pattern = STYLE_PART.exec(text)?.[1]
      if (pattern === undefined) return null
      style.pattern = pattern as LinePattern
      continue
    }
    const match = PART.exec(text)
    const part = NUMBER_PARTS.find((p) => p.word === word)
    if (match === null || part === undefined) return null
    const n = Number(match[2])
    if (match[3] !== part.unit || n < part.min || n > part.max) return null
    style[part.attr] = n
  }
  return style
}

/** The comment for a style, or `null` for a line that follows the default in every part: the set parts, in order (S2, S3, S71, S93). */
export function formatLineComment(style: LineStyle): string | null {
  const parts = ORDER.flatMap((word) => {
    if (word === 'style') return style.pattern === null ? [] : [`style ${style.pattern}`]
    const part = NUMBER_PARTS.find((p) => p.word === word)!
    const n = style[part.attr]
    return n === null ? [] : [`${part.word} ${n}${part.unit}`]
  })
  return parts.length === 0 ? null : `<!-- line: ${parts.join(', ')} -->`
}
