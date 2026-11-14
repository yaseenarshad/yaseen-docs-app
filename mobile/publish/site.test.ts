import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pngSize, SPLASH_SCREENS } from './images'
import { shellFiles } from './pwaPlugin'

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

describe('the web app manifest', () => {
  it('"Notecards" (round 10, item 11), standalone, the whole site', () => {
    expect(manifest.name).toBe('Notecards')
    expect(manifest.short_name).toBe('Notecards')
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.id).toBe('/')
  })

  it("its colours are the app's tokens: the dark background (no white flash in dark mode), the light bar", () => {
    expect(manifest.background_color).toBe(token('dark', '--bg'))
    expect(manifest.theme_color).toBe(token('light', '--bg'))
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
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Notecards" />')
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

  it('a splash picture for each iPhone size, light and dark, in the background colour (iOS shows white without one)', () => {
    expect(SPLASH_SCREENS.length).toBeGreaterThanOrEqual(9)
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
      ['index.html', 'friend.html', 'assets/index-a1.js', 'assets/engine-b2.js', 'assets/qrDecode-c3.js', 'assets/index-d4.css', 'assets/friend-e5.js', 'assets/x.js.map'],
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
      '/icons/apple-touch-icon.png',
      '/icons/icon-192.png',
      '/manifest.webmanifest',
    ])
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
    expect(config.routes).toEqual([{ pattern: 'preview.notecards.yaseenarshad.com', custom_domain: true }])
    expect(config.assets).toEqual({ directory: './dist', not_found_handling: 'single-page-application', html_handling: 'auto-trailing-slash' })
    expect(config.main).toBeUndefined()
    expect(config.assets.binding).toBeUndefined()
    expect(JSON.stringify(config)).not.toMatch(/"notecards\.yaseenarshad\.com"|yaseen-notecards"/)
  })

  it('one script builds, then publishes the preview', () => {
    const root = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8'))
    expect(root.scripts['mobile:publish:preview']).toMatch(/^npm run mobile:build && npx --yes wrangler@\d+\.\d+\.\d+ deploy --config mobile\/wrangler\.jsonc$/)
  })
})
