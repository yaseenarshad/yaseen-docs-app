import { isRecord } from './guards'
import { DEFAULT_WEB_LINKS } from './webLinksDefault'
import {
  LINK_FILL_PERCENT,
  LINK_HOVER_FILL_PERCENT,
  LINK_HOVER_TINT_PERCENT,
  LINK_HOVER_WASH_PERCENT,
  LINK_MARK_MASK,
  LINK_PALETTE_COLORS,
  SHARED_LINK_MARKS,
  isLinkHex,
  linkColorCss,
  linkFillSolidCss,
  linkHex,
  linkHoverSolidCss,
  linkHoverTextCss,
  type LinkHex,
  type LinkHover,
  type LinkPaletteColor,
  type LinkStrength,
  type SharedLinkMark,
} from './linkStyle'

/**
 * Web / External Link styling (YAZ-6580): how non-vault hyperlinks (`https://`, `http://`, `mailto:`, app URLs)
 * render in Desktop (Editor, Hover previews, Explore, Cards) and Mobile reader.
 *
 * Stored on `SettingsState.webLinks` (Global default) and sparsely overridden per vault in
 * `<vault>/.yaseendocs/settings.json` (`VAULT_OVERRIDE_KEYS`). Pure: no React, no Electron, no Node builtins.
 */

export const WEB_LINK_MARKS = SHARED_LINK_MARKS
export type WebLinkMarkIcon = SharedLinkMark
export const DEFAULT_WEB_LINK_MARK: WebLinkMarkIcon = 'arrow-up-right'
export const WEB_LINK_CUSTOM_MAX = 8

export type WebLinkColor = 'accent' | 'same' | 'muted' | LinkPaletteColor | LinkHex
export type WebLinkBoxShape = 'none' | 'round' | 'square'
export type WebLinkBoxFill = 'tint' | 'none' | LinkPaletteColor | LinkHex
export type WebLinkMarkPlace = 'off' | 'after' | 'before'
export type WebLinkMarkSize = 'small' | 'normal'
export type WebLinkMarkColor = 'same' | 'accent' | 'muted' | LinkPaletteColor | LinkHex

export interface WebLinkBox {
  /** None (absent), round (4px radius), or square (0px radius). */
  shape?: Exclude<WebLinkBoxShape, 'none'>
  /** Accent 10% tint (absent when shape is set), none, palette colour, or custom `#rrggbb`. */
  fill?: Exclude<WebLinkBoxFill, 'tint'>
  /** Palette or custom fill strength: light (15%), medium (absent, 30%), or strong (50%). */
  strength?: Exclude<LinkStrength, 'medium'>
}

export interface WebLinkMark {
  /** Off (mark omitted), after text, or before text. */
  place: Exclude<WebLinkMarkPlace, 'off'>
  /** Built-in SVG icon (`'arrow-up-right'` when absent and `custom` is absent). */
  icon?: WebLinkMarkIcon
  /** Custom text or emoji (1..8 code points, e.g. `🔗`, `🌐`, `[web]`). Takes precedence over `icon`. */
  custom?: string
  /** Same as link (absent), accent, muted, palette colour, or custom `#rrggbb`. */
  color?: Exclude<WebLinkMarkColor, 'same'>
  /** Small (`0.85em`, absent) or normal (`1em`). */
  size?: Exclude<WebLinkMarkSize, 'small'>
}

/** Sparse style for external hyperlinks. Every omitted field is today's look (accent, underlined, no box, no mark, wash hover). */
export interface WebLinksStyle {
  bold?: true
  italic?: true
  /** Underline is ON by default; stored only as `false` when turned off. */
  underline?: false
  /** Text colour: accent (absent), same (body text), muted, palette colour, or `#rrggbb`. */
  color?: Exclude<WebLinkColor, 'accent'>
  box?: WebLinkBox
  mark?: WebLinkMark
  /** Hover feedback: wash (absent, subtle 8%), underline, text colour, or off. */
  hover?: LinkHover
}

export { DEFAULT_WEB_LINKS }

export interface WebLinkPreset {
  id: 'classic' | 'arrow' | 'link' | 'emoji' | 'pill'
  label: string
  style: WebLinksStyle
}

