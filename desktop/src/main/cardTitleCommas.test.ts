// YAZ-5393 (decision: encode commas) and YAZ-5394: a card-line title survives an OLDER build's writes, and a quote
// that never closes never hides the parts after it.
import { describe, expect, it } from 'vitest'
import { cardReviewsOf, cardTitleOf, changeCard, cleanCardTitle, formatCardLine, isCardNext, isCardOff, parseCardLine, withCardReview, withCardTitle, type CardLine } from '@shared/cardLine'
import { canonicalPageId, isNumberId } from '@shared/pageId'

/**
 * A FROZEN COPY of an OLDER build's card line rules (the Mac at `337eed0a6`, the phone at `753a57dfe`: before YAZ-5308),
 * word for word, only what these writes use: it splits the body on EVERY comma, keeps an unknown part verbatim and
 * joins the parts with `, `. Never import it outside this test.
 */
namespace older {
  type Review = { at: string; rating: string; seconds?: number }
  type Part = { kind: 'id'; id: string } | { kind: 'review'; review: Review } | { kind: 'off' } | { kind: 'next' } | { kind: 'notitle' } | { kind: 'other'; text: string }
  export type Line = { parts: Part[] }
  const LINE_RE = /^<!--[ \t]*card:[ \t]*(.*?)[ \t]*-->$/
  const REVIEW_RE = /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\dZ)[ \t]+(again|hard|good|easy)(?:[ \t]+(0|[1-9]\d{0,4})s)?$/
  export function parseCardLine(value: string): Line | null {
    const body = LINE_RE.exec(value.trim())?.[1]
    if (body === undefined || body.includes('-->')) return null
    const parts: Part[] = []
    let id = false
    for (const text of body.split(/[ \t]*,[ \t]*/)) {
      if (text === '') continue
      const review = REVIEW_RE.exec(text)
      const seconds = review?.[3] === undefined ? undefined : Number(review[3])
      if (review !== null && (seconds === undefined || seconds <= 86400)) parts.push({ kind: 'review', review: seconds === undefined ? { at: review[1], rating: review[2] } : { at: review[1], rating: review[2], seconds } })
      else if (text === 'off') parts.push({ kind: 'off' })
      else if (text === 'next') parts.push({ kind: 'next' })
      else if (text === 'notitle') parts.push({ kind: 'notitle' })
      else if (!id && isNumberId(text)) {
        id = true
        parts.push({ kind: 'id', id: canonicalPageId(text) })
      } else parts.push({ kind: 'other', text })
    }
    return { parts }
  }
  const formatCardReview = (r: Review): string => (r.seconds !== undefined ? `${r.at} ${r.rating} ${r.seconds}s` : `${r.at} ${r.rating}`)
  export function formatCardLine(line: Line): string | null {
    const parts = line.parts.map((p) => (p.kind === 'id' ? p.id : p.kind === 'review' ? formatCardReview(p.review) : p.kind === 'other' ? p.text : p.kind))
    return parts.length === 0 ? null : `<!-- card: ${parts.join(', ')} -->`
  }
  export const isCardOff = (line: Line): boolean => line.parts.some((p) => p.kind === 'off')
  export const isCardNext = (line: Line): boolean => line.parts.some((p) => p.kind === 'next')
  export const reviewsOf = (line: Line): Review[] => line.parts.flatMap((p) => (p.kind === 'review' ? [p.review] : []))
  export function withCardOff(line: Line, off: boolean): Line {
    if (isCardOff(line) === off) return line
    if (!off) return { parts: line.parts.filter((p) => p.kind !== 'off') }
    const at = line.parts.findIndex((p) => p.kind === 'id') + 1
    return { parts: [...line.parts.slice(0, at), { kind: 'off' }, ...line.parts.slice(at)] }
  }
  export function withCardNext(line: Line, on: boolean): Line {
    if (isCardNext(line) === on) return line
    if (!on) return { parts: line.parts.filter((p) => p.kind !== 'next') }
    let i = line.parts.findIndex((p) => p.kind === 'id') + 1
    if (line.parts[i]?.kind === 'off') i++
    return { parts: [...line.parts.slice(0, i), { kind: 'next' }, ...line.parts.slice(i)] }
  }
  export function withCardNoTitle(line: Line): Line {
    let i = line.parts.findIndex((p) => p.kind === 'id') + 1
    while (line.parts[i]?.kind === 'off' || line.parts[i]?.kind === 'next') i++
    return { parts: [...line.parts.slice(0, i), { kind: 'notitle' }, ...line.parts.slice(i)] }
  }
  export function withCardReview(line: Line, review: Review): Line {
    const last = line.parts.map((p) => p.kind === 'review').lastIndexOf(true)
    const at = last === -1 ? line.parts.length : last + 1
    return { parts: [...line.parts.slice(0, at), { kind: 'review', review }, ...line.parts.slice(at)] }
  }
}

