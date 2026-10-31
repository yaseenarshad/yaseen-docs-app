/**
 * The frozen table's borders (YAZ-3788). jsdom paints nothing, so this holds the rules to the contract
 * in words. With `border-collapse: collapse` the TABLE paints each border, at the rows' first place,
 * and a cell's background stops inside it: the moved rows leave a band of the border's width at each
 * edge, and the rows under them show through it. So a frozen table separates its borders, and each
 * cell draws its own bottom and right border over its own solid background (its first row and its
 * first column also the top and left), and outranks prosemirror-tables' `collapse`. Its `overflow: clip`
 * replaces their `hidden`: `hidden` made the table the sticky cells' scroll box, so the frozen columns
 * never stuck in the block's sideways scroll.
 */
import { describe, expect, it } from 'vitest'
import tableCss from './table.css?inline'
import tablesCss from '@milkdown/kit/prose/tables/style/tables.css?inline'

const rules = (css: string) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    // A comma inside `:is(…)` does not split the list.
    selectors: sel.split(/,(?![^(]*\))/).map((s) => s.trim()),
    body: body.replace(/\s+/g, ' ').trim(),
  }))

/** Classes, attributes and pseudo-classes: the middle column of a selector's weight. */
const weight = (selector: string) => (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length

const FROZEN = '.milkdown .ProseMirror .milkdown-table-block[data-table-frozen]'
const bodyOf = (selector: string) => rules(tableCss).find(({ selectors }) => selectors.includes(selector))?.body

describe('a frozen table draws its borders cell by cell (YAZ-3788)', () => {
  it('separates the borders, over prosemirror-tables\' `collapse`; clips with no scroll box, so the columns stick in the block', () => {
    expect(bodyOf(`${FROZEN} table`)).toBe('border-collapse: separate; border-spacing: 0; overflow: clip;')
    const collapse = rules(tablesCss).find(({ body }) => /border-collapse:\s*collapse/.test(body))!
    expect(weight(`${FROZEN} table`)).toBeGreaterThan(Math.max(...collapse.selectors.map(weight)))
  })

  it('each cell draws its bottom and right border; the first row and the first column also the top and left', () => {
    expect(bodyOf(`${FROZEN} :is(th, td)`)).toBe('border-top-width: 0; border-left-width: 0;')
    expect(bodyOf(`${FROZEN} tr:first-child > *`)).toBe('border-top-width: var(--table-border-width, 1px);')
    expect(bodyOf(`${FROZEN} tr > :first-child`)).toBe('border-left-width: var(--table-border-width, 1px);')
  })

  it('a frozen cell paints the page colour under its border too', () => {
    const paint = rules(tableCss).find(({ selectors }) => selectors.some((s) => s.includes('.table-frozen-row > *')))!
    expect(paint.body).toContain('background-color: var(--bg);')
    expect(paint.body).not.toContain('background-clip')
  })
})

describe('a frozen column sticks only while its block scrolls sideways (YAZ-3790)', () => {
  it('one sticky rule, under `data-table-scrolls`: 1,000 sticky cells cost ~2 ms a key', () => {
    const sticky = rules(tableCss).filter(({ body }) => /position:\s*sticky/.test(body)).flatMap(({ selectors }) => selectors)
    expect(sticky).toEqual(['.milkdown .ProseMirror .milkdown-table-block[data-table-scrolls] :is(th, td).table-frozen-col'])
  })

  it('a frozen column cell stacks (`z-index`) only while it sticks: 1,000 stacked cells cost ~4 ms of paint work a scroll (YAZ-3792)', () => {
    const stacked = rules(tableCss).filter(({ selectors, body }) => /z-index/.test(body) && selectors.some((s) => s.includes('table-frozen-col'))).flatMap(({ selectors }) => selectors)
    expect(stacked).toEqual(['.milkdown .ProseMirror .milkdown-table-block[data-table-scrolls] :is(th, td).table-frozen-col'])
  })
})
