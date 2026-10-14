/**
 * Renders the comparison picture of the README: tools/readmeMedia/compare.html -> docs/assets/compare.png.
 *
 * USAGE
 *   node tools/readmeMedia/compare.mjs [--out <file.png>]
 *
 * The page is drawn by a headless Chromium (Playwright's own) at two times the size, then made
 * 1600 pixels wide with `sips` (macOS). No window opens. To change a row, edit ROWS in compare.html,
 * run this again, and write the same change in the alt text of the picture in README.md.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = path.resolve(import.meta.dirname, '../..')
const WIDTH = 1600
const HEIGHT = 900

const args = process.argv.slice(2)
const outFlag = args.indexOf('--out')
const out = path.resolve(outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1] : path.join(REPO, 'docs/assets/compare.png'))

const { chromium } = createRequire(path.join(REPO, 'package.json'))('playwright')
const url = pathToFileURL(path.join(import.meta.dirname, 'compare.html'))
url.searchParams.set('icon', pathToFileURL(path.join(REPO, 'desktop/build/icon.png')).href)

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 })
  await page.goto(url.href)
  await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].filter((img) => img.src).map((img) => img.decode())]))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } })
} finally {
  await browser.close()
}
execFileSync('/usr/bin/sips', ['--resampleWidth', String(WIDTH), out], { stdio: 'ignore' })
console.log(`${path.relative(REPO, out)} (${WIDTH} × ${HEIGHT})`)
