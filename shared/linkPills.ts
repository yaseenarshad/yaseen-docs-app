import { isRecord } from './guards'

/**
 * A vault's link pills look (YAZ-4924): how every link pill of ONE vault draws — in its notes, the explore stack, the
 * mini window, a folder page's cells and the properties panel. It lives in `<vault>/.yaseendocs/link-pills.json` and
 * goes through the generic `vaultConfig` door, the pattern of `text-formatting.json`, so GitHub sync carries it to the
 * other Macs. Pure: no React, no fs.
 *
 * Version 2 (the redo): ONE format string with tokens in braces, as the New… box's `{YYYY}`, says what a pill shows
 * and in what order — `{icon}` `{name}` `{id}` `{number}` (the ID's number alone) `{vault}` `{folder}` (the parent
 * folder) `{path}` (the whole path from the vault) `{mark}` (a small icon, round 5); any other text shows as typed. The
 * box (shape, fill, strength) and each PART (the name, the ID, the number, the vault, the folder, the path, the mark,
 * your own text: bold / italic / underline, colour, size; the mark's icon) have their own style. The file
 * holds only what differs from the default, beside the version:
 * `{ "version": 2, "format": "{icon}{name} ({id})", "box": { "fill": "none" }, "parts": { "name": { "bold": true } } }`.
 * A missing file, or `{}`, is the app's own look: the default format with every part at its own default draws exactly
 * today's pill, the other vault's name in brackets after it (YAZ-3609 D22) included. A version 1 file (the fields of
 * the first round: background, before / after, icon, bold…) is read and converted in memory (`fromV1`); it is written
 * as version 2 only when the reader changes something. The look never changes a note: the pieces are drawn, the note
 * keeps `[[Name]]`.
 */

export const LINK_PILLS_FILE = 'link-pills.json'
/** The shape of the file. A reader converts an older one; a writer always writes this. */
export const LINK_PILLS_VERSION = 2

/** The table palette (`table.css` `--table-fill-solid-*` and `--table-text-*`), the cell toolbar's ten colours. */
export const LINK_PILL_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey', 'brown'] as const
export type LinkPillColor = (typeof LINK_PILL_COLORS)[number]
/** How strong a palette fill is: 15 %, 30 % and 50 % of the colour (`wikilink.css`), as a card's are. */
export const LINK_PILL_STRENGTHS = ['light', 'medium', 'strong'] as const
export type LinkPillStrength = (typeof LINK_PILL_STRENGTHS)[number]

/** The tokens a format may hold, in the order the chips show them. */
export const LINK_PILL_TOKENS = ['icon', 'name', 'id', 'number', 'vault', 'folder', 'path', 'mark'] as const
export type LinkPillToken = (typeof LINK_PILL_TOKENS)[number]
/** The parts a reader can style: each token but the icon, and `text` for every piece of their own text. The icon has no style. */
export const LINK_PILL_PARTS = ['name', 'id', 'number', 'vault', 'folder', 'path', 'mark', 'text'] as const
export type LinkPillPart = (typeof LINK_PILL_PARTS)[number]
/** The icons `{mark}` can draw (round 5), in the order the style panel shows them; the first is the default. */
export const LINK_PILL_MARKS = ['arrow-up-right', 'arrow-right', 'link', 'return', 'dot', 'diamond', 'star', 'bookmark'] as const
export type LinkPillMark = (typeof LINK_PILL_MARKS)[number]
export const DEFAULT_LINK_PILL_MARK: LinkPillMark = 'arrow-up-right'
/** The longest format. */
export const LINK_PILL_FORMAT_MAX = 60
/** Today's pill: the icon on the name, then the other vault's name in brackets (empty, with its brackets, on a pill of this vault). */
export const DEFAULT_LINK_PILL_FORMAT = '{icon}{name} ({vault})'

/** A part's colour: the accent, the text around the pill, the muted grey, or a palette colour's text colour. */
export type LinkPillPartColor = 'accent' | 'same' | 'muted' | LinkPillColor
export type LinkPillSize = 'normal' | 'small'
/** One part's style. Every field absent is the part's own default (`LINK_PILL_PART_DEFAULTS`). */
export interface LinkPillPartStyle {
  bold?: true
  italic?: true
  underline?: true
  color?: LinkPillPartColor
  size?: LinkPillSize
  /** The mark's icon (the mark only); `DEFAULT_LINK_PILL_MARK` when absent. */
  icon?: LinkPillMark
}
/** The pill's box. Absent: today's rounded box with the accent's 10 % tint. */
export interface LinkPillBox {
  /** Rounded (absent), square, or no box and a line under the pill. */
  shape?: 'square' | 'underline'
  /** The accent's tint (absent), none, or a palette colour. */
  fill?: 'none' | LinkPillColor
  /** A palette fill's strength; medium when absent. Meaningless with no palette fill. */
  strength?: Exclude<LinkPillStrength, 'medium'>
}

