import { searchCandidates, searchRows, type SearchCandidate } from '@client/search/searchCandidates'
import { filterTest } from '@client/search/searchType'
import type { IndexRecord } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { phoneRecord } from '../sync/phoneIndex'
import { ALL_TYPES, buildRows, findRows, phoneKindOf, searchRecords, typeTest, type PhoneType, type SearchSource } from './searchRun'
import { boardRecord } from '../drawing/boardFiles'

/** One card block with its line, as the Mac writes it: its title on its card line (YAZ-5308), when it has one. */
const card = (id: string, body: string, title?: string) => `\`\`\`card\n${body}\n\`\`\`\n<!-- card: ${id}${title === undefined ? '' : `, title "${title}"`} -->`
const page = (title: string, body: string, extra = '') => `---\ntitle: ${title}\n${extra}---\n\n${body}\n`
const cardFile = (title: string, id: string, body = 'Front\n---\nBack') => `---\nkind: card\n---\n\n${card(id, body, title)}\n`

/** A made-up vault, as the phone's index holds it (the real `indexRecord` of 2B). */
const FILES: Record<string, string> = {
  'Spanish words.md': page('Spanish words', `Words for a trip.\n\n${card('DEMO-12', 'la biblioteca\n---\nthe library', 'la biblioteca')}\n\n${card('DEMO-13', 'el tren\n---\nthe train', 'el tren')}\n\n![[DEMO-40]]`, 'id: DEMO-1\naliases: [Español]\n'),
  'git/Git cheat sheet.md': page('Git cheat sheet', card('DEMO-38', 'git pull\n---\nFetch and merge', 'git pull'), 'id: DEMO-2\n'),
  'Trip plan.md': page('Trip plan', 'Madrid in May. [[Spanish words]] [[Nowhere page]]', 'id: DEMO-3\n'),
  'cards/capital-of-spain-demo-40.md': cardFile('Capital of Spain', 'DEMO-40'),
  'cards/broken-demo-41.md': `---\nkind: card\n---\n\n${card('DEMO-41', 'One', 'Two cards in one')}\n\n${card('DEMO-42', 'Two')}\n`,
  'Café notes.md': page('Café notes', 'Über straße 🙂', 'id: DEMO-4\n'),
  'Regex (a+b)*.md': page('Regex (a+b)*', 'Text with [brackets].', 'id: DEMO-5\n'),
  '2026-10-28.md': page('Weekly sync', 'Named by hand.', 'id: DEMO-6\n'),
  '🙂 Happy.md': page('🙂 Happy', 'Emoji title.', 'id: DEMO-7\n'),
  'old/Old letters.md': page('Old letters', 'Before the letters changed.', 'id: OLD-8\n'),
  'folder/.folder.md': '---\ntitle: A folder\n---\n',
}
const RECORDS = Object.fromEntries(Object.entries(FILES).map(([path, text]) => [path, phoneRecord(path, text.length, text, { ctime: 1, mtime: 1 })]))
const source = (cards: boolean): SearchSource => ({ records: searchRecords(RECORDS), letters: ['DEMO', 'OLD'], cards })

/** What the Mac shows: `searchRows` on the rows the Type keeps (`useSearchResults` with the filters). */
const macRows = (rows: readonly SearchCandidate[], query: string, type: PhoneType) => {
  const keep = filterTest({ type: type[0] ?? 'all', time: 'any' }, () => 0, undefined)
  return searchRows(keep === undefined ? rows : rows.filter(keep), query)
}

const QUERIES = ['a', 'sp', 'spanish', 'Español', 'DEMO-12', 'demo 12', 'demo12', '12', '#1', '#4', '#12', 'OLD-12', 'old-8', '.*', '(a+b)*', '[brackets]', '\\', '🙂', 'é', 'Über', 'ß', 'STRASSE', 'git pull', 'capital', '2026-10', 'zzz', '   ', 'la bib', 'DEMO-40', 'DEMO-41', 'card']

