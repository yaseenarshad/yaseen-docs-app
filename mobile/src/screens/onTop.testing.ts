import { readFileSync } from 'node:fs'

/**
 * YAZ-5497: IS AN OVERLAY ON TOP, AND WHOLE? jsdom draws nothing, so this reads the app's own stylesheets and walks the
 * CSS rules that paint an overlay (a sheet, a panel) that is `position: fixed` over the whole screen.
 *
 * A fixed overlay is on top of the page arrows and the tab bar, and whole, only when no element between it and the
 * frame (`.app`, which also holds the arrows and the tab bar) does one of these:
 *  - clips it: `mask-image` (the reader's soft fade at the bottom: the overlay is masked to the scroll box and faded),
 *    `clip-path`, `filter`, `backdrop-filter`;
 *  - holds it (a containing block for a fixed child: `inset: 0` is then that element, not the screen): `transform`,
 *    `perspective`, `filter`, `contain: paint | layout | strict | content`, `will-change: transform`;
 *  - shuts its `z-index` in (a stacking context of its own, painted in the page's place, under the arrows and the tab
 *    bar that come later): any of the above, `opacity` under 1, `isolation: isolate`, a positioned element with a
 *    `z-index`, `position: fixed | sticky`.
 * And the overlay paints over the arrows and the tab bar: its `z-index` is higher than theirs.
 */
const CSS = ['../styles.css', '../page/pageNav.css', '../page/find/pageTools.css', '../page/reader.css', '../page/properties/properties.css', '../page/properties/pageProperties.css']

interface Rule {
  selector: string
  decls: Map<string, string>
}
let rules: Rule[] = []

/**
 * The rules of a stylesheet that are not inside an at-rule (`@media` …), each with its declarations as written. Our
 * own small reader: jsdom's CSSOM drops a declaration with `calc()` or `env()` (the reader's mask, the home bar's room).
 */
export function readRules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Rule[] = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open < 0) break
    const head = text.slice(i, open).trim()
    // The block's end, at its own depth.
    let depth = 1
    let j = open + 1
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') depth--
      j++
    }
    const body = text.slice(open + 1, j - 1)
    if (!head.startsWith('@')) {
      const decls = new Map<string, string>()
      for (const part of body.split(/;(?![^(]*\))/)) {
        const colon = part.indexOf(':')
        if (colon > 0) decls.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).replace(/!important/, '').trim())
      }
      out.push({ selector: head, decls })
    }
    i = j
  }
  return out
}

/** The rules of one of the app's stylesheets, by its path from `src/screens/`. */
export const rulesOf = (file: string): Rule[] => readRules(readFileSync(new URL(file, import.meta.url), 'utf8'))

/** Loads the app's stylesheets (once). */
export function loadAppCss(): void {
  if (rules.length > 0) return
  rules = CSS.flatMap((file) => readRules(readFileSync(new URL(file, import.meta.url), 'utf8')))
}

/** The value of `name` from the last rule (outside `@media`) that matches `el`, or its inline style. */
export function declared(el: Element, name: string): string {
  let value = ''
  for (const rule of rules) {
    let hit = false
    try {
      hit = el.matches(rule.selector)
    } catch {
      hit = false // a selector jsdom cannot match (`::highlight`, `::-webkit-scrollbar`): not an element's
    }
    const v = hit ? rule.decls.get(name) : undefined
    if (v !== undefined) value = v
  }
  const inline = el instanceof HTMLElement ? el.style.getPropertyValue(name) : ''
  return inline !== '' ? inline : value
}

const z = (el: Element) => {
  const v = declared(el, 'z-index')
  return v === '' || v === 'auto' ? 0 : Number(v)
}

/** What an element between the overlay and the frame does to it, or null. */
function trap(el: Element): string | null {
  const has = (name: string, bad: (v: string) => boolean) => {
    const v = declared(el, name)
    return v !== '' && bad(v) ? `${name}: ${v}` : null
  }
  const notNone = (v: string) => v !== 'none'
  return (
    has('mask-image', notNone) ??
    has('-webkit-mask-image', notNone) ??
    has('clip-path', notNone) ??
    has('filter', notNone) ??
    has('backdrop-filter', notNone) ??
    has('transform', notNone) ??
    has('perspective', notNone) ??
    has('contain', (v) => /paint|layout|strict|content/.test(v)) ??
    has('will-change', (v) => /transform|filter|perspective/.test(v)) ??
    has('opacity', (v) => Number(v) < 1) ??
    has('isolation', (v) => v === 'isolate') ??
    has('position', (v) => v === 'fixed' || v === 'sticky') ??
    (/relative|absolute/.test(declared(el, 'position')) && declared(el, 'z-index') !== '' && declared(el, 'z-index') !== 'auto' ? `z-index: ${declared(el, 'z-index')} (positioned)` : null)
  )
}

/** The element's name for a message: its tag and classes. */
const nameOf = (el: Element) => `${el.tagName.toLowerCase()}${[...el.classList].map((c) => `.${c}`).join('')}`

/**
 * Why `overlay` is NOT whole and on top of the arrows and the tab bar of its frame ([] when it is): each element
 * between it and the frame that clips it, holds it or shuts its z-index in; a bar at the bottom that paints over it.
 */
export function onTopProblems(overlay: Element): string[] {
  const problems: string[] = []
  const frame = overlay.closest('.app') ?? overlay.ownerDocument.querySelector('.app')
  if (frame === null) return ['no frame (.app)']
  if (declared(overlay, 'position') !== 'fixed') problems.push(`${nameOf(overlay)} is not position: fixed`)
  if (!frame.contains(overlay)) {
    // Outside the frame (in `document.body`): only the body's own children are between.
    for (let el = overlay.parentElement; el !== null && el !== overlay.ownerDocument.body; el = el.parentElement) {
      const why = trap(el)
      if (why !== null) problems.push(`${nameOf(el)} (${why})`)
    }
  } else {
    for (let el = overlay.parentElement; el !== null && el !== frame; el = el.parentElement) {
      const why = trap(el)
      if (why !== null) problems.push(`${nameOf(el)} (${why})`)
    }
  }
  for (const bar of frame.querySelectorAll('.page-arrows, .tabbar')) {
    // A bar is painted over the overlay when the overlay is shut in, or when its z-index is as high.
    if (z(bar) >= z(overlay) && /relative|absolute|fixed|sticky/.test(declared(bar, 'position'))) problems.push(`${nameOf(bar)} paints over it (z-index ${z(bar)})`)
  }
  return problems
}
