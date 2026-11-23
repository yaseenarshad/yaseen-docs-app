// YAZ-5309: the card's title on its card line (YAZ-5308, decision D) through every write the phone makes, the merge
// rule of sync (decision 5) and a build from before YAZ-5308.
import { describe, expect, it } from 'vitest'
import {
  cardTitleOf,
  formatCardLine,
  isCardFix,
  parseCardLine,
  withCardFix,
  withCardNext,
  withCardNoTitle,
  withCardOff,
  withCardReview,
  withCardReviewAt,
  withCardTitle,
  withoutCardReview,
  EMPTY_CARD_LINE,
  type CardLine,
} from '@shared/cardLine'
import { uniteCardLines } from '@shared/cardMerge'
import { splitFrontmatter } from '@shared/frontmatter'
import { pageCards } from '@shared/cardLine'
import * as older from './olderCardLine.fixture'

const R1 = '2026-11-01T09:00:00.000Z good'
const R2 = '2026-11-13T10:00:00.000Z again 7s'
const parse = (body: string): CardLine => parseCardLine(`<!-- card: ${body} -->`)!
const write = (line: CardLine): string => formatCardLine(line)!.replace(/^<!-- card: | -->$/g, '')

/** Titles that hold each hard character: the title part as the Mac writes it (`withCardTitle`), and its text. */
const HARD: Array<[string, string]> = [
  ['a quote', 'The "City" of Light'],
  ['a comma', 'Paris, France'],
  ['an end of comment', 'a --> b'],
  ['a backslash', 'C:\\ and \\\\ two'],
  ['non-ASCII letters', 'Ñandú über Straße — çà'],
  ['an emoji', 'Speed of light 🚀✨'],
  ['all of them', 'Ünïcode, "q" \\ --> 🙂'],
]
/** The title part as the Mac writes it. */
const partOf = (title: string): string => write(withCardTitle(EMPTY_CARD_LINE, title))

describe('`fix` (YAZ-5097) with the title part: its place is after the ID, the title and any `off` / `next` / `notitle`', () => {
  it('Fix later writes `fix` after the title; with `off`, `next` and `notitle`, after them', () => {
    expect(write(withCardFix(parse(`WIKI-5, title "Ser", ${R1}`), true))).toBe(`WIKI-5, title "Ser", fix, ${R1}`)
    expect(write(withCardFix(parse(`WIKI-5, title "Ser", off, next, notitle, ${R1}`), true))).toBe(`WIKI-5, title "Ser", off, next, notitle, fix, ${R1}`)
    expect(write(withCardFix(parse(`title "Ser", ${R1}`), true))).toBe(`title "Ser", fix, ${R1}`)
  })

  it('the other marks keep their place before `fix`, and `fix` keeps its own after them', () => {
    const marked = parse(`WIKI-5, title "Ser", fix, ${R1}`)
    expect(write(withCardOff(marked, true))).toBe(`WIKI-5, title "Ser", off, fix, ${R1}`)
    expect(write(withCardNext(marked, true))).toBe(`WIKI-5, title "Ser", next, fix, ${R1}`)
    expect(write(withCardNoTitle(marked, true))).toBe(`WIKI-5, title "Ser", notitle, fix, ${R1}`)
    expect(write(withCardTitle(marked, 'Estar'))).toBe(`WIKI-5, title "Estar", fix, ${R1}`)
  })
})

