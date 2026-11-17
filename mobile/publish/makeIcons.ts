import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BG_DARK, BG_LIGHT, SPLASH_SCREENS, iconSvg, pngSize, splashFile, splashHtml } from './images'

/**
 * Makes the icons and the splash pictures in `mobile/public/` (YAZ-5087). Run it again when the Mac's icon changes:
 *   npx vite-node mobile/publish/makeIcons.ts
 * They are drawn by Chrome with no window (`--headless`), from the Mac app's icon (YAZ-5476, `images.ts` › `LOGO_SOURCE`).
 */

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const pub = new URL('../public/', import.meta.url).pathname
mkdirSync(join(pub, 'icons'), { recursive: true })
mkdirSync(join(pub, 'splash'), { recursive: true })

const work = mkdtempSync(join(tmpdir(), 'notecards-icons-'))
const iconPage = (svg: string, size: number) =>
  `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`
function draw(html: string, width: number, height: number, out: string) {
  const page = join(work, `page-${width}x${height}.html`)
  writeFileSync(page, html)
  // Chrome can end with a non-zero status after it wrote the picture (a display-link warning on macOS). The check is the
  // picture itself: it must exist and have the size. Up to three tries.
  for (let attempt = 1; ; attempt++) {
    rmSync(out, { force: true })
    try {
      execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--force-device-scale-factor=1', `--user-data-dir=${join(work, `profile-${width}x${height}-${attempt}-${out.length}`)}`, `--window-size=${width},${height}`, `--screenshot=${out}`, `file://${page}`], { stdio: 'ignore' })
    } catch {
      // checked below
    }
    if (existsSync(out) || attempt === 3) break
  }
  const got = pngSize(out)
  if (got.width !== width || got.height !== height) throw new Error(`${out} is ${got.width}x${got.height}, not ${width}x${height}`)
}

try {
  const icon = iconSvg()
  for (const [size, file] of [[180, 'apple-touch-icon'], [192, 'icon-192'], [512, 'icon-512'], [512, 'icon-maskable-512']] as const) draw(iconPage(icon, size), size, size, join(pub, `icons/${file}.png`))
  for (const s of SPLASH_SCREENS) {
    for (const [scheme, colour] of [['light', BG_LIGHT], ['dark', BG_DARK]] as const) {
      const [w, h] = [s.width * s.ratio, s.height * s.ratio]
      draw(splashHtml(w, h, colour), w, h, join(pub, splashFile(s, scheme).slice(1)))
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
console.log('icons and splash pictures written to mobile/public/')
