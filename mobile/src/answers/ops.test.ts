import { describe, expect, it } from 'vitest'
import { CARD_SECONDS_MAX, cardRecords, formatCardLine, pageCards, parseCardLine, type CardReview } from '@shared/cardLine'
import { cardFileText, pageText } from '../sync/testing'
import { applyOps, opsBetween, type CardOp } from './ops'

const R1: CardReview = { at: '2026-11-14T06:01Z', rating: 'good', seconds: 9 }
const R2: CardReview = { at: '2026-11-14T06:02Z', rating: 'again' }
const page = pageText('Page', 'NC-1', ['NC-2', 'NC-3'], 'Some text.\n\n')
const file = cardFileText('Speed of light', 'NC-17')
const lineOf = (content: string, id: string) => formatCardLine(pageCards(content).find((c) => c.line.parts.some((p) => p.kind === 'id' && p.id === id))!.line)
const frontmatter = (content: string) => content.slice(0, content.indexOf('---\n', 4) + 4)

describe('applyOps (decision 2): each kind of action, by card ID, on the newest text', () => {
  const kinds: [string, CardOp[], string][] = [
    ['review', [{ kind: 'review', id: 'NC-2', review: R1 }], '<!-- card: NC-2, 2026-11-14T06:01Z good 9s -->'],
    ['unreview', [{ kind: 'review', id: 'NC-2', review: R1 }, { kind: 'review', id: 'NC-2', review: R2 }, { kind: 'unreview', id: 'NC-2', at: R1.at, rating: R1.rating }], '<!-- card: NC-2, 2026-11-14T06:02Z again -->'],
    ['off', [{ kind: 'off', id: 'NC-2', on: true }], '<!-- card: NC-2, off -->'],
    ['next', [{ kind: 'next', id: 'NC-2', on: true }], '<!-- card: NC-2, next -->'],
    ['fix', [{ kind: 'fix', id: 'NC-2', on: true }], '<!-- card: NC-2, fix -->'],
  ]
  for (const [name, ops, want] of kinds) {
    it(`${name}: on a page, only that card's line changes`, () => {
      const out = applyOps(page, ops)
      expect(out.lost).toEqual([])
      expect(lineOf(out.content, 'NC-2')).toBe(want)
      expect(lineOf(out.content, 'NC-3')).toBe('<!-- card: NC-3 -->')
      expect(out.content.replace(want, '<!-- card: NC-2 -->')).toBe(page)
    })
    it(`${name}: on a card file, the card line changes and the properties stay byte for byte`, () => {
      const out = applyOps(file, ops.map((op) => ({ ...op, id: 'NC-17' }) as CardOp))
      expect(out.lost).toEqual([])
      expect(lineOf(out.content, 'NC-17')).toBe(want.replace('NC-2', 'NC-17'))
      expect(frontmatter(out.content)).toBe(frontmatter(file))
      expect(frontmatter(out.content)).toBe('---\nkind: card\ntitle: Speed of light\n---\n')
    })
  }

  it('off, next and fix turn off again; an archived card is unarchived', () => {
    const marked = applyOps(page, [{ kind: 'off', id: 'NC-3', on: true }, { kind: 'next', id: 'NC-3', on: true }, { kind: 'fix', id: 'NC-3', on: true }]).content
    expect(lineOf(marked, 'NC-3')).toBe('<!-- card: NC-3, off, next, fix -->')
    const cleared = applyOps(marked, [{ kind: 'off', id: 'NC-3', on: false }, { kind: 'next', id: 'NC-3', on: false }, { kind: 'fix', id: 'NC-3', on: false }]).content
    expect(cleared).toBe(page)
  })

  it('an unknown ID comes back in `lost`; the other actions still apply; nothing is dropped silently', () => {
    const gone: CardOp = { kind: 'review', id: 'NC-99', review: R1 }
    const out = applyOps(page, [gone, { kind: 'off', id: 'NC-2', on: true }])
    expect(out.lost).toEqual([gone])
    expect(lineOf(out.content, 'NC-2')).toBe('<!-- card: NC-2, off -->')
  })

  it('a page that only EMBEDS the card does not hold it: the action is lost for that page, and the page does not change', () => {
    const embedding = pageText('Embeds', 'NC-30', [], 'See ![[NC-17]] here.\n\n')
    const op: CardOp = { kind: 'review', id: 'NC-17', review: R1 }
    expect(applyOps(embedding, [op])).toEqual({ content: embedding, lost: [op] })
  })

  it('idempotent: one action applied two times adds ONE review (a send that reached GitHub but whose answer was lost)', () => {
    const op: CardOp = { kind: 'review', id: 'NC-2', review: R1 }
    const once = applyOps(page, [op]).content
    expect(applyOps(once, [op]).content).toBe(once)
    expect(applyOps(page, [op, op]).content).toBe(once)
    // The same review with no seconds is the same review (cardReviewKey): still one.
    expect(applyOps(once, [{ kind: 'review', id: 'NC-2', review: { at: R1.at, rating: R1.rating } }]).content).toBe(once)
    expect(cardRecords(once)[0].reviews).toHaveLength(1)
  })

  it('YAZ-5078: two answers in ONE minute with one rating are two reviews, as the Mac writes them; each still goes one time', () => {
    // A new card comes back in the same session: Remembered, then Remembered again, in the same minute.
    const twice: CardOp[] = [
      { kind: 'review', id: 'NC-2', review: R1 },
      { kind: 'review', id: 'NC-2', review: R1, nth: 2 },
    ]
    const once = applyOps(page, twice).content
    expect(lineOf(once, 'NC-2')).toBe('<!-- card: NC-2, 2026-11-14T06:01Z good 9s, 2026-11-14T06:01Z good 9s -->')
    // Sent again (the send reached GitHub, its answer was lost): no third review.
    expect(applyOps(once, twice).content).toBe(once)
    // An action from before this field (no `nth`) is the first of its minute, as before.
    expect(applyOps(once, [{ kind: 'review', id: 'NC-2', review: R1 }]).content).toBe(once)
  })

  it('YAZ-5181: `unreview` names ONE review (time and rating): applied two times, it takes one review; the other of that minute stays', () => {
    const two = applyOps(page, [{ kind: 'review', id: 'NC-2', review: { at: R1.at, rating: 'again' } }, { kind: 'review', id: 'NC-2', review: R1 }]).content
    const op: CardOp = { kind: 'unreview', id: 'NC-2', at: R1.at, rating: R1.rating }
    const once = applyOps(two, [op]).content
    expect(lineOf(once, 'NC-2')).toBe(`<!-- card: NC-2, ${R1.at} again -->`)
    expect(applyOps(once, [op]).content).toBe(once)
    expect(applyOps(two, [op, op]).content).toBe(once)
  })

  it('YAZ-5198: an `unreview` names WHICH identical copy (`nth`): two identical entries, the unreview of the second applied two times leaves ONE', () => {
    const two = applyOps(page, [{ kind: 'review', id: 'NC-2', review: { at: R1.at, rating: 'again', seconds: 3 } }, { kind: 'review', id: 'NC-2', review: { at: R1.at, rating: 'again', seconds: 4 }, nth: 2 }]).content
    expect(lineOf(two, 'NC-2')).toBe(`<!-- card: NC-2, ${R1.at} again 3s, ${R1.at} again 4s -->`)
    const op: CardOp = { kind: 'unreview', id: 'NC-2', at: R1.at, rating: 'again', nth: 2 }
    const once = applyOps(two, [op]).content
    expect(lineOf(once, 'NC-2')).toBe(`<!-- card: NC-2, ${R1.at} again 3s -->`)
    expect(applyOps(once, [op]).content).toBe(once)
    // The first copy's unreview (nth 1) still takes the one left, and only once.
    const first: CardOp = { kind: 'unreview', id: 'NC-2', at: R1.at, rating: 'again', nth: 1 }
    const none = applyOps(once, [first]).content
    expect(lineOf(none, 'NC-2')).toBe('<!-- card: NC-2 -->')
    expect(applyOps(none, [first]).content).toBe(none)
  })

  it('the order of the actions is kept: archive then unarchive is not archived; unarchive then archive is', () => {
    expect(applyOps(page, [{ kind: 'off', id: 'NC-2', on: true }, { kind: 'off', id: 'NC-2', on: false }]).content).toBe(page)
    expect(lineOf(applyOps(page, [{ kind: 'off', id: 'NC-2', on: false }, { kind: 'off', id: 'NC-2', on: true }]).content, 'NC-2')).toBe('<!-- card: NC-2, off -->')
    expect(applyOps(page, [{ kind: 'review', id: 'NC-2', review: R1 }, { kind: 'unreview', id: 'NC-2', at: R1.at, rating: R1.rating }]).content).toBe(page)
  })

  it('a new review goes after the reviews already on the line, as the Mac writes it', () => {
    const answered = applyOps(page, [{ kind: 'review', id: 'NC-2', review: R2 }]).content
    expect(lineOf(applyOps(answered, [{ kind: 'review', id: 'NC-2', review: R1 }]).content, 'NC-2')).toBe('<!-- card: NC-2, 2026-11-14T06:02Z again, 2026-11-14T06:01Z good 9s -->')
  })

  it('a page with CRLF line ends keeps them; a page with no change comes back as the same string', () => {
    const crlf = page.replace(/\n/g, '\r\n')
    const out = applyOps(crlf, [{ kind: 'review', id: 'NC-3', review: R1 }]).content
    expect(out).toContain('<!-- card: NC-3, 2026-11-14T06:01Z good 9s -->\r\n')
    expect(out.replace(/\r\n/g, '')).not.toContain('\n')
    expect(applyOps(page, [])).toEqual({ content: page, lost: [] })
  })

  it('500 actions on one page: one read of the page, the right lines', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `NC-${100 + i}`)
    const big = pageText('Big', 'NC-1', ids)
    const ops: CardOp[] = ids.flatMap((id, i) => [0, 1, 2, 3, 4].map((m) => ({ kind: 'review', id, review: { at: `2026-11-14T0${m}:${String(i % 60).padStart(2, '0')}Z`, rating: 'good' } }) as CardOp))
    const t0 = performance.now()
    const out = applyOps(big, ops)
    expect(performance.now() - t0).toBeLessThan(500)
    expect(out.lost).toEqual([])
    expect(cardRecords(out.content).every((c) => c.reviews.length === 5)).toBe(true)
  })
})

