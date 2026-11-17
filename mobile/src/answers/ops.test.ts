import { describe, expect, it } from 'vitest'
import { CARD_SECONDS_MAX, cardRecords, formatCardLine, pageCards, parseCardLine, type CardReview } from '@shared/cardLine'
import { cardFileText, pageText } from '../sync/testing'
import { applyOps, opsBetween, type CardOp } from './ops'

const R1: CardReview = { at: '2026-11-14T06:01:00.000Z', rating: 'good', seconds: 9 }
const R2: CardReview = { at: '2026-11-14T06:02:00.000Z', rating: 'again' }
const page = pageText('Page', 'NC-1', ['NC-2', 'NC-3'], 'Some text.\n\n')
const file = cardFileText('Speed of light', 'NC-17')
const lineOf = (content: string, id: string) => formatCardLine(pageCards(content).find((c) => c.line.parts.some((p) => p.kind === 'id' && p.id === id))!.line)
const frontmatter = (content: string) => content.slice(0, content.indexOf('---\n', 4) + 4)

describe('applyOps (decision 2): each kind of action, by card ID, on the newest text', () => {
  const kinds: [string, CardOp[], string][] = [
    ['review', [{ kind: 'review', id: 'NC-2', review: R1 }], '<!-- card: NC-2, 2026-11-14T06:01:00.000Z good 9s -->'],
    ['unreview', [{ kind: 'review', id: 'NC-2', review: R1 }, { kind: 'review', id: 'NC-2', review: R2 }, { kind: 'unreview', id: 'NC-2', at: R1.at, rating: R1.rating }], '<!-- card: NC-2, 2026-11-14T06:02:00.000Z again -->'],
    ['off', [{ kind: 'off', id: 'NC-2', on: true }], '<!-- card: NC-2, off -->'],
    ['next', [{ kind: 'next', id: 'NC-2', on: true }], '<!-- card: NC-2, next -->'],
    ['fix', [{ kind: 'fix', id: 'NC-2', on: true }], '<!-- card: NC-2, fix -->'],
    ['notitle', [{ kind: 'notitle', id: 'NC-2', on: true }], '<!-- card: NC-2, notitle -->'],
    // YAZ-5697 round 2: Title in review › on the phone, the Mac's words.
    ['title', [{ kind: 'title', id: 'NC-2', choice: 'side2' }], '<!-- card: NC-2, title-side2 -->'],
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
      // YAZ-5308: the card file's title is on its card line, right after the ID; the action keeps it there.
      expect(lineOf(out.content, 'NC-17')).toBe(want.replace('NC-2', 'NC-17, title "Speed of light"'))
      expect(frontmatter(out.content)).toBe(frontmatter(file))
      expect(frontmatter(out.content)).toBe('---\nkind: card\n---\n')
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

  it('YAZ-5642: two answers in one minute have two millisecond times: both go on, each one time; Undo takes exactly the one it names', () => {
    const a: CardReview = { at: '2026-11-14T06:01:12.345Z', rating: 'again', seconds: 4 }
    const b: CardReview = { at: '2026-11-14T06:01:41.802Z', rating: 'again', seconds: 3 }
    const ops: CardOp[] = [{ kind: 'review', id: 'NC-2', review: a }, { kind: 'review', id: 'NC-2', review: b }]
    const both = applyOps(page, ops).content
    expect(lineOf(both, 'NC-2')).toBe(`<!-- card: NC-2, ${a.at} again 4s, ${b.at} again 3s -->`)
    expect(applyOps(both, ops).content).toBe(both) // a resend adds nothing
    const undo: CardOp = { kind: 'unreview', id: 'NC-2', at: a.at, rating: 'again' }
    const once = applyOps(both, [undo]).content
    expect(lineOf(once, 'NC-2')).toBe(`<!-- card: NC-2, ${b.at} again 3s -->`)
    expect(applyOps(once, [undo]).content).toBe(once) // a resend of the Undo takes nothing more
  })

  it('YAZ-5181: `unreview` names ONE review (time and rating): applied two times, it takes one review; the other of that minute stays', () => {
    const two = applyOps(page, [{ kind: 'review', id: 'NC-2', review: { at: R1.at, rating: 'again' } }, { kind: 'review', id: 'NC-2', review: R1 }]).content
    const op: CardOp = { kind: 'unreview', id: 'NC-2', at: R1.at, rating: R1.rating }
    const once = applyOps(two, [op]).content
    expect(lineOf(once, 'NC-2')).toBe(`<!-- card: NC-2, ${R1.at} again -->`)
    expect(applyOps(once, [op]).content).toBe(once)
    expect(applyOps(two, [op, op]).content).toBe(once)
  })

  it('the order of the actions is kept: archive then unarchive is not archived; unarchive then archive is', () => {
    expect(applyOps(page, [{ kind: 'off', id: 'NC-2', on: true }, { kind: 'off', id: 'NC-2', on: false }]).content).toBe(page)
    expect(lineOf(applyOps(page, [{ kind: 'off', id: 'NC-2', on: false }, { kind: 'off', id: 'NC-2', on: true }]).content, 'NC-2')).toBe('<!-- card: NC-2, off -->')
    expect(applyOps(page, [{ kind: 'review', id: 'NC-2', review: R1 }, { kind: 'unreview', id: 'NC-2', at: R1.at, rating: R1.rating }]).content).toBe(page)
  })

  it('a new review goes after the reviews already on the line, as the Mac writes it; an older one at its time (YAZ-5520)', () => {
    const answered = applyOps(page, [{ kind: 'review', id: 'NC-2', review: R1 }]).content
    expect(lineOf(applyOps(answered, [{ kind: 'review', id: 'NC-2', review: R2 }]).content, 'NC-2')).toBe('<!-- card: NC-2, 2026-11-14T06:01:00.000Z good 9s, 2026-11-14T06:02:00.000Z again -->')
    const late = applyOps(page, [{ kind: 'review', id: 'NC-2', review: R2 }]).content
    expect(lineOf(applyOps(late, [{ kind: 'review', id: 'NC-2', review: R1 }]).content, 'NC-2')).toBe('<!-- card: NC-2, 2026-11-14T06:01:00.000Z good 9s, 2026-11-14T06:02:00.000Z again -->')
  })

  it('a page with CRLF line ends keeps them; a page with no change comes back as the same string', () => {
    const crlf = page.replace(/\n/g, '\r\n')
    const out = applyOps(crlf, [{ kind: 'review', id: 'NC-3', review: R1 }]).content
    expect(out).toContain('<!-- card: NC-3, 2026-11-14T06:01:00.000Z good 9s -->\r\n')
    expect(out.replace(/\r\n/g, '')).not.toContain('\n')
    expect(applyOps(page, [])).toEqual({ content: page, lost: [] })
  })

  it('YAZ-5514 W1: an answer on a mixed line end page changes only its card line', () => {
    // Pasted from Windows: the properties and one paragraph end in CRLF, the rest in LF. Each line keeps its own end.
    const mixed = '---\r\ntitle: P\r\n---\r\n# A\n\nPasted from Windows\r\nmore\n\n```card\nQ\n```\n<!-- card: NC-1 -->\n\n```card\nQ2\r\n```\r\n<!-- card: NC-2 -->\r\n'
    const out = applyOps(mixed, [
      { kind: 'review', id: 'NC-1', review: R1 },
      { kind: 'off', id: 'NC-2', on: true },
    ]).content
    const a = mixed.split('\n')
    const b = out.split('\n')
    expect(b).toHaveLength(a.length)
    expect(a.map((l, i) => (l === b[i] ? null : [l, b[i]])).filter((x) => x !== null)).toEqual([
      ['<!-- card: NC-1 -->', '<!-- card: NC-1, 2026-11-14T06:01:00.000Z good 9s -->'],
      ['<!-- card: NC-2 -->\r', '<!-- card: NC-2, off -->\r'],
    ])
  })

  it('YAZ-5514: a mark set again later in one list counts once, as its last value: the list applied two times gives the same bytes', () => {
    // From the answer and mark fuzz (seed 289): Up next off (the answer) and on again (the menu), with Show title.
    const text = '# A\n\n```card\nQ\n```\n<!--card:NC-4 , notitle,off,\tfix , title "a &#44; b", fix  -->\n'
    const ops: CardOp[] = [
      { kind: 'review', id: 'nc-4', review: { at: '2026-11-14T06:00:00.000Z', rating: 'hard' } },
      { kind: 'next', id: 'nc-4', on: false },
      { kind: 'fix', id: 'NC-4', on: true },
      { kind: 'next', id: 'NC-4', on: true },
      { kind: 'notitle', id: 'nc-4', on: false },
    ]
    const once = applyOps(text, ops).content
    expect(applyOps(once, ops).content).toBe(once)
    // A card that holds Up next already keeps it in its place: off then on in one list changes no byte.
    const held = applyOps(once, [{ kind: 'next', id: 'NC-4', on: false }, { kind: 'next', id: 'NC-4', on: true }])
    expect(held.content).toBe(once)
    expect(applyOps(text, [{ kind: 'off', id: 'NC-4', on: false }, { kind: 'off', id: 'NC-4', on: true }]).content).toBe(text)
  })

  it('500 actions on one page: one read of the page, the right lines', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `NC-${100 + i}`)
    const big = pageText('Big', 'NC-1', ids)
    const ops: CardOp[] = ids.flatMap((id, i) => [0, 1, 2, 3, 4].map((m) => ({ kind: 'review', id, review: { at: `2026-11-14T0${m}:${String(i % 60).padStart(2, '0')}:00.000Z`, rating: 'good' } }) as CardOp))
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
      { kind: 'review', id: 'NC-2', review: { at: '2026-11-14T06:03:00.000Z', rating: 'easy', seconds: CARD_SECONDS_MAX } },
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
    const before = line('<!-- card: NC-2, next, 2026-11-14T06:02:00.000Z again -->')
    expect(opsBetween('NC-2', before, before)).toEqual([])
    expect(opsBetween('NC-2', before, line('<!-- card: NC-2, off, 2026-11-14T06:02:00.000Z again, 2026-11-14T06:01:00.000Z good 9s -->'))).toEqual([
      { kind: 'off', id: 'NC-2', on: true },
      { kind: 'next', id: 'NC-2', on: false },
      { kind: 'review', id: 'NC-2', review: R1 },
    ])
    expect(opsBetween('NC-2', before, line('<!-- card: NC-2, next, fix -->'))).toEqual([
      { kind: 'fix', id: 'NC-2', on: true },
      { kind: 'unreview', id: 'NC-2', at: R2.at, rating: R2.rating },
    ])
  })
  it('YAZ-5642: two answers of one minute have two times: removing the second names it by its full time; adding it back names it too', () => {
    const second = '2026-11-14T06:01:41.802Z'
    const two = line(`<!-- card: NC-2, ${R1.at} again 3s, ${second} again 4s -->`)
    const one = line(`<!-- card: NC-2, ${R1.at} again 3s -->`)
    expect(opsBetween('NC-2', two, one)).toEqual([{ kind: 'unreview', id: 'NC-2', at: second, rating: 'again' }])
    expect(opsBetween('NC-2', one, two)).toEqual([{ kind: 'review', id: 'NC-2', review: { at: second, rating: 'again', seconds: 4 } }])
  })
  it('YAZ-5503: the title on the front is a mark: Hide is `notitle` on, Show is off', () => {
    expect(opsBetween('NC-2', line('<!-- card: NC-2 -->'), line('<!-- card: NC-2, notitle -->'))).toEqual([{ kind: 'notitle', id: 'NC-2', on: true }])
    expect(opsBetween('NC-2', line('<!-- card: NC-2, notitle, off -->'), line('<!-- card: NC-2, off -->'))).toEqual([{ kind: 'notitle', id: 'NC-2', on: false }])
  })
  it('a change the phone cannot send (for example the title) is refused, not lost', () => {
    expect(() => opsBetween('NC-2', line('<!-- card: NC-2 -->'), line('<!-- card: NC-2, title "New" -->'))).toThrow(/cannot send/)
  })
})

