// YAZ-5309 (the note-cards session's note on YAZ-5393/5394): `fix` (YAZ-5097, "Fix later") is a KNOWN part of the base's
// parser, as `off`, `next` and `notitle` are, so the Mac's sweeps and writers never read it as unknown, never move it,
// and a property can never take its name. Its place: after the head (ID, title, properties) and `off` / `next` /
// `notitle`, before the reviews.
import { describe, expect, it } from 'vitest'
import { cardPropertiesOf, cardReviewsOf, formatCardLine, isCardFix, isCardPropertyName, parseCardLine, withCardFix, withCardNoTitle, withCardProperty } from '@shared/cardLine'
import { uniteCardLines } from '@shared/cardMerge'
import { cardFilePropertiesMoved } from '@shared/cardPropertySweep'
import { cardTitlesMoved } from '@shared/cardTitleSweep'

const R0 = '2026-11-01T09:00Z good'
const line = (text: string) => parseCardLine(`<!-- card: ${text} -->`)!
const write = (l: ReturnType<typeof line>) => formatCardLine(l)!.replace(/^<!-- card: | -->$/g, '')

describe('`fix` is a known part (isKnownPart)', () => {
  it('a quote that never closes (YAZ-5394) never hides `fix` after it: it stands alone, as `off` does', () => {
    const l = line(`NC-1, note 5" screen, fix, ${R0}`)
    expect(isCardFix(l)).toBe(true)
    expect(cardReviewsOf(l)).toHaveLength(1)
    expect(l.parts.map((p) => p.kind)).toEqual(['id', 'other', 'fix', 'review'])
    expect(write(l)).toBe(`NC-1, note 5" screen, fix, ${R0}`)
  })

  it('`fix` is a card line word: never a property name, in any capitals; `fix "x"` stays an unknown part', () => {
    for (const name of ['fix', 'Fix', 'FIX']) expect(isCardPropertyName(name)).toBe(false)
    expect(() => withCardProperty(line('NC-1'), 'fix', 'x')).toThrow()
    const l = line('NC-1, fix "later"')
    expect(cardPropertiesOf(l)).toEqual({})
    expect(l.parts.map((p) => p.kind)).toEqual(['id', 'other'])
    expect(isCardFix(l)).toBe(false)
  })

  it('its place: after the ID, the title, the properties and `off` / `next` / `notitle`; before the reviews', () => {
    expect(write(withCardFix(line(`NC-1, title "T", tags "a" "b", level "A2", off, next, notitle, ${R0}`), true))).toBe(`NC-1, title "T", tags "a" "b", level "A2", off, next, notitle, fix, ${R0}`)
    // A property set later goes before it, with the other properties; `notitle` set later goes before it too.
    expect(write(withCardProperty(line(`NC-1, title "T", fix, ${R0}`), 'tags', ['x']))).toBe(`NC-1, title "T", tags ["x"], fix, ${R0}`)
    expect(write(withCardNoTitle(line(`NC-1, title "T", fix, ${R0}`), true))).toBe(`NC-1, title "T", notitle, fix, ${R0}`)
  })
})

describe('the Mac`s sweeps never treat `fix` as unknown nor move it', () => {
  it('the property sweep moves a card file`s properties before `fix`; a front-matter key `fix` stays in the front matter', () => {
    const file = `---\nkind: card\ntags: [a, b]\nfix: yes\n---\n\n\`\`\`card\nQ\n---\nA\n\`\`\`\n<!-- card: NC-1, title "T", fix, ${R0} -->\n`
    expect(cardFilePropertiesMoved(file)).toBe(`---\nkind: card\nfix: yes\n---\n\n\`\`\`card\nQ\n---\nA\n\`\`\`\n<!-- card: NC-1, title "T", tags "a" "b", fix, ${R0} -->\n`)
  })

  it('the title sweep keeps `fix` where it is', () => {
    const page = `# P\n\n\`\`\`card\nCapital of France\n\nWhat is it?\n---\nParis\n\`\`\`\n<!-- card: NC-1, fix, ${R0} -->\n`
    const moved = cardTitlesMoved(page)
    expect(moved).not.toBeNull()
    expect(moved!).toContain(`<!-- card: NC-1, title "Capital of France", fix, ${R0} -->`)
  })
})

describe('the merge keeps the app`s order of marks with `fix` (YAZ-5097 open point)', () => {
  const card = (l: string) => `# P\n\n\`\`\`card\nQ\n\`\`\`\n<!-- card: ${l} -->\n`
  it('a `fix` only mine has goes after `notitle`, as `withCardFix` puts it', () => {
    const [t, m] = uniteCardLines(card(`NC-1, ${R0}`), card(`NC-1, notitle, ${R0}`), card(`NC-1, fix, ${R0}`))
    expect(t).toBe(m)
    expect(t).toContain(`<!-- card: NC-1, notitle, fix, ${R0} -->`)
  })
})
