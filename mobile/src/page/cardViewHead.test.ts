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