describe('the older-app rule (round 10, addition 17)', () => {
  it('each line that applyOps writes reads back the same with the card parser, and holds only parts the Mac reads or keeps', () => {
    const ops: CardOp[] = [
      { kind: 'review', id: 'NC-2', review: R1 },
      { kind: 'review', id: 'NC-2', review: { at: '2026-11-14T06:03Z', rating: 'easy', seconds: CARD_SECONDS_MAX } },
      { kind: 'review', id: 'NC-2', review: R2 },
      { kind: 'off', id: 'NC-2', on: true },
      { kind: 'next', id: 'NC-3', on: true },
      { kind: 'fix', id: 'NC-3', on: true },
      { kind: 'unreview', id: 'NC-2', at: R2.at, rating: R2.rating },
    ]
    const out = applyOps(page, ops).content
    const written = out.split('\n').filter((l) => l.startsWith('<!-- card:'))
    expect(written).toHaveLength(2)
    for (const text of written) {
      const parsed = parseCardLine(text)!
      expect(formatCardLine(parsed)).toBe(text)
      for (const part of parsed.parts) expect(part.kind === 'other' ? part.text : part.kind).toMatch(/^(id|review|off|next|fix)$/)
    }
    // The card text, the properties and every other line are the Mac's own bytes.
    expect(out.split('\n').filter((l) => !l.startsWith('<!-- card:'))).toEqual(page.split('\n').filter((l) => !l.startsWith('<!-- card:')))
  })
})

