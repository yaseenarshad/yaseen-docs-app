/**
 * YAZ-5466, decision D: a card file's `comments` are the FILE's. They stay in its front matter beside `kind: card`,
 * never on the card line, never a card property. Every writer of the card keeps the `comments` block byte for byte, and
 * every comment write keeps the card block and its card line byte for byte (LF and Windows CRLF files alike).
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { addComment, deleteComment, editComment, readComments, readCommentsAndShape, setResolved } from '@shared/comments'
import { cardFileCard, cardFileContent } from '@shared/cardFileFormat'
import { cardPropertiesOf, changeCard, changeCardText, withCardFix, withCardNext, withCardOff, withCardProperty, withCardReview, withCardTitle, withoutCardProperty, withoutCardReviews } from '@shared/cardLine'
import { cardFilePropertiesMoved } from '@shared/cardPropertySweep'
import { splitFrontmatter } from '@shared/frontmatter'
import { scanFile } from './vaultIndex/scan'

const COMMENTS = 'comments:\n  - id: aaaaaaaa\n    n: 1\n    at: 2026-11-14T10:00:00Z\n    by: yaseen\n    body: Is the Seine right?\n  - id: bbbbbbbb\n    n: 1\n    at: 2026-11-14T10:05:00Z\n    reply_to: aaaaaaaa\n    body: "Yes, it is."\n'
const LINE = '<!-- card: GEO-204, title "Rivers, of Seville", level "A2" -->'
const CARD = '```card\nWhich river runs through Seville?\n---\nThe Guadalquivir.\n```\n'
const file = (frontmatter = `kind: card\n${COMMENTS}`, line = LINE) => `---\n${frontmatter}---\n${CARD}${line}\n`
const crlf = (text: string) => text.replace(/\n/g, '\r\n')

/** The `comments` block of a file's front matter, as written. */
const commentsBlock = (content: string): string => {
  const front = splitFrontmatter(content.replace(/\r\n/g, '\n')).frontmatter
  const at = front.indexOf('comments:')
  return at === -1 ? '' : front.slice(at).split(/\n(?=\S)/)[0]
}
/** The card block and its line, as written. */
const cardPart = (content: string): string => content.slice(content.indexOf('```card'))

const at = '2026-11-14T11:00:00Z'

describe('a comment write keeps the card block and its card line byte for byte (YAZ-5466)', () => {
  for (const [name, wrap] of [['LF', (t: string) => t], ['Windows CRLF (YAZ-5150)', crlf]] as const) {
    it(`${name}: write, reply, edit, resolve, reopen, delete`, () => {
      const start = wrap(file())
      const steps = [
        (c: string) => addComment(c, 'A new one, with, commas', { id: 'cccccccc', at, by: 'yaseen' }),
        (c: string) => addComment(c, 'A reply', { id: 'dddddddd', at, replyTo: 'cccccccc', by: 'yaseen' }),
        (c: string) => editComment(c, 'cccccccc', 'Edited', at, 'A title'),
        (c: string) => setResolved(c, 'cccccccc', at, 'yaseen'),
        (c: string) => setResolved(c, 'cccccccc', null),
        (c: string) => deleteComment(c, 'cccccccc'),
      ]
      let content = start
      for (const step of steps) {
        const next = step(content)
        expect(next).not.toBe(content)
        expect(cardPart(next)).toBe(cardPart(start))
        expect(next.startsWith(wrap('---\nkind: card\n'))).toBe(true)
        if (name !== 'LF') expect(next.replace(/\r\n/g, '')).not.toContain('\n')
        content = next
      }
      // Deleting the parent took its reply: back to the two that were there.
      expect(readComments(content).map((c) => c.id)).toEqual(['aaaaaaaa', 'bbbbbbbb'])
    })
  }

  it('the first comment on a card file with only `kind: card` goes in its front matter, after the mark', () => {
    const start = file('kind: card\n')
    const next = addComment(start, 'First', { id: 'eeeeeeee', at })
    expect(next.startsWith('---\nkind: card\ncomments:\n')).toBe(true)
    expect(cardPart(next)).toBe(cardPart(start))
    expect(cardPropertiesOf(cardFileCard(next)!.line)).toEqual({ level: 'A2' })
  })

  it('an old card file from before decision D (properties still in its front matter): the comment goes in, nothing else moves', () => {
    const start = file(`kind: card\ntitle: Rivers of Seville\ntags: [europe]\n`, '<!-- card: GEO-204 -->')
    const next = addComment(start, 'Old file', { id: 'ffffffff', at })
    expect(next).toContain('kind: card\ntitle: Rivers of Seville\ntags: [europe]\ncomments:\n')
    expect(cardPart(next)).toBe(cardPart(start))
  })

  it('a broken `comments` block is never overwritten: the file says "invalid" or "foreign", and a write throws', () => {
    const foreign = file('kind: card\ncomments: my own notes\n')
    expect(readCommentsAndShape(foreign).shape).toBe('foreign')
    expect(() => addComment(foreign, 'x', { id: 'gggggggg', at })).toThrow()
    const invalid = file('kind: card\ncomments: [\n')
    expect(readCommentsAndShape(invalid).shape).toBe('invalid')
    expect(() => addComment(invalid, 'x', { id: 'gggggggg', at })).toThrow()
  })
})

