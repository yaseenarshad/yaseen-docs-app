import { describe, expect, it } from 'vitest'
import {
  EMPTY_CARD_LINE,
  cardCreatedOf,
  cardRecords,
  cardTime,
  formatCardLine,
  isCardPropertyName,
  pageCards,
  parseCardLine,
  settleCardCopy,
  withCardCreated,
  withCardFix,
  withCardId,
  withCardNext,
  withCardNoTitle,
  withCardOff,
  withCardProperty,
  withCardTitle,
  withCardTitleAt,
  type CardReview,
} from '@shared/cardLine'
import { uniteCardLines } from '@shared/cardMerge'
import { cardFileAsPage, moveCardOut, moveTextIntoCard, pageAsCardFile, putCardBack, splitCardFile } from '@shared/cardConvert'
import { spliceCardLine } from '../../../mobile/src/answers/splice'
import { applyOps, type CardOp } from '../../../mobile/src/answers/ops'

const STAMP = '2026-11-21T16:05:31.204Z'
const STAMP_2 = '2026-11-22T08:00:00.000Z'
const R1 = '2026-11-21T18:00:00.000Z good 5s'
const R2 = '2026-11-22T09:00:00.000Z easy 3s'

describe('shared/cardLine created part (YAZ-6166)', () => {
  it('parses canonical created timestamp without raw and round-trips', () => {
    const rawLine = `<!-- card: WIKI-512, created ${STAMP}, title "Capital of France" -->`
    const parsed = parseCardLine(rawLine)!
    expect(parsed.parts).toEqual([
      { kind: 'id', id: 'WIKI-512' },
      { kind: 'created', at: STAMP },
      { kind: 'title', title: 'Capital of France' },
    ])
    expect(cardCreatedOf(parsed)).toBe(STAMP)
    expect(formatCardLine(parsed)).toBe(rawLine)
  })

  it('parses non-canonical ISO dates/timestamps, normalizes at, and preserves raw bytes', () => {
    const cases: Array<[string, string]> = [
      ['created 2026-11-21', '2026-11-21T00:00:00.000Z'],
      ['created 2024-02-29', '2024-02-29T00:00:00.000Z'],
      ['created 2026-11-21T16:05Z', '2026-11-21T16:05:00.000Z'],
      ['created 2026-11-21T16:05:31Z', '2026-11-21T16:05:31.000Z'],
      ['created 2026-11-21T16:05:31.204999Z', '2026-11-21T16:05:31.204Z'],
      ['created 2026-11-21T09:05:31-07:00', '2026-11-21T16:05:31.000Z'],
      ['created  2026-11-21T16:05:31.204Z', '2026-11-21T16:05:31.204Z'],
    ]
    for (const [part, expectedAt] of cases) {
      const line = parseCardLine(`<!-- card: WIKI-1, ${part} -->`)!
      expect(cardCreatedOf(line), part).toBe(expectedAt)
      expect(line.parts[1], part).toEqual({ kind: 'created', at: expectedAt, raw: part })
      expect(formatCardLine(line), part).toBe(`<!-- card: WIKI-1, ${part} -->`)
    }
  })

  it('treats invalid dates/timestamps as unknown other parts and keeps their bytes', () => {
    for (const bad of [
      'created 2026-02-30',
      'created 2026-02-29',
      'created 2026-13-01',
      'created 2026-00-10',
      'created 2026-11-21T16:05:31',
      'created 2026-11-21T25:00:00Z',
      'created not-a-date',
      'created',
    ]) {
      const line = parseCardLine(`<!-- card: WIKI-1, ${bad} -->`)!
      expect(cardCreatedOf(line), bad).toBeNull()
      expect(line.parts[1], bad).toEqual({ kind: 'other', text: bad })
      expect(formatCardLine(line), bad).toBe(`<!-- card: WIKI-1, ${bad} -->`)
    }
  })

  it('keeps only the first created part; a second is kept as other', () => {
    const line = parseCardLine(`<!-- card: WIKI-1, created ${STAMP}, created ${STAMP_2} -->`)!
    expect(cardCreatedOf(line)).toBe(STAMP)
    expect(line.parts[2]).toEqual({ kind: 'other', text: `created ${STAMP_2}` })
  })

  it('reserves created in CARD_LINE_WORDS (case-insensitive)', () => {
    expect(isCardPropertyName('created')).toBe(false)
    expect(isCardPropertyName('Created')).toBe(false)
    expect(isCardPropertyName('CREATED')).toBe(false)
    expect(() => withCardProperty(EMPTY_CARD_LINE, 'created', '2026-11-21')).toThrow()
    const line = parseCardLine('<!-- card: WIKI-1, created "2026-11-21" -->')!
    expect(cardCreatedOf(line)).toBeNull()
    expect(line.parts[1]).toEqual({ kind: 'other', text: 'created "2026-11-21"' })
  })

  it('recovers created after an unclosed quote via isKnownPart', () => {
    const line = parseCardLine(`<!-- card: WIKI-1, title "unclosed, created ${STAMP}, off -->`)!
    expect(cardCreatedOf(line)).toBe(STAMP)
    expect(line.parts.some((p) => p.kind === 'off')).toBe(true)
  })

  it('withCardCreated places created right after id and before title, updates in place, and removes on null', () => {
    const base = parseCardLine('<!-- card: WIKI-1, title "Front", tags "a", off -->')!
    const stamped = withCardCreated(base, STAMP)
    expect(formatCardLine(stamped)).toBe(`<!-- card: WIKI-1, created ${STAMP}, title "Front", tags "a", off -->`)
    expect(withCardCreated(stamped, STAMP)).toBe(stamped)
    expect(formatCardLine(withCardCreated(stamped, STAMP_2))).toBe(`<!-- card: WIKI-1, created ${STAMP_2}, title "Front", tags "a", off -->`)
    expect(formatCardLine(withCardCreated(stamped, null))).toBe('<!-- card: WIKI-1, title "Front", tags "a", off -->')
    expect(withCardCreated(base, null)).toBe(base)
  })

  it('keeps created right after id when adding title, properties, and marks', () => {
    let line = withCardCreated(withCardId(EMPTY_CARD_LINE, 'WIKI-9'), STAMP)
    line = withCardTitle(line, 'Capital')
    line = withCardProperty(line, 'tags', ['geo'])
    line = withCardOff(line, true)
    line = withCardNext(line, true)
    line = withCardNoTitle(line, true)
    line = withCardTitleAt(line, 'side2')
    line = withCardFix(line, true)
    expect(formatCardLine(line)).toBe(`<!-- card: WIKI-9, created ${STAMP}, title "Capital", tags ["geo"], off, next, notitle, title-side2, fix -->`)
  })

  it('cardRecords includes created when stamped and omits it when unstamped', () => {
    const md = [
      '```card',
      'One',
      '```',
      `<!-- card: WIKI-1, created ${STAMP} -->`,
      '',
      '```card',
      'Two',
      '```',
      '<!-- card: WIKI-2 -->',
    ].join('\n')
    const recs = cardRecords(md)
    expect(recs[0]).toMatchObject({ id: 'WIKI-1', created: STAMP })
    expect('created' in recs[1]).toBe(false)
  })

  it('settleCardCopy keeps keeper created and strips created from an emptied copy', () => {
    const keeperLine = parseCardLine(`<!-- card: WIKI-1, created ${STAMP}, next, ${R1} -->`)!
    const copyLine = parseCardLine(`<!-- card: WIKI-1, created ${STAMP}, next, ${R2} -->`)!
    const settled = settleCardCopy({ line: keeperLine, text: 'Same' }, { line: copyLine, text: 'Same' })
    expect(settled.emptied).toBe(true)
    expect(cardCreatedOf(settled.keeper!)).toBe(STAMP)
    expect(cardCreatedOf(settled.copy)).toBeNull()
    expect(formatCardLine(settled.copy)).toBe('<!-- card: WIKI-1 -->')

    // Different text: both cards keep their own created stamp.
    const diff = settleCardCopy({ line: keeperLine, text: 'One' }, { line: copyLine, text: 'Two' })
    expect(diff.emptied).toBe(false)
    expect(cardCreatedOf(diff.keeper!)).toBe(STAMP)
    expect(cardCreatedOf(diff.copy)).toBe(STAMP)
  })
})

