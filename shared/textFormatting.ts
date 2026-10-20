import { isRecord } from './guards'
import { HEADING_HIGHLIGHTS, HEADING_KEYS, HEADING_SIZE_MAX, HEADING_SIZE_MIN, type HeadingStyle, type HeadingStyles } from './types'

/**
 * A vault's text formatting (YAZ-3066, decisions D10 and D14 on YAZ-3048): how normal text and each
 * heading level look in every note of ONE vault. It lives in `<vault>/.yaseendocs/text-formatting.json`
 * and goes through the generic `vaultConfig` door, the pattern of `review.json`, so GitHub sync
 * carries it to the other Macs. Pure: no React, no fs.
 *
 * The file holds only what the reader changed, beside a version:
 * `{ "version": 1, "text": { "size": 17 }, "h2": { "size": 21, "underline": true } }`.
 * A missing file, or `{}`, is the app's own look.
 */

export const TEXT_FORMATTING_FILE = 'text-formatting.json'
/** The shape of the file. A reader ignores it; a writer always writes it. */
export const TEXT_FORMATTING_VERSION = 1

/** The Text line (D14): size only, whole px, 12 to 24, 16 when the reader changed nothing. */
export const TEXT_SIZE_MIN = 12
export const TEXT_SIZE_MAX = 24
export const TEXT_DEFAULT_SIZE = 16

/** What the Text line changed. A missing `size` is `TEXT_DEFAULT_SIZE`. */
export interface TextStyle {
  size?: number
}

/** Only the levels and the fields the reader changed. "Reset" removes a key; the defaults are never stored. */
export type TextFormatting = HeadingStyles & { text?: TextStyle }

const wholeIn = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/** One heading level's style (YAZ-3049 D1, D5): only the four known fields, each absent or valid. A size is whole px, 12 to 48. */
const HEADING_STYLE_FIELD_OK: { [K in keyof Required<HeadingStyle>]: (v: unknown) => boolean } = {
  size: (v) => wholeIn(v, HEADING_SIZE_MIN, HEADING_SIZE_MAX),
  bold: (v) => typeof v === 'boolean',
  underline: (v) => typeof v === 'boolean',
  highlight: (v) => typeof v === 'string' && (HEADING_HIGHLIGHTS as readonly string[]).includes(v),
}

export const isHeadingStyle = (v: unknown): v is HeadingStyle =>
  isRecord(v) && Object.entries(v).every(([field, value]) => Object.hasOwn(HEADING_STYLE_FIELD_OK, field) && (value === undefined || HEADING_STYLE_FIELD_OK[field as keyof HeadingStyle](value)))

/** The Text line's style: `size` only, whole px, 12 to 24. */
export const isTextStyle = (v: unknown): v is TextStyle =>
  isRecord(v) && Object.entries(v).every(([field, value]) => field === 'size' && (value === undefined || wholeIn(value, TEXT_SIZE_MIN, TEXT_SIZE_MAX)))

/** A copy without the fields that are `undefined`; null when no field is left. */
function definedFields<T extends object>(style: T): T | null {
  const out = Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined)) as T
  return Object.keys(out).length === 0 ? null : out
}

/**
 * The file as the app uses it (D10). A missing file or one that is not an object is the app's look,
 * `{}`. Each level and the Text line fall back alone: a bad one is left out and the others stay.
 * `version` and unknown keys are ignored.
 */
export function sanitizeTextFormatting(raw: unknown): TextFormatting {
  const r = isRecord(raw) ? raw : {}
  const out: TextFormatting = {}
  if (isTextStyle(r.text)) {
    const text = definedFields(r.text)
    if (text !== null) out.text = text
  }
  for (const key of HEADING_KEYS) {
    const style = r[key]
    if (!isHeadingStyle(style)) continue
    const clean = definedFields(style)
    if (clean !== null) out[key] = clean
  }
  return out
}

/**
 * What a writer puts in the file: the version, then only the changed levels and fields. The caller
 * hands in a clean value (the hook's sanitised one, the store's checked 1.0.15 map); a second
 * sanitise here would also put the whole sanitiser into the main bundle.
 */
export const textFormattingFile = (formatting: TextFormatting): Record<string, unknown> => ({ version: TEXT_FORMATTING_VERSION, ...formatting })