export const WEB_LINK_PRESETS: readonly WebLinkPreset[] = [
  { id: 'classic', label: 'Classic underline', style: {} },
  { id: 'arrow', label: 'Clean + arrow ↗', style: { underline: false, mark: { place: 'after', color: 'muted' }, hover: { style: 'underline' } } },
  { id: 'link', label: 'Clean + link icon', style: { underline: false, mark: { place: 'after', icon: 'link', color: 'muted' } } },
  { id: 'emoji', label: 'Custom emoji 🔗', style: { underline: false, mark: { place: 'after', custom: '🔗' } } },
  { id: 'pill', label: 'Subtle pill', style: { underline: false, box: { shape: 'round' }, mark: { place: 'after' } } },
]

const oneOf =
  <T extends string>(choices: readonly T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (choices as readonly string[]).includes(v)

const isTextNamedColor = /*#__PURE__*/ oneOf(['accent', 'same', 'muted', ...LINK_PALETTE_COLORS] as const)
const textColorOf = (v: unknown): WebLinkColor | undefined => (isTextNamedColor(v) ? v : linkHex(v))
const isMarkIcon = /*#__PURE__*/ oneOf(WEB_LINK_MARKS)

/** Clean custom mark string (trimmed, no control chars, 1..WEB_LINK_CUSTOM_MAX code points), or undefined. */
export function cleanWebLinkCustomMark(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed === '' || /[\p{Cc}]/u.test(trimmed)) return undefined
  if ([...trimmed].length > WEB_LINK_CUSTOM_MAX) return undefined
  return trimmed
}

function sanitizeBox(raw: unknown): WebLinkBox | undefined {
  if (!isRecord(raw)) return undefined
  if (raw.shape !== 'round' && raw.shape !== 'square') return undefined
  const out: WebLinkBox = { shape: raw.shape }
  if (oneOf(['none', ...LINK_PALETTE_COLORS] as const)(raw.fill)) out.fill = raw.fill
  else if (isLinkHex(raw.fill)) out.fill = linkHex(raw.fill)
  if (oneOf(['light', 'strong'] as const)(raw.strength) && out.fill !== undefined && out.fill !== 'none') out.strength = raw.strength
  return out
}

function sanitizeMark(raw: unknown): WebLinkMark | undefined {
  if (!isRecord(raw)) return undefined
  if (raw.place !== 'after' && raw.place !== 'before') return undefined
  const out: WebLinkMark = { place: raw.place }
  const custom = cleanWebLinkCustomMark(raw.custom)
  if (custom !== undefined) {
    out.custom = custom
  } else if (isMarkIcon(raw.icon) && raw.icon !== DEFAULT_WEB_LINK_MARK) {
    out.icon = raw.icon
  }
  const color = textColorOf(raw.color)
  if (color !== undefined && color !== 'same') out.color = color
  if (raw.size === 'normal') out.size = 'normal'
  return out
}

function sanitizeHover(raw: unknown): LinkHover | undefined {
  if (!isRecord(raw)) return undefined
  const out: LinkHover = {}
  if (oneOf(['underline', 'text', 'off'] as const)(raw.style)) out.style = raw.style
  if (out.style !== 'off' && out.style !== 'underline') {
    if (oneOf(['accent', ...LINK_PALETTE_COLORS] as const)(raw.color)) out.color = raw.color
    else if (isLinkHex(raw.color)) out.color = linkHex(raw.color)
  }
  if (out.style === undefined && oneOf(['medium', 'strong'] as const)(raw.strength)) out.strength = raw.strength
  return Object.keys(out).length === 0 ? undefined : out
}

/** Repair any unknown value into a sparse, canonical `WebLinksStyle`. */
export function sanitizeWebLinks(raw: unknown): WebLinksStyle {
  if (!isRecord(raw)) return DEFAULT_WEB_LINKS
  const out: WebLinksStyle = {}
  if (raw.bold === true) out.bold = true
  if (raw.italic === true) out.italic = true
  if (raw.underline === false) out.underline = false
  const color = textColorOf(raw.color)
  if (color !== undefined && color !== 'accent') out.color = color
  const box = sanitizeBox(raw.box)
  if (box !== undefined) out.box = box
  const mark = sanitizeMark(raw.mark)
  if (mark !== undefined) out.mark = mark
  const hover = sanitizeHover(raw.hover)
  if (hover !== undefined) out.hover = hover
  return Object.keys(out).length === 0 ? DEFAULT_WEB_LINKS : out
}

export const isDefaultWebLinks = (style: WebLinksStyle): boolean => Object.keys(style).length === 0

