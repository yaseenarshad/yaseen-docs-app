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
    expect(css).toMatch(/\.review__dock \{[^}]*position: sticky;[^}]*bottom: 0;/)
  })

  it('the answer buttons and ⋯ are big for a thumb (56 px; Apple asks 44 pt)', () => {
    expect(css).toMatch(/\.review__answer \{[^}]*min-height: 56px;/)
    expect(css).toMatch(/\.review__more \{[^}]*min-width: 56px;[^}]*min-height: 56px;/)
  })

  it("the card styles' tokens have the Mac's values, light and dark", () => {
    const light = tokens(blockAfter(css, ':root {'))
    const dark = tokens(blockAfter(css, '@media (prefers-color-scheme: dark)'))
    const macLight = tokens(blockAfter(mac, ':root {'))
    const macDark = tokens(blockAfter(mac, "[data-theme='dark'] {"))
    for (const name of ['--bg-hover', '--next-hidden', '--mark-bg']) expect([name, light[name]]).toEqual([name, macLight[name]])
    for (const name of Object.keys(dark)) expect([name, dark[name]]).toEqual([name, macDark[name]])
  })
})