describe('every write the phone makes keeps the title part byte for byte', () => {
  /** The phone's writes, each with its undo where it has one (`ops.ts` applies these writers). */
  const writes: Array<[string, (l: CardLine) => CardLine]> = [
    ['an answer, then its undo', (l) => withoutCardReview(withCardReview(l, { at: '2026-11-13T10:00:00.000Z', rating: 'again', seconds: 7 }), '2026-11-13T10:00:00.000Z')],
    ['a review taken out and put back', (l) => withCardReviewAt(withoutCardReview(l, '2026-11-01T09:00:00.000Z'), { at: '2026-11-01T09:00:00.000Z', rating: 'good' }, 2)],
    ['Up next, and its undo', (l) => withCardNext(withCardNext(l, true), false)],
    ['Archive card, and its undo', (l) => withCardOff(withCardOff(l, true), false)],
    ['Fix later, and its undo', (l) => withCardFix(withCardFix(l, true), false)],
  ]

  it.each(HARD)('a title with %s', (_what, title) => {
    const part = partOf(title)
    const body = `WIKI-5, ${part}, ${R1}`
    const line = parse(body)
    expect(cardTitleOf(line)).toBe(title.replace(/\s+/g, ' ').trim())
    expect(write(line)).toBe(body)
    for (const [name, change] of writes) expect(write(change(line)), name).toBe(body)
    // An answer, and each mark on: the title part is the same bytes, in the same place, right after the ID.
    for (const on of [withCardReview(line, { at: '2026-11-13T10:00:00.000Z', rating: 'again', seconds: 7 }), withCardNext(line, true), withCardOff(line, true), withCardFix(line, true), withCardNoTitle(line, true)])
      expect(write(on).startsWith(`WIKI-5, ${part}, `)).toBe(true)
    expect(write(withCardFix(withCardNext(line, true), true))).toBe(`WIKI-5, ${part}, next, fix, ${R1}`)
  })

  it('an empty title (`title ""`) is no title, and stays as its text in its place', () => {
    const body = `WIKI-5, title "", ${R1}`
    const line = parse(body)
    expect(cardTitleOf(line)).toBe('')
    for (const [name, change] of writes) expect(write(change(line)), name).toBe(body)
    expect(write(withCardFix(line, true))).toBe(`WIKI-5, fix, title "", ${R1}`)
  })

  it('a title written by hand in a form the Mac does not write (a bare `>`, extra spaces, a tab, an odd escape): the bytes stay', () => {
    for (const part of ['title "a > b"', 'title "  Two   spaces "', 'title\t"Tab"', 'title "odd \\q escape"']) {
      const body = `WIKI-5, ${part}, ${R1}`
      const line = parse(body)
      expect(cardTitleOf(line)).not.toBe('')
      expect(write(line)).toBe(body)
      for (const [name, change] of writes) expect(write(change(line)), `${part}: ${name}`).toBe(body)
      expect(write(withCardFix(line, true))).toBe(`WIKI-5, ${part}, fix, ${R1}`)
    }
    // A rename writes the Mac's own form.
    expect(write(withCardTitle(parse(`WIKI-5, title "a > b", ${R1}`), 'c > d'))).toBe(`WIKI-5, title "c \\> d", ${R1}`)
  })
})

