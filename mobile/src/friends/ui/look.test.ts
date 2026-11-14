import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * YAZ-5264: the colours of the Friends rows, light and dark, against the page (4D's method in `status/look.test.ts`,
 * WCAG 2.1): each text 4.5:1 or more, each sign with a meaning (○ ◐ ✓) 3:1 or more. No text is drawn at an opacity.
 */
const css = readFileSync(join(import.meta.dirname, 'friends.css'), 'utf8')
const app = readFileSync(join(import.meta.dirname, '..', '..', 'styles.css'), 'utf8')
const block = (text: string, start: string) => {
  const from = text.indexOf(start)
  expect(from, start).toBeGreaterThanOrEqual(0)
  let depth = 0
  for (let i = text.indexOf('{', from); i < text.length; i++) {
    if (text[i] === '{') depth++
    if (text[i] === '}' && --depth === 0) return text.slice(from, i + 1)
  }
  throw new Error(`no block after ${start}`)
}
const tokens = (b: string) => Object.fromEntries([...b.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const light = { ...tokens(block(app, ':root {')), ...tokens(block(css, ':root {')) }
const dark = { ...light, ...tokens(block(app, '@media (prefers-color-scheme: dark)')), ...tokens(block(css, '@media (prefers-color-scheme: dark)')) }
const resolve = (theme: Record<string, string>, value: string): string => (value.startsWith('var(') ? resolve(theme, theme[value.slice(4, -1)]) : value)
/** The colour a rule gives its text. */
const colourOf = (selector: string) => /color:\s*(var\([^)]+\)|#[0-9a-f]{6})/i.exec(block(css, `${selector} {`))![1]

describe('the Friends colours (YAZ-5264)', () => {
  for (const [mode, theme] of [['light', light], ['dark', dark]] as const) {
    it(`${mode}: the words of a row 4.5:1, the marks 3:1, on the page and on a panel`, () => {
      const seen: Record<string, number> = {}
      for (const bg of [theme['--bg'], theme['--bg-side']]) {
        for (const [what, selector, need] of [
          ['under the name ("2h ago", "No longer shares with you")', '.fr-sub', 4.5],
          ['the gone row', '.fr-row--gone .fr-name', 4.5],
          ['the cheer line', '.fr-cheer', 4.5],
          ['○', '.fr-mark--not-started', 3],
          ['◐', '.fr-mark--started', 3],
          ['✓', '.fr-mark--finished', 3],
        ] as const) {
          const ratio = Math.round(contrast(resolve(theme, colourOf(selector)), resolve(theme, bg)) * 100) / 100
          seen[`${what} on ${bg}`] = ratio
          expect([mode, what, bg, ratio >= need]).toEqual([mode, what, bg, true])
        }
      }
      console.info(`friends contrast, ${mode}:`, JSON.stringify(seen))
    })
  }
  it('no Friends text is drawn at an opacity (it lowers the contrast)', () => {
    expect(css).not.toMatch(/opacity:\s*0\.\d/)
  })
})
