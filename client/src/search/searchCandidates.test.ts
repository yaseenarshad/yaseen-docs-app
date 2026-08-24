/**
 * Title search candidates (YAZ-802): basename + alias rows over an index snapshot, matched
 * through the shared completion matcher at SEARCH_CAP. The perf smoke lives in
 * searchCandidates.perf.test.ts (YAZ-740).
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { SEARCH_CAP, searchCandidates, searchTitles } from './searchCandidates'

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

describe('searchCandidates', () => {
  it('one row per record: matched on the basename, opening its own path, folder as the label', () => {
    expect(searchCandidates([rec('/vault/sub/Alpha.md')])).toEqual([
      { name: 'Alpha', lower: 'alpha', label: 'Alpha', path: '/vault/sub/Alpha.md', folder: 'sub' },
    ])
  })

  it('a root-level record carries an empty folder', () => {
    expect(searchCandidates([rec('/vault/Alpha.md')])[0].folder).toBe('')
  })

  it('an alias adds a row after its note, labelled with the basename', () => {
    const rows = searchCandidates([rec('/vault/Customer Acquisition Cost.md', ['CAC', 'Acquisition Cost'])])
    expect(rows.map((c) => c.label)).toEqual([
      'Customer Acquisition Cost',
      'CAC — Customer Acquisition Cost',
      'Acquisition Cost — Customer Acquisition Cost',
    ])
    // Every row opens the same note.
    expect(rows.every((c) => c.path === '/vault/Customer Acquisition Cost.md')).toBe(true)
  })

  it('an alias equal to its own basename is skipped — it would only duplicate the row', () => {
    expect(searchCandidates([rec('/vault/CAC.md', ['CAC', 'cac', 'Cost'])]).map((c) => c.label)).toEqual(['CAC', 'Cost — CAC'])
  })

  it('duplicate basenames BOTH appear under the bare name, told apart by the folder (unlike linkCandidates)', () => {
    const rows = searchCandidates([rec('/vault/Note.md'), rec('/vault/deep/Note.md')])
    expect(rows.map((c) => c.name)).toEqual(['Note', 'Note'])
    expect(rows.map((c) => c.folder)).toEqual(['', 'deep'])
    expect(rows.map((c) => c.path)).toEqual(['/vault/Note.md', '/vault/deep/Note.md'])
  })
})

describe('searchTitles', () => {
  const candidates = searchCandidates([
    rec('/vault/Big CAC story.md'),
    rec('/vault/CAC Model.md'),
    rec('/vault/CAC.md'),
    rec('/vault/Ideas.md', ['cac notes']),
  ])

  it('ranks exact → prefix → substring, input order within each bucket', () => {
    expect(searchTitles(candidates, 'cac').map((c) => c.label)).toEqual([
      'CAC',
      'CAC Model',
      'cac notes — Ideas',
      'Big CAC story',
    ])
  })

  it('matches the basename and aliases only — never the folder (🔒 D3, YAZ-739)', () => {
    expect(searchTitles(searchCandidates([rec('/vault/Archive/Note.md')]), 'archive')).toEqual([])
  })

  it('an empty query returns the first SEARCH_CAP rows in records order', () => {
    const many = searchCandidates(Array.from({ length: SEARCH_CAP + 10 }, (_, i) => rec(`/vault/Note ${i}.md`)))
    expect(searchTitles(many, '')).toEqual(many.slice(0, SEARCH_CAP))
  })

  it('caps at SEARCH_CAP after ranking — a late exact match still tops a board of substrings', () => {
    const many = searchCandidates([
      ...Array.from({ length: SEARCH_CAP + 10 }, (_, i) => rec(`/vault/note cac ${i}.md`)),
      rec('/vault/CAC.md'),
    ])
    const matched = searchTitles(many, 'cac')
    expect(matched).toHaveLength(SEARCH_CAP)
    expect(matched[0].name).toBe('CAC')
  })
})
