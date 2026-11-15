/**
 * The contrast of what a screen REALLY draws. jsdom renders the phone's
 * screens, but its `getComputedStyle` does not resolve custom properties, `color-mix()` or the cascade of the phone's
 * stylesheets. So this module computes the cascade itself over the rendered DOM: each rule that `element.matches`,
 * by specificity and load order; inherited `color`, font and custom properties; `var()`, `color-mix()`,
 * `currentColor`, alpha; each ancestor's fill under the text, and each `opacity` group. Only tests and the fixtures
 * build read this file.
 */

export type Theme = 'light' | 'dark'
export interface Sheet {
  file: string
  css: string
}
type RGBA = [number, number, number, number]

interface Decl {
  prop: string
  value: string
  spec: number
  order: number
}
interface Rule {
  file: string
  selector: string
  /** `::placeholder`, `::before`, `::after`, or null for the element itself. */
  pseudo: string | null
  spec: number
  order: number
  decls: [string, string][]
}

// ── Parsing ──────────────────────────────────────────────────────────────────────────────────────────────────────

const splitTop = (text: string, sep: string): string[] => {
  const out: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === sep && depth === 0) {
      out.push(text.slice(from, i))
      from = i + 1
    }
  }
  out.push(text.slice(from))
  return out.map((s) => s.trim()).filter((s) => s !== '')
}

/** Does a media query hold on the phone (390 px wide, this theme, "reduce motion" on, no hover)? */
function mediaHolds(query: string, theme: Theme, width: number): boolean {
  const q = query.replace(/^@media\s*/, '')
  return splitTop(q, ',').some((part) =>
    part.split(/\band\b/).every((cond) => {
      const c = cond.trim()
      let m: RegExpExecArray | null
      if ((m = /prefers-color-scheme:\s*(\w+)/.exec(c))) return m[1] === theme
      if ((m = /max-width:\s*([\d.]+)px/.exec(c))) return width <= +m[1]
      if ((m = /min-width:\s*([\d.]+)px/.exec(c))) return width >= +m[1]
      if (/prefers-reduced-motion:\s*reduce/.test(c)) return true
      if (/^(screen|all|only screen)$/.test(c) || c === '') return true
      return false
    }),
  )
}

/** Specificity as one number (ids × 1e6 + classes × 1e3 + types). `:where()` is 0; `:is()`, `:not()`, `:has()` take their largest argument. */
export function specificity(selector: string): number {
  let s = selector
  let extra = 0
  s = s.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '')
  s = s.replace(/:(is|not|has)\(((?:[^()]|\([^()]*\))*)\)/g, (_, _k, args: string) => {
    extra += Math.max(0, ...splitTop(args, ',').map(specificity))
    return ''
  })
  s = s.replace(/::[\w-]+/g, ' x')
  const ids = (s.match(/#[\w-]+/g) ?? []).length
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length
  const types = (s.replace(/\[[^\]]*\]/g, '').match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length
  return ids * 1e6 + classes * 1e3 + types + extra
}

export function parseSheets(sheets: Sheet[], theme: Theme, width: number): Rule[] {
  const rules: Rule[] = []
  let order = 0
  for (const sheet of sheets) {
    const parse = (text: string) => {
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
          if (mediaHolds(head, theme, width)) parse(body)
        } else if (head.startsWith('@supports')) parse(body)
        else if (!head.startsWith('@')) {
          const decls: [string, string][] = []
          for (const d of splitTop(body, ';')) {
            const k = d.indexOf(':')
            if (k > 0) decls.push([d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim().replace(/\s*!important$/, '')])
          }
          for (const sel of splitTop(head, ',')) {
            const pm = /::?(placeholder|before|after)\s*$/.exec(sel)
            const base = (pm ? sel.slice(0, pm.index) : sel).trim() || '*'
            if (/::[\w-]+/.test(base)) continue // other pseudo-elements: scrollbars, selection, webkit parts
            rules.push({ file: sheet.file, selector: base, pseudo: pm ? `::${pm[1]}` : null, spec: specificity(sel), order: order++, decls })
          }
        }
        i = j
      }
    }
    parse(sheet.css.replace(/\/\*[\s\S]*?\*\//g, ''))
  }
  return rules
}

/** The key of a selector's last compound: a class, else a tag, else `*`. Rules are tested only on elements with that key. */
function keyOf(selector: string): string {
  const parts = splitTop(selector.replace(/\s*([>+~])\s*/g, ' '), ' ')
  const last = (parts.at(-1) ?? '*').replace(/\((?:[^()]|\([^()]*\))*\)/g, '')
  const cls = /\.([\w-]+)/.exec(last)
  if (cls) return `.${cls[1]}`
  const tag = /^([a-zA-Z][\w-]*)/.exec(last)
  return tag ? tag[1].toLowerCase() : '*'
}

// ── Colours ──────────────────────────────────────────────────────────────────────────────────────────────────────

const NAMED: Record<string, RGBA> = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] }