describe('YAZ-5409: `next` with a place', () => {
  const pg = (body: string) => pageText('Page', 'NC-1', ['NC-2']).replace('<!-- card: NC-2 -->', `<!-- card: ${body} -->`)
  it('goes back at its place; with no place (a list stored before YAZ-5409) it goes to the writer\'s place', () => {
    expect(applyOps(pg('NC-2, title "x", tags "a"'), [{ kind: 'next', id: 'NC-2', on: true, at: 2 }]).content).toBe(pg('NC-2, title "x", next, tags "a"'))
    expect(applyOps(pg('NC-2, title "x", tags "a"'), [{ kind: 'next', id: 'NC-2', on: true }]).content).toBe(pg('NC-2, title "x", tags "a", next'))
  })
  it('is idempotent: a line that holds `next` already changes nothing, wherever it is', () => {
    const before = pg('NC-2, next, title "x", tags "a"')
    expect(applyOps(before, [{ kind: 'next', id: 'NC-2', on: true, at: 3 }]).content).toBe(before)
  })
})

describe('YAZ-5512 S1: an emptied properties block (`---\n---`, the Mac leaves it when the last property goes)', () => {
  it('a card below a later `---` line (a card back) is still found and answered', () => {
    const before = '---\n---\n# A\n\n```card\nQ\n---\nA\n```\n<!-- card: NC-1 -->\n'
    const out = applyOps(before, [{ kind: 'review', id: 'NC-1', review: R1 }])
    expect(out.lost).toEqual([])
    expect(out.content).toBe(before.replace('NC-1 -->', 'NC-1, 2026-11-14T06:01:00.000Z good 9s -->'))
  })
})