describe('the merge rule of sync (decision 5, `uniteCardLines`) keeps the title part, three ways', () => {
  const page = (line: string) => `---\nid: YAZ-1\n---\n# Words\n\n\`\`\`card\nHola\n\`\`\`\n<!-- card: ${line} -->\n\nThe end.\n`
  const lineOf = (text: string) => splitFrontmatter(text).body.split('\n')[pageCards(text)[0].lineAt!]
  const T = '2026-11-13T10:00:00.000Z good 4s'
  const M = '2026-11-13T10:05:00.000Z again 7s'

  it('the Mac renames the card (mine), the phone answers it (theirs): the new title and both answers stay', () => {
    const [t, m] = uniteCardLines(page(`YAZ-7, title "Hola", ${R1}`), page(`YAZ-7, title "Hola", ${R1}, ${T}`), page(`YAZ-7, title "Hello&#44; world", ${R1}, ${M}`))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, title "Hello&#44; world", ${R1}, ${T}, ${M} -->`)
  })

  it('the other way round: the Mac renames (theirs), the phone answers (mine)', () => {
    const [t, m] = uniteCardLines(page(`YAZ-7, title "Hola", ${R1}`), page(`YAZ-7, title "Hello", ${R1}, ${T}`), page(`YAZ-7, title "Hola", ${R1}, ${M}`))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, title "Hello", ${R1}, ${T}, ${M} -->`)
  })

  it('a title given to a card with none, or taken away, on one side; the phone answers and marks on the other', () => {
    const [t, m] = uniteCardLines(page(`YAZ-7, ${R1}`), page(`YAZ-7, next, fix, ${R1}, ${T}`), page(`YAZ-7, title "New \\"one\\"", ${R1}, ${M}`))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, title "New \\"one\\"", next, fix, ${R1}, ${T}, ${M} -->`)
    const [t2, m2] = uniteCardLines(page(`YAZ-7, title "Old", ${R1}`), page(`YAZ-7, title "Old", ${R1}, ${T}`), page(`YAZ-7, ${R1}, ${M}`))
    expect(t2).toBe(m2)
    expect(lineOf(t2)).toBe(`<!-- card: YAZ-7, ${R1}, ${T}, ${M} -->`)
  })

  it('both sides rename it, each to a new title: one title, theirs (as the ID and the order of the parts are)', () => {
    const [t, m] = uniteCardLines(page(`YAZ-7, title "A", ${R1}`), page(`YAZ-7, title "B", ${R1}, ${T}`), page(`YAZ-7, title "C", ${R1}, ${M}`))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, title "B", ${R1}, ${T}, ${M} -->`)
  })

  it('neither side changed the title: its bytes stay, a hand-written form too', () => {
    const [t, m] = uniteCardLines(page(`YAZ-7, title "a > b", ${R1}`), page(`YAZ-7, title "a > b", ${R1}, ${T}`), page(`YAZ-7, title "a > b", ${R1}, ${M}`))
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: YAZ-7, title "a > b", ${R1}, ${T}, ${M} -->`)
  })
})

describe('a build from before YAZ-5308 (point 6: the phone never writes what an older Mac cannot read)', () => {
  /** What the older build writes after its own change of the line. */
  const olderWrite = (body: string, change: (l: older.CardLine) => older.CardLine): string => older.formatCardLine(change(older.parseCardLine(`<!-- card: ${body} -->`)!))!.replace(/^<!-- card: | -->$/g, '')
  const olderWrites: Array<[string, (l: older.CardLine) => older.CardLine]> = [
    ['an answer', (l) => older.withCardReview(l, { at: '2026-11-13T10:00:00.000Z', rating: 'again', seconds: 7 })],
    ['Archive card', (l) => older.withCardOff(l, true)],
    ['Up next', (l) => older.withCardNext(l, true)],
    ['Title on the front: Hide', (l) => older.withCardNoTitle(l, true)],
    ['Fix later (an older phone)', (l) => older.withCardFix(l, true)],
    ['Reset history', (l) => older.withoutCardReviews(l)],
  ]

  it('reads the title part as an unknown part, keeps it in its place, and writes its bytes back on each of its writes', () => {
    for (const [, title] of HARD) {
      const body = `WIKI-5, ${partOf(title)}, ${R1}`
      expect(olderWrite(body, (l) => l)).toBe(body)
      for (const [name, change] of olderWrites) {
        const saved = olderWrite(body, change)
        // This build reads the same title off what the older build saved.
        expect(cardTitleOf(parse(saved)), `${title}: ${name}`).toBe(title.replace(/\s+/g, ' ').trim())
        // Its marks go after the ID, so before the title part; the part's own bytes stay.
        expect(saved, `${title}: ${name}`).toContain(partOf(title))
      }
    }
  })

  it('a title with a comma is two unknown parts there: written back as they were when the comma has one space after it and none before', () => {
    const line = older.parseCardLine(`<!-- card: WIKI-5, title "Paris, France", ${R1} -->`)!
    expect(line.parts.slice(1, 3)).toEqual([
      { kind: 'other', text: 'title "Paris' },
      { kind: 'other', text: 'France"' },
    ])
    expect(older.formatCardLine(older.withCardOff(line, true))).toBe(`<!-- card: WIKI-5, off, title "Paris, France", ${R1} -->`)
    // Other spaces at a comma are written as `, `: the title changes by those spaces only.
    expect(olderWrite(`WIKI-5, title "a ,b", ${R1}`, (l) => l)).toBe(`WIKI-5, title "a, b", ${R1}`)
  })

  it('a known word between the commas of a title (`off`, `next`, `notitle`, `fix`, a review) is no mark for an older build: the title holds `&#44;`, no comma (YAZ-5393)', () => {
    expect(partOf('Go, next, now')).toBe('title "Go&#44; next&#44; now"')
    const line = older.parseCardLine(`<!-- card: WIKI-5, ${partOf('Go, next, now')}, ${R1} -->`)!
    expect(older.isCardNext(line)).toBe(false)
    expect(older.formatCardLine(line)).toBe(`<!-- card: WIKI-5, ${partOf('Go, next, now')}, ${R1} -->`)
    expect(cardTitleOf(parse(`WIKI-5, ${partOf('Go, next, now')}, ${R1}`))).toBe('Go, next, now')
  })

  it('this build reads what an older build wrote with `fix`, `off` and `next` before the title part', () => {
    const saved = olderWrite(`WIKI-5, title "Ser", ${R1}`, (l) => older.withCardFix(older.withCardOff(l, true), true))
    expect(saved).toBe(`WIKI-5, off, fix, title "Ser", ${R1}`)
    const line = parse(saved)
    expect([cardTitleOf(line), isCardFix(line)]).toEqual(['Ser', true])
  })
})
