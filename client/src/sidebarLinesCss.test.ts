import { describe, expect, it } from 'vitest'
import appCss from './app.css?inline'

/** Every rule of a sheet, comments gone: each selector of its list, and its body. */
const rulesOf = (css: string): { selectors: string[]; body: string }[] =>
  [...css.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.split(',').map((s) => s.trim()), body }))

describe('sidebar level lines CSS contract (YAZ-3309 D1, D3, D5)', () => {
  const rules = rulesOf(appCss)
  const LINE = ".tree[role='group']::before"

  it('one 1px grey line on each nested level of the tree, below the chevron of its folder, hidden until a gate shows it, and no target for the mouse', () => {
    const line = rules.filter((rule) => rule.selectors.includes(LINE))
    expect(line).toHaveLength(1)
    const [{ body }] = line
    expect(body).toMatch(/content:\s*'';/)
    expect(body).toMatch(/position:\s*absolute;/)
    expect(body).toMatch(/top:\s*0;/)
    expect(body).toMatch(/bottom:\s*0;/)
    // A row's indent is 8 + depth * 14 px and its chevron 14 px wide: depth * 14 + 1 is the chevron's centre.
    expect(body).toMatch(/left:\s*calc\(var\(--tree-depth\) \* 14px \+ 1px\);/)
    expect(body).toMatch(/width:\s*1px;/)
    expect(body).toMatch(/background:\s*var\(--border\);/)
    expect(body).toMatch(/opacity:\s*0;/)
    expect(body).toMatch(/transition:\s*opacity 160ms ease;/)
    expect(body).toMatch(/pointer-events:\s*none;/)
    expect(rules.find((rule) => rule.selectors.includes(".tree[role='group']"))?.body).toMatch(/position:\s*relative;/)
  })

  it('`data-sidebar-lines` on `.app` gates it: always; while the mouse is over the list or a row has keyboard focus; `off` has no rule', () => {
    const gated = rules.filter((rule) => rule.selectors.some((s) => s.includes('data-sidebar-lines')))
    expect(gated).toHaveLength(1)
    expect(gated[0].selectors).toEqual([
      `.app[data-sidebar-lines='always'] ${LINE}`,
      `.app[data-sidebar-lines='hover'] .sidebar__body:hover ${LINE}`,
      `.app[data-sidebar-lines='hover'] .sidebar__body:has(.tree__row:focus-visible) ${LINE}`,
    ])
    expect(gated[0].body.trim()).toBe('opacity: 1;')
    expect(appCss).not.toMatch(/data-sidebar-lines='off'/)
  })

  it('Recents and Sessions nest a `.tree` with no role: no rule draws on a `.tree` inside a `.tree` (D4)', () => {
    for (const { selectors } of rules) for (const selector of selectors) expect(selector, selector).not.toMatch(/\.tree\s+\.tree/)
  })
})
