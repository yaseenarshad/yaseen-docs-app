import { describe, expect, it } from 'vitest'
import { cardPropertiesOf, formatCardLine, pageCards, parseCardLine, renameCardProperty, withCardProperty, withoutCardProperty, type CardLine, type CardPart, type CardReview } from '@shared/cardLine'
import { applyOps, opsBetween, UnsentChangeError, type CardOp } from './ops'

/**
 * YAZ-5349 (YAZ-5379: card properties on the card line) and YAZ-5393 (a comma in a title is `&#44;`), merged into the
 * phone branch. The phone's answer list writes card lines (`applyOps`) and must keep EVERY part that is no review and
 * no mark of its own byte for byte: the title, each property (`tags "a" "b"`, `level "A2"`, `["x"]`), each unknown
 * part. An answer, an Undo, Up next, Archive card, Fix later and their Undos never change, move or rewrite one. The
 * phone never sets a property: such a change cannot be sent (`UnsentChangeError`), so nothing is half saved.
 */
const R: CardReview = { at: '2026-11-14T06:01:00.000Z', rating: 'good', seconds: 9 }
const R0 = '2026-11-01T09:00:00.000Z good'
const pageWith = (line: string) => `---\ntitle: P\n---\n\n# P\n\n\`\`\`card\nWhat is it?\n---\n{{It}}\n\`\`\`\n<!-- card: ${line} -->\n\nThe end.\n`
const lineOf = (content: string) => formatCardLine(pageCards(content)[0].line)!
/** Each part's own text on the line, as the writer puts it. */
const texts = (line: CardLine) => line.parts.map((p) => formatCardLine({ parts: [p] })!.replace(/^<!-- card: | -->$/g, ''))
const MARK: ReadonlySet<CardPart['kind']> = new Set(['review', 'off', 'next', 'fix'])

const TWENTY = Array.from({ length: 20 }, (_, i) => `p${i + 1} ${i % 3 === 0 ? `"v${i}"` : i % 3 === 1 ? String(i * 1.5) : i % 2 === 0 ? 'true' : `["x${i}"]`}`).join(', ')

/** The base's own tricky lines (YAZ-5379, YAZ-5393, YAZ-5394 tests) and the phone's own. */
const LINES: Array<[string, string]> = [
  ['the mockup line', `GEO-197, title "Capital of Spain", tags "europe" "capitals", level "A2", source "Atlas, chapter 3", ${R0}`],
  ['each type', 'NC-1, title "T", text "say \\"hi\\" --\\> \\\\ ok", count 3, ratio -2.5, done true, later false, tags "a" "b c", when "2026-11-14", empty ""'],
  ['a list of one and of none', `NC-1, tags ["europe"], none [], two "a" "b", ${R0}`],
  ['a quoted name', `NC-1, "Due Date" "2026-11-20", "2024 goal" "yes", ${R0}`],
  ['a value with a line break', `NC-1, note "one\\ntwo", ${R0}`],
  ['a title with &#44; and properties', `NC-1, title "1&#44;000 islands", tags ["x"], ${R0}`],
  ['&#38; in a title', `NC-1, title "&#38;#44; and Q&A", ${R0}`],
  ['a value with a comma', `NC-1, note "a, b", other "a,b", ${R0}`],
  ['a value with a quote and a backslash', `NC-1, say "he said \\"no\\"", path "C:\\\\x", ${R0}`],
  ['&#44; written by a person in a value', `NC-1, note "x&#44;y", ${R0}`],
  ['&#44; written by a person in a title', `NC-1, title "a&#44;b", ${R0}`],
  ['an empty list and an empty text', `NC-1, tags [], note "", ${R0}`],
  ['20 properties', `NC-1, title "Twenty", ${TWENTY}, ${R0}`],
  ['unknown parts around them', `NC-1, someday 2027-01, tags "a" "b", odd, ${R0}, later-word`],
  ['a hand-written form: spaces, brackets, a number with a zero', `NC-1, tags  "a"   "b", list [ "a" "b" ], ratio 2.50, n -0, done  true, ${R0}`],
  ['a quote that never closes', `NC-1, note 5" screen, tags "a", ${R0}`],
  ['marks there already', `NC-1, title "T", tags "a" "b", off, notitle, ${R0}`],
]

