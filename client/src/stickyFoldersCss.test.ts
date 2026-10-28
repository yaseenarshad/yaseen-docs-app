import { describe, expect, it } from 'vitest'
import appCss from './app.css?inline'
import { TREE_ROW_H } from './sidebar/stickyFolders'

/** Every rule of a sheet, comments gone: each selector of its list, and its body. */
const rulesOf = (css: string): { selectors: string[]; body: string }[] =>
  [...css.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.split(',').map((s) => s.trim()), body }))

/** The rules inside the at-rule that `head` opens, and the sheet without that block. */
const block = (css: string, head: RegExp) => {
  const start = head.exec(css)?.index
  expect(start).toBeDefined()
  const open = css.indexOf('{', start)
  let depth = 0
  let end = open
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) {
      end = i + 1
      break
    }
  }
  return { inside: rulesOf(css.slice(open + 1, end - 1)), rest: rulesOf(css.slice(0, start) + css.slice(end)) }
}

describe('sticky folder rows CSS contract (YAZ-3440 D1, D2, D3, D10)', () => {
  const css = appCss.replace(/\/\*.*?\*\//gs, '')
  const stuck = block(css, /@container scroll-state\(stuck: top\) \{/)
  const rules = stuck.rest
  const bodies = (selector: string) => rules.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body)
  const STICKY = ".tree > li[aria-expanded='true'] > .tree__row--sticky"
  // The row's height, read from the sheet: 13px * 1.5 + 2 * 3px. The cap's script measures the same row (stickyFolders.ts).
  const row = bodies('.tree__row').find((b) => /line-height/.test(b)) ?? ''
  const rowHeight = Number(/font-size:\s*([\d.]+)px/.exec(row)?.[1]) * Number(/line-height:\s*([\d.]+);/.exec(row)?.[1]) + 2 * Number(/padding:\s*([\d.]+)px/.exec(row)?.[1])

  it("an open folder's row sticks one row per level below the list's top padding, the shallower row on top", () => {
    expect(rowHeight).toBe(TREE_ROW_H)
    const [sticky] = bodies(STICKY)
    expect(sticky).toMatch(/position:\s*sticky;/)
    // Chromium sticks below the padding, so `top` takes it back and the stack starts flush at the top edge (D10).
    expect(sticky).toMatch(new RegExp(`top:\\s*calc\\(var\\(--tree-depth, 0\\) \\* ${rowHeight}px - var\\(--sidebar-pad-top, 0px\\)\\);`))
    expect(sticky).toMatch(/z-index:\s*calc\(10 - var\(--tree-depth, 0\)\);/)
    const list = bodies('.sidebar__body').join('')
    expect(list).toMatch(/--sidebar-pad-top:\s*6px;/)
    expect(list).toMatch(/padding:\s*var\(--sidebar-pad-top\) /)
    // The stuck rows' z-index stays inside the list.
    expect(list).toMatch(/isolation:\s*isolate;/)
  })

  it('the stuck rows stand over the level lines and the thread, in both line styles (D10)', () => {
    // The deepest row that can stick is 6 levels deep (the cap is 7 levels), so the lowest stuck row is z 10 - 6 = 4.
    const lowest = 10 - 6
    const z = (selector: string) => Number(/z-index:\s*(-?\d+);/.exec(bodies(selector).join(''))?.[1])
    const THREAD = ".app[data-sidebar-line-style='thread']"
    const ON = `${THREAD}:not([data-sidebar-lines='off'])`
    // Thread: each nested level is its own stack at z 3; its grey line (z 1), thread pieces and coloured chevron (z 2) stay inside it.
    expect(z(`${THREAD} .tree[role='group']`)).toBe(3)
    expect(z(`${THREAD} .tree[role='group']::before`)).toBe(1)
    expect(z(`${ON} .sidebar__body .tree[role='group'] > li::before`)).toBe(2)
    expect(z(`${ON} .sidebar__body .tree > li[aria-expanded]:not([data-renaming])::after`)).toBe(2)
    expect(z(`${THREAD} .tree[role='group']`)).toBeLessThan(lowest)
    // Plain: the grey line and its level have no z-index, so every stuck row (z 4 and up) paints over them.
    expect(bodies(".tree[role='group']::before").join('')).not.toMatch(/z-index/)
    expect(bodies(".tree[role='group']").join('')).not.toMatch(/z-index/)
  })

  it('only while a row is stuck (`scroll-state(stuck: top)`) does an opaque block back it, with the thin line under it', () => {
    expect(bodies('.tree__row--sticky').join('')).toMatch(/container-type:\s*scroll-state;/)
    const [backing] = stuck.inside.filter((rule) => rule.selectors.includes('.tree__row--sticky::before')).map((rule) => rule.body)
    expect(backing).toMatch(/content:\s*'';/)
    expect(backing).toMatch(/position:\s*absolute;/)
    expect(backing).toMatch(/z-index:\s*-1;/)
    expect(backing).toMatch(/background:\s*var\(--bg-side\);/)
    expect(backing).toMatch(/box-shadow:\s*0 1px 0 var\(--border\);/)
    expect(backing).toMatch(/pointer-events:\s*none;/)
    // The side colour is opaque in each theme, so nothing shows through a stuck row.
    const sides = [...css.matchAll(/--bg-side:\s*([^;]+);/g)].map(([, value]) => value.trim())
    expect(sides.length).toBeGreaterThanOrEqual(2)
    for (const side of sides) expect(side).toMatch(/^#[0-9a-f]{6}$/i)
    // The block is the stuck state's alone: outside the query no rule gives a sticky row the side colour.
    expect(rules.filter((rule) => rule.selectors.some((s) => s.includes('.tree__row--sticky')) && /--bg-side/.test(rule.body))).toEqual([])
  })

  it('a row or li scrolled into view lands below the rows stuck above it, up to the cap (D2, D3)', () => {
    const margin = rules.filter((rule) => /scroll-margin-top/.test(rule.body))
    expect(margin.map((rule) => rule.selectors)).toEqual([['.tree__row', '.tree > li']])
    expect(margin[0].body).toMatch(new RegExp(`scroll-margin-top:\\s*calc\\(min\\(var\\(--tree-depth, 0\\), var\\(--sticky-levels, 7\\)\\) \\* ${rowHeight}px\\);`))
  })

  it('`data-sticky-levels` on the list stops each folder row N levels deep or more, and never more than 7 stick (D2)', () => {
    const groups = (n: number) => " .tree[role='group']".repeat(n)
    const tail = " li[aria-expanded='true'] > .tree__row--sticky"
    const stops = [...[0, 1, 2, 3, 4, 5, 6].map((n) => `.sidebar__body[data-sticky-levels='${n}']${groups(n)}${tail}`), `${groups(7).trim()}${tail}`]
    const statics = rules.filter((rule) => rule.selectors.some((s) => s.includes('.tree__row--sticky')) && /position:\s*static;/.test(rule.body))
    expect(statics.map((rule) => rule.selectors)).toEqual([stops])
    // The cap as a number, for `scroll-margin-top`.
    for (let n = 0; n <= 7; n++) expect(bodies(`.sidebar__body[data-sticky-levels='${n}']`).join('')).toMatch(new RegExp(`--sticky-levels:\\s*${n};`))
  })
})
