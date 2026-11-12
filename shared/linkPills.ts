import { isRecord } from './guards'

/**
 * A vault's link pills look (YAZ-4924): how every link pill of ONE vault draws — in its notes, the explore stack, the
 * mini window, a folder page's cells and the properties panel. It lives in `<vault>/.yaseendocs/link-pills.json` and
 * goes through the generic `vaultConfig` door, the pattern of `text-formatting.json`, so GitHub sync carries it to the
 * other Macs. Pure: no React, no fs.
 *
 * The file holds only what the reader changed, beside a version: `{ "version": 1, "background": "none", "bold": true }`.
 * A missing file, or `{}`, is the app's own look: every field absent reads as today's pill. The look never changes a
 * file: the text before and after a pill, the vault name, the ID and the folder are drawn, the note keeps `[[Name]]`.
 */

export const LINK_PILLS_FILE = 'link-pills.json'
/** The shape of the file. A reader ignores it; a writer always writes it. */
export const LINK_PILLS_VERSION = 1

/** The table palette (`table.css` `--table-fill-solid-*` and `--table-text-*`), the cell toolbar's ten colours. */
export const LINK_PILL_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey', 'brown'] as const
export type LinkPillColor = (typeof LINK_PILL_COLORS)[number]
/** How strong a palette background is: 15 %, 30 % and 50 % of the colour (`wikilink.css`), as a card's are. */
export const LINK_PILL_STRENGTHS = ['light', 'medium', 'strong'] as const
export type LinkPillStrength = (typeof LINK_PILL_STRENGTHS)[number]
/** The longest text before or after a pill. */
export const LINK_PILL_TEXT_MAX = 8

/** What one vault changed. Every field absent is today's look; a default is never stored. */
export interface LinkPills {
  /** The box behind the name: the accent's 10 % tint (absent), none, or a palette colour. */
  background?: 'none' | LinkPillColor
  /** A palette background's strength; medium when absent. Meaningless with no palette background. */
  strength?: Exclude<LinkPillStrength, 'medium'>
  /** The name's colour: the accent (absent), the text around it (`same`), or a palette colour's text colour. */
  text?: 'same' | LinkPillColor
  /** The page's file icon before the name: shown (absent) or hidden. */
  icon?: 'hide'
  bold?: true
  italic?: true
  underline?: true
  /** Text drawn before the name, 1 to 8 characters: `(`, `→ `. */
  before?: string
  /** Text drawn after the name, 1 to 8 characters: `)`, ` ↗`. */
  after?: string
  /** The vault's name on a pill: other vaults only (absent, YAZ-3609 D22), on every pill, or never. */
  vault?: 'always' | 'never'
  /** Where the vault's name goes: after the name (absent) or before it, "Wiki › Name". */
  vaultPlace?: 'before'
  /** The note's ID, small and muted, after the name (in a vault with IDs). */
  id?: 'show'
  /** The page's folder, small and muted, after the name: its parent folder, or the whole path from the vault. */
  folder?: 'parent' | 'full'
  /** The box's shape: rounded (absent), square, or no box and a line under the name. */
  shape?: 'square' | 'underline'
}

/** The look of a vault that changed nothing: the same object every time, so a layer's style can be cached on it. */
export const NO_LINK_PILLS: LinkPills = Object.freeze({})

/** Before / After's quick picks, in the order the row shows them: a label, then the two texts (`''` = none). */
export const LINK_PILL_QUICK_PICKS: readonly (readonly [label: string, before: string, after: string])[] = [
  ['( )', '(', ')'],
  ['[ ]', '[', ']'],
  ['→ ', '→ ', ''],
  ['« »', '« ', ' »'],
  [' ↗', '', ' ↗'],
]

const oneOf =
  <T extends string>(choices: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (choices as readonly string[]).includes(v)
const isTrue = (v: unknown): v is true => v === true
/** A text before or after a pill: 1 to 8 characters, none of them a line break or another control character. */
export const isLinkPillText = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= LINK_PILL_TEXT_MAX && !/[\p{Cc}]/u.test(v)

const FIELD_OK: { [K in keyof Required<LinkPills>]: (v: unknown) => boolean } = {
  background: oneOf(['none', ...LINK_PILL_COLORS]),
  strength: oneOf(['light', 'strong']),
  text: oneOf(['same', ...LINK_PILL_COLORS]),
  icon: oneOf(['hide']),
  bold: isTrue,
  italic: isTrue,
  underline: isTrue,
  before: isLinkPillText,
  after: isLinkPillText,
  vault: oneOf(['always', 'never']),
  vaultPlace: oneOf(['before']),
  id: oneOf(['show']),
  folder: oneOf(['parent', 'full']),
  shape: oneOf(['square', 'underline']),
}
export const LINK_PILL_FIELDS = Object.keys(FIELD_OK) as (keyof LinkPills)[]

/**
 * The file as the app uses it. A missing file or one that is not an object is today's look, `{}`. Each field falls
 * back alone: a bad one is left out and the others stay. A strength with no palette background is left out too.
 */
export function sanitizeLinkPills(raw: unknown): LinkPills {
  if (!isRecord(raw)) return {}
  const out: Record<string, unknown> = {}
  for (const field of LINK_PILL_FIELDS) if (FIELD_OK[field](raw[field])) out[field] = raw[field]
  if (out.strength !== undefined && (out.background === undefined || out.background === 'none')) delete out.strength
  return out as LinkPills
}

/** What `vaultConfig.write` stores: the version, then the fields. */
export const linkPillsFile = (pills: LinkPills): Record<string, unknown> => ({ version: LINK_PILLS_VERSION, ...sanitizeLinkPills(pills) })

/** Whether the look is today's: no field set. */
export const isDefaultLinkPills = (pills: LinkPills): boolean => LINK_PILL_FIELDS.every((field) => pills[field] === undefined)

/** `pills` with `patch` applied, each field set back to its default dropped: the result holds only changes. */
export function withLinkPills(pills: LinkPills, patch: { [K in keyof LinkPills]?: LinkPills[K] | undefined }): LinkPills {
  return sanitizeLinkPills({ ...pills, ...patch })
}

/** "Plain": no background, the text's colour, no icon; everything else as it was. */
export const plainLinkPills = (pills: LinkPills): LinkPills => withLinkPills(pills, { background: 'none', strength: undefined, text: 'same', icon: 'hide' })
/** Whether "Plain" has nothing left to strip. */
export const isPlainLinkPills = (pills: LinkPills): boolean => pills.background === 'none' && pills.text === 'same' && pills.icon === 'hide'