const PAIRS: Array<[string, CardOp[]]> = [
  ['an answer and its Undo (`unreview`)', [{ kind: 'review', id: 'NC-1', review: R }, { kind: 'unreview', id: 'NC-1', at: R.at, rating: R.rating }]],
  ['Up next on, then off', [{ kind: 'next', id: 'NC-1', on: true }, { kind: 'next', id: 'NC-1', on: false }]],
  ['Archive card, then its Undo', [{ kind: 'off', id: 'NC-1', on: true }, { kind: 'off', id: 'NC-1', on: false }]],
  ['Fix later, then its Undo', [{ kind: 'fix', id: 'NC-1', on: true }, { kind: 'fix', id: 'NC-1', on: false }]],
]

describe('applyOps keeps every card-line part byte for byte: title, properties, unknown parts (YAZ-5349, YAZ-5393)', () => {
  it.each(LINES)('%s: each action and its Undo give the page back byte for byte; an action alone changes only its own part', (_name, raw) => {
    const line = raw.replace(/^GEO-197/, 'NC-1')
    const page = pageWith(line)
    const before = pageCards(page)[0].line
    // The line reads back as it is written: the test starts from bytes the parser keeps. A raw comma in quotes is the
    // exception: the shared writer encodes it (`&#44;`, YAZ-5393), and the phone's splice keeps it (YAZ-5409).
    if (!/"[^"]*,[^"]*"/.test(line)) expect(lineOf(page)).toBe(`<!-- card: ${line} -->`)
    for (const [name, ops] of PAIRS) {
      if (isNoop(before, ops[0])) continue
      expect(applyOps(page, ops).content, name).toBe(page)
      const once = pageCards(applyOps(page, ops.slice(0, 1)).content)[0].line
      const kept = (l: CardLine) => texts({ parts: l.parts.filter((p) => !MARK.has(p.kind)) })
      expect(kept(once), name).toEqual(kept(before))
      expect(cardPropertiesOf(once), name).toEqual(cardPropertiesOf(before))
    }
    // All four at once: the marks go after the head (ID, title, properties), the answer after the last review.
    const all = pageCards(applyOps(page, [{ kind: 'next', id: 'NC-1', on: true }, { kind: 'off', id: 'NC-1', on: true }, { kind: 'fix', id: 'NC-1', on: true }, { kind: 'review', id: 'NC-1', review: R }]).content)[0].line
    expect(texts({ parts: all.parts.filter((p) => !MARK.has(p.kind) && p.kind !== 'notitle') })).toEqual(texts({ parts: before.parts.filter((p) => !MARK.has(p.kind) && p.kind !== 'notitle') }))
  })

  it('the order the base defines: ID, title, properties, then off, next, notitle, fix, then the reviews', () => {
    const page = pageWith(`NC-1, title "Capital of Spain", tags "europe" "capitals", level "A2", ${R0}`)
    const ops: CardOp[] = [{ kind: 'fix', id: 'NC-1', on: true }, { kind: 'next', id: 'NC-1', on: true }, { kind: 'off', id: 'NC-1', on: true }, { kind: 'review', id: 'NC-1', review: R }]
    expect(lineOf(applyOps(page, ops).content)).toBe(`<!-- card: NC-1, title "Capital of Spain", tags "europe" "capitals", level "A2", off, next, fix, ${R0}, 2026-11-14T06:01:00.000Z good 9s -->`)
    const hidden = pageWith(`NC-1, title "T", tags ["x"], notitle, ${R0}`)
    expect(lineOf(applyOps(hidden, [{ kind: 'fix', id: 'NC-1', on: true }]).content)).toBe(`<!-- card: NC-1, title "T", tags ["x"], notitle, fix, ${R0} -->`)
  })

  it('a hand-written property keeps its bytes on a write (`tags  "a"   "b"`, `ratio 2.50`, `[ "a" ]`): the phone never rewrites a part it did not change', () => {
    for (const part of ['tags  "a"   "b"', 'ratio 2.50', 'n -0', 'list [ "a" ]', 'done  true', 'x 1.0']) {
      const page = pageWith(`NC-1, ${part}, ${R0}`)
      expect(lineOf(applyOps(page, [{ kind: 'review', id: 'NC-1', review: R }]).content), part).toBe(`<!-- card: NC-1, ${part}, ${R0}, 2026-11-14T06:01:00.000Z good 9s -->`)
    }
  })

  it('a title an older build wrote with a raw comma: a write encodes the comma, as the Mac does (YAZ-5393); a write that changes nothing keeps it', () => {
    const page = pageWith(`NC-1, title "1,000 islands", ${R0}`)
    expect(applyOps(page, [{ kind: 'next', id: 'NC-1', on: false }]).content).toBe(page)
    expect(lineOf(applyOps(page, [{ kind: 'review', id: 'NC-1', review: R }]).content)).toBe(`<!-- card: NC-1, title "1&#44;000 islands", ${R0}, 2026-11-14T06:01:00.000Z good 9s -->`)
  })
})

