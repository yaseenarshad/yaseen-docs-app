import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MASKABLE_SCALE, iconSvg, pngSize, SPLASH_SCREENS } from './images'
import { WORKER_SOURCES, shellFiles } from './pwaPlugin'

/** The home-screen app (YAZ-5087): the manifest, the icons, the iOS tags, the splash, the publish config. */

const here = new URL('..', import.meta.url).pathname
const read = (path: string) => readFileSync(join(here, path), 'utf8')
const css = read('src/styles.css')
const token = (block: 'light' | 'dark', name: string) => {
  const from = block === 'light' ? css.indexOf(':root {') : css.indexOf('@media (prefers-color-scheme: dark)')
  return new RegExp(`${name}:\\s*(#[0-9a-f]{6});`).exec(css.slice(from))![1]
}
const manifest = JSON.parse(read('public/manifest.webmanifest'))
const html = read('index.html')

describe("the app's name (Yaseen, 2026-11-14: \"it should just be notecard without an S\")", () => {
  it('"Notecard" in each place iOS and the browser read it: the manifest name and short name, the page title, the Home Screen title', () => {
    const NAME = 'Notecard'
    expect([manifest.name, manifest.short_name]).toEqual([NAME, NAME])
    expect(html).toContain(`<title>${NAME}</title>`)
    expect(html).toContain(`<meta name="apple-mobile-web-app-title" content="${NAME}" />`)
  })
})

describe('the web app manifest', () => {
  it('"Notecard" (round 10 item 11, renamed by Yaseen), standalone, the whole site', () => {
    expect(manifest.name).toBe('Notecard')
    expect(manifest.short_name).toBe('Notecard')
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.id).toBe('/')
  })

  it("its colours are the app's tokens: the dark background (no white flash in dark mode), the light bar", () => {
    expect(manifest.background_color).toBe(token('dark', '--bg'))
    expect(manifest.theme_color).toBe(token('light', '--bg'))
  })

  it('the icon is logo option 1, "Hidden word" (Yaseen, 2026-11-14): the source in the repo is the approved art, full-bleed', () => {
    const svg = read('public/icons/icon.svg')
    expect(svg).toBe(iconSvg())
    expect(svg).toContain('<rect width="512" height="512" fill="#5b6cff"/>')
    expect(svg).toContain('<rect x="204" y="234" width="140" height="44" rx="12" fill="#1f1f1f"/>') // the covered word
    // The maskable icon: the same card, scaled so its corners sit inside a circle of 66% of the width.
    const corner = Math.hypot(420 - 256, 366 - 256) * MASKABLE_SCALE
    expect(corner).toBeLessThan(0.33 * 512)
  })

  it('icons: 192, 512 and a maskable 512, each a real PNG of its size', () => {
    const want = [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]
    expect(manifest.icons).toEqual(want)
    for (const icon of want) {
      const [w, h] = icon.sizes.split('x').map(Number)
      expect([icon.src, pngSize(join(here, 'public', icon.src))]).toEqual([icon.src, { width: w, height: h }])
    }
  })
})

describe('the page head for iOS', () => {
  it('the Home Screen tags: the name, the 180 px icon, standalone, the status bar', () => {
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Notecard" />')
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />')
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes" />')
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="default" />')
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />')
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />')
    expect(pngSize(join(here, 'public/icons/apple-touch-icon.png'))).toEqual({ width: 180, height: 180 })
  })

  it('the viewport covers the whole screen (the safe areas are the CSS\'s)', () => {
    expect(html).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*"/)
  })

  it("light and dark: the bar colour of each, and the page's own colour scheme before any CSS", () => {
    expect(html).toContain(`<meta name="theme-color" media="(prefers-color-scheme: light)" content="${token('light', '--bg')}" />`)
    expect(html).toContain(`<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${token('dark', '--bg')}" />`)
    expect(html).toContain('<meta name="color-scheme" content="light dark" />')
    expect(html).toContain('<meta name="referrer" content="no-referrer" />')
  })

  it('YAZ-5287: the supported iPhone sizes, each with a splash (points and scale)', () => {
    const sizes = SPLASH_SCREENS.map((s) => `${s.width}x${s.height}@${s.ratio}`).sort()
    for (const want of ['440x956@3', '420x912@3', '402x874@3', '430x932@3', '393x852@3', '428x926@3', '390x844@3', '414x896@3', '375x812@3', '414x896@2', '375x667@2']) {
      expect([want, sizes.includes(want)]).toEqual([want, true])
    }
  })

  it('a splash picture for each iPhone size, light and dark, in the background colour (iOS shows white without one)', () => {
    expect(SPLASH_SCREENS.length).toBeGreaterThanOrEqual(11)
    for (const s of SPLASH_SCREENS) {
      for (const scheme of ['light', 'dark'] as const) {
        const file = `/splash/${scheme}-${s.width * s.ratio}x${s.height * s.ratio}.png`
        const media = `(device-width: ${s.width}px) and (device-height: ${s.height}px) and (-webkit-device-pixel-ratio: ${s.ratio}) and (orientation: portrait) and (prefers-color-scheme: ${scheme})`
        expect(html).toContain(`<link rel="apple-touch-startup-image" media="${media}" href="${file}" />`)
        expect([file, existsSync(join(here, 'public', file))]).toEqual([file, true])
      }
    }
  })
})