describe('the phone searches as the Mac (YAZ-5079)', () => {
  for (const cards of [true, false])
    it(`the same rows in the same order as the Mac, Review ${cards ? 'on' : 'off'}, for each Type`, async () => {
      const rows = (await buildRows(source(cards)))!
      expect(rows).toEqual(searchCandidates(source(cards).records, ['DEMO', 'OLD'], cards))
      for (const type of [ALL_TYPES, ['pages'], ['cards']] as const)
        for (const q of QUERIES) {
          const phone = (await findRows(rows, q, type))!
          expect([type.join(), q, phone.map((r) => r.label)]).toEqual([type.join(), q, macRows(rows, q, type).map((r) => r.label)])
        }
    })

  it('Review on: a card file is ONE card row, found by its title or its ID; each card in a page is a row; an embed gives no row', async () => {
    const rows = (await buildRows(source(true)))!
    const capital = (await findRows(rows, 'Capital of Spain', ALL_TYPES))!
    expect(capital.map((r) => [r.label, r.card, r.path])).toEqual([['Capital of Spain', true, 'cards/capital-of-spain-demo-40.md']])
    // The page that embeds DEMO-40 does not hold it: the ID finds the card one time.
    expect((await findRows(rows, 'DEMO-40', ALL_TYPES))!.map((r) => r.path)).toEqual(['cards/capital-of-spain-demo-40.md'])
    const bib = (await findRows(rows, 'biblioteca', ALL_TYPES))!
    expect(bib.map((r) => [r.label, r.page, r.id])).toEqual([['la biblioteca', 'Spanish words.md', 'DEMO-12']])
    // A card ID in any form the Mac reads.
    for (const q of ['DEMO-12', 'demo-12', 'demo 12']) expect((await findRows(rows, q, ALL_TYPES))![0].path).toBe('Spanish words.md#DEMO-12')
  })

  it('Review off: a card file is a page row; the cards in pages have no row', async () => {
    const rows = (await buildRows(source(false)))!
    expect((await findRows(rows, 'Capital', ALL_TYPES))!.map((r) => [r.label, r.card])).toEqual([['Capital of Spain', undefined]])
    expect(await findRows(rows, 'biblioteca', ALL_TYPES)).toEqual([])
  })

  it('the Type filter: Pages leaves out the cards, Cards leaves out the pages', async () => {
    const rows = (await buildRows(source(true)))!
    expect((await findRows(rows, 'a', ['pages']))!.every((r) => r.card === undefined)).toBe(true)
    expect((await findRows(rows, 'a', ['cards']))!.every((r) => r.card === true)).toBe(true)
    expect((await findRows(rows, 'Trip', ['cards']))!).toEqual([])
  })

  it('regex characters, emoji and non-ASCII are plain text; no result is an empty list', async () => {
    const rows = (await buildRows(source(true)))!
    expect((await findRows(rows, '(a+b)*', ALL_TYPES))!.map((r) => r.label)).toEqual(['Regex (a+b)*'])
    expect((await findRows(rows, '🙂', ALL_TYPES))!.map((r) => r.label)).toEqual(['🙂 Happy'])
    expect((await findRows(rows, 'café', ALL_TYPES))!.map((r) => r.label)).toEqual(['Café notes'])
    expect(await findRows(rows, 'zzzz', ALL_TYPES)).toEqual([])
    expect(await findRows(rows, '.*', ALL_TYPES)).toEqual([])
  })

  it('no folder settings record is a row', async () => {
    const rows = (await buildRows(source(true)))!
    expect(rows.some((r) => r.path.endsWith('.folder.md'))).toBe(false)
  })

  it('YAZ-5534: each type alone and in mixes; none on is All types (a folder too)', async () => {
    const boards = ['art/Sketch.excalidraw', 'flows/Login.drawio', 'flows/Signup.drawio.svg', 'flows/Pay.drawio.png'].map((p) => boardRecord(p))
    const rows = (await buildRows({ ...source(true), records: [...source(true).records, ...boards] }))!
    const folder: SearchCandidate = { kind: 'dir', name: 'git', lower: 'git', label: 'git', path: 'git', folder: '' }
    const all = [...rows, folder]
    const paths = (type: PhoneType) => {
      const keep = typeTest(type)
      return [...new Set((keep === undefined ? all : all.filter(keep)).map((r) => r.path))].sort()
    }
    expect(typeTest(ALL_TYPES)).toBeUndefined()
    expect(paths(['drawings'])).toEqual(['art/Sketch.excalidraw'])
    expect(paths(['diagrams'])).toEqual(['flows/Login.drawio', 'flows/Pay.drawio.png', 'flows/Signup.drawio.svg'])
    expect(paths(['cards'])).toEqual(['Spanish words.md#DEMO-12', 'Spanish words.md#DEMO-13', 'cards/broken-demo-41.md', 'cards/capital-of-spain-demo-40.md', 'git/Git cheat sheet.md#DEMO-38'])
    expect(paths(['pages'])).toEqual(['2026-10-28.md', 'Café notes.md', 'Regex (a+b)*.md', 'Spanish words.md', 'Trip plan.md', 'git/Git cheat sheet.md', 'old/Old letters.md', '🙂 Happy.md'].sort())
    // A mix is the rows of each type on, no more.
    expect(paths(['drawings', 'diagrams'])).toEqual([...paths(['drawings']), ...paths(['diagrams'])].sort())
    expect(paths(['pages', 'cards'])).toEqual([...paths(['pages']), ...paths(['cards'])].sort())
    expect(paths(['pages', 'cards', 'drawings', 'diagrams'])).toEqual(paths(ALL_TYPES).filter((p) => p !== 'git'))
    // The kinds are YAZ-5473's: a board by its extension, any letter case; a folder has no type.
    expect(phoneKindOf({ kind: 'file', path: 'x/Y.EXCALIDRAW' })).toBe('drawings')
    expect(phoneKindOf({ kind: 'file', path: 'x/y.DrawIO.SVG' })).toBe('diagrams')
    expect(phoneKindOf({ kind: 'file', path: 'x/y.svg' })).toBe('pages')
    expect(phoneKindOf(folder)).toBeNull()
    // Typed text with a mix: the Mac's ranking on the rows of the types on.
    expect((await findRows(rows, 'login', ['diagrams', 'drawings']))!.map((r) => r.path)).toEqual(['flows/Login.drawio'])
    expect((await findRows(rows, 'login', ['pages']))!).toEqual([])
  })

  it('a search that is no longer wanted stops (a new letter was typed)', async () => {
    const rows = (await buildRows(source(true)))!
    expect(await findRows(rows, 'a', ALL_TYPES, () => Promise.resolve(), () => false)).toBeNull()
    expect(await buildRows(source(true), () => Promise.resolve(), () => false)).toBeNull()
  })
})

