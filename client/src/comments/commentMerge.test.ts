/** `shared/commentMerge.ts` (YAZ-4615 D4, D9): sync's merge of a note whose rebase stopped. */
import { describe, expect, it } from 'vitest'
import { mergeNoteComments } from '@shared/commentMerge'
import { readComments } from '@shared/comments'

const note = (entries: string, body = 'Body\n') => `---\ntitle: Plan\n${entries === '' ? '' : `comments:\n${entries}`}---\n${body}`
const e = (id: string, n: number, at: string, body: string, extra = '') => `  - id: ${id}\n    n: ${n}\n    at: 2026-11-0${at}T10:00:00Z\n${extra}    body: ${body}\n`

describe('mergeNoteComments', () => {
  const one = e('a', 1, '1', 'First')

  it('keeps both new comments and gives MY clashing number the next free one', () => {
    const m = mergeNoteComments(note(one), note(one + e('b', 2, '2', 'Sam')), note(one + e('c', 2, '3', 'Me')))
    expect(m?.renumbered).toEqual([{ from: '#2', to: '#3' }])
    expect(readComments(m?.text ?? '').map((c) => [c.id, c.n])).toEqual([['a', 1], ['b', 2], ['c', 3]])
    expect(m?.copy).toBeUndefined()
  })

  it('a clashing reply number is renumbered inside its thread (#1.1 → #1.2)', () => {
    const reply = (id: string, at: string) => e(id, 1, at, id, '    reply_to: a\n')
    const m = mergeNoteComments(note(one), note(one + reply('b', '2')), note(one + reply('c', '3')))
    expect(m?.renumbered).toEqual([{ from: '#1.1', to: '#1.2' }])
  })

  it('merges key by key: their resolve and my edit of one comment both land', () => {
    const theirs = note(e('a', 1, '1', 'First', '    resolved: 2026-11-02T00:00:00Z\n'))
    const mine = note(e('a', 1, '1', 'First, edited'))
    const c = readComments(mergeNoteComments(note(one), theirs, mine)?.text ?? '')[0]
    expect(c).toMatchObject({ body: 'First, edited', resolved: '2026-11-02T00:00:00Z' })
  })

  it('an edit beats a delete, on either side; an untouched entry deleted on one side goes', () => {
    const two = e('d', 2, '2', 'Second')
    const edited = e('d', 2, '2', 'Second!')
    expect(readComments(mergeNoteComments(note(one + two), note(one), note(one + edited))?.text ?? '').map((c) => c.id)).toEqual(['a', 'd'])
    expect(readComments(mergeNoteComments(note(one + two), note(one + edited), note(one))?.text ?? '').map((c) => c.id)).toEqual(['a', 'd'])
    expect(readComments(mergeNoteComments(note(one + two), note(one + two), note(one))?.text ?? '').map((c) => c.id)).toEqual(['a'])
  })

  it('D9: the rest changed on both sides — theirs stays with every comment, mine comes back as a copy with none', () => {
    const m = mergeNoteComments(note(one), note(one, 'Theirs\n'), note(one + e('c', 2, '3', 'Me'), 'Mine\n'))
    expect(m?.text).toContain('Theirs\n')
    expect(readComments(m?.text ?? '').map((c) => c.id)).toEqual(['a', 'c'])
    expect(m?.copy).toBe('---\ntitle: Plan\n---\nMine\n')
  })

  it('the rest changed on ONE side is that side\'s', () => {
    expect(mergeNoteComments(note(one), note(one, 'Theirs\n'), note(one))?.text).toContain('Theirs\n')
    expect(mergeNoteComments(note(one), note(one), note(one, 'Mine\n'))?.text).toContain('Mine\n')
  })

  it('a plain note\'s hint line survives the merge, and a hand-written comment\'s new number is not announced (audit 1, 7)', () => {
    const hinted = (entries: string) => `---\n# comments: - {by: <name>, body: <text>}\n${entries === '' ? '' : `comments:\n${entries}`}---\nBody\n`
    const m = mergeNoteComments(hinted(''), hinted(e('b', 1, '2', 'Sam')), hinted('  - {by: claude, body: By hand}\n'))
    expect(m?.text.startsWith('---\n# comments: - {by: <name>, body: <text>}\ncomments:\n')).toBe(true)
    expect(m?.renumbered).toEqual([])
    expect(readComments(m?.text ?? '').map((c) => c.body)).toEqual(['Sam', 'By hand'])
  })

  it('a value of the user\'s own under `comments`, or a block that does not parse, is not ours: null', () => {
    expect(mergeNoteComments(null, '---\ncomments: "mine"\n---\n', note(one))).toBeNull()
    expect(mergeNoteComments(null, note(one), '---\ncomments: [unclosed\n---\n')).toBeNull()
  })
})
