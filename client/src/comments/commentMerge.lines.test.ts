/** YAZ-4701 (6B): the rest of a page merges line by line; D9 keeps both only for the SAME lines. Found by the checker. */
import { describe, expect, it } from 'vitest'
import { mergePageComments, pageRest, type LineMerge } from '@shared/commentMerge'
import { readComments } from '@shared/comments'

const page = (entries: string, body: string) => `---\ntitle: Plan\n${entries === '' ? '' : `comments:\n${entries}`}---\n${body}`
const e = (id: string, n: number, day: string, body: string) => `  - id: ${id}\n    n: ${n}\n    at: 2026-11-0${day}T10:00:00Z\n    body: ${body}\n`
const BODY = 'Para one.\n\nPara two.\n\nPara three.\n\nPara four.\n\nPara five.\n'

/** A line merge for whole-line edits: each line takes the side that changed it; null when both changed one line. */
const byLine: LineMerge = (base, theirs, mine) => {
  const [b, t, m] = [base, theirs, mine].map((s) => s.split('\n'))
  if (b.length !== t.length || b.length !== m.length) return null
  const out: string[] = []
  for (let i = 0; i < b.length; i++) {
    if (t[i] !== b[i] && m[i] !== b[i] && t[i] !== m[i]) return null
    out.push(t[i] !== b[i] ? t[i] : m[i])
  }
  return out.join('\n')
}

describe('mergePageComments: the rest merges line by line (D9)', () => {
  const one = e('a', 1, '1', 'First')
  const base = page(one, BODY)
  const theirs = page(one + e('b', 2, '2', 'Sam'), BODY.replace('Para one.', 'Para one, edited by Sam.'))

  it('both comment, and each edits a DIFFERENT paragraph: one page with both edits and both comments, no copy', () => {
    const mine = page(one + e('c', 2, '3', 'Me'), BODY.replace('Para five.', 'Para five, edited by me.'))
    const m = mergePageComments(base, theirs, mine, byLine)
    expect(readComments(m?.text ?? '').map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(m?.copy).toBeUndefined()
    expect(m?.text).toContain('Para one, edited by Sam.')
    expect(m?.text).toContain('Para five, edited by me.')
  })

  it('the line merge gets the three rests, with no comments in them', () => {
    const mine = page(one + e('c', 2, '3', 'Me'), BODY.replace('Para five.', 'Para five, edited by me.'))
    const seen: string[][] = []
    mergePageComments(base, theirs, mine, (b, t, m) => (seen.push([b, t, m]), null))
    expect(seen).toEqual([[pageRest(base), pageRest(theirs), pageRest(mine)]])
    expect(seen[0].some((s) => s.includes('comments:'))).toBe(false)
  })

  it('both edit the SAME paragraph: Sam’s text stays, mine is the copy (D9)', () => {
    const mine = page(one + e('c', 2, '3', 'Me'), BODY.replace('Para one.', 'Para one, edited by me.'))
    const m = mergePageComments(base, theirs, mine, byLine)
    expect(m?.text).toContain('Para one, edited by Sam.')
    expect(m?.copy).toContain('Para one, edited by me.')
    expect(readComments(m?.text ?? '').map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('only one side changed the rest: no line merge is asked for', () => {
    const mine = page(one + e('c', 2, '3', 'Me'), BODY)
    let calls = 0
    const m = mergePageComments(base, theirs, mine, () => (calls++, null))
    expect(calls).toBe(0)
    expect(m?.copy).toBeUndefined()
    expect(m?.text).toContain('Para one, edited by Sam.')
  })
})

describe('YAZ-5512 X1: the page merge never throws (sync must never stop on one page)', () => {
  it('a merged rest whose block will not take the comments: null (resolve.ts keeps both), never a throw', () => {
    const base = '# Words\n\nBody\n'
    const theirs = `---\ncomments:\n${e('a', 1, '1', 'phone')}---\n# Words\n\nBody, theirs\n`
    const mine = '# Words edited\n\nBody\n'
    // A line merge that came out with a block that is not YAML (both sides wrote into it).
    const broken: LineMerge = () => '---\na: [\n---\n# Words edited\n\nBody\n'
    let out: ReturnType<typeof mergePageComments> | undefined
    expect(() => (out = mergePageComments(base, theirs, mine, broken))).not.toThrow()
    expect(out).toBeNull()
  })

  it('a block that held only `comments` is no block in the rest: a phone comment on a page with no properties leaves the rest unchanged', () => {
    const before = '# Words\n\n```card\nHola\n---\nHello\n```\n<!-- card: NC-1 -->\n'
    const theirs = `---\ncomments:\n${e('a', 1, '1', 'phone')}---\n${before}`
    expect(pageRest(theirs)).toBe(before)
    // A block of the page's own keeps its other keys, and an empty block the page already had stays.
    expect(pageRest(`---\ntitle: P\ncomments:\n${e('a', 1, '1', 'x')}---\nBody\n`)).toBe('---\ntitle: P\n---\nBody\n')
    expect(pageRest('---\n---\nBody\n---\n')).toBe('---\n---\nBody\n---\n')
  })

  it('a phone comment on a page with no properties and a card back merges with a Mac edit of the first line without throwing, and without a copy', () => {
    const base = '# Words\n\n```card\nHola\n---\nHello\n```\n<!-- card: NC-1 -->\n'
    const theirs = `---\ncomments:\n${e('a', 1, '1', 'phone')}---\n${base}`
    const mine = base.replace('# Words', '# Words edited')
    const out = mergePageComments(base, theirs, mine, byLine)
    expect(out?.copy).toBeUndefined()
    expect(out?.text).toBe(`---\ncomments:\n${e('a', 1, '1', 'phone')}---\n${mine}`)
  })
})