const R1 = '2026-11-01T09:00Z good'
const ANSWER = { at: '2026-11-14T06:01Z', rating: 'good' as const, seconds: 9 }
/** The title part of a line: `title "…"`, as its bytes. */
const titlePart = (text: string): string => /title "(?:[^"\\]|\\.)*"/.exec(text)![0]

/** Every row of YAZ-5393's table: a title with a comma that an older build changed. */
const TABLE = ['1,000 islands', 'Rome,Italy', 'a , b', 'a,,b', 'Ready, next, go', 'a, off, b', 'x, 2026-11-12T14:05Z good, y']

/** An older build's writes: an answer (it takes `next` off in the same write), Up next, Archive card and their undos, `notitle`. */
const OLDER_WRITES: Array<[string, (l: older.Line) => older.Line]> = [
  ['an answer', (l) => older.withCardNext(older.withCardReview(l, ANSWER), false)],
  ['Up next on', (l) => older.withCardNext(l, true)],
  ['Up next on, then off', (l) => older.withCardNext(older.withCardNext(l, true), false)],
  ['Archive card', (l) => older.withCardOff(l, true)],
  ['Archive card, then Unarchive', (l) => older.withCardOff(older.withCardOff(l, true), false)],
  ['Title on the front: Hide', (l) => older.withCardNoTitle(l)],
  ['no change', (l) => l],
]

describe('YAZ-5393: the writer never puts a raw comma in a title, so an older build keeps the title part whole', () => {
  it.each(TABLE)('%s', (title) => {
    const text = formatCardLine(withCardTitle(parseCardLine(`<!-- card: NC-1, ${R1} -->`)!, title))!
    const part = titlePart(text)
    expect(part).not.toContain(',')
    // The new reader reads the title back.
    expect(cardTitleOf(parseCardLine(text)!)).toBe(cleanCardTitle(title))

    // The older reader: the title is ONE unknown part; no word of it is `next`, `off` or a review.
    const old = older.parseCardLine(text)!
    expect(old.parts.map((p) => p.kind)).toEqual(['id', 'other', 'review'])
    expect(old.parts[1]).toEqual({ kind: 'other', text: part })
    expect(older.isCardOff(old)).toBe(false)
    expect(older.isCardNext(old)).toBe(false)
    expect(older.reviewsOf(old)).toEqual([{ at: '2026-11-01T09:00Z', rating: 'good' }])

    // Each older write keeps the title part byte for byte, and the new reader still reads the title.
    for (const [name, write] of OLDER_WRITES) {
      const after = older.formatCardLine(write(old))!
      expect(titlePart(after), name).toBe(part)
      expect(cardTitleOf(parseCardLine(after)!), name).toBe(cleanCardTitle(title))
    }
  })

  it('before the fix, the same older writes changed the raw-comma title (the bug, kept as proof)', () => {
    const raw = '<!-- card: NC-1, title "1,000 islands", 2026-11-01T09:00Z good -->'
    expect(older.formatCardLine(older.parseCardLine(raw)!)).toBe('<!-- card: NC-1, title "1, 000 islands", 2026-11-01T09:00Z good -->')
  })

  it('the line as written: `&#44;` for a comma, and an `&` that starts `&#44;` or `&#38;` as `&#38;`; any other `&` as it is', () => {
    const write = (title: string): string => titlePart(formatCardLine(withCardTitle({ parts: [] }, title))!)
    expect(write('1,000 islands')).toBe('title "1&#44;000 islands"')
    expect(write('Q&A, part 2')).toBe('title "Q&A&#44; part 2"')
    expect(write('the code &#44; is a comma')).toBe('title "the code &#38;#44; is a comma"')
    expect(write('&#38;')).toBe('title "&#38;#38;"')
    expect(write('Paris, "the" --> city \\')).toBe('title "Paris&#44; \\"the\\" --\\> city \\\\"')
    for (const title of ['1,000 islands', 'Q&A, part 2', 'the code &#44; is a comma', '&#38;', '&#38;#44;', '&amp; &#45;', 'Paris, "the" --> city \\', '\\&#44;'])
      expect(cardTitleOf(parseCardLine(`<!-- card: NC-1, ${write(title)} -->`)!)).toBe(title)
  })

  it('a title with no comma and no `&#44;` / `&#38;` is written as before: byte for byte', () => {
    for (const text of ['<!-- card: DEMO-1, title "Capital of France", 2026-11-12T14:05Z good -->', '<!-- card: DEMO-1, title "Q&A \\"x\\" --\\> \\\\ 🚀", off -->'])
      expect(formatCardLine(parseCardLine(text)!)).toBe(text)
  })

  it('a line an older build already split is read as it stands, and made no worse: the next write encodes its commas', () => {
    // `1,000 islands` after one older write; `Ready, next, go` after an older answer took `next` out of it.
    for (const [body, title] of [
      ['NC-1, title "1, 000 islands", 2026-11-01T09:00Z good', '1, 000 islands'],
      ['NC-1, title "Ready, go", 2026-11-01T09:00Z good', 'Ready, go'],
      ['NC-1, title "a, b", 2026-11-01T09:00Z good', 'a, b'],
    ]) {
      const line = parseCardLine(`<!-- card: ${body} -->`)!
      expect(cardTitleOf(line)).toBe(title)
      expect(cardReviewsOf(line)).toHaveLength(1)
      const written = formatCardLine(withCardReview(line, ANSWER))!
      expect(cardTitleOf(parseCardLine(written)!)).toBe(title)
      expect(cardReviewsOf(parseCardLine(written)!)).toHaveLength(2)
      // From now on an older build keeps it whole.
      expect(older.formatCardLine(older.withCardNext(older.withCardReview(older.parseCardLine(written)!, ANSWER), false))).toContain(titlePart(written))
    }
  })

  it('a write that changes nothing leaves an older raw-comma line as it is; a write that changes it encodes the comma', () => {
    const page = '```card\nFront\n```\n<!-- card: NC-1, title "1,000 islands", 2026-11-01T09:00Z good -->\n'
    expect(changeCard(page, 'NC-1', (l) => l)).toBe(page)
    expect(changeCard(page, 'NC-1', (l) => withCardReview(l, ANSWER))).toBe('```card\nFront\n```\n<!-- card: NC-1, title "1&#44;000 islands", 2026-11-01T09:00Z good, 2026-11-14T06:01Z good 9s -->\n')
  })

  it('a YAZ-5308 build from before this fix reads `&#44;` as letters and writes it back the same', () => {
    // That build's title escapes, word for word: `\x` is x, nothing else.
    const unquote = (q: string): string => q.replace(/\\(.)/g, '$1')
    const quote = (t: string): string => `"${t.replace(/[\\">]/g, (c) => `\\${c}`)}"`
    const part = titlePart(formatCardLine(withCardTitle({ parts: [] }, 'Rome, "Italy"'))!)
    const inner = part.slice('title '.length)
    expect(`title ${quote(unquote(inner.slice(1, -1)))}`).toBe(part)
  })
})

