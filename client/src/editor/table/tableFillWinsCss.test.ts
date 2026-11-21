/**
 * YAZ-5938: a cell's own fill wins over the stripes, the header shade and the subheader shade on the page. Each of
 * those rules sets the cell's `--table-cell-tint`, and the fill rules come after them (`table.css`: "Order matters at
 * equal weight"). Order decides only at equal weight, so no rule before the fills may be heavier than they are. A
 * stripes rule was heavier (5 classes against 4), so a fill on a striped row (row 3, 5, …) did not show; a card's
 * table, drawn by `cardTable.css` alone, showed it.
 */
import { describe, expect, it } from 'vitest'
import cardTableCss from './cardTable.css?inline'
import editorTableCss from './table.css?inline'

/** The Mac's table look as it loads: `cardTable.css`, then `table.css` (`tableStyle.ts`). */
const css = (cardTableCss + editorTableCss).replace(/\/\*[\s\S]*?\*\//g, '')

/** Splits at top-level commas (not inside brackets). */
function splitTop(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let at = 0
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      out.push(list.slice(at, i))
      at = i + 1
    }
  }
  out.push(list.slice(at))
  return out.map((s) => s.trim()).filter((s) => s !== '')
}

type Spec = [number, number, number]
const add = (a: Spec, b: Spec): Spec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const more = (a: Spec, b: Spec) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]

/** The specificity of one complex selector (Selectors 4: `:where` 0, `:is` / `:not` its heaviest argument). */
function specificity(sel: string): Spec {
  let s: Spec = [0, 0, 0]
  let i = 0
  while (i < sel.length) {
    const c = sel[i]
    if (c === ':') {
      const m = /^::?([a-z-]+)(\()?/.exec(sel.slice(i))!
      i += m[0].length
      if (m[2] === undefined) {
        s = add(s, m[0].startsWith('::') ? [0, 0, 1] : [0, 1, 0])
        continue
      }
      let depth = 1
      const from = i
      while (depth > 0) {
        if (sel[i] === '(') depth++
        else if (sel[i] === ')') depth--
        i++
      }
      const inner = sel.slice(from, i - 1)
      if (m[1] === 'where') continue
      if (m[1] === 'is' || m[1] === 'not' || m[1] === 'has') {
        s = add(s, splitTop(inner).map(specificity).reduce((a, b) => (more(b, a) ? b : a), [0, 0, 0] as Spec))
      } else s = add(s, [0, 1, 0]) // :nth-child(…) and its kind
    } else if (c === '[') {
      i = sel.indexOf(']', i) + 1
      s = add(s, [0, 1, 0])
    } else if (c === '.') {
      i += /^\.[\w-]+/.exec(sel.slice(i))![0].length
      s = add(s, [0, 1, 0])
    } else if (c === '#') {
      i += /^#[\w-]+/.exec(sel.slice(i))![0].length
      s = add(s, [1, 0, 0])
    } else if (/[a-z]/i.test(c)) {
      i += /^[\w-]+/.exec(sel.slice(i))![0].length
      s = add(s, [0, 0, 1])
    } else i++
  }
  return s
}

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: splitTop(selector.trim()), body }))
const tints = rules.filter((r) => /(^|[;\s])--table-cell-tint\s*:/.test(r.body))
const isFill = (sel: string) => sel.includes('[data-fill')

describe('YAZ-5938: a cell\'s own fill wins on the page', () => {
  it('the helper weighs as the browser does', () => {
    expect(specificity('.milkdown .ProseMirror :is(.milkdown-table-block, .super-view) :is(th, td)[data-fill^=\'#\']')).toEqual([0, 4, 1])
    expect(specificity('.a:where(.b .c) > td')).toEqual([0, 1, 1])
    expect(specificity('.a[x]:not([y]) :where(tr:nth-child(2n + 3)) > td')).toEqual([0, 3, 1])
  })

  it('every rule that tints a cell before the fills is no heavier than a fill, so the fill (later) wins: stripes, header, subheader', () => {
    const fills = tints.flatMap((r) => r.selectors).filter(isFill)
    expect(fills.length).toBeGreaterThanOrEqual(11)
    const fill = fills.map(specificity).reduce((a, b) => (more(a, b) ? b : a))
    const firstFill = tints.findIndex((r) => r.selectors.some(isFill))
    const heavier = tints
      .slice(0, firstFill)
      .flatMap((r) => r.selectors)
      .filter((sel) => /\b(td|th)\b/.test(sel) && more(specificity(sel), fill))
    expect(heavier).toEqual([])
  })
})