export const over = (top: RGBA, under: RGBA): RGBA => {
  const a = top[3] + under[3] * (1 - top[3])
  if (a === 0) return [0, 0, 0, 0]
  const ch = (i: number) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a
  return [ch(0), ch(1), ch(2), a]
}
const luminance = ([r, g, b]: RGBA) => {
  const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
export const ratio = (a: RGBA, b: RGBA) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}
export const hexOf = (c: RGBA) => '#' + c.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')

/**
 * Resolves `var()` with the custom properties of an element. It matches the brackets itself: a fallback can
 * hold `color-mix()` that holds `calc()` that holds `var()` (`table.css`'s head ink), deeper than a pattern can follow.
 */
function substitute(value: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 20) return value
  let out = ''
  let i = 0
  for (;;) {
    const at = value.indexOf('var(', i)
    if (at < 0) return out + value.slice(i)
    let level = 0
    let end = -1
    let comma = -1
    for (let j = at + 3; j < value.length; j++) {
      const c = value[j]
      if (c === '(') level++
      else if (c === ')' && --level === 0) {
        end = j
        break
      } else if (c === ',' && level === 1 && comma < 0) comma = j
    }
    if (end < 0) return out + value.slice(i)
    const name = value.slice(at + 4, comma < 0 ? end : comma).trim()
    const fallback = comma < 0 ? undefined : value.slice(comma + 1, end).trim()
    const set = vars.get(name)
    // A custom property set to `initial` is the guaranteed-invalid value: `var()` takes its fallback (table.css).
    const chosen = set !== undefined && set.trim() !== 'initial' ? set : (fallback ?? '')
    out += value.slice(i, at) + substitute(chosen, vars, depth + 1)
    i = end + 1
  }
}

/**
 * Resolves each `calc()` whose terms are numbers, or numbers of ONE unit (`%`, `px`, `em`, `rem`), with
 * `+ - * /` and parentheses: `calc(6 * 1 * 1%)` is `6%`. A `calc()` it cannot resolve stays as written, and the colour
 * that holds it is reported as unresolved (`audit().unresolved`).
 */
