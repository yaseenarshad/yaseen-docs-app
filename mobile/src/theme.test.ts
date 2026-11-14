import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The phone uses the Mac app's own colours and font (`client/src/app.css`), light and dark, and dark mode follows the
 * iPhone (round 10, item 6: `prefers-color-scheme`). A value that drifts from the Mac's fails here.
 */
const phone = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const mac = readFileSync(new URL('../../client/src/app.css', import.meta.url), 'utf8')

const tokens = (block: string) => Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
const blockAfter = (css: string, start: string) => {
  const from = css.indexOf(start)
  expect(from).toBeGreaterThanOrEqual(0)
  let depth = 0
  for (let i = css.indexOf('{', from); i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) return css.slice(from, i + 1)
  }
  throw new Error(`no block after ${start}`)
}

const phoneLight = tokens(blockAfter(phone, ':root {'))
const phoneDark = tokens(blockAfter(phone, '@media (prefers-color-scheme: dark)'))
const macLight = tokens(blockAfter(mac, ':root {'))
const macDark = tokens(blockAfter(mac, "[data-theme='dark'] {"))
const COLOURS = ['--bg', '--bg-side', '--fg', '--fg-muted', '--border', '--accent', '--accent-soft', '--danger', '--warn', '--ok']

describe('the phone theme', () => {
  it("light: the Mac's colours and font", () => {
    for (const name of [...COLOURS, '--font']) expect([name, phoneLight[name]]).toEqual([name, macLight[name]])
  })

  it("dark, by the iPhone's setting: the Mac's dark colours", () => {
    for (const name of COLOURS) expect([name, phoneDark[name]]).toEqual([name, macDark[name]])
    expect(phoneDark['color-scheme'] ?? blockAfter(phone, '@media (prefers-color-scheme: dark)')).toContain('dark')
  })

  it('home-screen basics: 16 px fields (no zoom on focus), 44 pt taps, the safe areas', () => {
    expect(phone).toMatch(/\ninput \{\n  font-size: 16px;/)
    expect(phoneLight['--tap']).toBe('44px')
    for (const inset of ['safe-area-inset-top', 'safe-area-inset-bottom', 'safe-area-inset-left', 'safe-area-inset-right']) expect(phone).toContain(inset)
  })
})