describe('opsBetween: a change of one card line as actions (the review host\'s ⋯ menu)', () => {
  const line = (text: string) => parseCardLine(text)!
  it('marks and reviews become actions; the same line is none', () => {
    const before = line('<!-- card: NC-2, next, 2026-11-14T06:02Z again -->')
    expect(opsBetween('NC-2', before, before)).toEqual([])
    expect(opsBetween('NC-2', before, line('<!-- card: NC-2, off, 2026-11-14T06:02Z again, 2026-11-14T06:01Z good 9s -->'))).toEqual([
      { kind: 'off', id: 'NC-2', on: true },
      { kind: 'next', id: 'NC-2', on: false },
      { kind: 'review', id: 'NC-2', review: R1 },
    ])
    expect(opsBetween('NC-2', before, line('<!-- card: NC-2, next, fix -->'))).toEqual([
      { kind: 'fix', id: 'NC-2', on: true },
      { kind: 'unreview', id: 'NC-2', at: R2.at, rating: R2.rating },
    ])
  })
  it('YAZ-5198: identical copies are counted: removing the second of two names it (`nth: 2`); adding a second names it too', () => {
    const two = line(`<!-- card: NC-2, ${R1.at} again 3s, ${R1.at} again 4s -->`)
    const one = line(`<!-- card: NC-2, ${R1.at} again 3s -->`)
    expect(opsBetween('NC-2', two, one)).toEqual([{ kind: 'unreview', id: 'NC-2', at: R1.at, rating: 'again', nth: 2 }])
    expect(opsBetween('NC-2', one, two)).toEqual([{ kind: 'review', id: 'NC-2', review: { at: R1.at, rating: 'again', seconds: 4 }, nth: 2 }])
  })
  it('a change the phone cannot send (for example the title on the front) is refused, not lost', () => {
    expect(() => opsBetween('NC-2', line('<!-- card: NC-2 -->'), line('<!-- card: NC-2, notitle -->'))).toThrow(/cannot send/)
  })
})
