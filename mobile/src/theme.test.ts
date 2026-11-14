import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * YAZ-5179 (B6, decided by Yaseen's delegation): the phone has its OWN token layer on top of the Mac's colours
 * (`styles.css`). The Mac keeps its colours; the phone moves a colour's lightness (not its hue) until the contrast is
 * right. This test does not lock values. It walks EVERY stylesheet the phone loads (its own under `mobile/src`, and
 * the Mac's card, table and card-screen styles that the card drawing imports), light and dark, and computes the
 * contrast of each pair a screen can make (WCAG 2.1 AA):
 *  - a rule with `color` and its own `background`: that pair, 4.5:1 (3:1 for large text: 24 px, or 18.66 px bold);
 *  - a rule with `color` and no background of its own: the text on EACH surface of the phone (the page, a panel, a
 *    card), 4.5:1 (or 3:1 large);
 *  - a control (a field, a button) with a border colour: the border on its fill, or on each surface, 3:1.
 * `opacity` on a rule fades its text into the surface. A new pair under the limits fails here, with its file and rule.
 */

const SRC = fileURLToPath(new URL('.', import.meta.url))
const CLIENT = fileURLToPath(new URL('../../client/src/', import.meta.url))
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(join(dir, e.name))) : e.name.endsWith('.css') ? [join(dir, e.name)] : []))
const FILES = [...walk(SRC), ...['editor/card/card.css', 'editor/table/table.css', 'review/cardScreens.css'].map((f) => join(CLIENT, f))]

type Theme = 'light' | 'dark'
interface Rule {
  file: string
  selector: string
  theme: Theme | 'both'
  decls: Record<string, string>
}

/** The rules of a stylesheet, with the theme they apply to (`prefers-color-scheme: dark` blocks are dark only). */
function rulesOf(file: string): Rule[] {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Rule[] = []
  const parse = (text: string, theme: Theme | 'both') => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      if (open < 0) break
      const head = text.slice(i, open).trim()
      let depth = 1
      let j = open + 1
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++
        else if (text[j] === '}') depth--
        j++
      }
      const body = text.slice(open + 1, j - 1)
      if (head.startsWith('@media')) {
        if (/prefers-color-scheme:\s*dark/.test(head)) parse(body, 'dark')
        else if (/prefers-color-scheme:\s*light/.test(head)) parse(body, 'light')
        else parse(body, theme)
      } else if (head.startsWith('@supports')) parse(body, theme)
      else if (!head.startsWith('@')) {
        const decls: Record<string, string> = {}
        for (const d of body.split(';')) {
          const k = d.indexOf(':')
          if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim().replace(/\s*!important$/, '')
        }
        out.push({ file: relative(join(SRC, '../..'), file), selector: head.replace(/\s+/g, ' '), theme, decls })
      }
      i = j
    }
  }
  parse(css, 'both')
  return out
}

const RULES = FILES.flatMap(rulesOf)

/**
 * The code the phone runs: its own source (no tests, no fixtures), and each `client/` file it imports, followed through
 * their relative imports. A Mac rule counts only when each class it names is in that code (the Mac's Inbox, editor
 * and table menus are in the same stylesheets, but the phone never draws them).
 */
const walkCode = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === 'node_modules' || e.name === 'dev' ? [] : walkCode(join(dir, e.name))) : /\.(ts|tsx)$/.test(e.name) && !/(\.test\.|testing\.ts|fixtures)/.test(e.name) ? [join(dir, e.name)] : [],
  )
function phoneCode(): string {
  const seen = new Set<string>()
  const queue = walkCode(SRC)
  const text: string[] = []
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    let code: string
    try {
      code = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    text.push(code)
    for (const m of code.matchAll(/from\s+'([^']+)'|import\s+'([^']+)'/g)) {
      const spec = m[1] ?? m[2]
      const base = spec.startsWith('@client/') ? join(CLIENT, spec.slice('@client/'.length)) : spec.startsWith('.') && file.startsWith(CLIENT) ? join(file, '..', spec) : null
      if (base === null || base.endsWith('.css')) continue
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (/\.(ts|tsx)$/.test(candidate)) queue.push(candidate)
    }
  }
  return text.join('\n')
}
const CODE = phoneCode()
const drawnByPhone = (r: Rule) => {
  if (r.file.startsWith('mobile/')) return true
  return [...r.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].every((m) => new RegExp(`(^|[^\\w-])${m[1].replace(/[-]/g, '\\-')}([^\\w-]|$)`).test(CODE))
}
/** The Mac's dark selectors (`[data-theme='dark']`) never match on the phone: it follows the iPhone's setting. */
const PHONE_RULES = RULES.filter((r) => !/data-theme/.test(r.selector) && drawnByPhone(r))