export function resolveCalc(value: string): string {
  let out = value
  for (let guard = 0; guard < 50 && /calc\(/i.test(out); guard++) {
    const start = out.toLowerCase().lastIndexOf('calc(')
    let depth = 0
    let end = -1
    for (let i = start + 4; i < out.length; i++) {
      if (out[i] === '(') depth++
      else if (out[i] === ')' && --depth === 0) {
        end = i
        break
      }
    }
    if (end < 0) return out
    const result = evalCalc(out.slice(start + 5, end))
    if (result === null) return out
    out = out.slice(0, start) + result + out.slice(end + 1)
  }
  return out
}

function evalCalc(expr: string): string | null {
  const tokens = expr.match(/\d*\.?\d+(?:e[+-]?\d+)?(?:%|px|rem|em)?|[-+*/()]|\S/gi) ?? []
  let i = 0
  type Num = { n: number; unit: string }
  const fail = (): never => {
    throw new Error('calc')
  }
  const primary = (): Num => {
    const t = tokens[i++]
    if (t === '(') {
      const v = sum()
      if (tokens[i++] !== ')') fail()
      return v
    }
    if (t === '-') {
      const v = primary()
      return { n: -v.n, unit: v.unit }
    }
    const m = t === undefined ? null : /^(\d*\.?\d+(?:e[+-]?\d+)?)(%|px|rem|em)?$/i.exec(t)
    if (!m) return fail()
    return { n: +m[1], unit: (m[2] ?? '').toLowerCase() }
  }
  const product = (): Num => {
    let v = primary()
    while (tokens[i] === '*' || tokens[i] === '/') {
      const op = tokens[i++]
      const w = primary()
      if (op === '*') {
        if (v.unit !== '' && w.unit !== '') fail()
        v = { n: v.n * w.n, unit: v.unit || w.unit }
      } else {
        if (w.unit !== '' || w.n === 0) fail()
        v = { n: v.n / w.n, unit: v.unit }
      }
    }
    return v
  }
  const sum = (): Num => {
    let v = product()
    while (tokens[i] === '+' || tokens[i] === '-') {
      const op = tokens[i++]
      const w = product()
      if (v.unit !== w.unit && v.n !== 0 && w.n !== 0) fail()
      v = { n: op === '+' ? v.n + w.n : v.n - w.n, unit: v.unit || w.unit }
    }
    return v
  }
  try {
    const v = sum()
    if (i !== tokens.length) return null
    return `${Math.round(v.n * 1e6) / 1e6}${v.unit}`
  } catch {
    return null
  }
}

/** A value that names a colour the engine must read (a colour function, a hex, a `var()` or `calc()` left over). */
const COLOURISH = /\b(?:color-mix|rgba?|hsla?|hwb|lab|lch|oklab|oklch|light-dark|color|var|calc)\(|gradient\(|#[0-9a-f]{3,8}\b/i
const NOT_A_COLOUR = /^(?:inherit|initial|unset|revert|revert-layer|none)$/i

export function parseColour(raw: string, current: RGBA | null): RGBA | null {
  const v = raw.trim().toLowerCase()
  if (v === '') return null
  if (v === 'currentcolor') return current
  if (NAMED[v]) return NAMED[v]
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    const n = [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255))
    return [n[0], n[1], n[2], n[3] / 255]
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v)
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : +rgb[4]]
  const mix = /^color-mix\(\s*in srgb\s*,\s*((?:[^(),]|\([^()]*\))+?)(?:\s+([\d.]+)%)?\s*,\s*((?:[^(),]|\([^()]*\))+?)(?:\s+([\d.]+)%)?\s*\)$/.exec(resolveCalc(v))
  if (mix) {
    const a = parseColour(mix[1], current)
    const b = parseColour(mix[3], current)
    if (a === null || b === null) return null
    const p = mix[2] !== undefined ? +mix[2] / 100 : mix[4] !== undefined ? 1 - +mix[4] / 100 : 0.5
    const alpha = a[3] * p + b[3] * (1 - p)
    if (alpha === 0) return [0, 0, 0, 0]
    const ch = (i: number) => (a[i] * a[3] * p + b[i] * b[3] * (1 - p)) / alpha
    return [ch(0), ch(1), ch(2), alpha]
  }
  return null
}