export const sameWebLinks = (a: WebLinksStyle, b: WebLinksStyle): boolean =>
  JSON.stringify(sanitizeWebLinks(a)) === JSON.stringify(sanitizeWebLinks(b))

/** Strict validator for IPC / `SETTINGS_FIELD_OK`: must be a plain object matching canonical shape with no bogus fields. */
export function isWebLinksStyle(raw: unknown): raw is WebLinksStyle {
  if (!isRecord(raw)) return false
  const allowedTop = new Set(['bold', 'italic', 'underline', 'color', 'box', 'mark', 'hover'])
  for (const key of Object.keys(raw)) if (!allowedTop.has(key)) return false
  if (raw.bold !== undefined && raw.bold !== true) return false
  if (raw.italic !== undefined && raw.italic !== true) return false
  if (raw.underline !== undefined && raw.underline !== false) return false
  if (raw.color !== undefined) {
    const c = textColorOf(raw.color)
    if (c === undefined || c === 'accent') return false
  }
  if (raw.box !== undefined) {
    if (!isRecord(raw.box)) return false
    const allowedBox = new Set(['shape', 'fill', 'strength'])
    for (const k of Object.keys(raw.box)) if (!allowedBox.has(k)) return false
    if (sanitizeBox(raw.box) === undefined) return false
    if (raw.box.fill !== undefined && sanitizeBox(raw.box)?.fill !== (isLinkHex(raw.box.fill) ? linkHex(raw.box.fill) : raw.box.fill)) return false
    if (raw.box.strength !== undefined && sanitizeBox(raw.box)?.strength !== raw.box.strength) return false
  }
  if (raw.mark !== undefined) {
    if (!isRecord(raw.mark)) return false
    const allowedMark = new Set(['place', 'icon', 'custom', 'color', 'size'])
    for (const k of Object.keys(raw.mark)) if (!allowedMark.has(k)) return false
    const clean = sanitizeMark(raw.mark)
    if (clean === undefined) return false
    if (raw.mark.custom !== undefined && clean.custom !== raw.mark.custom) return false
    if (raw.mark.icon !== undefined && (raw.mark.custom !== undefined || clean.icon !== raw.mark.icon)) return false
    if (raw.mark.color !== undefined && clean.color !== (isLinkHex(raw.mark.color) ? linkHex(raw.mark.color) : raw.mark.color)) return false
    if (raw.mark.size !== undefined && clean.size !== raw.mark.size) return false
  }
  if (raw.hover !== undefined) {
    if (!isRecord(raw.hover)) return false
    const allowedHover = new Set(['style', 'color', 'strength'])
    for (const k of Object.keys(raw.hover)) if (!allowedHover.has(k)) return false
    const clean = sanitizeHover(raw.hover)
    if (clean === undefined) return false
    if (raw.hover.style !== undefined && clean.style !== raw.hover.style) return false
    if (raw.hover.color !== undefined && clean.color !== (isLinkHex(raw.hover.color) ? linkHex(raw.hover.color) : raw.hover.color)) return false
    if (raw.hover.strength !== undefined && clean.strength !== raw.hover.strength) return false
  }
  return true
}