/** The custom properties of one theme: light is every rule outside a dark block; dark is light, then the dark blocks. */
function tokensOf(theme: Theme): Record<string, string> {
  const t: Record<string, string> = {}
  for (const pass of theme === 'light' ? ['both', 'light'] : ['both', 'dark'])
    for (const r of PHONE_RULES) if (r.theme === pass) for (const [k, v] of Object.entries(r.decls)) if (k.startsWith('--')) t[k] = v
  return t
}
const TOKENS = { light: tokensOf('light'), dark: tokensOf('dark') }

type RGBA = [number, number, number, number]
const NAMED: Record<string, RGBA> = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], '#fff': [255, 255, 255, 1], '#000': [0, 0, 0, 1] }

/** A colour value to RGBA, through `var(…)`. Null: not a colour (an image, `transparent`, `currentColor`, unknown). */
function colourOf(value: string, theme: Theme, depth = 0): RGBA | null {
  const v = value.trim()
  if (depth > 12) return null
  const ref = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v)
  if (ref) {
    const t = TOKENS[theme][ref[1]]
    return t !== undefined ? colourOf(t, theme, depth + 1) : ref[2] !== undefined ? colourOf(ref[2], theme, depth + 1) : null
  }
  if (NAMED[v.toLowerCase()]) return NAMED[v.toLowerCase()]
  if (v === 'transparent') return [0, 0, 0, 0]
  const mix = /^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+)\)$/.exec(v)
  if (mix) {
    const [a, b] = [colourOf(mix[1], theme, depth + 1), colourOf(mix[3], theme, depth + 1)]
    if (a === null || b === null) return null
    const p = +mix[2] / 100
    // Premultiplied mix, as the browser does: a colour with `transparent` keeps its RGB and takes p of its alpha.
    const alpha = a[3] * p + b[3] * (1 - p)
    if (alpha === 0) return [0, 0, 0, 0]
    const ch = (i: number) => (a[i] * a[3] * p + b[i] * b[3] * (1 - p)) / alpha
    return [ch(0), ch(1), ch(2), alpha]
  }
  const hex = /^#([0-9a-f]{3,8})$/i.exec(v)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    const n = [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255))
    return [n[0], n[1], n[2], n[3] / 255]
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v)
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : +rgb[4]]
  return null
}

/** The first colour in a shorthand (`border: 1px solid var(--x)`, `background: var(--y)`). */
function colourIn(value: string | undefined, theme: Theme): RGBA | null {
  if (value === undefined) return null
  const whole = colourOf(value, theme)
  if (whole !== null) return whole
  for (const part of value.match(/color-mix\((?:[^()]|\([^()]*\))*\)|var\([^()]*(?:\([^()]*\))?[^()]*\)|#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\bwhite\b|\bblack\b/gi) ?? []) {
    const c = colourOf(part, theme)
    if (c !== null) return c
  }
  return null
}

const over = (top: RGBA, under: RGBA): RGBA => {
  const a = top[3]
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]
}
const luminance = ([r, g, b]: RGBA) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a: RGBA, b: RGBA) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}
const hexOf = (c: RGBA) => '#' + c.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')

/** The surfaces a text with no background of its own can sit on: the page, a panel (sheets, fields, a card). */
const SURFACES: [string, string][] = [
  ['the page', 'var(--bg)'],
  ['a panel', 'var(--bg-side)'],
]

