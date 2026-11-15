import { describe, expect, it } from 'vitest'
import { addComment, readComments } from '@shared/comments'
import { cardFileCard } from '@shared/cardFileFormat'
import { cardPropertiesOf, cardRecords } from '@shared/cardLine'
import { splitFrontmatter } from '@shared/frontmatter'
import { cardInContent } from '@client/review/cardRead'
import { SEND_AFTER_MS } from '../sync/cadence'
import { applyOps, type CardOp } from '../answers/ops'
import { commentsSetup } from './testing'
import { applyComment, type NewComment } from './write'

/**
 * YAZ-5477 (the Mac's YAZ-5466, decision D): a CARD FILE's comments from the phone. They are the FILE's: the `comments`
 * list in its front matter, right after `kind: card`, never on the card line, never a card property. The phone's one
 * comment write keeps the card part byte for byte (the card block, its card line, `kind: card`); the phone's own card
 * writers (an answer, its Undo, Archive, Fix later, Up next: `applyOps` and its splice) keep the `comments` block byte
 * for byte. LF and Windows CRLF files alike. Made-up card files only.
 */
const COMMENTS = 'comments:\n  - id: aaaaaaaa\n    n: 1\n    at: 2026-11-14T10:00:00Z\n    by: sam\n    body: Is the Seine right?\n  - id: bbbbbbbb\n    n: 1\n    at: 2026-11-14T10:05:00Z\n    reply_to: aaaaaaaa\n    body: "Yes, it is."\n'
const LINE = '<!-- card: GEO-204, title "Rivers, of Seville", level "A2", 2026-11-01T09:00Z good -->'
const CARD = '```card\nWhich river runs through Seville?\n---\nThe Guadalquivir.\n```\n'
const file = (frontmatter = `kind: card\n${COMMENTS}`, line = LINE) => `---\n${frontmatter}---\n\n${CARD}${line}\n`
const crlf = (text: string) => text.replace(/\n/g, '\r\n')
const C = (id: string, body = 'Approved'): NewComment => ({ id, at: '2026-11-14T11:00:00Z', by: 'yaseen', body })

/** The card block and its line, as written (everything from the card's fence on). */
const cardPart = (content: string): string => content.slice(content.indexOf('```card'))
/** The `comments` block of the front matter, as written. */
const commentsBlock = (content: string): string => {
  const front = splitFrontmatter(content).frontmatter
  const at = front.indexOf('comments:')
  return at === -1 ? '' : front.slice(at, front.search(/\r?\n---\s*$/) + 1 || undefined).split(/\r?\n(?=[^ \r\n])/)[0]
}
const added = (content: string, c: NewComment): string => {
  const out = applyComment(content, c)
  if (out.kind !== 'added') throw new Error(`not added: ${JSON.stringify(out)}`)
  return out.content
}

describe('a comment on a card file keeps the card part byte for byte (YAZ-5477)', () => {
  for (const [name, wrap] of [['LF', (t: string) => t], ['CRLF', crlf]] as const) {
    it(`${name}: the first comment goes in the front matter right after \`kind: card\`, as the Mac writes it`, () => {
      const start = wrap(file('kind: card\n'))
      const out = added(start, C('cccccccc'))
      expect(out).toBe(wrap(`---\nkind: card\ncomments:\n  - id: cccccccc\n    n: 1\n    at: 2026-11-14T11:00:00Z\n    by: yaseen\n    body: Approved\n---\n\n${CARD}${LINE}\n`))
      expect(cardPart(out)).toBe(cardPart(start))
      expect(out.startsWith(wrap('---\nkind: card\ncomments:\n'))).toBe(true)
      // The Mac's own writer gives the same file (no splice difference on a card file).
      expect(out).toBe(addComment(start, 'Approved', { id: 'cccccccc', at: '2026-11-14T11:00:00Z', by: 'yaseen' }))
      if (name === 'CRLF') expect(out.replace(/\r\n/g, '')).not.toContain('\n')
    })

    it(`${name}: with comments there, the new one goes last as #2; the old entries, the card block and the line stay`, () => {
      const start = wrap(file())
      const out = added(start, C('cccccccc', 'Second, with a comma'))
      expect(cardPart(out)).toBe(cardPart(start))
      // The list is the Mac's writer's (as on a page, YAZ-5461): the old entries keep their ids, numbers and words.
      expect(out.startsWith(wrap('---\nkind: card\ncomments:\n  - id: aaaaaaaa\n'))).toBe(true)
      expect(readComments(out).map((c) => [c.id, c.n, c.body])).toEqual([
        ['aaaaaaaa', 1, 'Is the Seine right?'],
        ['bbbbbbbb', 1, 'Yes, it is.'],
        ['cccccccc', 2, 'Second, with a comma'],
      ])
      // The card reads as before: its title, its property, its review; `comments` is no card property.
      const card = cardFileCard(out.replace(/\r\n/g, '\n'))!
      expect(cardPropertiesOf(card.line)).toEqual({ level: 'A2' })
      if (name === 'CRLF') expect(out.replace(/\r\n/g, '')).not.toContain('\n')
    })
  }

  it('an old card file (before decision D: properties still in its front matter): the comment goes in, nothing else moves', () => {
    const start = file('kind: card\ntitle:   Rivers\ntags: [europe,rivers]\n', '<!-- card: GEO-204 -->')
    const out = added(start, C('dddddddd'))
    expect(out).toContain('kind: card\ntitle:   Rivers\ntags: [europe,rivers]\ncomments:\n  - id: dddddddd\n')
    expect(cardPart(out)).toBe(cardPart(start))
  })

  it('a card file whose `comments` is not a comment list, or does not parse: refused, nothing written', () => {
    expect(applyComment(file('kind: card\ncomments: my own notes\n'), C('eeeeeeee'))).toEqual({ kind: 'refused', why: 'foreign' })
    expect(applyComment(file('kind: card\ncomments: [\n'), C('eeeeeeee'))).toEqual({ kind: 'refused', why: 'invalid' })
  })
})

