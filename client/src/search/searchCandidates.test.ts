/**
 * Title search candidates (YAZ-802): basename + alias rows over an index snapshot, matched
 * through the shared completion matcher at SEARCH_CAP — and, since YAZ-1491, one row per FOLDER
 * of the loaded tree (🔒 D1), ranked through the very same matcher (🔒 D2); since YAZ-2620, one row
 * per tree file that is no note (🔒 D3 there), the same way. The perf smoke lives in
 * searchCandidates.perf.test.ts (YAZ-740).
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { SEARCH_CAP, fileCandidates, folderCandidates, searchCandidates, searchRows, searchTitles } from './searchCandidates'

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

describe('fileCandidates (🔒 D3, YAZ-2620)', () => {
  it('S12: one `file` row per file that is no note — matched by its file name WITH the extension, labelled by its root-relative folder', () => {
    const rows = fileCandidates('/vault', ['/vault/skills/yt/get-transcript.py', '/vault/scan.pdf'])
    expect(rows).toEqual([
      { kind: 'file', name: 'get-transcript.py', lower: 'get-transcript.py', label: 'get-transcript.py', path: '/vault/skills/yt/get-transcript.py', folder: 'skills/yt' },
      { kind: 'file', name: 'scan.pdf', lower: 'scan.pdf', label: 'scan.pdf', path: '/vault/scan.pdf', folder: '' },
    ])
    expect(searchTitles(rows, '.py').map((c) => c.path)).toEqual(['/vault/skills/yt/get-transcript.py'])
    expect(searchTitles(rows, 'Get-Transcript').map((c) => c.path)).toEqual(['/vault/skills/yt/get-transcript.py'])
    expect(searchTitles(rows, 'skills')).toEqual([]) // its folder is a label, never matched — a note's rule (🔒 D3, YAZ-739)
    expect(fileCandidates('/vault/', ['/vault/a/b.txt']).map((c) => c.folder)).toEqual(['a'])
  })

  it('S12, S19: a note still matches by its title and aliases, never by its file name; a tie is folder, then note, then other file', () => {
    const notes = searchCandidates([rec('/vault/up-001-abdul.md', ['Plan'], 'UP-001 - Abdul')])
    const rows = [...folderCandidates('/vault', ['/vault/plan'], []), ...notes, ...fileCandidates('/vault', ['/vault/bin/plan', '/vault/up-001-abdul.py'])]
    expect(searchTitles(rows, 'up-001-abdul').map((c) => c.path)).toEqual(['/vault/up-001-abdul.py'])
    // `plan` three times, each an exact name: the folder, the note's alias, the file with no extension.
    expect(searchTitles(rows, 'plan').map((c) => [c.kind, c.label])).toEqual([['dir', 'plan'], ['file', 'Plan — UP-001 - Abdul'], ['file', 'plan']])
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

describe('searchTitles with pinned rows first (YAZ-2662 D4)', () => {
  const candidates = [
    ...folderCandidates('/vault', ['/vault/Pinned', '/vault/Pinned/CAC deep'], []),
    ...searchCandidates([rec('/vault/Big CAC story.md'), rec('/vault/CAC.md'), rec('/vault/Pinned/CAC Model.md'), rec('/vault/Pinned/Ideas.md', ['my cac']), rec('/vault/Pinned/Other.md')]),
  ]
  /** The paths of the candidates that are a pinned item or are inside one: `Pinned/` is the pinned item. */
  const first = new Set(candidates.map((c) => c.path).filter((path) => path.startsWith('/vault/Pinned')))

  it('each pinned match goes before each other match; inside each part the order stays exact → starts with → contains, input order in a rank', () => {
    expect(searchTitles(candidates, 'cac', first).map((c) => c.label)).toEqual(['CAC deep', 'CAC Model', 'my cac — Ideas', 'CAC', 'Big CAC story'])
    expect(searchTitles(candidates, 'cac').map((c) => c.label)).toEqual(['CAC', 'CAC deep', 'CAC Model', 'Big CAC story', 'my cac — Ideas'])
  })

  it('S24: the limit cuts AFTER the pinned matches went first — 60 other matches and 3 pinned keep the 3 and the best 47 of the others', () => {
    const many = searchCandidates([...Array.from({ length: 60 }, (_, i) => rec(`/vault/Note ${String(i).padStart(2, '0')}.md`)), ...Array.from({ length: 3 }, (_, i) => rec(`/vault/Pinned/A note ${i}.md`))])
    const pinned = new Set(many.slice(60).map((c) => c.path))
    const matched = searchTitles(many, 'note', pinned)
    expect(matched).toHaveLength(SEARCH_CAP)
    expect(matched.slice(0, 3).map((c) => c.label)).toEqual(['A note 0', 'A note 1', 'A note 2']) // they only CONTAIN the text; the 60 start with it
    expect(matched.slice(3)).toEqual(many.slice(0, 47))
    expect(searchTitles(many, 'note').some((c) => pinned.has(c.path))).toBe(false) // with no pinned row the limit cuts them, as before
  })

  it('no pinned row, or no pinned match, is the ranking as it was: what the note-shortcut picker asks for (R7)', () => {
    expect(searchTitles(candidates, 'cac', new Set())).toEqual(searchTitles(candidates, 'cac'))
    expect(searchTitles(candidates, 'big', first).map((c) => c.label)).toEqual(['Big CAC story'])
  })

  it('S25: the rows that an id finds put the pinned ones first too', () => {
    const rows = searchCandidates([{ ...rec('/vault/plan-7tq2m8vd4xhn.md', [], 'Plan'), id: '7tq2m8vd4xhn' }, { ...rec('/vault/Pinned/abdul-k3m9x2pq7abc.md', [], 'Abdul'), id: 'k3m9x2pq7abc' }])
    const both = '[[7tq2m8vd4xhn]] and [[k3m9x2pq7abc]]'
    expect(searchRows(rows, both).map((c) => c.label)).toEqual(['Plan', 'Abdul'])
    expect(searchRows(rows, both, new Set(['/vault/Pinned/abdul-k3m9x2pq7abc.md'])).map((c) => c.label)).toEqual(['Abdul', 'Plan'])
    expect(searchRows(rows, 'abdul', new Set(['/vault/Pinned/abdul-k3m9x2pq7abc.md'])).map((c) => c.label)).toEqual(['Abdul'])
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

  it('in a vault that does not use IDs nothing is found by id: its index hands out no id, so an id pasted is searched as any text is (YAZ-2523 V5)', () => {
    // The same note and folder as such a vault's index hands them out: no `id`, the file name as the title.
    const plain = [...folderCandidates('/vault', ['/vault/candidates'], [rec('/vault/candidates/.folder.md', [], 'candidates')]), ...searchCandidates([{ ...rec('/vault/candidates/Abdul.md', ['Abdul R']), properties: { id: ID } }])]
    for (const pasted of [ID, `[[${ID}|Abdul]]`, 'see f7n2w8rt4xyz']) expect(searchRows(plain, pasted)).toEqual([])
    expect(searchRows(plain, 'abdul')).toEqual(searchTitles(plain, 'abdul'))
    expect(searchRows(plain, 'abdul').map((c) => c.label)).toEqual(['Abdul', 'Abdul R — Abdul'])
  })

  it('D: text that holds no id of this vault is the ordinary search: part of an id matches nothing by id, and a title sharing its letters is found as any title is', () => {
    expect(found('k3m9').map(([, label]) => label)).toEqual(['k3m9 abdul notes'])
    expect(found(ID.slice(0, 11))).toEqual([])
    expect(found('zzzz9zzzzzzz')).toEqual([]) // an id, but of no note here
    expect(searchRows(rows, 'abdul')).toEqual(searchTitles(rows, 'abdul'))
  })
})

