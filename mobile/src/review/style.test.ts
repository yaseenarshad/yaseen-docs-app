import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 4B's stylesheet (jsdom has no layout, so the rules are read here): the buttons stay in reach while a long card
 * scrolls, they are big for a thumb, and the three tokens the Mac's card styles read have the Mac's values.
 */
// YAZ-5363: the Review tab's place and its waiting state are in `screens/reviewSlot.css` (the first load draws them).
const css = readFileSync(new URL('./review.css', import.meta.url), 'utf8') + readFileSync(new URL('../screens/reviewSlot.css', import.meta.url), 'utf8')
const app = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
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
  it('YAZ-5415: the controls stay at the bottom while a long card scrolls: the screen never scrolls, the card does (no scroll bar)', () => {
    expect(app).toMatch(/\.screen--review \{[^}]*padding: 0;[^}]*overflow: hidden;/)
    expect(css).toMatch(/\.review__card \{[^}]*flex: 1 1 0;[^}]*min-height: 0;[^}]*overflow-y: auto;[^}]*scrollbar-width: none;/)
    expect(css).toMatch(/\.review__card::-webkit-scrollbar \{\s*display: none;/)
    expect(css).toMatch(/\.review__dock \{[^}]*flex: none;/)
  })

  it('YAZ-5298: a sound player is as wide as its parts, not the whole card, so the middle of a short card is free', () => {
    expect(css).toMatch(/\.review__card \.card__audio \{[^}]*display: inline-flex;/)
  })

  it('YAZ-5299: the card ID never breaks over two lines', () => {
    expect(css).toMatch(/\.review__id \{[^}]*white-space: nowrap;/)
  })

  it('YAZ-5415: ✕ and ✓ are round 58 px, 14 px apart; ← → ⋯ are 44 pt (Apple asks 44 pt)', () => {
    expect(css).toMatch(/\.review__answer \{[^}]*width: 58px;[^}]*height: 58px;[^}]*border-radius: 50%;/)
    expect(css).toMatch(/\.review__answers \{[^}]*gap: 14px;/)
    expect(css).toMatch(/\.review__arrow \{[^}]*width: var\(--tap\);[^}]*height: var\(--tap\);/)
    expect(css).toMatch(/\.review__answers\[data-count='4'\] \.review__answer \{[^}]*width: var\(--tap\);[^}]*height: var\(--tap\);/)
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
    const phoneDark = tokens(blockAfter(phone, ":root:where([data-scheme='dark'])"))
    expect(ratio(light, phoneTokens['--bg'])).toBeGreaterThanOrEqual(4.5)
    expect(ratio(light, phoneTokens['--bg-side'])).toBeGreaterThanOrEqual(4.5)
    expect(tokens(blockAfter(css, ":root:where([data-scheme='dark'])"))['--review-warn-text']).toBe('var(--warn)')
    expect(ratio(phoneDark['--warn'], phoneDark['--bg'])).toBeGreaterThanOrEqual(4.5)
    expect(css).toMatch(/\.review__lost-title \{[^}]*color: var\(--review-warn-text\);/)
  })

  it('YAZ-5233: Undo and a sound\'s play button are 44 pt', () => {
    // The quiet "Undo" (26 px to the eye) takes a 44 pt tap: its box reaches 9 px over and under it.
    expect(css).toMatch(/\.review__undo \{[^}]*height: 26px;/)
    expect(css).toMatch(/\.review__undo::after \{[^}]*inset: -9px -4px;/)
    expect(css).toMatch(/\.review__card \.card__audio-play \{[^}]*min-width: var\(--tap\);[^}]*min-height: var\(--tap\);/)
  })

  it("the card styles' tokens have the Mac's values, light and dark", () => {
    const light = tokens(blockAfter(css, ':root {'))
    const dark = tokens(blockAfter(css, ":root:where([data-scheme='dark'])"))
    const macLight = tokens(blockAfter(mac, ':root {'))
    const macDark = tokens(blockAfter(mac, "[data-theme='dark'] {"))
    for (const name of ['--bg-hover', '--next-hidden', '--mark-bg']) expect([name, light[name]]).toEqual([name, macLight[name]])
    for (const name of ['--bg-hover', '--next-hidden']) expect([name, dark[name]]).toEqual([name, macDark[name]])
  })

  it('YAZ-5231, YAZ-5415: at 320 px the row fits inside its 6 px gutters, with every target 44 pt or more', () => {
    expect(css).toMatch(/\.review__dock \{[^}]*padding: 2px 6px /)
    expect(css).toMatch(/\.review__ctrl \{[^}]*grid-template-columns: 1fr auto 1fr;/)
    // Two buttons, centred: the two sides are as wide as the wider (← →, 88 px).
    expect(2 * (2 * 44) + 2 * 58 + 14).toBeLessThanOrEqual(320 - 12)
    // Four buttons: no centring at 374 px and under; each 44 pt, 2 px apart.
    const narrow = css.slice(css.indexOf('@media (max-width: 374px)'))
    expect(narrow).toMatch(/\.review__ctrl:has\(\[data-count='4'\]\) \{[^}]*grid-template-columns: auto 1fr auto;/)
    expect(narrow).toMatch(/\.review__answers\[data-count='4'\] \{[^}]*gap: 2px;/)
    expect(narrow).toMatch(/\.review__dock \{\s*padding-left: 2px;\s*padding-right: 2px;/)
    expect(2 * 44 + 4 * 44 + 3 * 2 + 44).toBeLessThanOrEqual(320 - 4)
  })

  it('YAZ-5267: the kept box fills the screen by flex (no percent of a parent with no height): the buttons sit at the bottom', () => {
    expect(css).toMatch(/\.review-slot,\s*\.review-host \{[^}]*display: flex;[^}]*flex-direction: column;/)
    expect(css).not.toMatch(/\.review-host \{[^}]*min-height: 100%/)
    // YAZ-5415: on the Review tab each box of the chain takes the screen's height by flex, so the card fills it and
    // the controls sit at the bottom on a short card as on a long one.
    for (const box of ['.screen--review > .review-slot', '.screen--review .review-host', '.screen--review .review-host > .review']) expect(css).toMatch(new RegExp(`${box.replace(/[.>]/g, (c) => `\\${c}`)} \\{\\s*flex: 1 1 0;\\s*min-height: 0;`))
    expect(css).toMatch(/\.review__stage \{[^}]*flex: 1 1 0;[^}]*min-height: 0;/)
  })

  it("YAZ-5317, YAZ-5333: a sound's progress bar is no tap target on Review: no enlarged box over the card", () => {
    expect(css).not.toMatch(/\.card__audio-bar \{[^}]*padding: 20px/)
    expect(css).not.toMatch(/\.card__audio-bar \{[^}]*margin: -20px/)
  })

  it('YAZ-5313: while "A new version is ready." shows, the dock keeps room above it (no overlap with Undo or the buttons)', () => {
    expect(css).toMatch(/#root:has\(> \.update-line\) \{\s*--update-room: 72px;/)
    expect(css).toMatch(/\.review__dock \{[^}]*padding: 2px 6px calc\(6px \+ var\(--update-room, 0px\)\);/)
  })
})