describe('YAZ-5520: a list that holds an unreview and a review of the same review, applied twice, keeps the order of the reviews', () => {
  const pg = (body: string) => pageText('Page', 'NC-1', ['NC-2']).replace('<!-- card: NC-2 -->', `<!-- card: ${body} -->`)
  const twice = (before: string, ops: CardOp[]) => {
    const once = applyOps(before, ops).content
    return [once, applyOps(once, ops).content]
  }
  it('an undo and a redo of a review, then an older review (seed 32795): the reviews go in time order', () => {
    const at07: CardReview = { at: '2026-11-14T06:07:00.000Z', rating: 'good' }
    const at27: CardReview = { at: '2026-11-14T06:27:00.000Z', rating: 'good' }
    const ops: CardOp[] = [{ kind: 'unreview', id: 'NC-2', ...at27 }, { kind: 'review', id: 'NC-2', review: at27 }, { kind: 'review', id: 'NC-2', review: at07 }]
    const [once, again] = twice(pg('NC-2, 2026-11-14T06:27:00.000Z good'), ops)
    expect(once).toBe(pg('NC-2, 2026-11-14T06:07:00.000Z good, 2026-11-14T06:27:00.000Z good'))
    expect(again).toBe(once)
  })
  it('a review taken out and put back by one list keeps its place: between marks, and out of time order (seed 10366)', () => {
    const at16: CardReview = { at: '2026-11-14T06:16:00.000Z', rating: 'good' }
    const at28: CardReview = { at: '2026-11-14T06:28:00.000Z', rating: 'hard' }
    const ops: CardOp[] = [{ kind: 'unreview', id: 'NC-2', ...at16 }, { kind: 'review', id: 'NC-2', review: at16 }, { kind: 'review', id: 'NC-2', review: at28 }, { kind: 'next', id: 'NC-2', on: true, at: 2 }]
    const held = pg('NC-2, 2026-11-14T06:16:00.000Z good, next, 2026-11-14T06:28:00.000Z hard')
    expect(applyOps(held, ops).content).toBe(held)
    const late = pg('NC-2, 2026-11-14T06:28:00.000Z hard, 2026-11-14T06:16:00.000Z good')
    expect(applyOps(late, ops.slice(0, 2)).content).toBe(late)
  })
  it('a new answer still goes right after the last review, as the Mac writes it; an older one goes at its time', () => {
    const before = pg('NC-2, 2026-11-14T06:07:00.000Z good, tags "a"')
    expect(applyOps(before, [{ kind: 'review', id: 'NC-2', review: R2 }]).content).toBe(pg('NC-2, 2026-11-14T06:02:00.000Z again, 2026-11-14T06:07:00.000Z good, tags "a"'))
    expect(applyOps(before, [{ kind: 'review', id: 'NC-2', review: { at: '2026-11-14T06:30:00.000Z', rating: 'easy' } }]).content).toBe(pg('NC-2, 2026-11-14T06:07:00.000Z good, 2026-11-14T06:30:00.000Z easy, tags "a"'))
  })
})

describe('YAZ-5697 round 2: Title in review › on the phone (the Mac\'s YAZ-5696 choice)', () => {
  const line = (text: string) => parseCardLine(`<!-- card: ${text} -->`)!
  it('a choice of when the title shows is ONE `title` action, the Mac\'s change; Never alone stays a `notitle` action', () => {
    expect(opsBetween('NC-1', line('NC-1'), line('NC-1, title-front'))).toEqual([{ kind: 'title', id: 'NC-1', choice: 'front' }])
    expect(opsBetween('NC-1', line('NC-1, title-front'), line('NC-1'))).toEqual([{ kind: 'title', id: 'NC-1', choice: 'default' }])
    expect(opsBetween('NC-1', line('NC-1'), line('NC-1, notitle'))).toEqual([{ kind: 'notitle', id: 'NC-1', on: true }])
  })
})
