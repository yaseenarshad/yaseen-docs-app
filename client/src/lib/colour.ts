/**
 * The app's colour maths, in one place (YAZ-4366): `#rrggbb` to its channels and back, and one reader of the CSS
 * colours a browser gives (`rgb()`, `rgba()`, `#rgb`, `#rrggbb`, `#rrggbbaa`). The highlight mark, its panel and
 * colour box, the table copy-out and Monaco's theme all use these, so a colour reads the same everywhere.
 */

/** A `#` colour string. */
export type Hex = `#${string}`

/** A channel (rounded, kept in 0 to 255) as two hex digits. */
const byte = (v: number): string => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')

/** `#rrggbb` as its red, green and blue, 0 to 255. */
export function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Red, green and blue (each rounded, kept in 0 to 255) as lowercase `#rrggbb`. */
export const hexOfRgb = (rgb: readonly number[]): Hex => `#${rgb.map(byte).join('')}`

/**
 * `rgb(…)` / `rgba(…)` / `#rgb` / `#rrggbb(aa)` as lowercase `#rrggbb`, or `#rrggbbaa` when it is see-through;
 * `undefined` for anything else (a colour name, `hsl()`, `var()`).
 */
export function toHex(color: string): Hex | undefined {
  const c = color.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c)
  if (short !== null) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase() as Hex
  if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return c.toLowerCase() as Hex
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(c)
  if (rgb === null) return undefined
  const hex = hexOfRgb([Number(rgb[1]), Number(rgb[2]), Number(rgb[3])])
  if (rgb[4] === undefined) return hex
  const alpha = rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4])
  return alpha >= 1 ? hex : `${hex}${byte(alpha * 255)}`
}

/** A CSS colour as a solid lowercase `#rrggbb`, its alpha dropped; null when `toHex` cannot read it. */
export const solidHex = (color: string): Hex | null => (toHex(color)?.slice(0, 7) as Hex | undefined) ?? null
