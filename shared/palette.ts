/**
 * Unified Google Docs-style 10×8 colour palette (`shared/palette.ts`, YAZ-6727).
 *
 * Shared by Page Toolbar (Text colour & Highlight), Table Cell Toolbar (Fill & Text),
 * Drawing Text Box toolbar, and Settings › Quick highlight colours.
 *
 * - Row 1: 10-step grayscale from pure Black (`#000000`) to pure White (`#ffffff`)
 *   (includes exact `#000000`, `#434343`, `#d9d9d9`, `#ffffff` for monthly calendar templates).
 * - Row 2: 10 pure vibrant base hues.
 * - Rows 3–8: 60 tints and shades (Light 3 → Dark 3) directly beneath each base hue.
 */

export interface PaletteSwatch {
  readonly hex: `#${string}`
  readonly label: string
}

export const GDOCS_GRAYSCALE: readonly PaletteSwatch[] = [
  { hex: '#000000', label: 'Black' },
  { hex: '#434343', label: 'Dark grey 4' },
  { hex: '#666666', label: 'Dark grey 3' },
  { hex: '#999999', label: 'Dark grey 2' },
  { hex: '#b7b7b7', label: 'Dark grey 1' },
  { hex: '#cccccc', label: 'Grey' },
  { hex: '#d9d9d9', label: 'Light grey 1' },
  { hex: '#efefef', label: 'Light grey 2' },
  { hex: '#f3f3f3', label: 'Light grey 3' },
  { hex: '#ffffff', label: 'White' },
]

export const GDOCS_BASE_HUES: readonly PaletteSwatch[] = [
  { hex: '#980000', label: 'Red berry' },
  { hex: '#ff0000', label: 'Red' },
  { hex: '#ff9900', label: 'Orange' },
  { hex: '#ffff00', label: 'Yellow' },
  { hex: '#00ff00', label: 'Green' },
  { hex: '#00ffff', label: 'Cyan' },
  { hex: '#4a86e8', label: 'Cornflower blue' },
  { hex: '#0000ff', label: 'Blue' },
  { hex: '#9900ff', label: 'Purple' },
  { hex: '#ff00ff', label: 'Magenta' },
]

const SHADE_NAMES = ['Light 3', 'Light 2', 'Light 1', 'Dark 1', 'Dark 2', 'Dark 3'] as const

const SHADE_HEXES: readonly (readonly `#${string}`[])[] = [
  ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'],
  ['#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd'],
  ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'],
  ['#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79'],
  ['#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47'],
  ['#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130'],
]

export const GDOCS_SHADES: readonly (readonly PaletteSwatch[])[] = /*#__PURE__*/ SHADE_HEXES.map((row, r) =>
  row.map((hex, c) => ({ hex, label: `${GDOCS_BASE_HUES[c]!.label} ${SHADE_NAMES[r]}` })),
)

/** All 8 rows (10 columns each = 80 swatches). */
export const GDOCS_ROWS: readonly (readonly PaletteSwatch[])[] = [GDOCS_GRAYSCALE, GDOCS_BASE_HUES, ...GDOCS_SHADES]

/** Flat list of all 80 Google Docs palette swatches. */
export const GDOCS_ALL: readonly PaletteSwatch[] = /*#__PURE__*/ GDOCS_ROWS.flat()

/** Relative luminance (0–1) of `#rrggbb` or `#rrggbbaa` (ignores alpha; invalid strings return 0.5). */
export function hexLuminance(hex: string): number {
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return 0.5
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** True when a swatch is bright enough to need a dark checkmark / dark ink on top of it. */
export const isLightSwatch = (hex: string): boolean => hexLuminance(hex) >= 0.42

/**
 * Auto-contrast text tone for a solid (or ≥ 50% opaque) hex highlight (`YAZ-6733`).
 * Returns `'dark'` (needs white text), `'light'` (needs dark text), or `null` for translucent washes.
 */
export function highlightContrastTone(hex: string): 'dark' | 'light' | null {
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null
  if (hex.length === 9 && parseInt(hex.slice(7, 9), 16) < 128) return null
  return isLightSwatch(hex) ? 'light' : 'dark'
}

/**
 * Auto-contrast text tone from a CSS `background-color` value (`#rrggbb[aa]` OR browser-serialized `rgb(...)` / `rgba(...)`).
 * Used by Mobile reader (`pageRender.ts`) and Desktop cards (`cardRender.ts`) after DOMPurify/inline-style restore (`YAZ-6738`, `YAZ-6739`).
 */
export function highlightContrastToneFromStyle(bg: string): 'dark' | 'light' | null {
  const s = bg.trim()
  if (s.startsWith('#')) return highlightContrastTone(s)
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)$/i.exec(s)
  if (m === null) return null
  if (m[4] !== undefined && Number(m[4]) < 0.5) return null
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])].map((n) => {
    const c = Math.max(0, Math.min(255, n)) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b >= 0.42 ? 'light' : 'dark'
}
