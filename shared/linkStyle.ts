/**
 * Shared link-styling primitives reused by both internal Link pills (`shared/linkPills.ts`) and external
 * Web links (`shared/webLinks.ts`, YAZ-6580). Pure: no React, no Electron, no Node builtins.
 */

/** The table palette (`table.css` `--table-fill-solid-*` and `--table-text-*`), ten colours. */
export const LINK_PALETTE_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'grey', 'brown'] as const
export type LinkPaletteColor = (typeof LINK_PALETTE_COLORS)[number]

/** Fill / wash strength levels. */
export const LINK_STRENGTHS = ['light', 'medium', 'strong'] as const
export type LinkStrength = (typeof LINK_STRENGTHS)[number]

/** A custom `#rrggbb` colour, lowercase; used as-is in light and dark themes. */
export type LinkHex = `#${string}`
export const linkHex = (v: unknown): LinkHex | undefined => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? (v.toLowerCase() as LinkHex) : undefined)
export const isLinkHex = (v: unknown): v is LinkHex => linkHex(v) !== undefined

/** Hover feedback styles shared by Link pills and Web links. */
export const LINK_HOVER_STYLES = ['wash', 'underline', 'text', 'off'] as const
export type LinkHoverStyle = (typeof LINK_HOVER_STYLES)[number]
export type LinkHoverColor = 'accent' | LinkPaletteColor | LinkHex
export interface LinkHover {
  /** Wash (absent), underline, text colour, or off. */
  style?: Exclude<LinkHoverStyle, 'wash'>
  /** Auto (absent), accent, a palette colour, or a custom `#rrggbb`. */
  color?: LinkHoverColor
  /** Subtle (absent, `'light'` 8 %), medium (14 %), or strong (22 %). Wash only. */
  strength?: Exclude<LinkStrength, 'light'>
}

/** Fill wash percentages for palette/custom fills. */
export const LINK_FILL_PERCENT = { light: 15, medium: 30, strong: 50 } as const
/** Hover wash percentages: subtle (8%), medium (14%), strong (22%). */
export const LINK_HOVER_WASH_PERCENT = { light: 8, medium: 14, strong: 22 } as const
/** Hover tint percentages over default accent-tinted boxes. */
export const LINK_HOVER_TINT_PERCENT = { light: 18, medium: 24, strong: 32 } as const
/** Hover darkening mix over palette/custom-filled boxes. */
export const LINK_HOVER_FILL_PERCENT = { light: 7, medium: 12, strong: 18 } as const

export const linkFillSolidCss = (color: LinkPaletteColor | LinkHex): string =>
  color.startsWith('#') ? color : `var(--table-fill-solid-${color})`

export const linkHoverSolidCss = (color: LinkHoverColor): string =>
  color === 'accent' ? 'var(--accent)' : color.startsWith('#') ? color : `var(--table-fill-solid-${color})`

export const linkHoverTextCss = (color: LinkHoverColor): string =>
  color === 'accent' ? 'var(--accent)' : color.startsWith('#') ? color : `var(--table-text-${color})`

export const linkColorCss = (color: 'accent' | 'same' | 'muted' | LinkPaletteColor | LinkHex): string =>
  color === 'accent' ? 'var(--accent)' : color === 'same' ? 'currentColor' : color === 'muted' ? 'var(--fg-muted)' : color.startsWith('#') ? color : `var(--table-text-${color})`

/** Built-in SVG mark icons shared by Link pills and Web links (all 24×24 viewBox, stroked/filled in currentColor). */
export const SHARED_LINK_MARKS = ['arrow-up-right', 'link', 'globe', 'arrow-right', 'return', 'dot', 'diamond', 'star', 'bookmark'] as const
export type SharedLinkMark = (typeof SHARED_LINK_MARKS)[number]

const svg = (inner: string): string =>
  `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

export const LINK_MARK_SVG: Readonly<Record<SharedLinkMark, string>> = {
  'arrow-up-right': /*#__PURE__*/ svg('<path d="M7 17 17 7M8 7h9v9"/>'),
  link: /*#__PURE__*/ svg('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.5 1.5M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/>'),
  globe: /*#__PURE__*/ svg('<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4.2" ry="9"/><path d="M3.5 12h17"/>'),
  'arrow-right': /*#__PURE__*/ svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  return: /*#__PURE__*/ svg('<path d="M9 10l-5 5 5 5M20 4v7a4 4 0 0 1-4 4H4"/>'),
  dot: /*#__PURE__*/ svg('<circle cx="12" cy="12" r="4" fill="currentColor"/>'),
  diamond: /*#__PURE__*/ svg('<path d="M12 5l7 7-7 7-7-7z" fill="currentColor"/>'),
  star: /*#__PURE__*/ svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
  bookmark: /*#__PURE__*/ svg('<path d="M6 3.5h12V21l-6-4-6 4z"/>'),
}

/** Each mark as a CSS mask `url("data:image/svg+xml,...")`, built once at module load. */
export const LINK_MARK_MASK: Readonly<Record<SharedLinkMark, string>> = /*#__PURE__*/ Object.fromEntries(
  Object.entries(LINK_MARK_SVG).map(([mark, icon]) => [
    mark,
    `url("data:image/svg+xml,${encodeURIComponent(icon.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}")`,
  ]),
) as Readonly<Record<SharedLinkMark, string>>
