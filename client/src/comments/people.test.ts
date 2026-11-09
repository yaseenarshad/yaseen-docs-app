/** `shared/people.ts` (YAZ-4615 D1): the vault's people file. */
import { describe, expect, it } from 'vitest'
import { EMPTY_PEOPLE, mergePeopleFile, own, parsePeople, PEOPLE_MAX, withCard } from '@shared/people'
import { handleFromName, isCommentProfile } from '@shared/types'

const card = (name: string, updated: string) => ({ name, picture: null, updated })
const file = (people: Record<string, unknown>) => JSON.stringify({ version: 1, people })

describe('people file', () => {
  it('parsePeople drops what is not a card; a wrong shape is none', () => {
    expect(parsePeople({ version: 1, people: { a: card('A', 'x'), b: { name: 1 } } }).people).toEqual({ a: card('A', 'x') })
    expect(parsePeople('nope')).toEqual(EMPTY_PEOPLE)
  })

  it('a synced card\'s picture is only a small data URL: a remote address or a huge string is not a card (audit 13)', () => {
    const people = { a: { name: 'A', picture: 'https://example.com/pixel.png', updated: 'x' }, b: { name: 'B', picture: `data:image/webp;base64,${'A'.repeat(70000)}`, updated: 'x' }, c: { name: 'C', picture: 'data:image/webp;base64,AAAA', updated: 'x' } }
    expect(Object.keys(parsePeople({ version: 1, people }).people)).toEqual(['c'])
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
    // `agent` is what the CLI signs an agent with: a person with it would read as an agent (checker, round 1).
    expect(isCommentProfile({ handle: 'agent', name: 'Agent Smith', picture: null })).toBe(false)
  })
  it('a write keeps a card this version cannot read (a newer app’s shape); so does the merge', () => {
    const odd = { name: 'Lee', avatar: { url: 'x' }, updated: '2026-11-01T00:00:00Z' }
    const me = { handle: 'maya', name: 'Maya', picture: null }
    expect(withCard({ version: 1, people: { lee: odd } }, me, 't1')?.people).toEqual({ lee: odd, maya: card('Maya', 't1') })
    const base = file({ lee: odd })
    expect(JSON.parse(mergePeopleFile(base, file({ lee: odd, sam: card('Sam', 't1') }), file({ lee: odd, maya: card('Maya', 't1') })) ?? '').people).toEqual({ lee: odd, sam: card('Sam', 't1'), maya: card('Maya', 't1') })
  })

  it('the app reads at most PEOPLE_MAX cards (a limit on what grows)', () => {
    const many = Object.fromEntries(Array.from({ length: PEOPLE_MAX + 5 }, (_, i) => [`p${i}`, card(`P${i}`, 't')]))
    expect(Object.keys(parsePeople({ version: 1, people: many }).people)).toHaveLength(PEOPLE_MAX)
  })
  it('every handle in the file is known, readable or not; a lookup reads own keys only (6C, 6D)', () => {
    const read = parsePeople({ version: 1, people: { sam: card('Sam', 't'), lee: { name: 'Lee', picture: 'https://x/p.png', updated: 't' } } })
    expect(Object.keys(read.people)).toEqual(['sam'])
    expect([...read.handles]).toEqual(['sam', 'lee'])
    expect(own(read.people, 'constructor')).toBeUndefined()
    expect(own(read.people, 'sam')).toEqual(card('Sam', 't'))
  })

  it('the merge and withCard never read a card from Object.prototype', () => {
    const me = { handle: 'constructor', name: 'Con', picture: null }
    expect(withCard({ version: 1, people: {} }, me, 't1')?.people).toEqual({ constructor: card('Con', 't1') })
    const merged = JSON.parse(mergePeopleFile(file({}), file({ constructor: card('Con', 't1') }), file({ sam: card('Sam', 't1') })) ?? '').people
    expect(merged).toEqual({ constructor: card('Con', 't1'), sam: card('Sam', 't1') })
  })
})
