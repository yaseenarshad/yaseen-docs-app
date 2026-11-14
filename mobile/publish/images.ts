import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

/**
 * The pictures of the home-screen app (YAZ-5087), made by `makeIcons.ts` from ONE drawing (`iconSvg`). No new
 * dependency: the icons are drawn by the Chrome on this Mac, the splash pictures (one colour) by this file.
 */

/** The app's accent and backgrounds (`src/styles.css`; `publish/site.test.ts` checks the manifest against it). */
export const ACCENT = '#5b6cff'
export const BG_LIGHT = '#ffffff'
export const BG_DARK = '#1e1e1e'

/**
 * THE ICON (Yaseen, 2026-11-14: logo option 1, "Hidden word"): a white card on the accent square, with lines of text and
 * one word covered by a dark bar. Full-bleed (iOS rounds the corners itself). The shapes are the approved art, as drawn.
 * `scale` shrinks the card's shapes on the same blue (the maskable icon keeps the card well inside the safe zone).
 */
const CARD = `<rect x="92" y="146" width="328" height="220" rx="30" fill="#ffffff"/>
  <rect x="132" y="190" width="248" height="26" rx="13" fill="#c9cfff"/>
  <rect x="132" y="243" width="56" height="26" rx="13" fill="#c9cfff"/>
  <rect x="204" y="234" width="140" height="44" rx="12" fill="#1f1f1f"/>
  <rect x="132" y="296" width="180" height="26" rx="13" fill="#c9cfff"/>`

export function iconSvg({ scale = 1 }: { scale?: number } = {}): string {
  const card = scale === 1 ? `  ${CARD}` : `  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">\n  ${CARD}\n  </g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${ACCENT}"/>
${card}
</svg>
`
}

/** The maskable icon's scale: the card's corners then sit 158 px from the centre, inside a circle of 33% of the width. */
export const MASKABLE_SCALE = 0.8

/**
 * The iPhone screens that get a splash picture (CSS points and pixel ratio). With none, iOS shows a white screen
 * while the app starts, also in dark mode. Newest first.
 */
export const SPLASH_SCREENS = [
  { width: 440, height: 956, ratio: 3 }, // 16 Pro Max, 17 Pro Max
  { width: 402, height: 874, ratio: 3 }, // 16 Pro, 17, 17 Pro
  { width: 430, height: 932, ratio: 3 }, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  { width: 420, height: 912, ratio: 3 }, // Air (YAZ-5287)
  { width: 393, height: 852, ratio: 3 }, // 14 Pro, 15, 15 Pro, 16
  { width: 428, height: 926, ratio: 3 }, // 12 Pro Max, 13 Pro Max, 14 Plus
  { width: 390, height: 844, ratio: 3 }, // 12, 13, 14, 12 Pro, 13 Pro, 16e
  { width: 375, height: 812, ratio: 3 }, // X, XS, 11 Pro, 12 mini, 13 mini
  { width: 414, height: 896, ratio: 3 }, // XS Max, 11 Pro Max (YAZ-5287)
  { width: 414, height: 896, ratio: 2 }, // XR, 11
  { width: 375, height: 667, ratio: 2 }, // SE (2nd and 3rd), 8
] as const

export type Scheme = 'light' | 'dark'
export const splashFile = (s: (typeof SPLASH_SCREENS)[number], scheme: Scheme) => `/splash/${scheme}-${s.width * s.ratio}x${s.height * s.ratio}.png`
export const splashMedia = (s: (typeof SPLASH_SCREENS)[number], scheme: Scheme) =>
  `(device-width: ${s.width}px) and (device-height: ${s.height}px) and (-webkit-device-pixel-ratio: ${s.ratio}) and (orientation: portrait) and (prefers-color-scheme: ${scheme})`

/** The `<link>` tags for `index.html`. */
export const splashLinks = () =>
  SPLASH_SCREENS.flatMap((s) => (['light', 'dark'] as const).map((scheme) => `<link rel="apple-touch-startup-image" media="${splashMedia(s, scheme)}" href="${splashFile(s, scheme)}" />`))

/** The width and height of a PNG file (its IHDR). */
export function pngSize(file: string): { width: number; height: number } {
  const b = readFileSync(file)
  if (b.toString('latin1', 1, 4) !== 'PNG') throw new Error(`${file} is not a PNG`)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** A PNG of one colour (`#rrggbb`), opaque. */
export function solidPng(width: number, height: number, hex: string): Buffer {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 2, 0, 0, 0], 8) // 8 bits, RGB
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
