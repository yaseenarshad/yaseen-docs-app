// YAZ-5465 (practice merge, round 2): the phone's writes and the Mac's writes on the SAME card line, after the merge.
// The phone writes actions (`applyOps`, spliced); the Mac writes through `changeCard`; AutoSync unites the two sides
// with `uniteCardLines` (YAZ-5089). Each case: the base, the phone's side, the Mac's side, then the merge. Both sides of
// the merge must be the same text, hold both changes, and keep every other byte (line ends, front matter, titles with
// `&#44;`, properties with commas, odd spacing).
import { describe, expect, it } from 'vitest'
import { cardRecords, changeCard, parseCardLine, formatCardLine, withCardProperty, withCardReview, withCardTitle, withCardNext, withCardOff, withCardFix, pageCards, cardIdOf } from '@shared/cardLine'
import { uniteCardLines } from '@shared/cardMerge'
import { applyOps, type CardOp } from './ops'
import { addComment, readComments } from '@shared/comments'
import { mergePageComments } from '@shared/commentMerge'
import { applyComment } from '../comments/write'

const P = { at: '2026-11-14T10:00Z', rating: 'good' as const, seconds: 4 }
const M = { at: '2026-11-14T10:05Z', rating: 'again' as const, seconds: 9 }
const R0 = '2026-11-01T09:00Z good'

const page = (line: string, eol = '\n', fm = '---\nid: YAZ-1\n# a comment in front matter\ntags: [a, b]\n---\n') =>
  `${fm}# Words\n\n\`\`\`card\nHola, {{mundo}}\n---\nHello, world\n\`\`\`\n<!-- card: ${line} -->\n\nThe end.\n`.replace(/\n/g, eol)
const cardFile = (line: string) => `---\nkind: card\ntitle: "Capital, Spain"\nid: GEO-1\n---\n\`\`\`card\nCapital of Spain?\n---\nMadrid\n\`\`\`\n<!-- card: ${line} -->\n`
const lineOf = (text: string): string => {
  const card = pageCards(text)[0]
  const rows = text.replace(/\r\n/g, '\n').split('\n')
  const fmEnd = text.startsWith('---') ? rows.indexOf('---', 1) + 1 : 0
  return rows[fmEnd + card.lineAt!]
}
const phone = (text: string, ops: CardOp[]) => {
  const { content, lost } = applyOps(text, ops)
  expect(lost).toEqual([])
  return content
}
const mac = (text: string, id: string, change: Parameters<typeof changeCard>[2]) => changeCard(text, id, change)
const merged = (base: string, theirs: string, mine: string) => {
  const [t, m] = uniteCardLines(base, theirs, mine)
  expect(t).toBe(m)
  return t
}

