import { readFileSync } from 'node:fs'

/**
 * The pictures of the home-screen app (YAZ-5087), made by `makeIcons.ts` from ONE picture, the Mac app's icon (YAZ-5476,
 * `LOGO_SOURCE`). No new dependency: the icons and the splash pictures are drawn by the Chrome on this Mac.
 */

/** The app's accent and backgrounds (`src/styles.css`; `publish/site.test.ts` checks the manifest against it). */
export const BG_LIGHT = '#ffffff'
export const BG_DARK = '#1e1e1e'

/**
 * THE ICON (YAZ-5476, Yaseen: "use the same Yaseen Docs logo"): the Mac app's own icon, `desktop/build/icon.png` (the
 * source electron-builder packs, `desktop/package.json` › build.mac.icon is its `.icns`). The Mac's picture is a macOS
 * rounded square with a margin and a shadow; the phone's icon is full-bleed (iOS and Android round the corners
 * themselves), so the drawing crops the inside of the square, past its bevel (`LOGO_CROP`), and lays it on the square's
 * own blue (top to bottom, sampled from the art) so the corners the crop leaves are the same blue. The Y sits well
 * inside the maskable safe circle (`site.test.ts`), so the maskable icon is the same drawing.
 */
export const LOGO_SOURCE = new URL('../../desktop/build/icon.png', import.meta.url).pathname
/** The Mac icon's 1024 px canvas, and the square inside its rounded square's bevel (x and y from, and the side). */
export const LOGO_CANVAS = 1024
export const LOGO_CROP = { from: 121, size: 782 } as const
/** The rounded square's blue at the top and at the bottom of the crop. */
export const LOGO_TOP = '#7684ff'
export const LOGO_BOTTOM = '#4755df'

const logoData = () => `data:image/png;base64,${readFileSync(LOGO_SOURCE).toString('base64')}`

/** The full-bleed icon: the Mac logo's inside on its blue, 512 x 512. */
export function iconSvg(): string {
  const k = 512 / LOGO_CROP.size
  const n = (v: number) => Number(v.toFixed(3))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${LOGO_TOP}"/><stop offset="1" stop-color="${LOGO_BOTTOM}"/></linearGradient></defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <image href="${logoData()}" x="${n(-LOGO_CROP.from * k)}" y="${n(-LOGO_CROP.from * k)}" width="${n(LOGO_CANVAS * k)}" height="${n(LOGO_CANVAS * k)}"/>
</svg>
`
}

/** The splash picture's page: the background colour, and the Mac logo as the Mac shows it (rounded, with its shadow) in the middle. */
export function splashHtml(width: number, height: number, colour: string): string {
  const side = Math.round(width * SPLASH_LOGO)
  return `<!doctype html><style>html,body{margin:0;width:${width}px;height:${height}px;background:${colour};overflow:hidden}img{position:absolute;left:${Math.round((width - side) / 2)}px;top:${Math.round((height - side) / 2)}px;width:${side}px;height:${side}px}</style><img src="${logoData()}">`
}

/** The logo's side on a splash picture, as a share of the screen's width (about 140 pt on a 440 pt iPhone). */
export const SPLASH_LOGO = 0.32

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

/** The width and height of a PNG file (its IHDR). */
export function pngSize(file: string): { width: number; height: number } {
  const b = readFileSync(file)
  if (b.toString('latin1', 1, 4) !== 'PNG') throw new Error(`${file} is not a PNG`)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}
