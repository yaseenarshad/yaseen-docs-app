import { isRecord } from './guards'
import { isLineDefaults, type LineDefaults } from './line'
import { HEADING_HIGHLIGHTS, HEADING_KEYS, HEADING_SIZE_MAX, HEADING_SIZE_MIN, type HeadingStyle, type HeadingStyles } from './types'

/**
 * A vault's text formatting (YAZ-3066, decisions D10 and D14 on YAZ-3048): how normal text and each
 * heading level look in every page of ONE vault. It lives in `<vault>/.yaseendocs/text-formatting.json`
 * and goes through the generic `vaultConfig` door, the pattern of `review.json`, so GitHub sync
 * carries it to the other Macs. Pure: no React, no fs.
 *
 * The file holds only what the reader changed, beside a version:
 * `{ "version": 1, "text": { "size": 17 }, "h2": { "size": 21, "underline": true } }`.
 * A missing file, or `{}`, is the app's own look. Since YAZ-3208 (🔒 D8) an optional `line` key
 * holds the vault's default line: `"line": { "darkness": 70, "pattern": "dashed" }`.
 */

export const TEXT_FORMATTING_FILE = 'text-formatting.json'
/**
 * The shape of the file. A reader ignores it; a writer always writes it. 2 (YAZ-5485): the `spacing` key. A v1 writer
 * (YAZ-5483 on) keeps a key it does not know, so `spacing` survives an older build's save.
 */
export const TEXT_FORMATTING_VERSION = 2

/** The Text line (D14): size only, whole px, 12 to 24, 16 when the reader changed nothing. */
export const TEXT_SIZE_MIN = 12
export const TEXT_SIZE_MAX = 24
export const TEXT_DEFAULT_SIZE = 16

/** What the Text line changed. A missing `size` is `TEXT_DEFAULT_SIZE`. */
export interface TextStyle {
  size?: number
}

/**
 * The vault's page spacing (YAZ-5485, scoping B2): Settings › Appearance › Spacing (Line spacing, Space between
 * blocks) and Editor › Outline (Bullet indent, Bullet gap). A field left out is the app's default. The KEY left out is
 * different: the vault has not taken the spacing over yet, and the Mac then reads its app values (the fallback; the
 * phone reads its defaults). So `"spacing": {}` is "the defaults, in this vault".
 */
export interface PageSpacing {
  /** Line height, 1 to 3 (the presets are 1.0, 1.15, 1.5, 2.0); the default 1.5. */
  line?: number
  /** Space between blocks, px per side, 0 to 32; the default 4. */
  blockGap?: number
  /** Bullet indent, px, `PAGE_BULLET_INDENT_MIN`–`MAX`; the default is the page's own 2.15em. */
  bulletIndent?: number
  /** Bullet gap, px, `PAGE_BULLET_GAP_MIN`–`MAX`; the default 10. */
  bulletGap?: number
}

export const SPACING_DEFAULTS: Required<PageSpacing> = /*#__PURE__*/ Object.freeze({ line: 1.5, blockGap: 4, bulletIndent: 34, bulletGap: 10 })

/** Only the levels and the fields the reader changed. "Reset" removes a key; the defaults are never stored. */
export type TextFormatting = HeadingStyles & { text?: TextStyle; line?: LineDefaults; spacing?: PageSpacing }

const SPACING_FIELD_OK: { [K in keyof Required<PageSpacing>]: (v: unknown) => boolean } = {
  line: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 3,
  blockGap: (v) => wholeIn(v, 0, 32),
  // `PAGE_BULLET_INDENT_MIN`–`MAX` and `PAGE_BULLET_GAP_MIN`–`MAX` of `types.ts`, written out: an import would add
  // exports to the phone's first load (YAZ-5377), which this module's reader chunk would then take from it.
  bulletIndent: (v) => wholeIn(v, 8, 48),
  bulletGap: (v) => wholeIn(v, 2, 20),
}

/** The spacing's valid fields, each alone; a value equal to the default is left out. Not an object: null (no key). */
export function sanitizeSpacing(raw: unknown): PageSpacing | null {
  if (!isRecord(raw)) return null
  const out: PageSpacing = {}
  for (const field of Object.keys(SPACING_FIELD_OK) as (keyof PageSpacing)[]) {
    const v = raw[field]
    if (SPACING_FIELD_OK[field](v) && v !== SPACING_DEFAULTS[field]) out[field] = v as number
  }
  return out
}

/** The spacing as it draws: every field, the defaults filled in. */
export const spacingOf = (spacing: PageSpacing): Required<PageSpacing> => ({ ...SPACING_DEFAULTS, ...spacing })

/**
 * The CSS variables of a vault's spacing, the names the Mac's pages and the phone's reader read (`--edit-line-height`,
 * `--edit-block-gap`, `--page-bullet-indent`, `--page-bullet-gap`). All four, so a page layer of the vault never takes
 * the app's values from `.app`; the indent's default is the page's own 2.15em. No spacing (no key): none.
 */
export function spacingVars(spacing: PageSpacing | undefined): Record<string, string> {
  if (spacing === undefined) return {}
  const s = spacingOf(spacing)
  return {
    '--edit-line-height': String(s.line),
    '--edit-block-gap': `${s.blockGap}px`,
    '--page-bullet-indent': spacing.bulletIndent === undefined ? '2.15em' : `${s.bulletIndent}px`,
    '--page-bullet-gap': `${s.bulletGap}px`,
  }
}

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
 * `{}`. Each level, the Text line and the default line fall back alone: a bad one is left out and
 * the others stay (S95).
 * `version` and unknown keys are ignored.
 */
export function sanitizeTextFormatting(raw: unknown): TextFormatting {
  const r = isRecord(raw) ? raw : {}
  const out: TextFormatting = {}
  if (isTextStyle(r.text)) {
    const text = definedFields(r.text)
    if (text !== null) out.text = text
  }
  if (isLineDefaults(r.line)) {
    const line = definedFields(r.line)
    if (line !== null) out.line = line
  }
  // YAZ-5485: the spacing falls back field by field; a `spacing` that is not an object is no key at all.
  const spacing = sanitizeSpacing(r.spacing)
  if (spacing !== null) out.spacing = spacing
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

/** The top-level keys this build's writer owns (YAZ-5483): every other key of the file is kept on a save (`writeConfig`'s `known`). */
export const TEXT_FORMATTING_KEYS: readonly string[] = ['version', 'text', 'line', 'spacing', ...HEADING_KEYS]
