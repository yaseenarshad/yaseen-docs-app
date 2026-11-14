import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 4B's stylesheet (jsdom has no layout, so the rules are read here): the buttons stay in reach while a long card
 * scrolls, they are big for a thumb, and the three tokens the Mac's card styles read have the Mac's values.
 */
const css = readFileSync(new URL('./review.css', import.meta.url), 'utf8')
const mac = readFileSync(new URL('../../../client/src/app.css', import.meta.url), 'utf8')
const tokens = (block: string) => Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
const blockAfter = (text: string, start: string) => {
  const from = text.indexOf(start)
  let depth = 0
  for (let i = text.indexOf('{', from); i < text.length; i++) {
    if (text[i] === '{') depth++
    if (text[i] === '}' && --depth === 0) return text.slice(from, i + 1)
  }
  throw new Error(`no block after ${start}`)
}

describe('the Review tab styles', () => {
  it('the dock with the answer buttons sticks to the bottom of the screen while a long card scrolls', () => {
    expect(css).toMatch(/\.review__dock \{[^}]*position: sticky;[^}]*bottom: -24px;/)
  })

  it('YAZ-5298: a sound player is as wide as its parts, not the whole card, so the middle of a short card is free', () => {
    expect(css).toMatch(/\.review__card \.card__audio \{[^}]*display: inline-flex;/)
  })

  it('YAZ-5299: the card ID never breaks over two lines', () => {
    expect(css).toMatch(/\.review__id \{[^}]*white-space: nowrap;/)
  })

  it('the answer buttons and ⋯ are big for a thumb (56 px; Apple asks 44 pt)', () => {
    expect(css).toMatch(/\.review__answer \{[^}]*min-height: 56px;/)
    expect(css).toMatch(/\.review__more \{[^}]*min-width: 56px;[^}]*min-height: 56px;/)
  })

  it('YAZ-5234: the lost line and the fix line are 4.5:1 or more, light and dark', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
    const phone = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    const light = tokens(blockAfter(css, ':root {'))['--review-warn-text']
    const phoneTokens = tokens(blockAfter(phone, ':root {'))
    const phoneDark = tokens(blockAfter(phone, '@media (prefers-color-scheme: dark)'))
    expect(ratio(light, phoneTokens['--bg'])).toBeGreaterThanOrEqual(4.5)
    expect(ratio(light, phoneTokens['--bg-side'])).toBeGreaterThanOrEqual(4.5)
    expect(tokens(blockAfter(css, '@media (prefers-color-scheme: dark)'))['--review-warn-text']).toBe('var(--warn)')
    expect(ratio(phoneDark['--warn'], phoneDark['--bg'])).toBeGreaterThanOrEqual(4.5)
    expect(css).toMatch(/\.review__lost-title \{[^}]*color: var\(--review-warn-text\);/)
  })

  it('YAZ-5233: Undo and a sound\'s play button are 44 pt', () => {
    expect(css).toMatch(/\.review__undo \{[^}]*min-width: var\(--tap\);/)
    expect(css).toMatch(/\.review__card \.card__audio-play \{[^}]*min-width: var\(--tap\);[^}]*min-height: var\(--tap\);/)
  })

  it("the card styles' tokens have the Mac's values, light and dark", () => {
    const light = tokens(blockAfter(css, ':root {'))
    const dark = tokens(blockAfter(css, '@media (prefers-color-scheme: dark)'))
    const macLight = tokens(blockAfter(mac, ':root {'))
    const macDark = tokens(blockAfter(mac, "[data-theme='dark'] {"))
    for (const name of ['--bg-hover', '--next-hidden', '--mark-bg']) expect([name, light[name]]).toEqual([name, macLight[name]])
    for (const name of ['--bg-hover', '--next-hidden']) expect([name, dark[name]]).toEqual([name, macDark[name]])
  })

  it('YAZ-5231: at 320 px the row fits: the answers can shrink, lose their icons, and ⋯ is 44 pt', () => {
    expect(css).toMatch(/\.review__answer \{\s*min-width: 0;\s*\}/)
    const narrow = css.slice(css.indexOf('@media (max-width: 374px)'))
    expect(narrow).toMatch(/\.review__answer svg \{\s*display: none;/)
    expect(narrow).toMatch(/\.review__more \{\s*min-width: var\(--tap\);/)
  })

  it('YAZ-5267: the kept box fills the screen by flex (no percent of a parent with no height): the buttons sit at the bottom', () => {
    expect(css).toMatch(/\.review-slot,\s*\.review-host \{[^}]*display: flex;[^}]*flex-direction: column;/)
    expect(css).toMatch(/\.review-slot \{\s*min-height: 100%;/)
    expect(css).toMatch(/\.review-host,\s*\.review-host > \.review \{\s*flex: 1 0 auto;/)
    expect(css).not.toMatch(/\.review-host \{[^}]*min-height: 100%/)
    expect(css).toMatch(/\.review__dock \{[^}]*margin: auto -16px -24px;/)
  })

  it("YAZ-5317, YAZ-5333: a sound's progress bar is no tap target on Review: no enlarged box over the card", () => {
    expect(css).not.toMatch(/\.card__audio-bar \{[^}]*padding: 20px/)
    expect(css).not.toMatch(/\.card__audio-bar \{[^}]*margin: -20px/)
  })

  it('YAZ-5313: while "A new version is ready." shows, the dock keeps room above it (no overlap with Undo or the buttons)', () => {
    expect(css).toMatch(/#root:has\(> \.update-line\) \{\s*--update-room: 72px;/)
    expect(css).toMatch(/\.review__dock \{\s*bottom: calc\(var\(--update-room, 0px\) - 24px\);\s*margin-bottom: calc\(var\(--update-room, 0px\) - 24px\);/)
  })
})