describe('YAZ-5394: a quote that never closes never hides the parts after it', () => {
  const read = (body: string): CardLine => parseCardLine(`<!-- card: ${body} -->`)!

  it('the issue`s line: its review reads, the line is written back byte for byte, and an answer after it reads back', () => {
    const text = '<!-- card: NC-1, title "x, 2026-11-01T09:00Z good -->'
    const line = parseCardLine(text)!
    expect(cardReviewsOf(line)).toEqual([{ at: '2026-11-01T09:00Z', rating: 'good' }])
    expect(cardTitleOf(line)).toBe('')
    expect(formatCardLine(line)).toBe(text)
    const answered = formatCardLine(withCardReview(line, ANSWER))!
    expect(answered).toBe('<!-- card: NC-1, title "x, 2026-11-01T09:00Z good, 2026-11-14T06:01Z good 9s -->')
    expect(cardReviewsOf(parseCardLine(answered)!)).toHaveLength(2)
  })

  it('a quote in any unknown part: the reviews and marks after it read', () => {
    const line = read('NC-1, note 5" screen, 2026-11-01T09:00Z good, off, next')
    expect(cardReviewsOf(line)).toHaveLength(1)
    expect(isCardOff(line)).toBe(true)
    expect(isCardNext(line)).toBe(true)
    expect(line.parts.map((p) => p.kind)).toEqual(['id', 'other', 'review', 'off', 'next'])
  })

  it('the pieces that are no known part stay ONE part, with their own commas and spaces', () => {
    const text = '<!-- card: NC-1, title "1,000 islands ,  more, 2026-11-01T09:00Z good, tail,x -->'
    const line = parseCardLine(text)!
    expect(line.parts).toEqual([
      { kind: 'id', id: 'NC-1' },
      { kind: 'other', text: 'title "1,000 islands ,  more' },
      { kind: 'review', review: { at: '2026-11-01T09:00Z', rating: 'good' } },
      { kind: 'other', text: 'tail,x' },
    ])
    expect(formatCardLine(line)).toBe(text)
  })

  it('a closed quote after an unclosed one changes nothing: the rest is still split on its commas', () => {
    const line = read('NC-1, a"b, title "c, d", 2026-11-01T09:00Z good')
    expect(cardReviewsOf(line)).toHaveLength(1)
  })
})