/** The first colour in a shorthand (`border: 1px solid X`, `background: X url(…)`). */
function colourIn(value: string, current: RGBA | null): RGBA | null {
  const whole = parseColour(value, current)
  if (whole !== null) return whole
  for (const part of value.match(/color-mix\((?:[^()]|\([^()]*\))*\)|#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black|transparent|currentcolor)\b/gi) ?? []) {
    // The first colour of the shorthand is its colour. If the engine cannot read it, it says so (null), not the next one.
    return parseColour(part, current)
  }
  return null
}

// ── The cascade over the DOM ─────────────────────────────────────────────────────────────────────────────────────

interface Computed {
  vars: Map<string, string>
  color: RGBA
  fontSize: number
  fontWeight: number
  hidden: boolean
  own: Map<string, string>
}

const INHERITED = new Set(['color', 'font-size', 'font-weight', 'visibility'])

export interface Finding {
  theme: Theme
  what: 'text' | 'large text' | 'placeholder' | 'icon' | 'field border'
  ratio: number
  need: number
  fg: string
  bg: string
  where: string
  text: string
}

export interface AuditOptions {
  theme: Theme
  width?: number
  /** For the mutation checks of the test: switch off one part of the engine. */
  without?: 'opacity' | 'color-mix' | 'ancestor-fill'
}

export function audit(root: Element, sheets: Sheet[], options: AuditOptions): { findings: Finding[]; elements: number; skipped: number; unresolved: string[] } {
  const { theme } = options
  /**
   * Each colour value the engine cannot read (a function it does not know, a `calc()` it cannot resolve). The
   * engine does NOT guess for them (it would draw the element on the wrong fill). It reports each one, and the screen
   * test expects none: a new kind of value turns the test red, not a silent pass.
   */
  const unresolved = new Set<string>()
  const unread = (el: Element, prop: string, value: string) => {
    if (options.without === undefined) unresolved.add(`${prop}: ${value} (${el.tagName.toLowerCase()}${el.classList.length > 0 ? `.${[...el.classList].join('.')}` : ''})`)
  }
  const rules = parseSheets(sheets, theme, options.width ?? 390)
  const byKey = new Map<string, Rule[]>()
  for (const r of rules) {
    const k = keyOf(r.selector)
    byKey.set(k, [...(byKey.get(k) ?? []), r])
  }
  let skipped = 0
  const cache = new Map<Element, Map<string | null, Map<string, Decl>>>()
  const matchesOf = (el: Element): Map<string | null, Map<string, Decl>> => {
    const hit = cache.get(el)
    if (hit) return hit
    const out = new Map<string | null, Map<string, Decl>>()
    const candidates = [...(byKey.get('*') ?? []), ...(byKey.get(el.tagName.toLowerCase()) ?? []), ...[...el.classList].flatMap((c) => byKey.get(`.${c}`) ?? [])]
    for (const r of candidates) {
      let ok = false
      try {
        ok = el.matches(r.selector)
      } catch {
        skipped++
      }
      if (!ok) continue
      const map = out.get(r.pseudo) ?? new Map<string, Decl>()
      for (const [prop, value] of r.decls) {
        const before = map.get(prop)
        if (before === undefined || r.spec > before.spec || (r.spec === before.spec && r.order > before.order)) map.set(prop, { prop, value, spec: r.spec, order: r.order })
      }
      out.set(r.pseudo, map)
    }
    // An inline style wins over the sheets.
    const inline = el.getAttribute('style')
    if (inline) {
      const map = out.get(null) ?? new Map<string, Decl>()
      for (const d of splitTop(inline, ';')) {
        const k = d.indexOf(':')
        if (k > 0) map.set(d.slice(0, k).trim().toLowerCase(), { prop: d.slice(0, k).trim(), value: d.slice(k + 1).trim(), spec: 1e9, order: 1e9 })
      }
      out.set(null, map)
    }
    cache.set(el, out)
    return out
  }

  const computedCache = new Map<Element, Computed>()
  const PAGE: Computed = { vars: new Map(), color: [0, 0, 0, 1], fontSize: 16, fontWeight: 400, hidden: false, own: new Map() }
  const compute = (el: Element, pseudo: string | null = null): Computed => {
    if (pseudo === null) {
      const hit = computedCache.get(el)
      if (hit) return hit
    }
    const parent = pseudo !== null ? compute(el) : el.parentElement ? compute(el.parentElement) : PAGE
    const decls = matchesOf(el).get(pseudo) ?? new Map<string, Decl>()
    const vars = new Map(parent.vars)
    for (const [prop, d] of decls) if (prop.startsWith('--')) vars.set(prop, substitute(d.value, vars))
    const own = new Map<string, string>()
    for (const [prop, d] of decls) if (!prop.startsWith('--')) own.set(prop, resolveCalc(substitute(d.value, vars)))
    let color = parent.color
    const c = own.get('color')
    if (c !== undefined && c !== 'inherit') {
      const parsed = options.without === 'color-mix' && /color-mix/.test(c) ? null : parseColour(c, parent.color)
      if (parsed !== null) color = parsed
      else if (c.trim() !== '' && !NOT_A_COLOUR.test(c.trim())) unread(el, pseudo ? `color${pseudo}` : 'color', c)
    }
    let fontSize = parent.fontSize
    const fs = own.get('font-size')
    if (fs) {
      const m = /^([\d.]+)(px|em|rem|%)$/.exec(fs)
      if (m) fontSize = m[2] === 'px' ? +m[1] : m[2] === 'rem' ? +m[1] * 16 : m[2] === '%' ? (parent.fontSize * +m[1]) / 100 : parent.fontSize * +m[1]
    }
    let fontWeight = parent.fontWeight
    const fw = own.get('font-weight')
    if (fw) fontWeight = fw === 'bold' ? 700 : fw === 'normal' ? 400 : Number.isNaN(+fw) ? fontWeight : +fw
    if (pseudo === null && /^(h[1-6]|strong|b|th)$/i.test(el.tagName) && !fw) fontWeight = 700
    const display = own.get('display')
    const clip = own.get('clip') ?? ''
    const hidden =
      parent.hidden ||
      display === 'none' ||
      own.get('visibility') === 'hidden' ||
      /rect\(0/.test(clip) ||
      (pseudo === null && ((el as HTMLElement).hidden === true || el.tagName === 'TEMPLATE' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE'))
    const out: Computed = { vars, color, fontSize, fontWeight, hidden, own }
    if (pseudo === null) computedCache.set(el, out)
    return out
  }

  const fillOf = (el: Element): RGBA => {
    const own = compute(el).own
    const v = own.get('background-color') ?? own.get('background')
    if (v === undefined || /^none\b/.test(v)) return [0, 0, 0, 0]
    if (options.without === 'color-mix' && /color-mix/.test(v)) return [0, 0, 0, 0]
    const fill = colourIn(v, compute(el).color)
    if (fill === null && COLOURISH.test(v)) unread(el, 'background', v)
    return fill ?? [0, 0, 0, 0]
  }
  const opacityOf = (el: Element) => {
    if (options.without === 'opacity') return 1
    const o = parseFloat(compute(el).own.get('opacity') ?? '1')
    return Number.isNaN(o) ? 1 : o
  }

  /** What lies under the content of `el` (its fill on all fills above it), and the `opacity` groups that fade it all. */
  const backdrop = (el: Element, withOwnFill = true): { under: RGBA; groups: { o: number; under: RGBA }[] } => {
    const chain: Element[] = []
    for (let n: Element | null = el; n !== null; n = n.parentElement) chain.unshift(n)
    let under: RGBA = [255, 255, 255, 1]
    const groups: { o: number; under: RGBA }[] = []
    for (const n of chain) {
      const o = opacityOf(n)
      if (o < 1) groups.push({ o, under })
      if (n === el && !withOwnFill) break
      if (options.without === 'ancestor-fill' && n !== el && n.parentElement !== null) continue
      const fill = fillOf(n)
      if (fill[3] > 0) under = over(fill, under)
    }
    return { under, groups }
  }
  const fade = (c: RGBA, groups: { o: number; under: RGBA }[]): RGBA => {
    let out = c
    for (let i = groups.length - 1; i >= 0; i--) {
      const { o, under } = groups[i]
      out = [out[0] * o + under[0] * (1 - o), out[1] * o + under[1] * (1 - o), out[2] * o + under[2] * (1 - o), 1]
    }
    return out
  }

  const findings: Finding[] = []
  const where = (el: Element) => {
    const path: string[] = []
    for (let n: Element | null = el; n !== null && path.length < 3; n = n.parentElement) path.unshift(n.tagName.toLowerCase() + (n.classList.length > 0 ? `.${[...n.classList].join('.')}` : ''))
    return path.join(' > ')
  }
  const check = (el: Element, what: Finding['what'], fgRaw: RGBA, text: string, outside = false) => {
    const { under, groups } = backdrop(el, !outside)
    const fg = fade(over(fgRaw, under), groups)
    const bg = fade(under, groups)
    const large = compute(el).fontSize >= 24 || (compute(el).fontSize >= 18.66 && compute(el).fontWeight >= 700)
    const need = what === 'icon' || what === 'field border' ? 3 : what === 'text' && large ? 3 : 4.5
    findings.push({ theme, what: what === 'text' && large ? 'large text' : what, ratio: ratio(fg, bg), need, fg: hexOf(fg), bg: hexOf(bg), where: where(el), text: text.slice(0, 40) })
  }
  const disabled = (el: Element) => el.closest('button:disabled, input:disabled, select:disabled, textarea:disabled, fieldset:disabled, [aria-disabled="true"]') !== null

  let elements = 0
  for (const el of root.querySelectorAll('*')) {
    const c = compute(el)
    if (c.hidden || disabled(el)) continue
    elements++
    const tag = el.tagName.toLowerCase()
    if (tag === 'input' || tag === 'textarea') {
      const input = el as HTMLInputElement
      if (input.type === 'checkbox' || input.type === 'radio' || input.type === 'hidden' || input.type === 'range') continue
      if (input.value !== '') check(el, 'text', c.color, input.type === 'password' ? '••••' : input.value)
      else if (input.placeholder) {
        const ph = compute(el, '::placeholder').own.get('color')
        // No colour of the phone's own: the browser's grey (Safari's is lighter than Chrome's #757575): fail.
        const colour = ph !== undefined ? parseColour(ph, c.color) : null
        if (ph !== undefined && colour === null && !NOT_A_COLOUR.test(ph.trim())) unread(el, 'color::placeholder', ph)
        check(el, 'placeholder', colour ?? [117, 117, 117, 0.6], input.placeholder)
      }
      const b = c.own.get('border-color') ?? c.own.get('border')
      if (b !== undefined && !/^(0|none)\b/.test(b) && !/\b0(px)?\s+(solid|none)\b|^none/.test(c.own.get('border') ?? '')) {
        const colour = colourIn(b, c.color)
        if (colour === null && COLOURISH.test(b)) unread(el, 'border', b)
        if (colour !== null && colour[3] > 0) check(el, 'field border', colour, input.placeholder || input.value, true)
      }
      continue
    }
    if (tag === 'svg') {
      if (el.closest('[aria-hidden="true"]') === null || el.parentElement?.textContent?.trim() === '') check(el, 'icon', c.color, 'svg')
      continue
    }
    if (el.closest('svg') !== null) continue
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim()
    if (own !== '') check(el, 'text', c.color, own)
    for (const pseudo of ['::before', '::after']) {
      const p = compute(el, pseudo)
      const content = p.own.get('content')
      if (content === undefined) continue
      const m = /^(["'])(.+)\1$/.exec(content.trim())
      if (m && m[2].trim() !== '' && !/^\\[0-9a-f]+\s*$/i.test(m[2])) check(el, 'text', p.color, m[2])
    }
  }
  return { findings, elements, skipped, unresolved: [...unresolved] }
}
