/** `shared/people.ts` (YAZ-4615 D1): the vault's people file. */
import { describe, expect, it } from 'vitest'
import { EMPTY_PEOPLE, mergePeopleFile, parsePeople, withCard } from '@shared/people'
import { handleFromName, isCommentProfile } from '@shared/types'

const card = (name: string, updated: string) => ({ name, picture: null, updated })
const file = (people: Record<string, unknown>) => JSON.stringify({ version: 1, people })

describe('people file', () => {
  it('parsePeople drops what is not a card; a wrong shape is none', () => {
    expect(parsePeople({ version: 1, people: { a: card('A', 'x'), b: { name: 1 } } }).people).toEqual({ a: card('A', 'x') })
    expect(parsePeople('nope')).toEqual(EMPTY_PEOPLE)
  })

  it('withCard writes your card, and nothing when it already matches', () => {
    const me = { handle: 'yaseen', name: 'Yaseen', picture: null }
    const once = withCard(EMPTY_PEOPLE, me, 't1')
    expect(once?.people.yaseen).toEqual(card('Yaseen', 't1'))
    expect(withCard(once!, me, 't2')).toBeNull()
    expect(withCard(once!, { ...me, name: 'Yas' }, 't2')?.people.yaseen).toEqual(card('Yas', 't2'))
  })

  it('merge: one side only keeps that change; both changed keeps the newer; a bad side is null', () => {
    const base = file({ sam: card('Sam', '2026-11-01T00:00:00Z') })
    const merged = JSON.parse(mergePeopleFile(base, file({ sam: card('Sam T', '2026-11-03T00:00:00Z') }), file({ sam: card('Sam M', '2026-11-02T00:00:00Z'), me: card('Me', '2026-11-02T00:00:00Z') }))!)
    expect(merged.people).toEqual({ sam: card('Sam T', '2026-11-03T00:00:00Z'), me: card('Me', '2026-11-02T00:00:00Z') })
    // A Mac whose clock is wrong (a year ahead) wins a clash it should lose: the cost of no server (item 17).
    const skew = JSON.parse(mergePeopleFile(base, file({ sam: card('Right', '2026-11-03T00:00:00Z') }), file({ sam: card('Skewed', '2027-11-01T00:00:00Z') }))!)
    expect(skew.people.sam.name).toBe('Skewed')
    expect(mergePeopleFile(base, '{', file({}))).toBeNull()
  })

  it('handles: from a name, and only valid profiles pass', () => {
    expect(handleFromName('Yaseen Arshad')).toBe('yaseen-arshad')
    expect(handleFromName('  Zoë!! ')).toBe('zoe')
    expect(handleFromName('!!!')).toBe('')
    expect(isCommentProfile({ handle: 'yaseen', name: 'Yaseen', picture: null })).toBe(true)
    expect(isCommentProfile({ handle: 'Bad Handle', name: 'x', picture: null })).toBe(false)
    expect(isCommentProfile({ handle: 'ok', name: ' ', picture: null })).toBe(false)
    expect(isCommentProfile({ handle: 'ok', name: 'x', picture: 'http://x' })).toBe(false)
  })
})
