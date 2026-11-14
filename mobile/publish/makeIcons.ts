import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BG_DARK, BG_LIGHT, SPLASH_SCREENS, iconSvg, pngSize, solidPng, splashFile } from './images'

/**
 * Makes the icons and the splash pictures in `mobile/public/` (YAZ-5087). Run it again when the drawing changes:
 *   npx vite-node mobile/publish/makeIcons.ts
 * The icons are drawn by Chrome with no window (`--headless`). The final icon art is Yaseen's call; change `iconSvg`.
 */

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const pub = new URL('../public/', import.meta.url).pathname
mkdirSync(join(pub, 'icons'), { recursive: true })
mkdirSync(join(pub, 'splash'), { recursive: true })

writeFileSync(join(pub, 'icons/icon.svg'), iconSvg({ round: true }))

const work = mkdtempSync(join(tmpdir(), 'notecards-icons-'))
function draw(svg: string, size: number, out: string) {
  const page = join(work, `icon-${size}.html`)
  writeFileSync(page, `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">`)
  // Chrome can end with a non-zero status after it wrote the picture (a display-link warning on macOS). The check is the
  // picture itself: it must exist and have the size. Up to three tries.
  for (let attempt = 1; ; attempt++) {
    rmSync(out, { force: true })
    try {
      execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--force-device-scale-factor=1', `--user-data-dir=${join(work, `profile-${size}-${attempt}-${out.length}`)}`, `--window-size=${size},${size}`, `--screenshot=${out}`, `file://${page}`], { stdio: 'ignore' })
    } catch {
      // checked below
    }
    if (existsSync(out) || attempt === 3) break
  }
  const got = pngSize(out)
  if (got.width !== size || got.height !== size) throw new Error(`${out} is ${got.width}x${got.height}, not ${size}`)
}

try {
  draw(iconSvg(), 180, join(pub, 'icons/apple-touch-icon.png'))
  draw(iconSvg(), 192, join(pub, 'icons/icon-192.png'))
  draw(iconSvg(), 512, join(pub, 'icons/icon-512.png'))
  draw(iconSvg({ scale: 0.78 }), 512, join(pub, 'icons/icon-maskable-512.png'))
} finally {
  rmSync(work, { recursive: true, force: true })
}

for (const s of SPLASH_SCREENS) {
  for (const [scheme, colour] of [['light', BG_LIGHT], ['dark', BG_DARK]] as const) {
    writeFileSync(join(pub, splashFile(s, scheme)), solidPng(s.width * s.ratio, s.height * s.ratio, colour))
  }
}
console.log('icons and splash pictures written to mobile/public/')