/** Selectors whose text is never shown, or a colour that is only a hidden word's mask (it shows when the word does). */
const NOT_TEXT = /::placeholder|\.sr-only|:disabled|\[disabled\]|\[hidden\]/
const CONTROL = /(^|[\s,>+~(])(input|textarea|select)\b|\.btn\b|\.field\b/

export interface Pair {
  theme: Theme
  file: string
  selector: string
  what: 'text' | 'large text' | 'control border'
  fg: string
  bg: string
  on: string
  ratio: number
  need: number
}

function pairs(): Pair[] {
  const out: Pair[] = []
  for (const theme of ['light', 'dark'] as const)
    for (const r of PHONE_RULES) {
      if (r.theme !== 'both' && r.theme !== theme) continue
      const d = r.decls
      const bgValue = d['background-color'] ?? d.background
      const ownBg = colourIn(bgValue, theme)
      const grounds: [string, RGBA][] = SURFACES.map(([name, v]) => [name, colourOf(v, theme)!])
      const onto = ownBg !== null && ownBg[3] > 0 ? grounds.map(([name, g]): [string, RGBA] => [ownBg[3] < 1 ? `its own fill on ${name}` : 'its own fill', over(ownBg, g)]) : grounds
      const fade = d.opacity !== undefined && !Number.isNaN(parseFloat(d.opacity)) ? parseFloat(d.opacity) : 1
      const text = d.color === undefined ? null : colourOf(d.color, theme)
      if (text !== null && !NOT_TEXT.test(r.selector) && text[3] > 0) {
        const size = /([\d.]+)px/.exec(d['font-size'] ?? '')
        const px = size ? parseFloat(size[1]) : 16
        const bold = /^(bold|[6-9]00)$/.test(d['font-weight'] ?? '')
        const large = px >= 24 || (px >= 18.66 && bold)
        for (const [on, g] of new Map(onto)) {
          const fg = over([text[0], text[1], text[2], text[3] * fade], g)
          out.push({ theme, file: r.file, selector: r.selector, what: large ? 'large text' : 'text', fg: hexOf(fg), bg: hexOf(g), on, ratio: ratio(fg, g), need: large ? 3 : 4.5 })
        }
      }
      if (CONTROL.test(r.selector) && !NOT_TEXT.test(r.selector)) {
        const border = colourIn(d['border-color'] ?? d.border, theme)
        if (border !== null && border[3] > 0 && !/^(0|none)\b/.test(d.border ?? '')) {
          // The border against what is OUTSIDE the control: each surface.
          for (const [on, g] of grounds) {
            const b = over(border, g)
            out.push({ theme, file: r.file, selector: r.selector, what: 'control border', fg: hexOf(b), bg: hexOf(g), on, ratio: ratio(b, g), need: 3 })
          }
        }
      }
    }
  return out
}

const ALL = pairs()

describe('the phone theme (YAZ-5179): every colour pair a screen can make', () => {
  it('reads the stylesheets the phone loads, and finds the pairs', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(10)
    expect(ALL.filter((p) => p.what !== 'control border').length).toBeGreaterThan(100)
    expect(ALL.some((p) => p.what === 'control border')).toBe(true)
  })

  it('every text and background pair of the phone has 4.5:1 or more (3:1 large text), and each control border 3:1, light and dark', () => {
    const low = ALL.filter((p) => p.ratio < p.need).map((p) => `${p.theme} ${p.what} ${p.ratio}:1 < ${p.need} — ${p.file} \`${p.selector}\`: ${p.fg} on ${p.bg} (${p.on})`)
    expect([...new Set(low)]).toEqual([])
  })

  it('the lowest pairs, for the record', () => {
    for (const theme of ['light', 'dark'] as const) {
      const text = ALL.filter((p) => p.theme === theme && p.what === 'text').sort((a, b) => a.ratio - b.ratio)[0]
      const border = ALL.filter((p) => p.theme === theme && p.what === 'control border').sort((a, b) => a.ratio - b.ratio)[0]
      console.info(`${theme}: lowest text ${text.ratio}:1 (${text.selector}, ${text.fg} on ${text.bg}); lowest control border ${border.ratio}:1 (${border.selector})`)
    }
  })
})

describe('the phone theme: the Mac\'s font, dark mode by the iPhone, the home-screen basics', () => {
  const phone = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
  const mac = readFileSync(new URL('../../client/src/app.css', import.meta.url), 'utf8')
  const token = (css: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1].trim()

  it("the Mac's font; dark mode follows the iPhone's setting (round 10, item 6)", () => {
    expect(token(phone, '--font')).toBe(token(mac, '--font'))
    expect(phone).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root \{[\s\S]*?color-scheme: dark;/)
  })

  it('home-screen basics: 16 px fields (no zoom on focus), 44 pt taps, the safe areas', () => {
    expect(phone).toMatch(/\ninput \{\n  font-size: 16px;/)
    expect(token(phone, '--tap')).toBe('44px')
    for (const inset of ['safe-area-inset-top', 'safe-area-inset-bottom', 'safe-area-inset-left', 'safe-area-inset-right']) expect(phone).toContain(inset)
  })

  it('the hue of each changed colour stays the Mac\'s (only the lightness moves)', () => {
    const macLight = Object.fromEntries([...(/:root \{([\s\S]*?)\n\}/.exec(mac)?.[1] ?? '').matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]))
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
      const phoneValue = TOKENS.light[name]
      const macValue = macLight[name]
      if (phoneValue === undefined || macValue === undefined || !phoneValue.startsWith('#')) continue
      const [a, b] = [hue(phoneValue), hue(macValue)]
      if (a === null || b === null) expect([name, a]).toEqual([name, b])
      else expect([name, Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) <= 6]).toEqual([name, true])
    }
  })
})
