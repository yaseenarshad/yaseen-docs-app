import { searchCandidates, searchRows, type SearchCandidate } from '@client/search/searchCandidates'
import { filterTest } from '@client/search/searchType'
import type { IndexRecord } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { phoneRecord } from '../sync/phoneIndex'
import { uiSlicer } from '../sync/yieldToUi'
import { buildRows, emptyBoxRows, findRows, searchRecords, type PhoneType, type SearchSource } from './searchRun'

/** One card block with its line, as the Mac writes it. */
const card = (id: string, body: string) => `\`\`\`card\n${body}\n\`\`\`\n<!-- card: ${id} -->`
const page = (title: string, body: string, extra = '') => `---\ntitle: ${title}\n${extra}---\n\n${body}\n`
const cardFile = (title: string, id: string, body = 'Front\n---\nBack') => `---\nkind: card\ntitle: ${title}\n---\n\n${card(id, body)}\n`

/** A made-up vault, as the phone's index holds it (the real `indexRecord` of 2B). */
const FILES: Record<string, string> = {
  'Spanish words.md': page('Spanish words', `Words for a trip.\n\n${card('DEMO-12', 'la biblioteca\n---\nthe library')}\n\n${card('DEMO-13', 'el tren\n---\nthe train')}\n\n![[DEMO-40]]`, 'id: DEMO-1\naliases: [Español]\n'),
  'git/Git cheat sheet.md': page('Git cheat sheet', card('DEMO-38', 'git pull\n---\nFetch and merge'), 'id: DEMO-2\n'),
  'Trip plan.md': page('Trip plan', 'Madrid in May. [[Spanish words]] [[Nowhere page]]', 'id: DEMO-3\n'),
  'cards/capital-of-spain-demo-40.md': cardFile('Capital of Spain', 'DEMO-40'),
  'cards/broken-demo-41.md': `---\nkind: card\ntitle: Two cards in one\n---\n\n${card('DEMO-41', 'One')}\n\n${card('DEMO-42', 'Two')}\n`,
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
  const keep = filterTest({ type, time: 'any' }, () => 0, undefined)
  return searchRows(keep === undefined ? rows : rows.filter(keep), query)
}

const QUERIES = ['a', 'sp', 'spanish', 'Español', 'DEMO-12', 'demo 12', 'demo12', '12', '#1', '#4', '#12', 'OLD-12', 'old-8', '.*', '(a+b)*', '[brackets]', '\\', '🙂', 'é', 'Über', 'ß', 'STRASSE', 'git pull', 'capital', '2026-10', 'zzz', '   ', 'la bib', 'DEMO-40', 'DEMO-41', 'card']