describe('the phone never sets a property (stage one): such a change cannot be sent', () => {
  const before = parseCardLine(`<!-- card: NC-1, title "T", tags "a" "b", level "A2", ${R0} -->`)!
  it.each([
    ['a new value', withCardProperty(before, 'level', 'B1')],
    ['a new property', withCardProperty(before, 'source', 'Atlas')],
    ['a removed property', withoutCardProperty(before, 'tags')],
    ['a renamed property', renameCardProperty(before, 'tags', 'topics')],
    ['a list of one in place of its value', withCardProperty(before, 'level', ['A2'])],
  ])('%s throws UnsentChangeError: nothing is half saved', (_name, after) => {
    expect(() => opsBetween('NC-1', before, after)).toThrow(UnsentChangeError)
  })

  it('marks and reviews next to properties still go as actions', () => {
    const after = parseCardLine(`<!-- card: NC-1, title "T", tags "a" "b", level "A2", off, fix, ${R0} -->`)!
    expect(opsBetween('NC-1', before, after)).toEqual([
      { kind: 'off', id: 'NC-1', on: true },
      { kind: 'fix', id: 'NC-1', on: true },
    ])
  })
})

/** An action that changes nothing on this line (Undo of a mark the line holds already, and so on): skipped. */
function isNoop(line: CardLine, op: CardOp): boolean {
  if (op.kind === 'off') return line.parts.some((p) => p.kind === 'off') === op.on
  if (op.kind === 'next') return line.parts.some((p) => p.kind === 'next') === op.on
  if (op.kind === 'fix') return line.parts.some((p) => p.kind === 'fix') === op.on
  return false
}

describe('an unswept vault (no property move yet, YAZ-5384; no title move, YAZ-5308): the phone reads it and never half-migrates it', () => {
  const file = `---\nkind: card\ntitle: Old title\ntags: [europe, capitals]\nlevel: A2\n---\n\n\`\`\`card\nCapital of Spain\n\nWhat is it?\n---\nMadrid\n\`\`\`\n<!-- card: NC-1, ${R0} -->\n`
  it('an answer, Fix later and Up next change only the card line: the front matter and the first line stay byte for byte, no property or title part is written', () => {
    const out = applyOps(file, [{ kind: 'review', id: 'NC-1', review: R }, { kind: 'fix', id: 'NC-1', on: true }, { kind: 'next', id: 'NC-1', on: true }]).content
    expect(out).toBe(file.replace(`<!-- card: NC-1, ${R0} -->`, `<!-- card: NC-1, next, fix, ${R0}, 2026-11-14T06:01:00.000Z good 9s -->`))
    expect(cardPropertiesOf(pageCards(out)[0].line)).toEqual({})
    expect(applyOps(out, [{ kind: 'unreview', id: 'NC-1', at: R.at, rating: R.rating }, { kind: 'fix', id: 'NC-1', on: false }, { kind: 'next', id: 'NC-1', on: false }]).content).toBe(file)
  })
})
