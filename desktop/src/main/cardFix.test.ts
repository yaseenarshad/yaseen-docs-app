// "Fix later" (YAZ-5097; round 10, addition 3 of YAZ-5055): the mark `fix` on the card line. The phone writes it
// (YAZ-5073, the `fix` action); the Mac reads it, shows it, sets it, clears it and lists the marked cards ("To fix").
import { describe, expect, it } from 'vitest'
import {
  CARD_FIX,
  cardRecords,
  changeCard,
  formatCardLine,
  isCardFix,
  parseCardLine,
  pageCards,
  settleCardCopy,
  withCardFix,
  withCardId,
  withCardNext,
  withCardNoTitle,
  withCardOff,
  withCardReview,
  withoutCardReviews,
  type CardLine,
} from '@shared/cardLine'
import { fixCards } from '@shared/cardSchedule'
import { moveCardOut, putCardBack } from '@shared/cardConvert'
import { uniteCardLines } from '@shared/cardMerge'
import { splitFrontmatter } from '@shared/frontmatter'

const parse = (body: string): CardLine => parseCardLine(`<!-- card: ${body} -->`)!
const write = (line: CardLine): string => formatCardLine(line)!.replace(/^<!-- card: | -->$/g, '')
const R1 = '2026-11-01T09:00Z good'
const R2 = '2026-11-13T10:00Z again 7s'

describe('the `fix` part (YAZ-5097)', () => {
  it('Fix later writes `fix` after the ID and any `off`, `next` or `notitle`; it reads back; a clear removes it', () => {
    expect(CARD_FIX).toBe('fix')
    expect(write(withCardFix(parse(`WIKI-5, ${R1}`), true))).toBe(`WIKI-5, fix, ${R1}`)
    expect(write(withCardFix(parse(`WIKI-5, off, next, notitle, ${R1}`), true))).toBe(`WIKI-5, off, next, notitle, fix, ${R1}`)
    expect(write(withCardFix(parse(R1), true))).toBe(`fix, ${R1}`)
    expect(isCardFix(parse(`WIKI-5, fix, ${R1}`))).toBe(true)
    expect(isCardFix(parse(`WIKI-5, ${R1}`))).toBe(false)
    expect(write(withCardFix(parse(`WIKI-5, next, fix, ${R1}, future-part`), false))).toBe(`WIKI-5, next, ${R1}, future-part`)
  })

  it('Fix later two times writes one mark; a clear of a card with none changes nothing', () => {
    const once = withCardFix(parse(`WIKI-5, ${R1}`), true)
    expect(withCardFix(once, true)).toBe(once)
    const none = parse(`WIKI-5, ${R1}`)
    expect(withCardFix(none, false)).toBe(none)
    // Two marks (two old writers): a clear removes both.
    expect(isCardFix(withCardFix(parse(`WIKI-5, fix, ${R1}, fix`), false))).toBe(false)
  })

  it('each other change of the line keeps `fix` where it is', () => {
    const line = parse(`WIKI-5, fix, ${R1}, future-part`)
    expect(write(withCardOff(line, true))).toBe(`WIKI-5, off, fix, ${R1}, future-part`)
    expect(write(withCardNext(line, true))).toBe(`WIKI-5, next, fix, ${R1}, future-part`)
    expect(write(withCardNoTitle(line, true))).toBe(`WIKI-5, notitle, fix, ${R1}, future-part`)
    expect(write(withCardReview(line, { at: '2026-11-13T10:00Z', rating: 'again', seconds: 7 }))).toBe(`WIKI-5, fix, ${R1}, ${R2}, future-part`)
    expect(write(withoutCardReviews(line))).toBe('WIKI-5, fix, future-part')
    expect(write(withCardId(line, 'WIKI-9'))).toBe(`WIKI-9, fix, ${R1}, future-part`)
  })

  it('the index record holds it (`fix: true`), so the To fix count reads no file; a card with none has no key', () => {
    const page = `# P\n\n\`\`\`card\nHola\n\`\`\`\n<!-- card: WIKI-5, fix, ${R1} -->\n\n\`\`\`card\nAdios\n\`\`\`\n<!-- card: WIKI-6 -->\n`
    const [a, b] = cardRecords(page)
    expect(a).toEqual({ id: 'WIKI-5', off: false, next: false, reviews: [{ at: '2026-11-01T09:00Z', rating: 'good' }], title: 'Hola', fix: true })
    expect(b).toEqual({ id: 'WIKI-6', off: false, next: false, reviews: [], title: 'Adios' })
  })
})

