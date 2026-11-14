import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The look of the dot (YAZ-5080): its colours in light and dark mode against the top bar, the pulse and "reduce
 * motion", and no layout jump when the words change length. jsdom has no layout, so these read the CSS.
 */
const css = readFileSync(new URL('./status.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')

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
const rule = (selector: string) => block(css, `${selector} {`)

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
const DOTS = ['--dot-synced', '--dot-pending', '--dot-syncing', '--dot-off', '--dot-attention']

describe('the colours', () => {
  for (const [mode, theme] of [['light', light], ['dark', dark]] as const) {
    it(`${mode}: each dot is 3:1 or more against the top bar (WCAG 1.4.11), and the words 4.5:1 or more`, () => {
      const bg = resolve(theme, theme['--bg'])
      const seen: Record<string, number> = {}
      for (const name of DOTS) {
        const colour = resolve(theme, theme[name])
        expect(colour, name).toMatch(/^#[0-9a-f]{6}$/i)
        seen[name] = Math.round(contrast(colour, bg) * 100) / 100
      }
      for (const [name, ratio] of Object.entries(seen)) expect([name, ratio >= 3]).toEqual([name, true])
      const words = resolve(theme, /color:\s*var\((--[\w-]+)\)/.exec(rule('.sync-status'))![0].replace(/color:\s*/, ''))
      expect(contrast(words, bg)).toBeGreaterThanOrEqual(4.5)
      console.info(`dot contrast, ${mode}:`, JSON.stringify(seen), 'words:', Math.round(contrast(words, bg) * 100) / 100)
    })
  }

  it("green, amber and red are the Mac's own tokens where they pass; blue and grey are the mockup's and the Mac's", () => {
    expect(tokens(block(css, ':root {'))).toMatchObject({ '--dot-synced': 'var(--ok)', '--dot-attention': 'var(--danger)', '--dot-off': 'var(--fg-muted)' })
    expect(tokens(block(css, '@media (prefers-color-scheme: dark)'))).toMatchObject({ '--dot-pending': 'var(--warn)' })
  })

  it('the five states are five different colours in each mode, and grey is a ring, not a filled dot', () => {
    for (const theme of [light, dark]) expect(new Set(DOTS.map((n) => resolve(theme, theme[n]).toLowerCase())).size).toBe(5)
    expect(rule('.sync-dot--off')).toMatch(/box-shadow: inset 0 0 0 2px var\(--dot-off\)/)
    expect(rule('.sync-dot--off')).toMatch(/background: transparent/)
  })
})

describe('motion', () => {
  it('blue pulses (the mockup: 1 s), and stops pulsing with "reduce motion"; it stays blue', () => {
    expect(rule('.sync-dot--syncing')).toMatch(/animation: sync-pulse 1s ease-in-out infinite/)
    const reduce = block(css, '@media (prefers-reduced-motion: reduce)')
    expect(reduce).toMatch(/\.sync-dot--syncing \{\s*animation: none;/)
    expect(reduce).not.toMatch(/background/)
  })
})

describe('no layout jump when the words change', () => {
  it('one line, no wrap; a box at least as wide as "Syncing…", so green and blue have the same size', () => {
    const r = rule('.sync-status')
    expect(r).toMatch(/white-space: nowrap/)
    expect(r).toMatch(/flex: none/)
    expect(r).toMatch(/min-width: [\d.]+em/)
    expect(r).toMatch(/min-height: var\(--tap\)/)
    expect(r).toMatch(/font-variant-numeric: tabular-nums/)
  })

  it('the dot has a fixed size and never shrinks', () => {
    expect(rule('.sync-dot')).toMatch(/width: 10px;\s*height: 10px;[\s\S]*flex: none/)
  })
})

describe('YAZ-5216: the words are never cut', () => {
  it('no ellipsis and no cap on the box: the vault name gives room, never the words', () => {
    expect(rule('.sync-status')).not.toMatch(/max-width/)
    expect(css).not.toMatch(/\.sync-status__words[^{]*\{[^}]*text-overflow/)
  })

  it('under 380 px the short form shows, at 380 px and more the words of decision 12', () => {
    expect(rule('.sync-status__words--short')).toMatch(/display: none/)
    const narrow = block(css, '@media (max-width: 379px)')
    expect(narrow).toMatch(/\.sync-status__words--full \{\s*display: none;/)
    expect(narrow).toMatch(/\.sync-status__words--short \{\s*display: inline;/)
  })

  it('at 320 px the longest short form fits beside a vault name of 4 letters and the gear', () => {
    // The top bar at 320 px: 320 - 16 - 8 (its padding) - 44 (the gear) - 2 × 8 (gaps) = 236 px. 13 px text is about 7 px a letter.
    const box = (letters: number) => 6 + 10 + 6 + letters * 7 + 6
    expect(box(20) + 4 * 10).toBeLessThanOrEqual(236)
    expect(rule('.topbar__title')).toMatch(/min-width: 4em/)
  })
})

describe('what the dot reads', () => {
  it('never the media (3D, decision 12): a picture that fails or downloads does not change the dot', () => {
    for (const file of ['./dot.ts', './SyncStatus.tsx', './StatusSheet.tsx', './useDotAnswers.ts']) expect(readFileSync(new URL(file, import.meta.url), 'utf8')).not.toMatch(/from '\.\.\/media/)
  })
})
