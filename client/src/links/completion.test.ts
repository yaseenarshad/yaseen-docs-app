/**
 * Shared `[[…]]` completion matcher (Links B, GRO-2191): the trailing-fragment trigger, the
 * capped substring match every completion surface uses (EditableCell's editors + the editor's
 * `[[` picker), and `linkCandidates` — shortest unambiguous names with duplicate basenames
 * disambiguated per the resolver's shallowest-depth rule. A perf smoke keeps the 1,000+ file
 * acceptance honest.
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { resolverFor } from '../bases/engine'
import { MAX_SUGGESTIONS, linkCandidates, matchLinkNames, trailingLinkFragment } from './completion'

const rec = (path: string): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const folder = path.slice('/vault/'.length, path.lastIndexOf('/')).replace(/^\/+$/, '')
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: path.indexOf('/', '/vault/'.length) === -1 ? '' : folder,
    ext: 'md',
    size: 1,
    ctime: 1,
    mtime: 1,
    properties: {},
    tags: [],
    links: [],
    embeds: [],
  }
}

describe('trailingLinkFragment', () => {
  it('finds the fragment of an unclosed trailing [[', () => {
    expect(trailingLinkFragment('foo [[ba')).toBe('ba')
    expect(trailingLinkFragment('[[')).toBe('')
    expect(trailingLinkFragment('[[Alpha Beta')).toBe('Alpha Beta')
  })

  it('returns null without an unclosed [[ at the end', () => {
    expect(trailingLinkFragment('')).toBeNull()
    expect(trailingLinkFragment('plain text')).toBeNull()
    expect(trailingLinkFragment('[[closed]]')).toBeNull()
    expect(trailingLinkFragment('[[closed]] after')).toBeNull()
    expect(trailingLinkFragment('[single [bracket')).toBeNull()
  })

  it('a second [[ after a closed pair triggers again', () => {
    expect(trailingLinkFragment('[[a]] and [[b')).toBe('b')
  })

  it('keeps a | in the fragment (alias handling is per-consumer)', () => {
    expect(trailingLinkFragment('[[target|ali')).toBe('target|ali')
  })
})

describe('matchLinkNames', () => {
  const names = ['Alpha', 'Beta', 'alphabet soup', 'Gamma']

  it('matches case-insensitive substrings in input order', () => {
    expect(matchLinkNames(names, 'alpha')).toEqual(['Alpha', 'alphabet soup'])
    expect(matchLinkNames(names, 'ALPHA')).toEqual(['Alpha', 'alphabet soup'])
    expect(matchLinkNames(names, 'et sou')).toEqual(['alphabet soup'])
    expect(matchLinkNames(names, 'zzz')).toEqual([])
  })

  it('an empty fragment matches everything (capped)', () => {
    expect(matchLinkNames(names, '')).toEqual(names)
  })

  it('caps at MAX_SUGGESTIONS', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Note ${i}`)
    expect(matchLinkNames(many, 'Note')).toHaveLength(MAX_SUGGESTIONS)
    expect(matchLinkNames(many, '')).toEqual(many.slice(0, MAX_SUGGESTIONS))
  })
})

describe('linkCandidates', () => {
  it('unique basenames stay bare', () => {
    const records = [rec('/vault/A.md'), rec('/vault/sub/B.md')]
    expect(linkCandidates(records)).toEqual(['A', 'B'])
  })

  it('duplicate basenames: the shallowest keeps the bare name, others get folder/basename', () => {
    const records = [rec('/vault/Note.md'), rec('/vault/deep/Note.md'), rec('/vault/deep/deeper/Note.md')]
    expect(linkCandidates(records)).toEqual(['Note', 'deep/Note', 'deep/deeper/Note'])
  })

  it('equal depth ties go to the first in (path-sorted) order, like the resolver', () => {
    const records = [rec('/vault/a/Note.md'), rec('/vault/b/Note.md')]
    expect(linkCandidates(records)).toEqual(['Note', 'b/Note'])
  })

  it('duplicate detection is case-insensitive, like resolution', () => {
    const records = [rec('/vault/note.md'), rec('/vault/sub/Note.md')]
    expect(linkCandidates(records)).toEqual(['note', 'sub/Note'])
  })

  it('every candidate resolves to exactly its own record (unambiguous by construction)', () => {
    const records = [
      rec('/vault/Note.md'),
      rec('/vault/a/Note.md'),
      rec('/vault/a/Other.md'),
      rec('/vault/b/c/Note.md'),
    ]
    const resolve = resolverFor(records, '/vault')
    const candidates = linkCandidates(records)
    candidates.forEach((candidate, i) => {
      expect(resolve(candidate)?.record.path).toBe(records[i].path)
    })
  })

  it('perf smoke: 5,000 records derive and match well under a keystroke budget', () => {
    const records = Array.from({ length: 5000 }, (_, i) => rec(`/vault/folder${i % 50}/Note ${i}.md`))
    const start = performance.now()
    const candidates = linkCandidates(records)
    for (let i = 0; i < 10; i++) matchLinkNames(candidates, `Note 49`)
    const elapsed = performance.now() - start
    expect(candidates).toHaveLength(5000)
    expect(elapsed).toBeLessThan(100)
  })
})
