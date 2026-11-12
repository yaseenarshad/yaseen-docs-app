/** The look of "Show IDs in the title" and "in the files list" (YAZ-4940 part 2), read from the sheet. */
import { describe, expect, it } from 'vitest'
import appCss from './app.css?inline'

const rulesOf = (css: string): { selectors: string[]; body: string }[] =>
  [...css.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.split(',').map((s) => s.trim()), body }))
const rules = rulesOf(appCss)
const body = (selector: string) => rules.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body).join('\n')

describe('the ID after the title', () => {
  it('the title box wraps its two items on one line, baseline to baseline: a long title sends the ID to the next line by itself', () => {
    const box = body('.page-title')
    expect(box).toMatch(/display:\s*flex;/)
    expect(box).toMatch(/flex-wrap:\s*wrap;/)
    expect(box).toMatch(/align-items:\s*baseline;/)
  })

  it('the ID is small and muted, never shrinks, and is no part of a selection of the title', () => {
    const id = body('.page-title__id')
    expect(id).toMatch(/flex:\s*none;/)
    expect(id).toMatch(/font-size:\s*12px;/)
    expect(id).toMatch(/font-weight:\s*400;/)
    expect(id).toMatch(/color:\s*var\(--fg-muted\);/)
    expect(id).toMatch(/user-select:\s*none;/)
    expect(id).toMatch(/cursor:\s*pointer;/)
  })
})

describe('the ID at the right end of a files-list row', () => {
  it('sits at the right end, never shrinks, and the name (the label\'s ellipsis) gives way first', () => {
    const id = body('.tree__id')
    expect(id).toMatch(/flex:\s*none;/)
    expect(id).toMatch(/margin-left:\s*auto;/)
    expect(id).toMatch(/white-space:\s*nowrap;/)
    expect(id).toMatch(/font-size:\s*10px;/)
    const label = body('.tree__label')
    expect(label).toMatch(/overflow:\s*hidden;/)
    expect(label).toMatch(/text-overflow:\s*ellipsis;/)
    expect(label).toMatch(/white-space:\s*nowrap;/)
  })

  it('a long name never pushes the ID (or the date) out: the row lays its items out in one line, the label is the one item that shrinks, and the ID and the date keep their width', () => {
    const row = body('.tree__row')
    expect(row).toMatch(/display:\s*flex;/)
    expect(row).not.toMatch(/flex-wrap:\s*wrap;/)
    const label = body('.tree__label')
    // The label may shrink to nothing: `min-width: 0` (its overflow alone allows it too), and nothing stops its shrink.
    expect(label).toMatch(/min-width:\s*0;/)
    expect(label).not.toMatch(/flex(-shrink)?:\s*(none|0)\b/)
    expect(body('.tree__id')).toMatch(/flex:\s*none;/)
    expect(body('.tree__date')).toMatch(/flex:\s*none;/)
  })

  it('the ID is muted, with digits of one width ("#5" and "#12" line up at the right end)', () => {
    const id = body('.tree__id')
    expect(id).toMatch(/font-variant-numeric:\s*tabular-nums;/)
    expect(id).toMatch(/color:\s*color-mix\(in srgb, var\(--fg-muted\)/)
  })

  it('after a vault tag the ID gives up its own push, and a date after the ID does the same: one column at the right end', () => {
    expect(body('.tree__vault + .tree__id')).toMatch(/margin-left:\s*0;/)
    expect(body('.tree__id + .tree__date')).toMatch(/margin-left:\s*0;/)
  })
})
