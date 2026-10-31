/**
 * The ten cell colours in `table.css` (YAZ-3817). jsdom paints nothing, so this holds each name of
 * `TABLE_COLORS` to its parts: a fill wash and a text colour in light and in dark, a solid swatch, and
 * its `[data-fill]` and `[data-color]` rules. A custom fill draws at `--table-fill-wash`, the wash
 * that a copy to Docs uses (`FILL_WASH`).
 */
import { describe, expect, it } from 'vitest'
import tableCss from './table.css?inline'
import { FILL_WASH } from './colours'
import { TABLE_COLORS } from './tableStyle'

const blocks = [...tableCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))
/** Every body of the rules with exactly `selector`, as one text. */
const bodyOf = (selector: string) => blocks.filter((b) => b.selector === selector).map((b) => b.body).join(';')
const declares = (selector: string, name: string) => new RegExp(`(^|[;{\\s])${name}\\s*:`).test(bodyOf(selector))
const CELL = '.milkdown .ProseMirror .milkdown-table-block :is(th, td)'

describe('the ten cell colours in table.css (YAZ-3817)', () => {
  it.each(TABLE_COLORS)('%s: a fill and a text colour in light and dark, a swatch, and its two rules', (c) => {
    for (const theme of [':root', "[data-theme='dark']"]) {
      expect(declares(theme, `--table-fill-${c}`), `${theme} --table-fill-${c}`).toBe(true)
      expect(declares(theme, `--table-text-${c}`), `${theme} --table-text-${c}`).toBe(true)
    }
    expect(declares(':root', `--table-fill-solid-${c}`)).toBe(true)
    expect(bodyOf(`${CELL}[data-fill='${c}']`)).toContain(`--table-cell-tint: var(--table-fill-${c})`)
    expect(bodyOf(`${CELL}[data-color='${c}']`)).toContain(`color: var(--table-text-${c})`)
  })

  it('a custom fill draws at the wash that a copy uses', () => {
    expect(bodyOf(':root')).toMatch(new RegExp(`--table-fill-wash:\\s*${FILL_WASH * 100}%;`))
    expect(bodyOf(`${CELL}[data-fill^='#']`)).toContain('color-mix(in srgb, var(--table-fill-custom) var(--table-fill-wash), transparent)')
  })
})