/** 5,000 pages, 4 cards in each (20,000 cards), with IDs, aliases and some card files: records as the index holds them. */
function bigVault(): IndexRecord[] {
  const records: IndexRecord[] = []
  for (let i = 0; i < 5000; i++) {
    const kind = i % 50 === 0 ? 'card' : undefined
    records.push({
      path: `folder${i % 40}/page-${i}.md`,
      name: `page-${i}.md`,
      basename: `page-${i}`,
      title: `Page ${i} ${['apple', 'banana', 'cherry', 'delta'][i % 4]}`,
      folder: `folder${i % 40}`,
      ext: 'md',
      size: 100,
      ctime: 1,
      mtime: 1,
      properties: {},
      aliases: i % 10 === 0 ? [`Alias ${i}`] : [],
      tags: [],
      links: [],
      embeds: [],
      id: `DEMO-${i + 1}`,
      ...(kind && { kind }),
      cards: Array.from({ length: kind ? 1 : 4 }, (_, c) => ({ id: `DEMO-${100000 + i * 4 + c}`, off: false, next: false, reviews: [], title: `Card ${i}-${c} ${['la casa', 'el perro', 'git pull', 'speed of light'][c]}` })),
    } as IndexRecord)
  }
  return records
}

describe('speed: 5,000 pages and 20,000 cards (YAZ-5079)', () => {
  it('builds the rows and finds each query in slices: no slice of its work takes 50 ms (CPU time of this thread; YAZ-5213)', async () => {
    const src: SearchSource = { records: bigVault(), letters: ['DEMO'], cards: true }
    // The work between two yields, in CPU time of this thread: the load of the machine does not count.
    const cpu = () => {
      const u = process.threadCpuUsage()
      return (u.user + u.system) / 1000
    }
    const run = () => {
      const work: number[] = []
      let last = cpu()
      const slice = async () => {
        work.push(cpu() - last)
        await new Promise((r) => setTimeout(r, 0))
        last = cpu()
      }
      return { work, slice }
    }
    const b = run()
    const rows = (await buildRows(src, b.slice))!
    const f = run()
    for (const q of ['a', 'pa', 'page 12', 'la casa', 'DEMO-100004', '#12', 'apple', 'zzz']) await findRows(rows, q, ALL_TYPES, f.slice)
    const longest = (w: number[]) => Math.max(...w)
    console.log(`[4C perf] ${rows.length} rows from 5,000 records: build in ${b.work.length} slices, longest ${longest(b.work).toFixed(1)} ms CPU; 8 queries in ${f.work.length} slices, longest ${longest(f.work).toFixed(1)} ms CPU`)
    expect(rows.length).toBeGreaterThan(25_000)
    expect(longest(b.work)).toBeLessThan(50)
    expect(longest(f.work)).toBeLessThan(50)
  }, 120_000)
})