describe("the phone's own card writers keep a card file's comments byte for byte (YAZ-5477)", () => {
  const R = { at: '2026-11-14T12:00Z', rating: 'good' as const }
  const writers: [string, CardOp[]][] = [
    ['an answer (the answer splice)', [{ kind: 'review', id: 'GEO-204', review: R }]],
    ['the Undo of a sent answer', [{ kind: 'unreview', id: 'GEO-204', at: '2026-11-01T09:00Z', rating: 'good' }]],
    ['Archive', [{ kind: 'off', id: 'GEO-204', on: true }]],
    ['Fix later', [{ kind: 'fix', id: 'GEO-204', on: true }]],
    ['Up next', [{ kind: 'next', id: 'GEO-204', on: true }]],
    ['all of them, then off again', [{ kind: 'review', id: 'GEO-204', review: R }, { kind: 'off', id: 'GEO-204', on: true }, { kind: 'fix', id: 'GEO-204', on: true }, { kind: 'next', id: 'GEO-204', on: true }, { kind: 'off', id: 'GEO-204', on: false }]],
  ]
  for (const [name, ops] of writers) {
    it(name, () => {
      for (const start of [file(), crlf(file())]) {
        const out = applyOps(start, ops)
        expect(out.lost).toEqual([])
        expect(out.content).not.toBe(start)
        // Everything before the card (the fences, `kind: card`, the comments) is the file's own.
        expect(out.content.slice(0, out.content.indexOf('```card'))).toBe(start.slice(0, start.indexOf('```card')))
        expect(commentsBlock(out.content)).toBe(commentsBlock(start))
        expect(commentsBlock(out.content)).not.toBe('')
        expect(readComments(out.content)).toEqual(readComments(start))
        // Only the card line changed; it never carries `comments`.
        const card = cardFileCard(out.content.replace(/\r\n/g, '\n'))!
        expect(cardPropertiesOf(card.line)).not.toHaveProperty('comments')
        expect(out.content.replace(/\r\n/g, '\n').split('\n').find((l) => l.startsWith('<!-- card:'))).not.toMatch(/comment/)
      }
    })
  }

  it('`comments` is never read as a card property: the reader, the index records', () => {
    const content = file()
    const card = cardInContent('cards/rivers-geo-204.md', content, 'GEO-204', -1)!
    expect(card.properties).toEqual({ level: 'A2' })
    expect(card.cardFile).toBe(true)
    expect(cardRecords(content).map((r) => r.properties ?? {})).toEqual([{ level: 'A2' }])
  })
})

describe('a comment from the phone reaches a card file (fake GitHub, made-up vault)', () => {
  const PATH = 'cards/rivers-geo-204.md'
  it('one commit; only the front matter gains the comment; the card part stays; an answer after it keeps the comment', async () => {
    const start = file('kind: card\n')
    const t = await commentsSetup({ [PATH]: start })
    const made = await t.port.add({ path: PATH, body: 'Approved', by: 'yaseen' })
    await t.settle()
    const after = (await t.remote(PATH))!
    expect(after).toBe(`---\nkind: card\ncomments:\n  - id: ${made.id}\n    n: 1\n    at: 2026-11-14T06:00:00Z\n    by: yaseen\n    body: Approved\n---\n\n${CARD}${LINE}\n`)
    expect(cardPart(after)).toBe(cardPart(start))
    expect(t.patches()).toBe(1)
    // An answer from Review on the same card file: the card line gains the review; the comment stays byte for byte.
    await t.answers.add([{ op: { kind: 'review', id: 'GEO-204', review: { at: '2026-11-14T06:01Z', rating: 'good' } }, path: PATH, title: 'Rivers, of Seville' }])
    await t.tick(SEND_AFTER_MS)
    const answered = (await t.remote(PATH))!
    expect(commentsBlock(answered)).toBe(commentsBlock(after))
    expect(answered).toBe(after.replace('good -->', 'good, 2026-11-14T06:01Z good -->'))
  })
})