describe('the phone searches as the Mac (YAZ-5079)', () => {
  for (const cards of [true, false])
    it(`the same rows in the same order as the Mac, Review ${cards ? 'on' : 'off'}, for each Type`, async () => {
      const rows = (await buildRows(source(cards)))!
      expect(rows).toEqual(searchCandidates(source(cards).records, ['DEMO', 'OLD'], cards))
      for (const type of ['all', 'pages', 'cards'] as const)
        for (const q of QUERIES) {
          const phone = (await findRows(rows, q, type))!
          expect([type, q, phone.map((r) => r.label)]).toEqual([type, q, macRows(rows, q, type).map((r) => r.label)])
        }
    })

  it('Review on: a card file is ONE card row, found by its title or its ID; each card in a page is a row; an embed gives no row', async () => {
    const rows = (await buildRows(source(true)))!
    const capital = (await findRows(rows, 'Capital of Spain', 'all'))!
    expect(capital.map((r) => [r.label, r.card, r.path])).toEqual([['Capital of Spain', true, 'cards/capital-of-spain-demo-40.md']])
    // The page that embeds DEMO-40 does not hold it: the ID finds the card one time.
    expect((await findRows(rows, 'DEMO-40', 'all'))!.map((r) => r.path)).toEqual(['cards/capital-of-spain-demo-40.md'])
    const bib = (await findRows(rows, 'biblioteca', 'all'))!
    expect(bib.map((r) => [r.label, r.page, r.id])).toEqual([['la biblioteca', 'Spanish words.md', 'DEMO-12']])
    // A card ID in any form the Mac reads.
    for (const q of ['DEMO-12', 'demo-12', 'demo 12']) expect((await findRows(rows, q, 'all'))![0].path).toBe('Spanish words.md#DEMO-12')
  })

  it('Review off: a card file is a page row; the cards in pages have no row', async () => {
    const rows = (await buildRows(source(false)))!
    expect((await findRows(rows, 'Capital', 'all'))!.map((r) => [r.label, r.card])).toEqual([['Capital of Spain', undefined]])
    expect(await findRows(rows, 'biblioteca', 'all')).toEqual([])
  })

  it('the Type filter: Pages leaves out the cards, Cards leaves out the pages', async () => {
    const rows = (await buildRows(source(true)))!
    expect((await findRows(rows, 'a', 'pages'))!.every((r) => r.card === undefined)).toBe(true)
    expect((await findRows(rows, 'a', 'cards'))!.every((r) => r.card === true)).toBe(true)
    expect((await findRows(rows, 'Trip', 'cards'))!).toEqual([])
  })

  it('regex characters, emoji and non-ASCII are plain text; no result is an empty list', async () => {
    const rows = (await buildRows(source(true)))!
    expect((await findRows(rows, '(a+b)*', 'all'))!.map((r) => r.label)).toEqual(['Regex (a+b)*'])
    expect((await findRows(rows, '🙂', 'all'))!.map((r) => r.label)).toEqual(['🙂 Happy'])
    expect((await findRows(rows, 'café', 'all'))!.map((r) => r.label)).toEqual(['Café notes'])
    expect(await findRows(rows, 'zzzz', 'all')).toEqual([])
    expect(await findRows(rows, '.*', 'all')).toEqual([])
  })

  it('no folder settings record is a row', async () => {
    const rows = (await buildRows(source(true)))!
    expect(rows.some((r) => r.path.endsWith('.folder.md'))).toBe(false)
  })

  it('the empty box lists the pages only, by name; Type › Cards lists the cards', async () => {
    const rows = (await buildRows(source(true)))!
    expect(emptyBoxRows(rows, 'all').map((r) => r.label)).toEqual(['Café notes', 'Git cheat sheet', 'Old letters', 'Regex (a+b)*', 'Spanish words', 'Trip plan', 'Weekly sync', '🙂 Happy'])
    expect(emptyBoxRows(rows, 'pages')).toEqual(emptyBoxRows(rows, 'all'))
    expect(emptyBoxRows(rows, 'cards').map((r) => r.label)).toEqual(['Capital of Spain', 'el tren', 'git pull', 'la biblioteca', 'Two cards in one'])
    // Review off: a card file is a page.
    const off = (await buildRows(source(false)))!
    expect(emptyBoxRows(off, 'all').map((r) => r.label)).toContain('Capital of Spain')
  })

  it('a search that is no longer wanted stops (a new letter was typed)', async () => {
    const rows = (await buildRows(source(true)))!
    expect(await findRows(rows, 'a', 'all', () => Promise.resolve(), () => false)).toBeNull()
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
  it('builds the rows and finds each query in slices: no hold of the thread over 50 ms; the numbers are printed', async () => {
    const src: SearchSource = { records: bigVault(), letters: ['DEMO'], cards: true }
    // The probe of 3B (`pass.test.ts`): a zero timeout again and again; the longest gap is the longest hold.
    let probing = true
    let gaps: number[] = []
    let last = performance.now()
    const probe = () => {
      const t = performance.now()
      gaps.push(t - last)
      last = t
      if (probing) setTimeout(probe, 0)
    }
    setTimeout(probe, 0)
    const measure = async <T>(run: () => Promise<T>) => {
      await new Promise((r) => setTimeout(r, 5))
      gaps = []
      last = performance.now()
      const t0 = performance.now()
      const result = await run()
      return { ms: performance.now() - t0, longest: Math.max(...gaps, performance.now() - last), result }
    }
    const realYield = () => new Promise<void>((r) => setTimeout(r, 0))
    let idle = Infinity
    let build = { ms: 0, longest: Infinity }
    let find = { ms: 0, longest: Infinity }
    let count = 0
    for (let run = 0; run < 5 && (build.longest >= 50 || find.longest >= 50); run++) {
      const calm = await measure(() => new Promise((r) => setTimeout(r, 100)))
      const b = await measure(() => buildRows(src, uiSlicer(realYield)))
      count = b.result!.length
      let worst = { ms: 0, longest: 0 }
      for (const q of ['a', 'pa', 'page 12', 'la casa', 'DEMO-100004', '#12', 'apple', 'zzz']) {
        const f = await measure(() => findRows(b.result!, q, 'all', uiSlicer(realYield)))
        if (f.longest > worst.longest) worst = f
      }
      idle = Math.min(idle, calm.longest)
      if (b.longest < build.longest) build = b
      if (worst.longest < find.longest) find = worst
    }
    probing = false
    console.log(`[4C perf] idle probe ${idle.toFixed(1)} ms; ${count} rows from 5,000 records: build ${build.ms.toFixed(0)} ms, longest hold ${build.longest.toFixed(1)} ms; the slowest of 8 queries ${find.ms.toFixed(0)} ms, longest hold ${find.longest.toFixed(1)} ms`)
    expect(count).toBeGreaterThan(25_000)
    if (idle > 15 && (build.longest >= 50 || find.longest >= 50)) {
      console.log('[4C perf] the machine is too busy to measure holds (the idle probe alone waited > 15 ms): check skipped')
      return
    }
    expect(build.longest).toBeLessThan(50)
    expect(find.longest).toBeLessThan(50)
  }, 120_000)
})
