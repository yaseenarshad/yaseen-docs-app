import { describe, expect, it } from 'vitest'
import { addComment, readComments, rawComments } from '@shared/comments'
import { pageRest } from '@shared/commentMerge'
import { applyComment, holdsComment, type NewComment } from './write'

/**
 * YAZ-5461: the phone's one write to a page. It changes ONLY the `comments` entry of the properties block: every other
 * byte stays (the body, the other keys, their order, spacing and quoting, YAML comments, the fences, the line ends,
 * unknown keys on entries). Made-up pages only.
 */
const C = (id: string, body = 'Approved', by = 'yaseen'): NewComment => ({ id, at: '2026-11-14T10:00:00Z', by, body })
const added = (content: string, c: NewComment): string => {
  const out = applyComment(content, c)
  if (out.kind !== 'added') throw new Error(`not added: ${JSON.stringify(out)}`)
  return out.content
}

/** `after` is `before` with only `inserted` put in at one place: the bytes before and after it are the page's own. */
function onlyInserted(before: string, after: string): string {
  let head = 0
  while (head < before.length && before[head] === after[head]) head++
  let tail = 0
  while (tail < before.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++
  expect(after.slice(0, head) + after.slice(after.length - tail)).toBe(before.slice(0, head) + before.slice(before.length - tail))
  return after.slice(head, after.length - tail)
}

describe('the comment goes in; nothing else changes (byte-exact)', () => {
  it('a page with no properties block: a new block with the comment, the body byte for byte after it', () => {
    const body = '# Plan\n\nSome  text   with odd   spacing.\n\n- [ ] a task\n'
    const out = added(body, C('a1b2c3d4'))
    expect(out.endsWith(body)).toBe(true)
    expect(out).toBe(`---\ncomments:\n  - id: a1b2c3d4\n    n: 1\n    at: 2026-11-14T10:00:00Z\n    by: yaseen\n    body: Approved\n---\n${body}`)
  })

  it('a CRLF page with no block: the new block has CRLF too; the body is untouched', () => {
    const body = '# Plan\r\n\r\nText.\r\n'
    const out = added(body, C('a1b2c3d4'))
    expect(out.endsWith(body)).toBe(true)
    expect(out.slice(0, out.length - body.length).replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('a block with no comments: the entry goes last; other keys keep their odd spacing, quoting, flow lists, YAML comments and order', () => {
    const page = [
      '---',
      '# my note about this page',
      "title:    'Quarterly   plan'",
      'tags: [a,b,  c]',
      'status: "draft"   # still a draft',
      'nested:',
      '    deep:   1',
      'empty:',
      '---',
      'Body line with trailing spaces   ',
      'and no newline at the end',
    ].join('\n')
    const out = added(page, C('a1b2c3d4'))
    const inserted = onlyInserted(page, out)
    expect(inserted).toBe('comments:\n  - id: a1b2c3d4\n    n: 1\n    at: 2026-11-14T10:00:00Z\n    by: yaseen\n    body: Approved\n')
    // The Mac's writer alone would have laid the other keys out again: the splice is what keeps them.
    expect(addComment(page, 'Approved', { id: 'a1b2c3d4', at: '2026-11-14T10:00:00Z', by: 'yaseen' })).not.toContain("title:    'Quarterly   plan'")
    expect(readComments(out).map((c) => c.body)).toEqual(['Approved'])
  })

  it('a block with comments: only the comments entry changes, numbered after the highest; unknown keys on entries stay', () => {
    const page = [
      '---',
      'title:   Plan',
      'comments:',
      '  - id: aa11bb22',
      '    n: 4',
      '    at: 2026-11-01T09:00:00Z',
      '    by: sam',
      '    mood: happy',
      '    body: First',
      '  - {by: agent, body: "hand written"}',
      'after:    [x,y]',
      '---',
      'Body.',
      '',
    ].join('\n')
    const out = added(page, C('a1b2c3d4', 'Looks good'))
    const before = page.split('\n')
    const after = out.split('\n')
    // The lines before and after the comments entry are the page's own.
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2))
    expect(after.slice(-4)).toEqual(before.slice(-4))
    expect(out.endsWith("after:    [x,y]\n---\nBody.\n")).toBe(true)
    const list = rawComments(out) as Record<string, unknown>[]
    expect(list[0]).toEqual({ id: 'aa11bb22', n: 4, at: '2026-11-01T09:00:00Z', by: 'sam', mood: 'happy', body: 'First' })
    // The Mac numbers the hand-written entry on its next write (D10), then the new one is one past the highest.
    expect(list.map((e) => e.n)).toEqual([4, 5, 6])
    expect(list[2]).toEqual({ id: 'a1b2c3d4', n: 6, at: '2026-11-14T10:00:00Z', by: 'yaseen', body: 'Looks good' })
  })

  it('CRLF block, `...` terminator, the agents hint line, an empty `comments:`: all kept', () => {
    const page = '---\r\n# comments: - {by: <name>, body: <text>}\r\ntitle:  A\r\ncomments:\r\nz: 1\r\n...\r\nBody\r\n'
    const out = added(page, C('a1b2c3d4'))
    const inserted = onlyInserted(page, out)
    expect(inserted.includes('\n')).toBe(true)
    expect(inserted.replace(/\r\n/g, '')).not.toContain('\n')
    expect(out.startsWith('---\r\n# comments: - {by: <name>, body: <text>}\r\ntitle:  A\r\ncomments:\r\n  - id: a1b2c3d4')).toBe(true)
    expect(out.endsWith('z: 1\r\n...\r\nBody\r\n')).toBe(true)
  })

  it('an empty block and a block of only YAML comments', () => {
    expect(added('---\n---\nBody\n', C('a1b2c3d4'))).toBe('---\ncomments:\n  - id: a1b2c3d4\n    n: 1\n    at: 2026-11-14T10:00:00Z\n    by: yaseen\n    body: Approved\n---\nBody\n')
    const out = added('---\n# only a note\n---\nBody\n', C('a1b2c3d4'))
    expect(out.startsWith('---\n# only a note\ncomments:\n')).toBe(true)
    expect(out.endsWith('---\nBody\n')).toBe(true)
  })

  it('a body with lines that look like YAML or fences is never touched', () => {
    const page = '---\ntitle: T\n---\n---\ncomments: not mine\n---\n```yaml\ncomments: []\n```\n'
    const out = added(page, C('a1b2c3d4'))
    expect(out.endsWith('---\ncomments: not mine\n---\n```yaml\ncomments: []\n```\n')).toBe(true)
    expect(pageRest(out)).toBe(pageRest(page))
  })

  it('a multi-line comment and an "Approved" written twice are each their own entry', () => {
    let page = '---\ntitle: T\n---\nBody\n'
    page = added(page, C('aaaaaaaa', 'line one\nline two  \n\n'))
    page = added(page, C('bbbbbbbb'))
    page = added(page, C('cccccccc'))
    expect(readComments(page).map((c) => [c.n, c.body])).toEqual([
      [1, 'line one\nline two'],
      [2, 'Approved'],
      [3, 'Approved'],
    ])
  })
})

describe('numbering, refusals and the second try', () => {
  it('the number is one past the highest top-level number (a gap stays), replies do not count', () => {
    const page = '---\ncomments:\n  - {id: p1, n: 2, at: 2026-11-01T09:00:00Z, body: a}\n  - {id: r1, n: 7, at: 2026-11-01T09:01:00Z, reply_to: p1, body: r}\n---\n'
    expect(readComments(added(page, C('a1b2c3d4'))).find((c) => c.id === 'a1b2c3d4')?.n).toBe(3)
  })

  it('a `comments` value of the user own (foreign) is refused: nothing written', () => {
    for (const page of ['---\ncomments: see the doc\n---\nBody\n', '---\ncomments:\n  a: 1\n---\n', '---\ncomments: 3\n---\n']) expect(applyComment(page, C('a1b2c3d4'))).toEqual({ kind: 'refused', why: 'foreign' })
  })

  it('a block that does not parse (invalid) is refused', () => {
    for (const page of ['---\ntitle: [unclosed\n---\nBody\n', '---\na: 1\na: 2\n---\n', '---\n- just\n- a list\n---\n']) expect(applyComment(page, C('a1b2c3d4'))).toEqual({ kind: 'refused', why: 'invalid' })
  })

  it('a layout the splice cannot hold (a flow-style block) is refused, never laid out again', () => {
    expect(applyComment('---\n{title: T, comments: []}\n---\nBody\n', C('a1b2c3d4'))).toEqual({ kind: 'refused', why: 'layout' })
    expect(applyComment('---\n  title: T\n  other: 1\n---\nBody\n', C('a1b2c3d4'))).toEqual({ kind: 'refused', why: 'layout' })
  })

  it('a comment the page holds already (an earlier try reached GitHub) is not added again', () => {
    const once = added('Body\n', C('a1b2c3d4'))
    expect(holdsComment(once, 'a1b2c3d4')).toBe(true)
    expect(applyComment(once, C('a1b2c3d4'))).toEqual({ kind: 'already' })
  })
})

describe('YAZ-5512 S1: an emptied properties block and a later `---` line', () => {
  it('the comment goes into the empty block; the body (and its `---` line) stays byte for byte', () => {
    const before = '---\n---\n# A\n\nIntro\n\n---\n\n```card\nQ\n```\n<!-- card: NC-1 -->\n'
    const out = added(before, C('a1b2c3d4'))
    expect(out.endsWith('---\n# A\n\nIntro\n\n---\n\n```card\nQ\n```\n<!-- card: NC-1 -->\n')).toBe(true)
    expect(readComments(out).map((c) => c.id)).toEqual(['a1b2c3d4'])
  })
})

describe('YAZ-5512 C1: a comment on a page with a BOM goes into its own properties block', () => {
  it('a block behind the BOM: only the `comments` entry is added, the BOM stays first', () => {
    const page = '\uFEFF---\ntitle: Plan\n---\n# Plan\n'
    const out = added(page, C('a1b2c3d4', 'Hi'))
    expect(onlyInserted(page, out)).toMatch(/^comments:\n {2}- id: a1b2c3d4\n/)
    expect(out.startsWith('\uFEFF---\ntitle: Plan\n')).toBe(true)
    expect(out.match(/^\uFEFF?---$/gm)).toHaveLength(2)
    expect(applyComment(out, C('a1b2c3d4', 'Hi'))).toEqual({ kind: 'already' })
  })

  it('no block (LF and CRLF): the new block goes AFTER the BOM, the body stays byte for byte', () => {
    for (const body of ['# Plan\n\nText\n', '# Plan\r\n\r\nText\r\n']) {
      const out = added(`\uFEFF${body}`, C('a1b2c3d4', 'Hi'))
      expect(out.startsWith('\uFEFF---')).toBe(true)
      expect(out.endsWith(`---${body.includes('\r') ? '\r\n' : '\n'}${body}`)).toBe(true)
      expect(readComments(out).map((c) => c.id)).toEqual(['a1b2c3d4'])
    }
  })
})