// Search by number (YAZ-2677 D9, with its addition): scenario record section F, S69 to S78.
describe('searchRows: the search box finds a note by its number (YAZ-2677 D9)', () => {
  const note = (path: string, title: string, id: string, aliases: string[] = []): IndexRecord => ({ ...rec(path, aliases, title), id })
  // Two vaults in one window, as `useSearchResults` joins them: `YAZ`, which was `OLD` before, and `BUS`.
  const yaz = [
    note('/yaz/plan-yaz-12.md', 'Plan', 'YAZ-12', ['The plan']),
    note('/yaz/first-yaz-1.md', 'First', 'YAZ-1'),
    note('/yaz/big-yaz-120.md', 'Big', 'YAZ-120'),
    note('/yaz/chapter-yaz-7.md', 'Chapter 12', 'YAZ-7'),
    note('/yaz/fix-yaz-8.md', 'Fix for YAZ-12', 'YAZ-8'),
    note('/yaz/old-k3m9x2pq7abc.md', 'Old one', 'k3m9x2pq7abc'),
    rec('/yaz/no id 12.md'),
  ]
  const rows = [
    ...folderCandidates('/yaz', ['/yaz/area'], [{ ...rec('/yaz/area/.folder.md', [], 'Area'), id: 'YAZ-3' }], ['YAZ', 'OLD']),
    ...searchCandidates(yaz, ['YAZ', 'OLD']),
    ...searchCandidates([note('/bus/trip-bus-12.md', 'Trip', 'BUS-12'), note('/bus/twelve-bus-5.md', '12 stops', 'BUS-5')], ['BUS']),
  ]
  const found = (query: string) => searchRows(rows, query).map((c) => c.label)

  it('S69: `12` shows the note of number 12 first, then the title matches for "12"', () => {
    expect(found('12').slice(0, 2)).toEqual(['YAZ-12 — Plan', 'BUS-12 — Trip'])
    expect(found('12').slice(2)).toEqual(['12 stops', 'Chapter 12', 'Fix for YAZ-12', 'no id 12'])
  })

  it('S70: in a window with two vaults both notes of that number show first, and each row shows its full ID', () => {
    expect(searchRows(rows, '12').slice(0, 2).map((c) => [c.label, c.path])).toEqual([
      ['YAZ-12 — Plan', '/yaz/plan-yaz-12.md'],
      ['BUS-12 — Trip', '/bus/trip-bus-12.md'],
    ])
  })

  it('S71: `YAZ-12`, `yaz-12`, `yaz12` and `yaz 12` all have `YAZ-12` as the first row; the title matches for the same text come after it', () => {
    for (const typed of ['YAZ-12', 'yaz-12', 'yaz12', 'yaz 12', ' Yaz-12 ']) expect(found(typed)[0]).toBe('YAZ-12 — Plan')
    expect(found('YAZ-12')).toEqual(['YAZ-12 — Plan', 'Fix for YAZ-12'])
    expect(found('yaz12')).toEqual(['YAZ-12 — Plan'])
  })

  it('S72: `yaz-12` does not show `YAZ-1` or `YAZ-120`, nor the other vault\'s note 12: an ID matches whole', () => {
    for (const typed of ['yaz-12', 'yaz12', 'yaz 12']) {
      const shown = searchRows(rows, typed).map((c) => c.id)
      expect(shown).toContain('YAZ-12')
      for (const other of ['YAZ-1', 'YAZ-120', 'BUS-12']) expect(shown).not.toContain(other)
    }
  })

  it('S73: `1` shows `YAZ-1` first, and no note whose number only starts with 1', () => {
    expect(found('1')[0]).toBe('YAZ-1 — First')
    const byId = searchRows(rows, '1').filter((c) => c.label.includes(' — ') && c.label.startsWith(`${c.id} — `))
    expect(byId.map((c) => c.id)).toEqual(['YAZ-1'])
  })

  it('S74: a pasted link `[[YAZ-12]]`, a file name `plan-yaz-12.md` and a whole path are that note (YAZ-2420 D32)', () => {
    for (const pasted of ['[[YAZ-12]]', '[[yaz-12|the plan]]', 'plan-yaz-12.md', '/Users/y/vault/work/plan-yaz-12.md']) expect(found(pasted)).toEqual(['YAZ-12 — Plan'])
  })

  it('S75: an old ID, pasted or typed, is its note under its title, as before', () => {
    expect(found('k3m9x2pq7abc')).toEqual(['Old one'])
    expect(found('/vault/old-K3M9X2PQ7ABC.md')).toEqual(['Old one'])
  })

  it('S76: `99`, a number no note has, gives the title matches only', () => {
    expect(searchRows(rows, '99')).toEqual(searchTitles(rows, '99'))
    expect(searchRows([...rows, ...searchCandidates([rec('/yaz/route 99.md')])], '99').map((c) => c.label)).toEqual(['route 99'])
  })

  it('S77: `OLD-12`, where the vault had the letters `OLD` before, is the note with number 12 of THAT vault', () => {
    for (const typed of ['OLD-12', 'old12', 'old 12']) expect(found(typed)).toEqual(['YAZ-12 — Plan'])
    // The letters of before ride on the rows of that vault alone, as one shared list.
    const [first, second] = rows.filter((c) => c.kind === 'file' && c.was !== undefined)
    expect(first.was).toEqual(['OLD'])
    expect(second.was).toBe(first.was)
    expect(rows.find((c) => c.id === 'BUS-12')).not.toHaveProperty('was')
  })

  it('a folder is found by its number as a note is', () => {
    expect(searchRows(rows, 'yaz-3').map((c) => [c.kind, c.label, c.path])).toEqual([['dir', 'YAZ-3 — Area', '/yaz/area']])
  })

  it('a note is one row when its id and its title both match; its alias row is not added after it', () => {
    expect(found('yaz-12').filter((label) => label.includes('Plan') || label.includes('plan'))).toEqual(['YAZ-12 — Plan'])
  })

  it('a number in a longer text is no bare number: the title matches only, in their own order', () => {
    expect(searchRows(rows, 'chapter 12')).toEqual(searchTitles(rows, 'chapter 12'))
    expect(found('chapter 12')).toEqual(['Chapter 12'])
  })

  it('S78: a text that can hold no ID is the title search itself, row for row', () => {
    for (const typed of ['plan', 'the', 'q3', 'a-1']) expect(searchRows(rows, typed)).toEqual(searchTitles(rows, typed))
  })

  it('with pinned rows (YAZ-2662 D4, S25): the ID matches stay first, the pinned one before the other, then the title matches, the pinned one before the others', () => {
    const first = new Set(['/bus/trip-bus-12.md', '/yaz/fix-yaz-8.md'])
    expect(searchRows(rows, '12', first).map((c) => c.label)).toEqual(['BUS-12 — Trip', 'YAZ-12 — Plan', 'Fix for YAZ-12', '12 stops', 'Chapter 12', 'no id 12'])
    expect(searchRows(rows, 'plan', first)).toEqual(searchTitles(rows, 'plan', first))
  })

  it('the rows are capped as the title search is, ID rows first', () => {
    const many = searchCandidates(Array.from({ length: 80 }, (_, i) => note(`/yaz/n-${i}.md`, `Report 12 part ${i}`, `YAZ-${i + 200}`)))
    const shown = searchRows([...many, ...rows], '12')
    expect(shown).toHaveLength(SEARCH_CAP)
    expect(shown.slice(0, 2).map((c) => c.id)).toEqual(['YAZ-12', 'BUS-12'])
  })
})