describe('shared/cardMerge preserves created (YAZ-6166)', () => {
  const page = (line: string) => `\`\`\`card\nQ\n---\nA\n\`\`\`\n<!-- card: ${line} -->\n`
  const lineOf = (md: string) => formatCardLine(pageCards(md)[0].line)!

  it('preserves created (including raw bytes) when both sides answer', () => {
    const base = page('WIKI-1, created 2026-11-21')
    const theirs = page(`WIKI-1, created 2026-11-21, ${R1}`)
    const mine = page(`WIKI-1, created 2026-11-21, ${R2}`)
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: WIKI-1, created 2026-11-21, ${R1}, ${R2} -->`)
  })

  it('never drops created when one side lacks it', () => {
    const base = page(`WIKI-1, created ${STAMP}`)
    const theirsDropped = page(`WIKI-1, ${R1}`)
    const mineKept = page(`WIKI-1, created ${STAMP}, ${R2}`)
    const [t1, m1] = uniteCardLines(base, theirsDropped, mineKept)
    expect(t1).toBe(m1)
    expect(lineOf(t1)).toBe(`<!-- card: WIKI-1, created ${STAMP}, ${R1}, ${R2} -->`)

    const theirsKept = page(`WIKI-1, created ${STAMP}, ${R1}`)
    const mineDropped = page(`WIKI-1, ${R2}`)
    const [t2, m2] = uniteCardLines(base, theirsKept, mineDropped)
    expect(t2).toBe(m2)
    expect(lineOf(t2)).toBe(`<!-- card: WIKI-1, created ${STAMP}, ${R1}, ${R2} -->`)
  })

  it('takes mine created when unstamped in base and theirs, placing it after id and before title', () => {
    const base = page('WIKI-1, title "Old"')
    const theirs = page(`WIKI-1, title "Old", ${R1}`)
    const mine = page(`WIKI-1, created ${STAMP}, title "New", ${R2}`)
    const [t, m] = uniteCardLines(base, theirs, mine)
    expect(t).toBe(m)
    expect(lineOf(t)).toBe(`<!-- card: WIKI-1, created ${STAMP}, title "New", ${R1}, ${R2} -->`)
  })

  it('resolves three-way created edits (only mine changed -> mine; both changed -> theirs)', () => {
    const base = page(`WIKI-1, created ${STAMP}`)
    const theirsSame = page(`WIKI-1, created ${STAMP}, ${R1}`)
    const mineChanged = page(`WIKI-1, created ${STAMP_2}, ${R2}`)
    const [t1, m1] = uniteCardLines(base, theirsSame, mineChanged)
    expect(t1).toBe(m1)
    expect(lineOf(t1)).toBe(`<!-- card: WIKI-1, created ${STAMP_2}, ${R1}, ${R2} -->`)

    const theirsChanged = page(`WIKI-1, created 2026-11-23T00:00:00.000Z, ${R1}`)
    const [t2, m2] = uniteCardLines(base, theirsChanged, mineChanged)
    expect(t2).toBe(m2)
    expect(lineOf(t2)).toBe(`<!-- card: WIKI-1, created 2026-11-23T00:00:00.000Z, ${R1}, ${R2} -->`)
  })
})

describe('shared/cardConvert preserves created byte-for-byte (YAZ-6166)', () => {
  const CARD_LINE = `<!-- card: GEO-140, created ${STAMP}, title "Capital", ${R1} -->`
  const NON_CANON = `<!-- card: GEO-141, created 2026-11-21, title "River" -->`
  const BLOCK = `\`\`\`card\nQ\n---\nA\n\`\`\`\n${CARD_LINE}`

  it('moveCardOut and putCardBack preserve created byte-for-byte', () => {
    const page = `# Europe\n\n${BLOCK}\n`
    const moved = moveCardOut(page, 'GEO-140')
    expect(moved.card.content).toContain(CARD_LINE)
    expect(putCardBack(moved.page, 'GEO-140', 0, moved.card.content, 'GEO-140')).toBe(page)
  })

  it('cardFileAsPage, pageAsCardFile, splitCardFile, and moveTextIntoCard preserve created byte-for-byte', () => {
    const cardFile = `---\nkind: card\n---\n${BLOCK}\n`
    const asPage = cardFileAsPage(cardFile)
    expect(asPage.content).toContain(CARD_LINE)
    const back = pageAsCardFile(asPage.content)!
    expect(back.content).toContain(CARD_LINE)

    const twoCards = `---\nkind: card\n---\n${BLOCK}\n\n\`\`\`card\nTwo\n\`\`\`\n${NON_CANON}\n`
    const split = splitCardFile(twoCards)!
    expect(split.keep).toContain(CARD_LINE)
    expect(split.cards[0].content).toContain(NON_CANON)

    const outside = `---\nkind: card\n---\nIntro\n\n${BLOCK}\n`
    expect(moveTextIntoCard(outside)).toContain(CARD_LINE)
  })
})

describe('mobile/src/answers/splice and applyOps preserve created byte-for-byte (YAZ-6166)', () => {
  const REVIEW: CardReview = { at: cardTime(Date.UTC(2026, 10, 22, 12, 0, 0)), rating: 'good', seconds: 8 }

  it('spliceCardLine preserves canonical and non-canonical created parts byte-for-byte', () => {
    for (const rawCreated of [`created ${STAMP}`, 'created 2026-11-21', 'created  2026-11-21T09:05:31-07:00']) {
      const text = `<!-- card: NC-1, ${rawCreated}, title "Card", ${R1} -->`
      const before = parseCardLine(text)!
      const after = withCardFix(before, true)
      const spliced = spliceCardLine(text, before, after)!
      expect(spliced).toBe(`<!-- card: NC-1, ${rawCreated}, title "Card", fix, ${R1} -->`)
    }
  })

  it('applyOps keeps created byte-for-byte across review, unreview, off, next, fix, notitle', () => {
    const rawCreated = 'created 2026-11-21'
    const page = `---\ntitle: P\n---\n\n\`\`\`card\nQ\n---\nA\n\`\`\`\n<!-- card: NC-1, ${rawCreated}, title "Card", ${R1} -->\n`
    const pairs: CardOp[][] = [
      [{ kind: 'review', id: 'NC-1', review: REVIEW }, { kind: 'unreview', id: 'NC-1', at: REVIEW.at, rating: REVIEW.rating }],
      [{ kind: 'off', id: 'NC-1', on: true }, { kind: 'off', id: 'NC-1', on: false }],
      [{ kind: 'next', id: 'NC-1', on: true }, { kind: 'next', id: 'NC-1', on: false }],
      [{ kind: 'fix', id: 'NC-1', on: true }, { kind: 'fix', id: 'NC-1', on: false }],
      [{ kind: 'notitle', id: 'NC-1', on: true }, { kind: 'notitle', id: 'NC-1', on: false }],
    ]
    for (const ops of pairs) {
      expect(applyOps(page, ops).content).toBe(page)
      expect(applyOps(page, [ops[0]]).content).toContain(`NC-1, ${rawCreated}, title "Card"`)
    }
  })
})
