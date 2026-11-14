import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The phone's theme (YAZ-5179, B6): the phone has its OWN token layer on top of the Mac's colours (`styles.css`). The
 * contrast of every pair the screens draw is checked from the RENDERED screens in `contrast.screens.test.tsx` (round 4:
 * the rule walk that was here missed fills from other rules, placeholders and parent `opacity`). This file keeps the
 * rest: the Mac's font, dark mode by the iPhone, the home-screen basics, and the Mac's hue for each changed colour.
 */
const phone = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const mac = readFileSync(new URL('../../client/src/app.css', import.meta.url), 'utf8')
const token = (css: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1].trim()
const lightBlock = (css: string) => /:root \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''

describe('the phone theme', () => {
  it("the Mac's font; dark mode follows the iPhone's setting (round 10, item 6)", () => {
    expect(token(phone, '--font')).toBe(token(mac, '--font'))
    expect(phone).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root \{[\s\S]*?color-scheme: dark;/)
  })

  it('home-screen basics: 16 px fields (no zoom on focus), 44 pt taps, the safe areas', () => {
    expect(phone).toMatch(/\ninput \{\n  font-size: 16px;/)
    expect(token(phone, '--tap')).toBe('44px')
    for (const inset of ['safe-area-inset-top', 'safe-area-inset-bottom', 'safe-area-inset-left', 'safe-area-inset-right']) expect(phone).toContain(inset)
  })

  it("the hue of each changed colour stays the Mac's (only the lightness moves)", () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      if (max === min) return null
      const d = max - min
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
      return (h * 60 + 360) % 360
    }
    for (const name of ['--fg-muted', '--accent', '--danger', '--warn', '--ok']) {
      const p = token(lightBlock(phone), name)?.slice(0, 7)
      const m = token(lightBlock(mac), name)?.slice(0, 7)
      if (p === undefined || m === undefined || !p.startsWith('#')) continue
      const [a, b] = [hue(p), hue(m)]
      if (a === null || b === null) expect([name, a]).toEqual([name, b])
      else expect([name, Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) <= 6]).toEqual([name, true])
    }
  })
})
