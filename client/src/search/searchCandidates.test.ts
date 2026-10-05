/**
 * Title search candidates (YAZ-802): basename + alias rows over an index snapshot, matched
 * through the shared completion matcher at SEARCH_CAP — and, since YAZ-1491, one row per FOLDER
 * of the loaded tree (🔒 D1), ranked through the very same matcher (🔒 D2). The perf smoke lives
 * in searchCandidates.perf.test.ts (YAZ-740).
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { SEARCH_CAP, folderCandidates, searchCandidates, searchRows, searchTitles } from './searchCandidates'

const rec = (path: string, aliases: string[] = [], title?: string): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const folder = path.slice('/vault/'.length, path.lastIndexOf('/')).replace(/^\/+$/, '')
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    title: title ?? name.replace(/\.md$/, ''),
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
      { kind: 'file', name: 'Alpha', lower: 'alpha', label: 'Alpha', path: '/vault/sub/Alpha.md', folder: 'sub' },
    ])
  })

  it('E: a note is matched on its title and labelled with it, on its alias rows too; an alias equal to the title is skipped (YAZ-2420 D14)', () => {
    const rows = searchCandidates([rec('/vault/up-001-abdul-k3m9x2pq7abc.md', ['Abdul', 'up-001 - abdul'], 'UP-001 - Abdul')])
    expect(rows.map((c) => [c.name, c.label])).toEqual([
      ['UP-001 - Abdul', 'UP-001 - Abdul'],
      ['Abdul', 'Abdul — UP-001 - Abdul'],
    ])
    expect(searchTitles(rows, '001 - ab').map((c) => c.label)).toEqual(['UP-001 - Abdul'])
    expect(searchTitles(rows, 'k3m9')).toEqual([])
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

describe('folderCandidates (🔒 D1, YAZ-1491)', () => {
  it('one `dir` row per folder: matched by its own name, carrying its own path', () => {
    expect(folderCandidates('/vault', ['/vault/Archive'], [])).toEqual([
      { kind: 'dir', name: 'Archive', lower: 'archive', label: 'Archive', path: '/vault/Archive', folder: '' },
    ])
  })

  it('E: a folder is matched on its title and labelled with it; its parent stays a path (YAZ-2420 D14)', () => {
    const folders = [{ path: '/vault/hiring/upwork-2026/.folder.md', title: 'Upwork 2026' } as IndexRecord]
    expect(folderCandidates('/vault', ['/vault/hiring', '/vault/hiring/upwork-2026'], folders)).toEqual([
      { kind: 'dir', name: 'hiring', lower: 'hiring', label: 'hiring', path: '/vault/hiring', folder: '' },
      { kind: 'dir', name: 'Upwork 2026', lower: 'upwork 2026', label: 'Upwork 2026', path: '/vault/hiring/upwork-2026', folder: 'hiring' },
    ])
  })

  it('a nested folder is labelled by its ROOT-RELATIVE parent, the way IndexRecord.folder is', () => {
    expect(folderCandidates('/vault', ['/vault/A', '/vault/A/B', '/vault/A/B/C'], []).map((c) => [c.name, c.folder])).toEqual([
      ['A', ''],
      ['B', 'A'],
      ['C', 'A/B'],
    ])
  })

  it('tolerates a trailing slash on the root', () => {
    expect(folderCandidates('/vault/', ['/vault/A/B'], []).map((c) => [c.name, c.folder])).toEqual([['B', 'A']])
  })

  it('no folders, no rows', () => {
    expect(folderCandidates('/vault', [], [])).toEqual([])
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

  it('a note never matches on its folder (🔒 D3, YAZ-739); the folder itself is ONE row (🔒 D2, YAZ-1491)', () => {
    const rows = [...folderCandidates('/vault', ['/vault/Archive'], []), ...searchCandidates([rec('/vault/Archive/Note.md')])]
    expect(searchTitles(rows, 'archive').map((c) => [c.kind, c.label])).toEqual([['dir', 'Archive']])
  })

  it('a folder and a note of the same name both match exactly — the folder first (tree order, 🔒 D1)', () => {
    const rows = [...folderCandidates('/vault', ['/vault/CAC'], []), ...searchCandidates([rec('/vault/CAC.md')])]
    expect(searchTitles(rows, 'cac').map((c) => [c.kind, c.path])).toEqual([
      ['dir', '/vault/CAC'],
      ['file', '/vault/CAC.md'],
    ])
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

describe('searchRows: the search box finds by id (YAZ-2420 D32)', () => {
  const ID = 'k3m9x2pq7abc'
  const ABDUL = `/vault/candidates/up-001-abdul-${ID}.md`
  const folders = [{ ...rec('/vault/candidates/.folder.md', [], 'Candidates 2026'), id: 'f7n2w8rt4xyz' }]
  const rows = [
    ...folderCandidates('/vault', ['/vault/candidates'], folders),
    ...searchCandidates([{ ...rec(ABDUL, ['Abdul'], 'UP-001 - Abdul'), id: ID }, rec('/vault/k3m9 abdul notes.md'), { ...rec('/vault/plan-7tq2m8vd4xhn.md', [], 'Plan'), id: '7tq2m8vd4xhn' }]),
  ]
  const found = (query: string) => searchRows(rows, query).map((c) => [c.kind, c.label, c.path])

  it('D: an id pasted alone is its note, the only result, under its title', () => {
    expect(found(ID)).toEqual([['file', 'UP-001 - Abdul', ABDUL]])
    expect(found(` ${ID.toUpperCase()} `)).toEqual([['file', 'UP-001 - Abdul', ABDUL]])
  })

  it('D: a `[[<id>]]` link, a file name or a whole copied path that holds the id is the same one result, wherever the note lives now', () => {
    for (const pasted of [`[[${ID}|Abdul]]`, `up-001-abdul-rehman-${ID}.md`, `/Users/y/vault/ai-dev-hire/upwork/up-001-abdul-rehman-${ID}.md`]) expect(found(pasted)).toEqual([['file', 'UP-001 - Abdul', ABDUL]])
  })

  it("D: a folder's id is the folder, the only result", () => {
    expect(found('see f7n2w8rt4xyz')).toEqual([['dir', 'Candidates 2026', '/vault/candidates']])
  })

  it('D: text that holds two ids gives those two and nothing else', () => {
    expect(found(`[[${ID}]] and [[7tq2m8vd4xhn]]`).map(([, label]) => label)).toEqual(['UP-001 - Abdul', 'Plan'])
  })

  it('D: text that holds no id of this vault is the ordinary search: part of an id matches nothing by id, and a title sharing its letters is found as any title is', () => {
    expect(found('k3m9').map(([, label]) => label)).toEqual(['k3m9 abdul notes'])
    expect(found(ID.slice(0, 11))).toEqual([])
    expect(found('zzzz9zzzzzzz')).toEqual([]) // an id, but of no note here
    expect(searchRows(rows, 'abdul')).toEqual(searchTitles(rows, 'abdul'))
  })
})