describe('the older-app rule (round 10, addition 17): a build that does not know `fix` keeps it', () => {
  // An older Mac build (before YAZ-5097) has no `fix` kind: its parser reads the word as `{ kind: 'other', text: 'fix' }`
  // and writes it back as its text, in its place. `asOlderBuild` turns this build's parts into that build's parts.
  const asOlderBuild = (line: CardLine): CardLine => ({ parts: line.parts.map((p) => (p.kind === 'fix' ? { kind: 'other', text: 'fix' } : p)) })

  it('this build reads `fix` as its own part kind, and writes the line back byte for byte', () => {
    for (const body of [`WIKI-5, fix, ${R1}`, `WIKI-5, off, next, notitle, fix, ${R1}, ${R2}`, 'fix', `WIKI-5, ${R1}, fix, future-part`]) {
      const line = parse(body)
      expect(line.parts.filter((p) => p.kind === 'fix')).toHaveLength(1)
      expect(write(line)).toBe(body)
    }
  })

  it('an older build holds `fix` as an unknown part, writes the same bytes, and each of its own writes keeps the mark', () => {
    const body = `WIKI-5, next, fix, ${R1}, future-part`
    const older = asOlderBuild(parse(body))
    expect(older.parts[2]).toEqual({ kind: 'other', text: 'fix' })
    expect(write(older)).toBe(body)
    // The older build's writes (an answer, Archive, Up next off, Reset history, a new ID): `fix` stays in its place.
    const saved = withCardId(withoutCardReviews(withCardNext(withCardOff(withCardReview(older, { at: '2026-11-13T10:00Z', rating: 'again', seconds: 7 }), true), false)), 'WIKI-9')
    expect(write(saved)).toBe('WIKI-9, off, fix, future-part')
    // ... and this build reads what the older build saved as the mark again.
    expect(isCardFix(parse(write(saved)))).toBe(true)
  })

  it('an unknown word in the place of `fix` (the next mark a newer phone may write) is kept the same way', () => {
    const line = parse(`WIKI-5, off, later-mark, ${R1}`)
    expect(line.parts[2]).toEqual({ kind: 'other', text: 'later-mark' })
    expect(write(withCardReview(withCardNext(line, true), { at: '2026-11-13T10:00Z', rating: 'again', seconds: 7 }))).toBe(`WIKI-5, off, next, later-mark, ${R1}, ${R2}`)
  })

  it('a page saved by the sweep or the copy rule keeps `fix` on the card that keeps the ID', () => {
    const keeper = { line: parse(`WIKI-5, fix, ${R1}`), text: 'Hola' }
    const copy = { line: parse(`WIKI-5, ${R2}`), text: 'Hola' }
    const settled = settleCardCopy(keeper, copy)
    expect(isCardFix(settled.keeper!)).toBe(true)
  })
})

describe('`fix` in a card file and through the convert actions', () => {
  const cardFile = `---\nkind: card\ntitle: Capital of France\n---\n\`\`\`card\nParis\n\`\`\`\n<!-- card: GEO-140, ${R1} -->\n`

  it('a card file\'s card: write, read, clear; the properties stay byte for byte', () => {
    const marked = changeCard(cardFile, 'GEO-140', (l) => withCardFix(l, true))
    expect(splitFrontmatter(marked).frontmatter).toBe(splitFrontmatter(cardFile).frontmatter)
    expect(isCardFix(pageCards(marked)[0].line)).toBe(true)
    expect(marked).toContain(`<!-- card: GEO-140, fix, ${R1} -->`)
    expect(changeCard(marked, 'GEO-140', (l) => withCardFix(l, false))).toBe(cardFile)
  })

  it('Move to its own file and Put back into this page keep `fix`', () => {
    const page = `# P\n\nText.\n\n\`\`\`card\nParis\n\`\`\`\n<!-- card: GEO-140, fix, ${R1} -->\n\nEnd.\n`
    const { page: left, card } = moveCardOut(page, 'GEO-140')
    expect(isCardFix(pageCards(card.content)[0].line)).toBe(true)
    const back = putCardBack(left, 'GEO-140', 0, card.content, 'GEO-140')
    expect(isCardFix(pageCards(back)[0].line)).toBe(true)
    expect(back).toContain(`<!-- card: GEO-140, fix, ${R1} -->`)
  })
})

