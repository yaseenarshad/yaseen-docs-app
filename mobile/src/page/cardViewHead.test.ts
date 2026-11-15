import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** YAZ-5299: the card view's head (jsdom has no layout, so the rule is read here). */
const css = readFileSync(new URL('./reader.css', import.meta.url), 'utf8')

describe('the card view head', () => {
  it('the card ID ("NC-48") never breaks over two lines; the title wraps', () => {
    expect(css).toMatch(/\.card-view__id \{[^}]*white-space: nowrap;/)
    expect(css).not.toMatch(/\.reader__title \{[^}]*white-space: nowrap;/)
  })
})

describe('the title band (YAZ-5437)', () => {
  it("is the Mac's: its colour token in light and dark, Default title size (1.125× the card text)", () => {
    expect(css).toMatch(/--card-title-band: #ededf0/)
    expect(css).toMatch(/prefers-color-scheme: dark[\s\S]*--card-title-band: #2d2d30/)
    const card = readFileSync(new URL('../../../client/src/editor/card/card.css', import.meta.url), 'utf8')
    expect(card).toMatch(/\.card-band \{[^}]*font-size: var\(--card-title-size, calc\(1em \* 1\.125\)\)/)
  })
})