/** What one vault changed. Every field absent is today's look; a default is never stored. */
export interface LinkPills {
  /** The format; `DEFAULT_LINK_PILL_FORMAT` when absent. Always valid: `{name}` in it, every token known. */
  format?: string
  box?: LinkPillBox
  parts?: { [K in LinkPillPart]?: LinkPillPartStyle }
  /** The vault's name on a pill: other vaults only (absent, YAZ-3609 D22), on every pill, or never. Read only with `{vault}` in the format. */
  vault?: 'always' | 'never'
}

/**
 * Each part's own default colour and size: the name as today's pill text, the quiet parts and your own text small and
 * muted. The mark is the line's size in the NAME's colour (the pill's colour): its colour here is the name's default,
 * and a mark colour equal to the name's is no change (`sanitizeV2`).
 */
export const LINK_PILL_PART_DEFAULTS: Record<LinkPillPart, { color: LinkPillPartColor; size: LinkPillSize }> = {
  name: { color: 'accent', size: 'normal' },
  text: { color: 'muted', size: 'small' },
  id: { color: 'muted', size: 'small' },
  number: { color: 'muted', size: 'small' },
  vault: { color: 'muted', size: 'small' },
  folder: { color: 'muted', size: 'small' },
  path: { color: 'muted', size: 'small' },
  mark: { color: 'accent', size: 'normal' },
}

/** The look of a vault that changed nothing: the same object every time, so a layer's style can be cached on it. */
export const NO_LINK_PILLS: LinkPills = Object.freeze({})

/** A ready format of the dropdown: its label, the format, and the style of your own text where the text should read as the name. */
export interface LinkPillReady {
  label: string
  format: string
  /** Applied over the current look's parts and box: Plain is a format and a look. */
  parts?: LinkPills['parts']
  box?: LinkPillBox
}
export const LINK_PILL_READY: readonly LinkPillReady[] = [
  { label: 'Name', format: DEFAULT_LINK_PILL_FORMAT },
  { label: 'Name (ID)', format: '{icon}{name} ({id})' },
  { label: 'Name #Number', format: '{icon}{name} #{number}' },
  { label: 'Name · Folder', format: '{icon}{name} · {folder}' },
  { label: 'Vault › Name', format: '{vault} › {icon}{name}' },
  { label: '(Name)', format: '({icon}{name})', parts: { text: { color: 'accent', size: 'normal' } } },
  { label: '→ Name', format: '→ {icon}{name}', parts: { text: { color: 'accent', size: 'normal' } } },
  { label: 'Name ↗', format: '{name}{mark}' },
  { label: 'Plain', format: '{name}', box: { fill: 'none' }, parts: { name: { color: 'same' } } },
]

// ---------- the format ----------

/** One piece of a parsed format: a known token, or text as typed. */
export type LinkPillSegment = { token: LinkPillToken } | { text: string }

const TOKEN_SET: ReadonlySet<string> = new Set(LINK_PILL_TOKENS)

/**
 * The format in pieces: each `{token}` a token, everything else text, neighbouring text joined. `unknown` lists each
 * `{…}` that is no token, as typed (`{Name}`, `{}`), so the row can mark it. A lone brace is text.
 */
export function parseLinkPillFormat(format: string): { segments: LinkPillSegment[]; unknown: string[] } {
  const segments: LinkPillSegment[] = []
  const unknown: string[] = []
  let text = ''
  const flush = () => {
    if (text !== '') segments.push({ text })
    text = ''
  }
  const re = /\{([^{}]*)\}/g
  let at = 0
  for (let m = re.exec(format); m !== null; m = re.exec(format)) {
    text += format.slice(at, m.index)
    at = m.index + m[0].length
    if (TOKEN_SET.has(m[1])) {
      flush()
      segments.push({ token: m[1] as LinkPillToken })
    } else {
      unknown.push(m[0])
      text += m[0]
    }
  }
  text += format.slice(at)
  flush()
  return { segments, unknown }
}

