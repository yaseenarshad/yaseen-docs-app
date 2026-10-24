/**
 * The `---` line's values (YAZ-3164; CONTRACTS rule 41): their ranges, the app's defaults and the
 * patterns. Shared because two sides check them: the editor (`client/src/editor/line/`) reads and
 * writes the line comment, and `sanitizeTextFormatting` checks a vault's default line (YAZ-3208,
 * 🔒 D8). Pure: no imports.
 */

/** Darkness: a % of the text colour, whole numbers. The app's default when the vault sets none. */
export const DARKNESS_DEFAULT = 50
export const DARKNESS_PRESETS = [10, 50, 100]
export const DARKNESS_MIN = 5
export const DARKNESS_MAX = 100
/** Thickness: whole px. The app's default when the vault sets none. */
export const THICKNESS_DEFAULT = 3
export const THICKNESS_PRESETS = [1, 3, 6]
export const THICKNESS_MIN = 1
export const THICKNESS_MAX = 24
/** Length: a % of the row. The handle's floor (S33); 100 is the full line, never written, and no vault sets it. */
export const MIN_LINE_WIDTH = 10
export const LINE_WIDTH_DEFAULT = 100
/** The highest length the comment may hold: 100 is the full line, so it is never written (🔒 D5). */
export const LINE_WIDTH_MAX = 99

/** The patterns (🔒 D7). Solid is the app's default; a picked `solid` is written too (D9, S100). */
export const LINE_PATTERNS = ['solid', 'dotted', 'dashed'] as const
export type LinePattern = (typeof LINE_PATTERNS)[number]
export const PATTERN_DEFAULT: LinePattern = 'solid'

const wholeIn = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/** A vault's default line (D8): only the fields the reader changed. Solid is no `pattern` field. */
export interface LineDefaults {
  darkness?: number
  thickness?: number
  pattern?: 'dotted' | 'dashed'
}

const LINE_DEFAULT_FIELD_OK: { [K in keyof Required<LineDefaults>]: (v: unknown) => boolean } = {
  darkness: (v) => wholeIn(v, DARKNESS_MIN, DARKNESS_MAX),
  thickness: (v) => wholeIn(v, THICKNESS_MIN, THICKNESS_MAX),
  pattern: (v) => v === 'dotted' || v === 'dashed',
}

/** Only the three known fields, each absent or in its range (S95). */
export const isLineDefaults = (v: unknown): v is LineDefaults =>
  typeof v === 'object' && v !== null && !Array.isArray(v) &&
  Object.entries(v).every(([field, value]) => Object.hasOwn(LINE_DEFAULT_FIELD_OK, field) && (value === undefined || LINE_DEFAULT_FIELD_OK[field as keyof LineDefaults](value)))
