/**
 * Shared `[[…]]` completion matcher (Links B, GRO-2191): the trailing-fragment trigger, the
 * ranked exact → prefix → substring match every completion surface uses (EditableCell's
 * editors + the editor's `[[` picker; ranking upgraded in place — F2, GRO-2197), and
 * `linkCandidates` — shortest unambiguous names with duplicate basenames
 * disambiguated per the resolver's shallowest-depth rule, plus one piped row per frontmatter
 * alias (Links E2, GRO-2214). The perf smoke lives in completion.perf.test.ts (YAZ-740).
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { resolverFor } from '../views/engine'
import { MAX_SUGGESTIONS, titleCandidates, linkCandidates, matchLinkCandidates, mergeLinkCandidates, nameCandidate, trailingLinkFragment } from './completion'

const rec = (path: string, aliases: string[] = []): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const folder = path.slice('/vault/'.length, path.lastIndexOf('/')).replace(/^\/+$/, '')
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    title: name.replace(/\.md$/, ''),
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

describe('matchLinkCandidates over plain names', () => {
  const names = ['Alpha', 'Beta', 'alphabet soup', 'Gamma']
  const matchLinkNames = (candidates: string[], fragment: string): string[] =>
    matchLinkCandidates(candidates.map(nameCandidate), fragment).map((c) => c.name)

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

describe('matchLinkCandidates ranking (F2, GRO-2197)', () => {
  const names = (candidates: string[], fragment: string): string[] =>
    matchLinkCandidates(candidates.map(nameCandidate), fragment).map((c) => c.name)

  it('an exact name beats a prefix beats a substring, whatever the input order', () => {
    expect(names(['Big CAC story', 'CAC Model', 'CAC'], 'cac')).toEqual(['CAC', 'CAC Model', 'Big CAC story'])
  })

  it('is stable within each bucket — input order preserved', () => {
    expect(names(['CAC one', 'x CAC', 'CAC two', 'y CAC'], 'cac')).toEqual(['CAC one', 'CAC two', 'x CAC', 'y CAC'])
  })

  it('the cap applies AFTER ranking — a late exact match still tops a board of substrings', () => {
    const candidates = [...Array.from({ length: 20 }, (_, i) => `note cac ${i}`), 'CAC']
    const matched = names(candidates, 'cac')
    expect(matched).toHaveLength(MAX_SUGGESTIONS)
    expect(matched[0]).toBe('CAC')
  })

  it('a fragment with leading/trailing whitespace still matches — the needle ends are trimmed (Obsidian)', () => {
    expect(names(['Alpha', 'Beta'], ' al')).toEqual(['Alpha'])
    expect(names(['Alpha', 'Beta'], 'alpha ')).toEqual(['Alpha'])
  })

  it('internal whitespace stays significant', () => {
    expect(names(['alphabet soup', 'alphabetsoup'], 'et sou')).toEqual(['alphabet soup'])
  })

  it('matches a hand-built literal without the precomputed lower (derived on the fly)', () => {
    expect(matchLinkCandidates([{ name: 'Alpha', insert: 'Alpha', label: 'Alpha' }], 'ALPHA')).toHaveLength(1)
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

  it('a name row matches, inserts and reads as itself (lower precomputed for the ranking scan, GRO-2197)', () => {
    // `path` is the record this row names (YAZ-957).
    expect(linkCandidates([rec('/vault/A.md')])).toEqual([{ name: 'A', insert: 'A', label: 'A', lower: 'a', path: '/vault/A.md' }])
  })

  it('an alias adds a row after its note: typed as the alias, inserted PIPED, labelled with the note (GRO-2214)', () => {
    const CAC = '/vault/Customer Acquisition Cost.md'
    const records = [rec(CAC, ['CAC', 'Acquisition Cost']), rec('/vault/Ideas.md')]
    expect(linkCandidates(records)).toEqual([
      // Every row carries the record it came from (YAZ-957) — the alias rows included, so an
      // alias row and its note's own row agree on whose note they are.
      { name: 'Customer Acquisition Cost', insert: 'Customer Acquisition Cost', label: 'Customer Acquisition Cost', lower: 'customer acquisition cost', path: CAC },
      { name: 'CAC', insert: 'Customer Acquisition Cost|CAC', label: 'CAC — Customer Acquisition Cost', lower: 'cac', path: CAC },
      { name: 'Acquisition Cost', insert: 'Customer Acquisition Cost|Acquisition Cost', label: 'Acquisition Cost — Customer Acquisition Cost', lower: 'acquisition cost', path: CAC },
      { name: 'Ideas', insert: 'Ideas', label: 'Ideas', lower: 'ideas', path: '/vault/Ideas.md' },
    ])
    // Typing the alias offers the alias row only; typing the name offers the name row only.
    expect(matchLinkCandidates(linkCandidates(records), 'cac').map((c) => c.label)).toEqual(['CAC — Customer Acquisition Cost'])
  })

  it('an alias equal to the chosen name is skipped — no degenerate [[X|X]] row (GRO-2197)', () => {
    const records = [rec('/vault/CAC.md', ['CAC', 'cac', 'Customer Acquisition Cost'])]
    expect(linkCandidates(records).map((c) => c.label)).toEqual(['CAC', 'Customer Acquisition Cost — CAC'])
  })

  it('an alias matching only the BARE basename of a folder-disambiguated note is NOT degenerate — the piped row stays', () => {
    const records = [rec('/vault/Note.md'), rec('/vault/a/Note.md', ['Note'])]
    expect(linkCandidates(records).map((c) => c.insert)).toEqual(['Note', 'a/Note', 'a/Note|Note'])
  })

  it('an alias containing [ or ] is skipped — its piped insert would re-parse as a different link (GRO-2197)', () => {
    const records = [rec('/vault/Metrics.md', ['[[X]]', 'ok]', '[ok', 'Fine'])]
    expect(linkCandidates(records).map((c) => c.insert)).toEqual(['Metrics', 'Metrics|Fine'])
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
})

describe('linkCandidates: a note with an id is linked BY it (YAZ-2293)', () => {
  const ID = 'k3m9x2pq7abc'
  const CAC = '/vault/Customer Acquisition Cost.md'

  it('the name row is still typed and read as the name, and inserts the id', () => {
    expect(linkCandidates([{ ...rec(CAC), id: ID }])).toEqual([
      { name: 'Customer Acquisition Cost', insert: ID, label: 'Customer Acquisition Cost', lower: 'customer acquisition cost', path: CAC },
    ])
  })

  it('an alias row inserts the SAME plain id — no pipe — and still reads `Alias — Note`', () => {
    expect(linkCandidates([{ ...rec(CAC, ['CAC']), id: ID }])[1]).toEqual({
      name: 'CAC',
      insert: ID,
      label: 'CAC — Customer Acquisition Cost',
      lower: 'cac',
      path: CAC,
    })
  })

  it('a note without an id beside one with: exactly the by-name rows it always had', () => {
    const records = [{ ...rec('/vault/A.md'), id: ID }, rec(CAC, ['CAC'])]
    expect(linkCandidates(records).slice(1)).toEqual([
      { name: 'Customer Acquisition Cost', insert: 'Customer Acquisition Cost', label: 'Customer Acquisition Cost', lower: 'customer acquisition cost', path: CAC },
      { name: 'CAC', insert: 'Customer Acquisition Cost|CAC', label: 'CAC — Customer Acquisition Cost', lower: 'cac', path: CAC },
    ])
  })

  it('the id resolves to its own record, from the name row and the alias row alike', () => {
    const records = [rec('/vault/CAC.md'), { ...rec(CAC, ['CAC']), id: ID }]
    const resolve = resolverFor(records, '/vault')
    expect(linkCandidates(records).map((c) => resolve(c.insert)?.record.path)).toEqual(['/vault/CAC.md', CAC, CAC])
  })

  it('duplicate basenames are still told apart in name and label, id or no id', () => {
    const records = [rec('/vault/Note.md'), { ...rec('/vault/a/Note.md', ['N']), id: ID }, rec('/vault/b/Note.md', ['N'])]
    expect(linkCandidates(records).map(({ name, label, insert }) => ({ name, label, insert }))).toEqual([
      { name: 'Note', label: 'Note', insert: 'Note' },
      { name: 'a/Note', label: 'a/Note', insert: ID },
      { name: 'N', label: 'N — a/Note', insert: ID },
      { name: 'b/Note', label: 'b/Note', insert: 'b/Note' },
      { name: 'N', label: 'N — b/Note', insert: 'b/Note|N' },
    ])
  })
})

describe('linkCandidates: rows are typed and read as TITLES (YAZ-2420 D17)', () => {
  const ID = 'k3m9x2pq7abc'
  const ABDUL = `/vault/candidates/up-001-abdul-${ID}.md`
  const abdul = (aliases: string[] = []): IndexRecord => ({ ...rec(ABDUL, aliases), title: 'UP-001 - Abdul' })

  it('E: the row of a note with a title matches and reads as the title, and inserts the id; so does its alias row', () => {
    const rows = linkCandidates([{ ...abdul(['Abdul R']), id: ID }])
    expect(rows).toEqual([
      { name: 'UP-001 - Abdul', insert: ID, label: 'UP-001 - Abdul', lower: 'up-001 - abdul', path: ABDUL },
      { name: 'Abdul R', insert: ID, label: 'Abdul R — UP-001 - Abdul', lower: 'abdul r', path: ABDUL },
    ])
    expect(matchLinkCandidates(rows, 'up-001 -').map((c) => c.label)).toEqual(['UP-001 - Abdul'])
    expect(matchLinkCandidates(rows, ID)).toEqual([]) // the file name is not what a row is typed as
  })

  it('a note with a title and no id inserts its title, which resolves back to it', () => {
    const records = [abdul(['Abdul R'])]
    expect(linkCandidates(records).map((c) => c.insert)).toEqual(['UP-001 - Abdul', 'UP-001 - Abdul|Abdul R'])
    expect(linkCandidates(records).map((c) => resolverFor(records, '/vault')(c.insert)?.record.path)).toEqual([ABDUL, ABDUL])
  })

  it('two notes with one title and no id: the shallowest inserts the title, the other its path, and each row tells them apart', () => {
    const records = [abdul(['Abdul R']), { ...rec('/vault/z/deep/old-abdul.md', ['Old one']), title: 'UP-001 - Abdul' }]
    expect(linkCandidates(records).map(({ label, insert }) => ({ label, insert }))).toEqual([
      { label: 'UP-001 - Abdul', insert: 'UP-001 - Abdul' },
      { label: 'Abdul R — UP-001 - Abdul', insert: 'UP-001 - Abdul|Abdul R' },
      { label: 'z/deep/UP-001 - Abdul', insert: 'z/deep/old-abdul' },
      { label: 'Old one — z/deep/UP-001 - Abdul', insert: 'z/deep/old-abdul|Old one' },
    ])
    const resolve = resolverFor(records, '/vault')
    expect(linkCandidates(records).map((c) => resolve(c.insert)?.record.path)).toEqual([ABDUL, ABDUL, '/vault/z/deep/old-abdul.md', '/vault/z/deep/old-abdul.md'])
  })
})

describe('titleCandidates (the cell editors, YAZ-2293)', () => {
  it('E: offers a note with a title by the title, and writes its id — its title when it has none (YAZ-2420 D17)', () => {
    const titled = { ...rec('/vault/candidates/up-001-abdul-k3m9x2pq7abc.md'), title: 'UP-001 - Abdul' }
    expect(titleCandidates([{ ...titled, id: 'k3m9x2pq7abc' }, titled])).toEqual([
      { name: 'UP-001 - Abdul', insert: 'k3m9x2pq7abc', label: 'UP-001 - Abdul', lower: 'up-001 - abdul' },
      { name: 'UP-001 - Abdul', insert: 'UP-001 - Abdul', label: 'UP-001 - Abdul', lower: 'up-001 - abdul' },
    ])
  })


  it('offers every note by its BASENAME — no alias row, no folder form — and writes its id when it has one', () => {
    const records = [rec('/vault/Note.md', ['Alias']), { ...rec('/vault/a/Note.md'), id: 'k3m9x2pq7abc' }]
    expect(titleCandidates(records)).toEqual([
      { name: 'Note', insert: 'Note', label: 'Note', lower: 'note' },
      { name: 'Note', insert: 'k3m9x2pq7abc', label: 'Note', lower: 'note' },
    ])
  })
})

describe('mergeLinkCandidates (YAZ-1310)', () => {
  it('suppresses recognized view-only targets even before a matching catalog entry exists', () => {
    const markdown = [
      { ...nameCandidate('data.json'), path: '/vault/data.json.md' },
      { name: 'JSON alias', insert: 'data.json|JSON alias', label: 'JSON alias — data.json', path: '/vault/data.json.md' },
      { name: 'data.json', insert: 'Note|data.json', label: 'data.json — Note', path: '/vault/Note.md' },
      { ...nameCandidate('Note'), path: '/vault/Note.md' },
    ]
    expect(mergeLinkCandidates(markdown, []).map((candidate) => candidate.insert)).toEqual([
      'Note|data.json',
      'Note',
    ])
  })

  it('reserves explicit view-only spellings while leaving semantic aliases and unrelated Markdown rows intact', () => {
    const markdown = [
      { ...nameCandidate('data.json'), path: '/vault/data.json.md' },
      { name: 'JSON alias', insert: 'data.json|JSON alias', label: 'JSON alias — data.json', path: '/vault/data.json.md' },
      { name: 'data.json', insert: 'Note|data.json', label: 'data.json — Note', path: '/vault/Note.md' },
      { ...nameCandidate('Note'), path: '/vault/Note.md' },
    ]
    const viewOnly = [
      { ...nameCandidate('data.json'), path: '/vault/data.json' },
      { ...nameCandidate('deep/tool.PY'), path: '/vault/deep/tool.PY' },
    ]
    expect(mergeLinkCandidates(markdown, viewOnly).map((candidate) => candidate.insert)).toEqual([
      'Note|data.json',
      'Note',
      'data.json',
      'deep/tool.PY',
    ])
  })

  it('keeps a note NAMED like a view-only file once it links by id: the id is no view-only spelling (YAZ-2293)', () => {
    const records = [{ ...rec('/vault/report.pdf.md', ['Q3']), id: 'k3m9x2pq7abc' }, rec('/vault/data.json.md')]
    expect(mergeLinkCandidates(linkCandidates(records), []).map((candidate) => candidate.label)).toEqual(['report.pdf', 'Q3 — report.pdf'])
  })
})