describe('fixCards: the To fix list (YAZ-5097), as the Archived list is built', () => {
  const rec = (path: string, folder: string, cards: { id: string | null; fix?: true; off?: boolean; title?: string }[], embeds?: string[]) => ({
    path,
    folder,
    cards: cards.map((c) => ({ id: c.id, off: c.off ?? false, next: false, reviews: [], ...(c.title !== undefined && { title: c.title }), ...(c.fix && { fix: true as const }) })),
    ...(embeds !== undefined && { embeds }),
  })

  it('lists each marked card of the scope by path and page order, an archived one too; a copy of an ID and a card with no ID are left out', () => {
    const records = [
      rec('/v/b.md', '', [{ id: 'W-3', fix: true, title: 'Three' }]),
      rec('/v/a.md', '', [{ id: 'W-1', title: 'One' }, { id: 'W-2', fix: true, off: true }, { id: 'W-2', fix: true }, { id: null, fix: true }]),
      rec('/v/sub/c.md', 'sub', [{ id: 'W-4', fix: true, title: 'Four' }]),
    ]
    expect(fixCards(records)).toEqual([
      { path: '/v/a.md', index: 1, id: 'W-2' },
      { path: '/v/b.md', index: 0, id: 'W-3', title: 'Three' },
      { path: '/v/sub/c.md', index: 0, id: 'W-4', title: 'Four' },
    ])
    expect(fixCards(records, 'sub').map((c) => c.id)).toEqual(['W-4'])
    expect(fixCards(records, '', '/v/b.md').map((c) => c.id)).toEqual(['W-3'])
  })

  it('a card embedded on two pages is one card: one row', () => {
    const records = [rec('/v/GEO-140.md', '', [{ id: 'GEO-140', fix: true, title: 'Capital' }]), rec('/v/p1.md', '', [], ['GEO-140']), rec('/v/p2.md', '', [], ['GEO-140'])]
    expect(fixCards(records)).toEqual([{ path: '/v/GEO-140.md', index: 0, id: 'GEO-140', title: 'Capital' }])
  })
})

describe('uniteCardLines: `fix` merges three ways (YAZ-5089, decision 5)', () => {
  const card = (line: string) => `\`\`\`card\nHola\n\`\`\`\n<!-- card: ${line} -->\n`
  const page = (line: string) => `---\nid: YAZ-1\n---\n# Words\n\n${card(line)}\nThe end.\n`
  const lineOf = (text: string) => splitFrontmatter(text).body.split('\n')[pageCards(text)[0].lineAt!]
  const T = '2026-11-13T10:00Z good 4s'
  const M = '2026-11-13T10:05Z again 7s'

  it('the phone marks Fix later and answers; the Mac answers: the mark stays, the reviews unite', () => {
    const [t, m] = uniteCardLines(page(`YAZ-7, ${R1}`), page(`YAZ-7, fix, ${R1}, ${T}`), page(`YAZ-7, ${R1}, ${M}`))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, fix, ${R1}, ${T}, ${M} -->`)
  })

  it('the Mac clears the mark (the card is fixed); the phone answers: the mark stays cleared', () => {
    const [t, m] = uniteCardLines(page(`YAZ-7, fix, ${R1}`), page(`YAZ-7, fix, ${R1}, ${T}`), page(`YAZ-7, ${R1}, ${M}`))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, ${R1}, ${T}, ${M} -->`)
  })

  it('both sides mark it: one `fix`; neither changed it: as it was', () => {
    const [t, m] = uniteCardLines(page(`YAZ-7, ${R1}`), page(`YAZ-7, fix, ${R1}, ${T}`), page(`YAZ-7, fix, ${R1}, ${M}`))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, fix, ${R1}, ${T}, ${M} -->`)
    const [t2] = uniteCardLines(page(`YAZ-7, fix, ${R1}`), page(`YAZ-7, fix, ${R1}, ${T}`), page(`YAZ-7, fix, ${R1}, ${M}`))
    expect(lineOf(t2)).toBe(`<!-- card: YAZ-7, fix, ${R1}, ${T}, ${M} -->`)
  })
})
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