/** Safe CSS string literal for a custom mark (escapes `\` and `"`). */
function cssQuote(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

const RESET_WEB_LINK_VARS: Readonly<Record<string, string>> = {
  '--ext-link-fg': 'initial',
  '--ext-link-weight': 'initial',
  '--ext-link-style': 'initial',
  '--ext-link-decoration': 'initial',
  '--ext-link-bg': 'initial',
  '--ext-link-pad-x': 'initial',
  '--ext-link-pad-y': 'initial',
  '--ext-link-radius': 'initial',
  '--ext-link-mark-place': 'initial',
  '--ext-link-mark-kind': 'initial',
  '--ext-link-mark-icon': 'initial',
  '--ext-link-mark-text': 'initial',
  '--ext-link-mark-fg': 'initial',
  '--ext-link-mark-size': 'initial',
  '--ext-link-hover-mode': 'initial',
  '--ext-link-hover-bg': 'initial',
  '--ext-link-hover-fg': 'initial',
  '--ext-link-hover-overhang': 'initial',
}

/**
 * Pure CSS custom properties for `WebLinksStyle`.
 * - Default (`resetDefaults: false`): emits only non-default variables (`{}` when default).
 * - Vault override (`resetDefaults: true`): starts from `initial` resets so a vault overriding back to
 *   Classic underline cleanly overrides any non-default Global `--ext-link-*` variables set on `.app`.
 */
export function webLinkVars(style: WebLinksStyle, opts?: { resetDefaults?: boolean }): Record<string, string> {
  const vars: Record<string, string> = opts?.resetDefaults ? { ...RESET_WEB_LINK_VARS } : {}
  if (isDefaultWebLinks(style)) return vars

  if (style.bold) vars['--ext-link-weight'] = '600'
  if (style.italic) vars['--ext-link-style'] = 'italic'
  if (style.underline === false) vars['--ext-link-decoration'] = 'none'
  if (style.color !== undefined) vars['--ext-link-fg'] = style.color === 'same' ? 'var(--fg)' : linkColorCss(style.color)

  const box = style.box
  const hasVisibleBox = box !== undefined && box.fill !== 'none'
  if (box !== undefined) {
    if (box.fill === 'none') {
      vars['--ext-link-bg'] = 'transparent'
      vars['--ext-link-pad-x'] = '0'
      vars['--ext-link-pad-y'] = '0'
      vars['--ext-link-radius'] = '0'
    } else {
      vars['--ext-link-pad-x'] = '4px'
      vars['--ext-link-pad-y'] = '0px'
      vars['--ext-link-radius'] = box.shape === 'square' ? '0' : '4px'
      if (box.fill === undefined) {
        vars['--ext-link-bg'] = 'color-mix(in srgb, var(--accent) 10%, transparent)'
      } else {
        const pct = LINK_FILL_PERCENT[box.strength ?? 'medium']
        vars['--ext-link-bg'] = `color-mix(in srgb, ${linkFillSolidCss(box.fill)} ${pct}%, transparent)`
      }
    }
  }

  const mark = style.mark
  if (mark !== undefined) {
    vars['--ext-link-mark-place'] = mark.place
    if (mark.custom !== undefined) {
      vars['--ext-link-mark-kind'] = 'text'
      vars['--ext-link-mark-text'] = cssQuote(mark.custom)
    } else {
      vars['--ext-link-mark-kind'] = 'svg'
      vars['--ext-link-mark-icon'] = LINK_MARK_MASK[mark.icon ?? DEFAULT_WEB_LINK_MARK]
    }
    if (mark.color !== undefined) vars['--ext-link-mark-fg'] = linkColorCss(mark.color)
    if (mark.size === 'normal') vars['--ext-link-mark-size'] = '1em'
  }

  const hover = style.hover
  const hoverStyle = hover?.style ?? 'wash'
  const hoverStrength = hover?.strength ?? 'light'
  const customFill = hasVisibleBox && box.fill !== undefined
  if (hoverStyle === 'off') {
    vars['--ext-link-hover-mode'] = 'off'
  } else if (hoverStyle === 'underline') {
    vars['--ext-link-hover-mode'] = 'underline'
  } else if (hoverStyle === 'text') {
    vars['--ext-link-hover-mode'] = 'text'
    vars['--ext-link-hover-fg'] =
      hover?.color !== undefined
        ? linkHoverTextCss(hover.color)
        : style.color === 'same'
          ? 'var(--accent)'
          : 'color-mix(in srgb, var(--accent) 72%, var(--fg))'
  } else {
    // Wash hover (default)
    if (hover?.color !== undefined) {
      vars['--ext-link-hover-bg'] = `color-mix(in srgb, ${linkHoverSolidCss(hover.color)} ${LINK_HOVER_WASH_PERCENT[hoverStrength]}%, transparent)`
      if (!hasVisibleBox) vars['--ext-link-hover-overhang'] = '1'
    } else if (customFill) {
      vars['--ext-link-hover-bg'] = `color-mix(in srgb, var(--fg) ${LINK_HOVER_FILL_PERCENT[hoverStrength]}%, var(--ext-link-bg))`
      vars['--ext-link-hover-overhang'] = '0'
    } else if (hasVisibleBox) {
      vars['--ext-link-hover-bg'] = `color-mix(in srgb, var(--accent) ${LINK_HOVER_TINT_PERCENT[hoverStrength]}%, transparent)`
      vars['--ext-link-hover-overhang'] = '0'
    } else if (hoverStrength !== 'light') {
      vars['--ext-link-hover-bg'] = `color-mix(in srgb, var(--fg) ${LINK_HOVER_WASH_PERCENT[hoverStrength]}%, transparent)`
    }
  }

  return vars
}