describe('every card writer keeps the `comments` block byte for byte (YAZ-5466)', () => {
  const start = file()
  const block = commentsBlock(start)
  const writers: [string, (c: string) => string][] = [
    ['Edit card / Done (the card`s text)', (c) => changeCardText(c, 'GEO-204', 'Which river?\n---\nThe Guadalquivir, in Seville.')],
    ['a title rename (the card line`s title)', (c) => changeCard(c, 'GEO-204', (l) => withCardTitle(l, 'Seville, the river'))],
    ['a property from the strip or the Cards table', (c) => changeCard(c, 'GEO-204', (l) => withCardProperty(l, 'source', 'Atlas, 2nd ed.'))],
    ['a property removed', (c) => changeCard(c, 'GEO-204', (l) => withoutCardProperty(l, 'level'))],
    ['Archive', (c) => changeCard(c, 'GEO-204', (l) => withCardOff(l, true))],
    ['Up next', (c) => changeCard(c, 'GEO-204', (l) => withCardNext(l, true, 1))],
    ['Fix later', (c) => changeCard(c, 'GEO-204', (l) => withCardFix(l, true))],
    ['a review answer from the Inbox', (c) => changeCard(c, 'GEO-204', (l) => withCardReview(l, { at: '2026-11-14T11:00:00.000Z', rating: 'good' }))],
    ['Reset history', (c) => changeCard(changeCard(c, 'GEO-204', (l) => withCardReview(l, { at: '2026-11-14T11:00:00.000Z', rating: 'good' })), 'GEO-204', withoutCardReviews)],
  ]
  for (const [name, write] of writers) {
    it(name, () => {
      for (const content of [start, crlf(start)]) {
        const next = write(content)
        expect(next).not.toBe(content)
        expect(commentsBlock(next)).toBe(block)
        expect(next.startsWith(content.slice(0, content.indexOf('```card')))).toBe(true)
        expect(cardPropertiesOf(cardFileCard(next.replace(/\r\n/g, '\n'))!.line)).not.toHaveProperty('comments')
      }
    })
  }

  it('the YAZ-5384 sweep moves the person`s properties to the card line and never `comments`: the block stays byte for byte', () => {
    const old = file(`kind: card\nlevel: B1\n${COMMENTS}source: Atlas\n`, '<!-- card: GEO-204, title "T" -->')
    const moved = cardFilePropertiesMoved(old)!
    expect(commentsBlock(moved)).toBe(commentsBlock(old))
    expect(moved).toContain(`---\nkind: card\n${COMMENTS}---\n`)
    expect(cardPropertiesOf(cardFileCard(moved)!.line)).toEqual({ level: 'B1', source: 'Atlas' })
    // A card file holding only `kind: card` and its comments: nothing to move.
    expect(cardFilePropertiesMoved(file())).toBeNull()
    expect(cardFilePropertiesMoved(crlf(file()))).toBeNull()
  })

  it('a new card file (New card, `card new`) has no `comments` until the first one', () => {
    const made = cardFileContent('Rivers', 'Q\n---\nA', { parts: [{ kind: 'id', id: 'GEO-9' }] } as never)
    expect(made).not.toContain('comments')
  })
})

describe('`comments` is never a card property (YAZ-5466)', () => {
  it('the index: neither the record`s properties nor its card`s', async () => {
    const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'yaz-5466-')))
    try {
      const p = path.join(dir, 'rivers.md')
      await writeFile(p, file())
      const record = (await scanFile(dir, p))!
      expect(record.kind).toBe('card')
      expect(record.properties).not.toHaveProperty('comments')
      expect(record.cards?.[0]?.properties ?? {}).toEqual({ level: 'A2' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
