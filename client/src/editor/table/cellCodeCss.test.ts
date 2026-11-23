/**
 * Long code in a cell (YAZ-5683). Crepe draws inline code as an `inline-block` (`.milkdown .ProseMirror code`): a box
 * as wide as its longest unbreakable run, so a path with no spaces (`/Applications/…/app.asar`) stayed one line and
 * ran over the next column, in a fixed-layout table (every page table, and a card's sized one). Plain text never did:
 * ProseMirror's `word-wrap: break-word` breaks a word that does not fit. jsdom paints nothing, so this holds the rules
 * to the contract; the headless pictures (the Mac's table render, the phone's `proveLayout` `page-cell-code`) measure it.
 */
import { describe, expect, it } from 'vitest'
import cardCss from '../card/card.css?inline'
import cardTableCss from './cardTable.css?inline'
import editorTableCss from './table.css?inline'
import crepeResetCss from '@milkdown/crepe/theme/common/reset.css?inline'
import phoneTablesCss from '../../../../mobile/src/page/tables.css?inline'

const rules = (css: string) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    selectors: sel.split(/,(?![^(]*\))/).map((s) => s.trim()),
    body: body.replace(/\s+/g, ' ').trim(),
  }))
/** Classes, attributes and pseudo-classes: the middle column of a selector's weight. */
const weight = (selector: string) => (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:|is\()[\w-]+/g) ?? []).length
const bodyOf = (css: string, selector: string) => rules(css).find(({ selectors }) => selectors.includes(selector))?.body

const PAGE_CODE = '.milkdown .ProseMirror .milkdown-table-block :is(th, td) code'
const CARD_CODE = '.card__sides .card__side :is(th, td) code'

describe('inline code in a cell wraps inside its cell (YAZ-5683)', () => {
  it("is inline in a page table's cell and in a card's, over Crepe's inline-block, its background on each line", () => {
    const crepe = rules(crepeResetCss).find(({ selectors }) => selectors.includes('.milkdown .ProseMirror code'))!
    expect(crepe.body).toContain('display: inline-block;')
    const body = 'display: inline; -webkit-box-decoration-break: clone; box-decoration-break: clone;'
    // One rule for both (cardTable.css: a rule a page table and a card share is one rule).
    expect(bodyOf(cardTableCss, PAGE_CODE)).toBe(body)
    expect(bodyOf(cardTableCss, CARD_CODE)).toBe(body)
    expect(weight(PAGE_CODE)).toBeGreaterThan(weight('.milkdown .ProseMirror code'))
    // The page's own table rules never set it back.
    expect(rules(editorTableCss).filter(({ selectors, body }) => selectors.some((s) => / code$/.test(s)) && /display/.test(body))).toEqual([])
  })

  it("a card's sized table (a fixed layout, as the page's) breaks a word longer than its column; an unsized one keeps words whole", () => {
    expect(bodyOf(cardCss, '.card__sides .card__side table[data-sized] :is(th, td)')).toBe('overflow-wrap: break-word;')
    expect(bodyOf(cardCss, '.card__sides .card__side :is(th, td)')).toContain('overflow-wrap: normal;')
    // The phone's Review keeps its words whole only where the table sizes itself.
    expect(bodyOf(phoneTablesCss, '.review__card .card__sides .card__table table:not([data-sized]) :is(th, td)')).toBe('overflow-wrap: normal;')
  })
})
