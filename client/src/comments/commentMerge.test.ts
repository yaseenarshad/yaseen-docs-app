/** `shared/commentMerge.ts` (YAZ-4615 D4, D9): sync's merge of a page whose rebase stopped. */
import { describe, expect, it } from 'vitest'
import { mergePageComments } from '@shared/commentMerge'
import { readComments } from '@shared/comments'

const page = (entries: string, body = 'Body\n') => `---\ntitle: Plan\n${entries === '' ? '' : `comments:\n${entries}`}---\n${body}`
const e = (id: string, n: number, at: string, body: string, extra = '') => `  - id: ${id}\n    n: ${n}\n    at: 2026-11-0${at}T10:00:00Z\n${extra}    body: ${body}\n`

describe('mergePageComments', () => {
  const one = e('a', 1, '1', 'First')

  it('keeps both new comments and gives MY clashing number the next free one', () => {
    const m = mergePageComments(page(one), page(one + e('b', 2, '2', 'Sam')), page(one + e('c', 2, '3', 'Me')))
    expect(m?.renumbered).toEqual([{ from: '#2', to: '#3' }])
    expect(readComments(m?.text ?? '').map((c) => [c.id, c.n])).toEqual([['a', 1], ['b', 2], ['c', 3]])
    expect(m?.copy).toBeUndefined()
  })

  it('a clashing reply number is renumbered inside its thread (#1.1 → #1.2)', () => {
    const reply = (id: string, at: string) => e(id, 1, at, id, '    reply_to: a\n')
    const m = mergePageComments(page(one), page(one + reply('b', '2')), page(one + reply('c', '3')))
    expect(m?.renumbered).toEqual([{ from: '#1.1', to: '#1.2' }])
  })

  it('merges key by key: their resolve and my edit of one comment both land', () => {
    const theirs = page(e('a', 1, '1', 'First', '    resolved: 2026-11-02T00:00:00Z\n'))
    const mine = page(e('a', 1, '1', 'First, edited'))
    const c = readComments(mergePageComments(page(one), theirs, mine)?.text ?? '')[0]
    expect(c).toMatchObject({ body: 'First, edited', resolved: '2026-11-02T00:00:00Z' })
  })

  it('an edit beats a delete, on either side; an untouched entry deleted on one side goes', () => {
    const two = e('d', 2, '2', 'Second')
    const edited = e('d', 2, '2', 'Second!')
    expect(readComments(mergePageComments(page(one + two), page(one), page(one + edited))?.text ?? '').map((c) => c.id)).toEqual(['a', 'd'])
    expect(readComments(mergePageComments(page(one + two), page(one + edited), page(one))?.text ?? '').map((c) => c.id)).toEqual(['a', 'd'])
    expect(readComments(mergePageComments(page(one + two), page(one + two), page(one))?.text ?? '').map((c) => c.id)).toEqual(['a'])
  })

  it('D9: the rest changed on both sides — theirs stays with every comment, mine comes back as a copy with none', () => {
    const m = mergePageComments(page(one), page(one, 'Theirs\n'), page(one + e('c', 2, '3', 'Me'), 'Mine\n'))
    expect(m?.text).toContain('Theirs\n')
    expect(readComments(m?.text ?? '').map((c) => c.id)).toEqual(['a', 'c'])
    expect(m?.copy).toBe('---\ntitle: Plan\n---\nMine\n')
  })

  it('the rest changed on ONE side is that side\'s', () => {
    expect(mergePageComments(page(one), page(one, 'Theirs\n'), page(one))?.text).toContain('Theirs\n')
    expect(mergePageComments(page(one), page(one), page(one, 'Mine\n'))?.text).toContain('Mine\n')
  })

  it('a plain page\'s hint line survives the merge, and a hand-written comment\'s new number is not announced (audit 1, 7)', () => {
    const hinted = (entries: string) => `---\n# comments: - {by: <name>, body: <text>}\n${entries === '' ? '' : `comments:\n${entries}`}---\nBody\n`
    const m = mergePageComments(hinted(''), hinted(e('b', 1, '2', 'Sam')), hinted('  - {by: claude, body: By hand}\n'))
    expect(m?.text.startsWith('---\n# comments: - {by: <name>, body: <text>}\ncomments:\n')).toBe(true)
    expect(m?.renumbered).toEqual([])
    expect(readComments(m?.text ?? '').map((c) => c.body)).toEqual(['Sam', 'By hand'])
  })

  it('a value of the user\'s own under `comments`, or a block that does not parse, is not ours: null', () => {
    expect(mergePageComments(null, '---\ncomments: "mine"\n---\n', page(one))).toBeNull()
    expect(mergePageComments(null, page(one), '---\ncomments: [unclosed\n---\n')).toBeNull()
  })
})
