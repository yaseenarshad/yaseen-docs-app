/**
 * YAZ-4896: a Super view's Sort, Group and Filter panels sit above the view's sticky column header, and each rule row
 * fits in its panel. jsdom paints nothing, so this holds the rules to the contract in words; the checker measures it
 * on screen.
 *
 * - THE ORDER: the bar (`table.css`) and the view's `thead th` (`superTable.css`) are in the same stacking context,
 *   and the header comes later in the page. So the bar needs a HIGHER `z-index` than the header, not an equal one.
 * - THE ROW: a rule row is a grid (as the folder pages' Sort menu), so the column pickers keep a width and "×" has its
 *   own last column. As a flex row the pickers shrank to 0 px and the order button took the row's full width, so "×"
 *   stood outside the panel.
 */
import { describe, expect, it } from 'vitest'
import tableCss from '../table.css?inline'
import superCss from './superTable.css?inline'

const rules = (css: string) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    selectors: sel.split(/,(?![^(]*\))/).map((s) => s.trim()),
    body: body.replace(/\s+/g, ' ').trim(),
  }))

/** The value of `prop` in the last rule that names `selector` and sets it. */
const decl = (css: string, selector: string, prop: string): string | undefined =>
  rules(css)
    .filter(({ selectors }) => selectors.includes(selector))
    .map(({ body }) => body.match(new RegExp(`(?:^|; )${prop}: ([^;]+);`))?.[1])
    .filter((value) => value !== undefined)
    .at(-1)

describe('YAZ-4896: the Super panels open above the view', () => {
  it('the bar (and so its panels) paints above the sticky column header and the group headers', () => {
    const bar = Number(decl(tableCss, '.milkdown .ProseMirror .table-zoom-anchor > .table-super-bar', 'z-index'))
    const head = Number(decl(superCss, '.super-view thead th', 'z-index'))
    const group = Number(decl(superCss, '.super-view .super-view__group > td', 'z-index'))
    expect(bar).toBeGreaterThan(head)
    expect(bar).toBeGreaterThan(group)
  })

  it('a rule row is a grid with "×" in its last column; the pickers keep a width', () => {
    expect(decl(superCss, '.super-menu .view-rule__main', 'display')).toBe('grid')
    expect(decl(superCss, '.super-menu .view-rule__remove', 'grid-column')).toBe('-2')
    expect(decl(superCss, '.super-menu .column-picker', 'display')).toBe('contents')
    for (const panel of ['sort', 'group', 'filter']) expect(decl(superCss, `.super-menu--${panel} .view-rule__main`, 'grid-template-columns')).toMatch(/minmax\(0, 1fr\)/)
    expect(decl(superCss, '.super-menu--rules', 'width')).toBeDefined()
  })
})

describe('YAZ-4834 P21: the view\'s column header wears the header row look', () => {
  it('`.super-view thead th` reads the `--table-header-*` variables, and table.css sets them from `data-table-header-*` on `.super-view`', () => {
    const body = decl(superCss, '.super-view thead th', 'font-weight')
    expect(body).toContain('var(--table-header-weight')
    expect(decl(superCss, '.super-view thead th', '--table-cell-tint')).toContain('var(--table-header-hue')
    expect(decl(superCss, '.super-view thead th', 'color')).toContain('var(--table-header-ink')
    expect(tableCss).toMatch(/:is\([^)]*\.super-view\)\[data-table-header-color='blue'\]/)
  })
})