/** Why a format cannot be saved, or null: too long, a control character, an unknown token, no `{name}`. */
export function linkPillFormatProblem(format: string): string | null {
  if (format.length > LINK_PILL_FORMAT_MAX) return `At most ${LINK_PILL_FORMAT_MAX} characters`
  if (/[\p{Cc}]/u.test(format)) return 'No line break or control character'
  const { segments, unknown } = parseLinkPillFormat(format)
  if (unknown.length > 0) return `Not a token: ${unknown.join(' ')}`
  if (!segments.some((s) => 'token' in s && s.token === 'name')) return 'The format needs {name}'
  return null
}

/** The tokens a format holds. */
export function linkPillFormatTokens(format: string): ReadonlySet<LinkPillToken> {
  const tokens = new Set<LinkPillToken>()
  for (const s of parseLinkPillFormat(format).segments) if ('token' in s) tokens.add(s.token)
  return tokens
}

// ---------- the file ----------

const oneOf =
  <T extends string>(choices: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (choices as readonly string[]).includes(v)
const isColor = oneOf(['accent', 'same', 'muted', ...LINK_PILL_COLORS])
const isSize = oneOf(['normal', 'small'])
const isMark = oneOf(LINK_PILL_MARKS)

/**
 * `raw` as a part's style with only its changes: a bad field falls back alone, a default is dropped. `undefined` when
 * nothing is left. `color`: the part's default colour (the mark's is the name's).
 */
function sanitizePart(part: LinkPillPart, raw: unknown, color: LinkPillPartColor = LINK_PILL_PART_DEFAULTS[part].color): LinkPillPartStyle | undefined {
  if (!isRecord(raw)) return undefined
  const out: LinkPillPartStyle = {}
  if (raw.bold === true) out.bold = true
  if (raw.italic === true) out.italic = true
  if (raw.underline === true) out.underline = true
  if (isColor(raw.color) && raw.color !== color) out.color = raw.color
  if (isSize(raw.size) && raw.size !== LINK_PILL_PART_DEFAULTS[part].size) out.size = raw.size
  if (part === 'mark' && isMark(raw.icon) && raw.icon !== DEFAULT_LINK_PILL_MARK) out.icon = raw.icon
  return Object.keys(out).length === 0 ? undefined : out
}

function sanitizeBox(raw: unknown): LinkPillBox | undefined {
  if (!isRecord(raw)) return undefined
  const out: LinkPillBox = {}
  if (oneOf(['square', 'underline'])(raw.shape)) out.shape = raw.shape
  if (oneOf(['none', ...LINK_PILL_COLORS])(raw.fill)) out.fill = raw.fill
  if (oneOf(['light', 'strong'])(raw.strength) && out.fill !== undefined && out.fill !== 'none') out.strength = raw.strength
  return Object.keys(out).length === 0 ? undefined : out
}

/** A version 2 file, or a look in memory, with only its valid changes. */
function sanitizeV2(raw: Record<string, unknown>): LinkPills {
  const out: LinkPills = {}
  if (typeof raw.format === 'string' && raw.format !== DEFAULT_LINK_PILL_FORMAT && linkPillFormatProblem(raw.format) === null) out.format = raw.format
  const box = sanitizeBox(raw.box)
  if (box !== undefined) out.box = box
  if (isRecord(raw.parts)) {
    const parts: LinkPills['parts'] = {}
    for (const part of LINK_PILL_PARTS) {
      // The name comes first: the mark's default colour is the name's.
      const style = sanitizePart(part, raw.parts[part], part === 'mark' ? parts.name?.color ?? LINK_PILL_PART_DEFAULTS.name.color : undefined)
      if (style !== undefined) parts[part] = style
    }
    if (Object.keys(parts).length > 0) out.parts = parts
  }
  if (oneOf(['always', 'never'])(raw.vault)) out.vault = raw.vault
  return out
}

/** A text before or after a pill of the first round: 1 to 8 characters, none of them a control character. */
const isV1Text = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 8 && !/[\p{Cc}]/u.test(v)

/**
 * A version 1 file as the look of today: each field of the first round in its place. The Before and After text, the
 * icon, the vault's place, the ID and the folder become the format, in the order the pill drew them (before, the vault
 * before the name, the icon, the name, the ID, the folder, the vault after the name, after). Bold, italic, underline
 * and the text colour are the name's style; the background and the shape the box. Before or After text: the text's
 * style is the pill's own colour and size, as it was. `vault: never` keeps `{vault}` in the format and the rule says never.
 */
export function fromV1(raw: Record<string, unknown>): LinkPills {
  const before = isV1Text(raw.before) ? raw.before : ''
  const after = isV1Text(raw.after) ? raw.after : ''
  const vaultBefore = raw.vaultPlace === 'before'
  const format =
    before +
    (vaultBefore ? '{vault} › ' : '') +
    (raw.icon === 'hide' ? '' : '{icon}') +
    '{name}' +
    (raw.id === 'show' ? ' {id}' : '') +
    (raw.folder === 'parent' ? ' {folder}' : raw.folder === 'full' ? ' {path}' : '') +
    (vaultBefore ? '' : ' ({vault})') +
    after
  const name: LinkPillPartStyle = {}
  if (raw.bold === true) name.bold = true
  if (raw.italic === true) name.italic = true
  if (raw.underline === true) name.underline = true
  if (raw.text === 'same' || oneOf(LINK_PILL_COLORS)(raw.text)) name.color = raw.text
  const parts: NonNullable<LinkPills['parts']> = { name }
  if (before !== '' || after !== '') parts.text = { color: 'accent', size: 'normal' }
  const box: LinkPillBox = {}
  if (raw.background === 'none' || oneOf(LINK_PILL_COLORS)(raw.background)) box.fill = raw.background
  if (raw.strength === 'light' || raw.strength === 'strong') box.strength = raw.strength
  if (raw.shape === 'square' || raw.shape === 'underline') box.shape = raw.shape
  return sanitizeV2({ format, box, parts, vault: raw.vault })
}

/** The fields a version 1 file may hold; a file without a version is read as one when it has any of them. */
const V1_FIELDS = ['background', 'strength', 'text', 'icon', 'bold', 'italic', 'underline', 'before', 'after', 'vaultPlace', 'id', 'folder', 'shape']

/**
 * The file as the app uses it. A missing file or one that is not an object is today's look, `{}`. A version 1 file
 * (or one with no version and a field of the first round) converts through `fromV1`. Each field falls back alone: a
 * bad one is left out and the others stay; a default is never kept.
 */
export function sanitizeLinkPills(raw: unknown): LinkPills {
  if (!isRecord(raw)) return {}
  if (raw.version === 1 || (raw.version === undefined && V1_FIELDS.some((f) => raw[f] !== undefined))) return fromV1(raw)
  return sanitizeV2(raw)
}

/** What `vaultConfig.write` stores: the version, then the fields. */
export const linkPillsFile = (pills: LinkPills): Record<string, unknown> => ({ version: LINK_PILLS_VERSION, ...sanitizeLinkPills(pills) })

/** Whether the look is today's: nothing set. */
export const isDefaultLinkPills = (pills: LinkPills): boolean => pills.format === undefined && pills.box === undefined && pills.parts === undefined && pills.vault === undefined

/** `pills` with the top-level fields of `patch` applied, each default dropped: the result holds only changes. */
export function withLinkPills(pills: LinkPills, patch: { [K in keyof LinkPills]?: LinkPills[K] | undefined }): LinkPills {
  return sanitizeLinkPills({ ...pills, ...patch })
}

/** `pills` with one part's style patched (a field `undefined` is that field's default). */
export function withLinkPillPart(pills: LinkPills, part: LinkPillPart, patch: { [K in keyof LinkPillPartStyle]?: LinkPillPartStyle[K] | undefined }): LinkPills {
  return withLinkPills(pills, { parts: { ...pills.parts, [part]: { ...pills.parts?.[part], ...patch } } })
}

/** `pills` with the box patched. */
export function withLinkPillBox(pills: LinkPills, patch: { [K in keyof LinkPillBox]?: LinkPillBox[K] | undefined }): LinkPills {
  return withLinkPills(pills, { box: { ...pills.box, ...patch } })
}

/** `pills` under a ready format: its format, and its parts and box over the current ones. */
export function withLinkPillReady(pills: LinkPills, ready: LinkPillReady): LinkPills {
  const parts = { ...pills.parts }
  for (const part of LINK_PILL_PARTS) if (ready.parts?.[part] !== undefined) parts[part] = { ...parts[part], ...ready.parts[part] }
  return withLinkPills(pills, { format: ready.format, parts, box: ready.box === undefined ? pills.box : { ...pills.box, ...ready.box } })
}
