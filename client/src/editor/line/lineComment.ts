/**
 * The line comment itself (YAZ-3164, 🔒 D1 / D4 / D6 / D7; CONTRACTS rule 41): the values, their
 * ranges and defaults, and the one reader and writer of `<!-- line: … -->`. No editor imports, on
 * purpose: the line-number worker (`lineNumbers/blockLines.ts`, rule 34) reads the same comment to
 * know that it is no block of the page (YAZ-3204), and its bundle must hold the parser only.
 * `lineStyle.ts` re-exports all of it.
 */
export const DARKNESS_DEFAULT = 50
export const DARKNESS_PRESETS = [10, 50, 100]
export const DARKNESS_MIN = 5
export const DARKNESS_MAX = 100
export const THICKNESS_DEFAULT = 3
export const THICKNESS_PRESETS = [1, 3, 6]
export const THICKNESS_MIN = 1
export const THICKNESS_MAX = 24
/** The handle's floor (S33). The length's default is 100, never written. */
export const MIN_LINE_WIDTH = 10
export const LINE_WIDTH_DEFAULT = 100
/** The highest length the comment may hold: 100 is the default, so it is never written (🔒 D5). */
export const LINE_WIDTH_MAX = 99

/** The patterns that are written (🔒 D7); solid is the default, `null`, and never written (S70). */
export const LINE_PATTERNS = ['dotted', 'dashed'] as const
export type LinePattern = (typeof LINE_PATTERNS)[number]

/** The `hr` attributes. `null` is the default; a stored value is never the default. */
export interface LineStyle {
  darkness: number | null
  thickness: number | null
  pattern: LinePattern | null
  width: number | null
}

export const PLAIN_LINE: LineStyle = { darkness: null, thickness: null, pattern: null, width: null }

/** The number parts: the word in the comment, its unit, the attribute and its range. The one table of the ranges. */
export const NUMBER_PARTS = [
  { word: 'darkness', unit: '%', attr: 'darkness', min: DARKNESS_MIN, max: DARKNESS_MAX, fallback: DARKNESS_DEFAULT },
  { word: 'thickness', unit: 'px', attr: 'thickness', min: THICKNESS_MIN, max: THICKNESS_MAX, fallback: THICKNESS_DEFAULT },
  { word: 'length', unit: '%', attr: 'width', min: MIN_LINE_WIDTH, max: LINE_WIDTH_MAX, fallback: LINE_WIDTH_DEFAULT },
] as const

/** Every word in its fixed order (S3, S71). */
const ORDER = ['darkness', 'thickness', 'style', 'length'] as const

/** `<!-- line: … -->`, any spaces inside the delimiters; the parts are read one by one. */
const COMMENT = /^<!--\s*line:\s*([^]*?)\s*-->$/
/** A number part: a word, a space, a whole number with no leading zero, its unit. */
const PART = /^(\w+)\s+([1-9]\d{0,2})(%|px)$/
/** The style part: `solid` is ours too, and reads as the default (S4). */
const STYLE_PART = /^style\s+(solid|dotted|dashed)$/

/** A value in its range, as stored: the default becomes `null`. */
export const stored = (value: number, fallback: number): number | null => (value === fallback ? null : value)

/**
 * The style a comment holds, or `null` when it is not the line comment (S5, S6, S72): one to four
 * parts joined by commas, in the fixed order and each at most once — a number part with its own
 * unit and a whole number in its range, or `style` with `solid`, `dotted` or `dashed`. A comment
 * that holds only defaults is still ours: it reads as the plain line (S4).
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
      style.pattern = pattern === 'solid' ? null : (pattern as LinePattern)
      continue
    }
    const match = PART.exec(text)
    const part = NUMBER_PARTS.find((p) => p.word === word)
    if (match === null || part === undefined) return null
    const n = Number(match[2])
    if (match[3] !== part.unit || n < part.min || n > part.max) return null
    style[part.attr] = stored(n, part.fallback)
  }
  return style
}

/** The comment for a style, or `null` for the plain line: only the parts that are not the default, in order (S2, S3, S71). */
export function formatLineComment(style: LineStyle): string | null {
  const parts = ORDER.flatMap((word) => {
    if (word === 'style') return style.pattern === null ? [] : [`style ${style.pattern}`]
    const part = NUMBER_PARTS.find((p) => p.word === word)!
    const n = style[part.attr]
    return n === null || n === part.fallback ? [] : [`${part.word} ${n}${part.unit}`]
  })
  return parts.length === 0 ? null : `<!-- line: ${parts.join(', ')} -->`
}
