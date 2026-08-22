/**
 * Shared `[[…]]` completion matcher (Links B, GRO-2191): the trailing-fragment trigger, the
 * capped substring match every completion surface uses (EditableCell's editors + the editor's
 * `[[` picker), and `linkCandidates` — shortest unambiguous names with duplicate basenames
 * disambiguated per the resolver's shallowest-depth rule, plus one piped row per frontmatter
 * alias (Links E2, GRO-2214). A perf smoke keeps the 1,000+ file acceptance honest.
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { resolverFor } from '../bases/engine'
import { MAX_SUGGESTIONS, linkCandidates, matchLinkCandidates, matchLinkNames, nameCandidate, trailingLinkFragment } from './completion'

const rec = (path: string, aliases: string[] = []): IndexRecord => {
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
    aliases,
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
  // E2 (GRO-2214) turned candidates from bare strings into { name, insert, label } rows, so the
  // name pins below now read the inserted text; the row shape gets its own pins after them.
  const inserts = (records: readonly IndexRecord[]): string[] => linkCandidates(records).map((c) => c.insert)

  it('unique basenames stay bare', () => {
    const records = [rec('/vault/A.md'), rec('/vault/sub/B.md')]
    expect(inserts(records)).toEqual(['A', 'B'])
  })

  it('duplicate basenames: the shallowest keeps the bare name, others get folder/basename', () => {
    const records = [rec('/vault/Note.md'), rec('/vault/deep/Note.md'), rec('/vault/deep/deeper/Note.md')]
    expect(inserts(records)).toEqual(['Note', 'deep/Note', 'deep/deeper/Note'])
  })

  it('equal depth ties go to the first in (path-sorted) order, like the resolver', () => {
    const records = [rec('/vault/a/Note.md'), rec('/vault/b/Note.md')]
    expect(inserts(records)).toEqual(['Note', 'b/Note'])
  })

  it('duplicate detection is case-insensitive, like resolution', () => {
    const records = [rec('/vault/note.md'), rec('/vault/sub/Note.md')]
    expect(inserts(records)).toEqual(['note', 'sub/Note'])
  })

  it('a name row matches, inserts and reads as itself', () => {
    expect(linkCandidates([rec('/vault/A.md')])).toEqual([{ name: 'A', insert: 'A', label: 'A' }])
  })

  it('an alias adds a row after its note: typed as the alias, inserted PIPED, labelled with the note (GRO-2214)', () => {
    const records = [rec('/vault/Customer Acquisition Cost.md', ['CAC', 'Acquisition Cost']), rec('/vault/Ideas.md')]
    expect(linkCandidates(records)).toEqual([
      { name: 'Customer Acquisition Cost', insert: 'Customer Acquisition Cost', label: 'Customer Acquisition Cost' },
      { name: 'CAC', insert: 'Customer Acquisition Cost|CAC', label: 'CAC — Customer Acquisition Cost' },
      { name: 'Acquisition Cost', insert: 'Customer Acquisition Cost|Acquisition Cost', label: 'Acquisition Cost — Customer Acquisition Cost' },
      { name: 'Ideas', insert: 'Ideas', label: 'Ideas' },
    ])
    // Typing the alias offers the alias row only; typing the name offers the name row only.
    expect(matchLinkCandidates(linkCandidates(records), 'cac').map((c) => c.label)).toEqual(['CAC — Customer Acquisition Cost'])
  })

  it('two notes claiming one alias both show, told apart by the note half (folder-disambiguated when the basenames collide too)', () => {
    const records = [rec('/vault/a/Model.md', ['CAC']), rec('/vault/b/Model.md', ['CAC'])]
    expect(matchLinkCandidates(linkCandidates(records), 'CAC').map((c) => c.label)).toEqual(['CAC — Model', 'CAC — b/Model'])
  })

  it('every candidate resolves to exactly its own record (unambiguous by construction)', () => {
    const records = [
      rec('/vault/Note.md', ['Alias one']),
      rec('/vault/a/Note.md'),
      rec('/vault/a/Other.md', ['Alias one']), // a duplicate alias: the piped insert is still exact
      rec('/vault/b/c/Note.md'),
    ]
    const resolve = resolverFor(records, '/vault')
    const owners = records.flatMap((r) => Array<string>(1 + r.aliases.length).fill(r.path))
    expect(linkCandidates(records).map((c) => resolve(c.insert)?.record.path)).toEqual(owners)
  })

  it('perf smoke: 5,000 records derive and match well under a keystroke budget', () => {
    const records = Array.from({ length: 5000 }, (_, i) => rec(`/vault/folder${i % 50}/Note ${i}.md`, [`N${i}`]))
    const start = performance.now()
    const candidates = linkCandidates(records)
    for (let i = 0; i < 10; i++) matchLinkCandidates(candidates, `Note 49`)
    const elapsed = performance.now() - start
    expect(candidates).toHaveLength(10000) // one name row + one alias row per record
    expect(elapsed).toBeLessThan(100)
  })
})

describe('matchLinkNames (plain-name surfaces)', () => {
  it('is the candidate matcher over bare names', () => {
    expect(matchLinkNames(['Alpha', 'Beta'], 'a')).toEqual(['Alpha', 'Beta'])
    expect(matchLinkCandidates(['Alpha', 'Beta'].map(nameCandidate), 'a').map((c) => c.insert)).toEqual(['Alpha', 'Beta'])
  })
})
