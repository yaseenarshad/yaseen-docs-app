import { describe, expect, it } from 'vitest'
import { cardRecords, changeCard, formatCardLine, isCardFix, parseCardLine, withCardFix } from '@shared/cardLine'
import { uniteCardLines } from '@shared/cardMerge'

/**
 * The "Fix later" mark (YAZ-5097; round 10, addition 3) as the phone writes it (YAZ-5073): the word `fix` on the card
 * line. An app that does not know it keeps it as its text (the older-app rule, addition 17).
 */
const line = (text: string) => parseCardLine(text)!

describe('the fix mark on the card line (YAZ-5097, written by the phone in YAZ-5073)', () => {
  it('on: one `fix` after the ID and the marks right after it; on again writes nothing new; off removes it', () => {
    const on = withCardFix(line('<!-- card: NC-1, 2026-11-12T14:05Z good -->'), true)
    expect(formatCardLine(on)).toBe('<!-- card: NC-1, fix, 2026-11-12T14:05Z good -->')
    expect(isCardFix(on)).toBe(true)
    expect(withCardFix(on, true)).toBe(on)
    expect(formatCardLine(withCardFix(line('<!-- card: NC-1, off, next, notitle, 2026-11-12T14:05Z good -->'), true))).toBe('<!-- card: NC-1, off, next, notitle, fix, 2026-11-12T14:05Z good -->')
    expect(formatCardLine(withCardFix(on, false))).toBe('<!-- card: NC-1, 2026-11-12T14:05Z good -->')
    expect(isCardFix(line('<!-- card: NC-1 -->'))).toBe(false)
  })

  it('a card line with `fix` reads back the same, and the record and every other part stay', () => {
    const text = '<!-- card: NC-1, off, fix, 2026-11-12T14:05Z good 13s -->'
    expect(formatCardLine(line(text))).toBe(text)
    const page = `# P\n\n\`\`\`card\nQ\n---\nA\n\`\`\`\n${text}\n`
    expect(cardRecords(page)[0]).toMatchObject({ id: 'NC-1', off: true, reviews: [{ at: '2026-11-12T14:05Z', rating: 'good', seconds: 13 }] })
    expect(changeCard(page, 'NC-1', (l) => withCardFix(l, true))).toBe(page)
  })

  it('the card merge rule (decision 5) keeps a `fix` that one side added', () => {
    const base = '```card\nQ\n```\n<!-- card: NC-1 -->\n'
    const theirs = '```card\nQ\n```\n<!-- card: NC-1, fix -->\n'
    const mine = '```card\nQ\n```\n<!-- card: NC-1, 2026-11-12T14:05Z good -->\n'
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(t).toBe(m)
    expect(t).toContain('<!-- card: NC-1, fix, 2026-11-12T14:05Z good -->')
  })
})