describe('the shell list the worker keeps', () => {
  it('the hashed build files, the pages under their served address, the manifest and icons; not the splash, the headers or the worker', () => {
    const list = shellFiles(
      ['index.html', 'friend.html', 'group.html', 'join.html', 'assets/index-a1.js', 'assets/engine-b2.js', 'assets/qrDecode-c3.js', 'assets/index-d4.css', 'assets/friend-e5.js', 'assets/x.js.map'],
      ['_headers', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'splash/dark-1179x2556.png', 'sw.js', 'robots.txt'],
    )
    expect(list).toEqual([
      '/',
      '/assets/engine-b2.js',
      '/assets/friend-e5.js',
      '/assets/index-a1.js',
      '/assets/index-d4.css',
      '/assets/qrDecode-c3.js',
      '/friend',
      '/group',
      '/icons/apple-touch-icon.png',
      '/icons/icon-192.png',
      '/join',
      '/manifest.webmanifest',
    ])
  })
})

describe("the worker's version (YAZ-5303)", () => {
  it("includes the worker's own code: a worker change alone is a new version, never the running version's cache", () => {
    for (const f of ['sw.ts', 'swCore.ts', 'killSwitch.ts']) expect([f, WORKER_SOURCES.some((s) => s.endsWith(`/src/pwa/${f}`))]).toEqual([f, true])
    for (const s of WORKER_SOURCES) expect([s, existsSync(new URL(s, new URL('./pwaPlugin.ts', import.meta.url)))]).toEqual([s, true])
  })
})

describe('the publish config (decision 8, round 12 item 14)', () => {
  const jsonc = (text: string) => JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''))
  const config = jsonc(read('wrangler.jsonc'))

  it('the PREVIEW Worker only: static files, no script, no workers.dev, its own address', () => {
    expect(config.name).toBe('yaseen-notecards-preview')
    expect(config.account_id).toBe('06ed69083fae875c626d37f9c05405a3')
    expect(config.workers_dev).toBe(false)
    expect(config.preview_urls).toBe(false)
    expect(config.routes).toEqual([{ pattern: 'preview.notecard.yaseenarshad.com', custom_domain: true }])
    expect(config.assets).toEqual({ directory: './dist', not_found_handling: 'single-page-application', html_handling: 'auto-trailing-slash' })
    expect(config.main).toBeUndefined()
    expect(config.assets.binding).toBeUndefined()
    expect(JSON.stringify(config)).not.toMatch(/"notecards?\.yaseenarshad\.com"|yaseen-notecards"/)
  })

  it('one script builds, then publishes the preview', () => {
    const root = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8'))
    expect(root.scripts['mobile:publish:preview']).toMatch(/^npm run mobile:build && npm run mobile:keep-previous && npx --yes wrangler@\d+\.\d+\.\d+ deploy --config mobile\/wrangler\.jsonc$/)
    // YAZ-5303: the live build's chunks stay on the host for one more deploy.
    expect(root.scripts['mobile:keep-previous']).toBe('vite-node mobile/publish/keepPreviousCli.ts')
  })

  it('YAZ-5285: one script publishes the kill switch to the PREVIEW; the README says what to do when a bad version ships', () => {
    const root = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8'))
    expect(root.scripts['mobile:publish:preview:kill-switch']).toMatch(/^NOTECARDS_KILL_SWITCH=1 npm run mobile:build && npm run mobile:keep-previous && npx --yes wrangler@\d+\.\d+\.\d+ deploy --config mobile\/wrangler\.jsonc$/)
    const readme = read('README.md')
    const part = readme.slice(readme.indexOf('## If a bad version ships'))
    expect(part.startsWith('## If a bad version ships')).toBe(true)
    for (const words of ['rollback', 'versions list', 'mobile:publish:preview:kill-switch', 'IndexedDB', 'app switcher']) expect([words, part.includes(words)]).toEqual([words, true])
  })
})
