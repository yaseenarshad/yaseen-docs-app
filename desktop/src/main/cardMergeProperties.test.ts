// The card rule of sync (`uniteCardLines`, decision 5 on YAZ-5055) with card properties (YAZ-5349 option A): each
// property is merged three ways by its name, as the title is (YAZ-5309). A property changed on the Mac and an answer on
// the phone: both stay. GitHub AutoSync holds a copy of this rule (YAZ-5090) and gives the same bytes.
import { describe, expect, it } from 'vitest'
import { uniteCardLines } from '@shared/cardMerge'
import { pageCards } from '@shared/cardLine'
import { splitFrontmatter } from '@shared/frontmatter'

const card = (line: string) => `\`\`\`card\nHola\n\`\`\`\n<!-- card: ${line} -->\n`
const page = (line: string) => `---\nid: YAZ-1\ntitle: Spanish words\n---\n# Spanish words\n\n${card(line)}\nThe end.\n`
const lineOf = (text: string) => {
  const c = pageCards(text)[0]
  return splitFrontmatter(text).body.split('\n')[c.lineAt!]
}
const OLD = '2026-11-01T09:00Z good'
const A = '2026-11-14T06:01Z good 9s'
const HEAD = 'YAZ-7, title "Hola"'

/** Both orders (the Mac as theirs, then as mine): the same line on both sides and in both orders, and a second merge changes nothing. */
function both(base: string, mac: string, phone: string): string {
  const out: string[] = []
  for (const [t0, m0] of [
    [mac, phone],
    [phone, mac],
  ]) {
    const [t, m] = uniteCardLines(page(base), page(t0), page(m0))
    expect(t).toBe(m)
    expect(uniteCardLines(page(base), t, m)).toEqual([t, m])
    out.push(lineOf(t))
  }
  expect(out[1], 'the Mac as mine').toBe(out[0])
  return out[0]
}

describe('uniteCardLines with card properties (YAZ-5349)', () => {
  it('a property changed on the Mac and an answer on the phone: both stay, in either order', () => {
    expect(both(`${HEAD}, level "A2", ${OLD}`, `${HEAD}, level "B1", ${OLD}`, `${HEAD}, level "A2", ${OLD}, ${A}`)).toBe(`<!-- card: ${HEAD}, level "B1", ${OLD}, ${A} -->`)
  })

  it('a property added on the Mac and Fix later on the phone: both stay; the property sits with the head, `fix` after it', () => {
    expect(both(`${HEAD}, ${OLD}`, `${HEAD}, tags "a" "b", ${OLD}`, `${HEAD}, fix, ${OLD}`)).toBe(`<!-- card: ${HEAD}, tags "a" "b", fix, ${OLD} -->`)
  })

  it('a property removed on the Mac and an answer on the phone: it stays removed', () => {
    expect(both(`${HEAD}, tags ["x"], level "A2", ${OLD}`, `${HEAD}, level "A2", ${OLD}`, `${HEAD}, tags ["x"], level "A2", ${OLD}, ${A}`)).toBe(`<!-- card: ${HEAD}, level "A2", ${OLD}, ${A} -->`)
  })

  it('a property renamed on the Mac and Up next on the phone: the new name, at its place, and `next`', () => {
    expect(both(`${HEAD}, tags "a", level "A2", ${OLD}`, `${HEAD}, topics "a", level "A2", ${OLD}`, `${HEAD}, tags "a", level "A2", next, ${OLD}`)).toBe(`<!-- card: ${HEAD}, topics "a", level "A2", next, ${OLD} -->`)
  })

  it('each side changed another property: each change stays', () => {
    const [t, m] = uniteCardLines(page(`${HEAD}, a "1", b "1", ${OLD}`), page(`${HEAD}, a "2", b "1", ${OLD}`), page(`${HEAD}, a "1", b "3", ${OLD}`))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: ${HEAD}, a "2", b "3", ${OLD} -->`)
  })

  it('both sides changed one property, each to a new value: theirs, as for the title', () => {
    const [t, m] = uniteCardLines(page(`${HEAD}, level "A2", ${OLD}`), page(`${HEAD}, level "B1", ${OLD}`), page(`${HEAD}, level "C1", ${OLD}, ${A}`))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: ${HEAD}, level "B1", ${OLD}, ${A} -->`)
  })

  it('a property neither side changed keeps its bytes, hand-written form and all', () => {
    expect(both(`${HEAD}, tags  "a"   "b", ${OLD}`, `${HEAD}, tags  "a"   "b", off, ${OLD}`, `${HEAD}, tags  "a"   "b", ${OLD}, ${A}`)).toBe(`<!-- card: ${HEAD}, tags  "a"   "b", off, ${OLD}, ${A} -->`)
  })

  it('a title with &#44; and a title change on the Mac, properties on both: the Mac`s title, the phone`s answer', () => {
    expect(both(`YAZ-7, title "1&#44;000 islands", tags ["x"], ${OLD}`, `YAZ-7, title "1&#44;001 islands", tags ["x"], ${OLD}`, `YAZ-7, title "1&#44;000 islands", tags ["x"], ${OLD}, ${A}`)).toBe(
      `<!-- card: YAZ-7, title "1&#44;001 islands", tags ["x"], ${OLD}, ${A} -->`,
    )
  })
})