describe('YAZ-5465 trial: phone and Mac on one card line', () => {
  const LINES = [
    `YAZ-7, ${R0}`,
    `YAZ-7, title "Capital&#44; Spain", ${R0}`,
    `YAZ-7, title "A  title", tags "a, b" "c", level 2, ${R0}`,
    `YAZ-7, title "T", ratio 2.50, notitle, ${R0}`,
    `YAZ-7, next, ${R0}`,
  ]
  for (const eol of ['\n', '\r\n']) {
    for (const line of LINES) {
      it(`answers on both sides (${eol === '\n' ? 'LF' : 'CRLF'}): ${line}`, () => {
        const base = page(line, eol)
        const t = phone(base, [{ kind: 'review', id: 'YAZ-7', review: P }])
        const m = mac(base, 'YAZ-7', (l) => withCardReview(l, M))
        const out = merged(base, t, m)
        // Both reviews, once each, in time order; every other part keeps its bytes.
        // A raw comma inside quotes is written `&#44;` (YAZ-5393): an older build splits there.
        const rest = line.replace(`, ${R0}`, '').replace('"a, b"', '"a&#44; b"')
        expect(lineOf(out)).toBe(`<!-- card: ${rest}, ${R0}, 2026-11-14T10:00Z good 4s, 2026-11-14T10:05Z again 9s -->`)
        // Only the card line changed: the line ends and the front matter stay.
        expect(out.split(eol).length).toBe(base.split(eol).length)
        expect(out.replace(/<!-- card: [^\n]*-->/, '')).toBe(base.replace(/<!-- card: [^\n]*-->/, ''))
      })
    }
  }

  it('phone Archive + Up next off + Fix later; Mac renames the title and sets a property with a comma', () => {
    const base = page(`YAZ-7, title "Old", next, ${R0}`)
    const t = phone(base, [{ kind: 'off', id: 'YAZ-7', on: true }, { kind: 'next', id: 'YAZ-7', on: false }, { kind: 'fix', id: 'YAZ-7', on: true }])
    const m = mac(base, 'YAZ-7', (l) => withCardProperty(withCardTitle(l, 'New, better'), 'source', 'p. 3, line 4'))
    const out = merged(base, t, m)
    const rec = cardRecords(out)[0]
    expect(rec).toMatchObject({ id: 'YAZ-7', off: true, next: false, fix: true, title: 'New, better' })
    expect(rec.properties).toEqual({ source: 'p. 3, line 4' })
    // An older build splits at a raw comma: the merged line has none outside its quotes' escapes.
    for (const quoted of lineOf(out).match(/"[^"]*"/g) ?? []) expect(quoted).not.toContain(',')
  })

  it('the Mac archives while the phone un-marks Up next and answers: both stay', () => {
    const base = page(`YAZ-7, next, ${R0}`)
    const t = phone(base, [{ kind: 'next', id: 'YAZ-7', on: false }, { kind: 'review', id: 'YAZ-7', review: P }])
    const m = mac(base, 'YAZ-7', (l) => withCardOff(l, true))
    expect(cardRecords(merged(base, t, m))[0]).toMatchObject({ off: true, next: false, reviews: [{ at: '2026-11-01T09:00Z' }, { at: P.at }] })
  })

  it('both sides set Fix later, one side clears it: the clear wins only against the base', () => {
    const base = page(`YAZ-7, fix, ${R0}`)
    const t = phone(base, [{ kind: 'review', id: 'YAZ-7', review: P }])
    const m = mac(base, 'YAZ-7', (l) => withCardFix(l, false))
    expect(cardRecords(merged(base, t, m))[0].fix).toBeUndefined()
  })

  it('a card file (kind: card): front matter with a comma in its title stays byte for byte', () => {
    const base = cardFile(`GEO-1, ${R0}`)
    const t = phone(base, [{ kind: 'review', id: 'GEO-1', review: P }, { kind: 'next', id: 'GEO-1', on: true }])
    const m = mac(base, 'GEO-1', (l) => withCardReview(withCardNext(l, false), M))
    const out = merged(base, t, m)
    expect(out.slice(0, out.indexOf('```'))).toBe(base.slice(0, base.indexOf('```')))
    expect(cardRecords(out)[0].reviews.map((r) => r.at)).toEqual(['2026-11-01T09:00Z', P.at, M.at])
  })

  it('a line the phone wrote reads back the same on the Mac (no rewrite of odd bytes)', () => {
    for (const line of [`YAZ-7, title  "Two  spaces", tags  "a"  "b", ${R0}`, `YAZ-7, title "x&#44;y", ratio 2.50, off, fix, ${R0}`, `YAZ-7, someday-part, ${R0}`]) {
      const base = page(line)
      const t = phone(base, [{ kind: 'review', id: 'YAZ-7', review: P }])
      const parsed = parseCardLine(lineOf(t))!
      expect(formatCardLine(parsed)).toBe(lineOf(t).replace(/^<!-- card: |\s*-->$/g, '').length > 0 ? lineOf(t) : '')
      expect(cardIdOf(parsed)).toBe('YAZ-7')
      expect(lineOf(t).startsWith(`<!-- card: ${line}`)).toBe(true)
    }
  })

  it('the same answer sent twice (a lost reply) and the Mac answered: one copy of each', () => {
    const base = page(`YAZ-7, ${R0}`)
    const once = phone(base, [{ kind: 'review', id: 'YAZ-7', review: P }])
    const twice = phone(once, [{ kind: 'review', id: 'YAZ-7', review: P }])
    expect(twice).toBe(once)
    const m = mac(base, 'YAZ-7', (l) => withCardReview(l, M))
    expect(cardRecords(merged(base, twice, m))[0].reviews).toHaveLength(3)
  })

  // AutoSync's order (`desktop/src/main/git/resolve.ts`): the card rule first, then the comments rule.
  const autoSync = (base: string, theirs: string, mine: string) => {
    const [t, m] = uniteCardLines(base, theirs, mine)
    return mergePageComments(base, t, m)
  }
  for (const [name, base] of [['a page', page(`YAZ-7, ${R0}`)], ['a card file (YAZ-5466)', cardFile(`GEO-1, ${R0}`).replace(/GEO-1, /, 'YAZ-7, ')]] as const) {
    it(`${name}: the phone comments and answers; the Mac comments and answers: both comments, both reviews`, () => {
      const c = applyComment(base, { id: 'c-phone', at: '2026-11-14T10:01:00Z', by: 'yaseen', body: 'From the phone, with: a colon' })
      expect(c.kind).toBe('added')
      const t = phone((c as { content: string }).content, [{ kind: 'review', id: 'YAZ-7', review: P }])
      const m = mac(addComment(base, 'From the Mac', { id: 'c-mac', at: '2026-11-14T10:06:00Z', title: 'Words' }), 'YAZ-7', (l) => withCardReview(l, M))
      const out = autoSync(base, t, m)
      expect(out).not.toBeNull()
      expect(out!.copy).toBeUndefined()
      const text = out!.text
      expect(readComments(String(text)).map((x) => x.id).sort()).toEqual(['c-mac', 'c-phone'])
      expect(cardRecords(String(text))[0].reviews).toHaveLength(3)
      if (name !== 'a page') expect(String(text)).toContain('kind: card')
    })
  }
})
