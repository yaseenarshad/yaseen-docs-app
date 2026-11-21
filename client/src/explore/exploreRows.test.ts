/**
 * The explore search (YAZ-2571): the sidebar search's rows and ranking, then the text rows (tags, frontmatter values)
 * and the typo pass. The guard at the end counts the work of a keystroke on a 5,000-page index: one scan of the rows
 * in memory, nothing read, no second index.
 */
import { describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { folderCandidates, searchCandidates, SEARCH_CAP, type SearchCandidate } from '../search/searchCandidates'
import { approxDistance, editsAllowed, exploreRows, FUZZY_MIN, FUZZY_WHEN, fuzzyRows, textCandidates, type SearchStats } from './exploreRows'

const rec = (path: string, title: string, extra: Partial<IndexRecord> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const folder = path.slice('/vault/'.length, path.lastIndexOf('/'))
  return { path, name, basename: name.replace(/\.md$/, ''), title, folder, ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...extra }
}

const records = [
  rec('/vault/words/conjecture.md', 'conjecture (vocab)', { tags: ['vocab', 'maths'], properties: { source: 'Mochi scouting', status: 'learning' } }),
  rec('/vault/words/precipitous.md', 'precipitous', { aliases: ['steep'], properties: { page: 'A long value that is a document and not a line, repeated to pass the eighty characters the snippet allows at most.' } }),
  rec('/vault/react.md', 'React', { tags: ['frontend'], properties: { title: 'React', id: 'YAZ-1', summary: 'A library for UI' } }),
  rec('/vault/pages/working-log.md', 'Working log'),
]
const rows = (): SearchCandidate[] => [...folderCandidates('/vault', ['/vault/words', '/vault/pages'], []), ...searchCandidates(records), ...textCandidates(records)]
const paths = (list: readonly SearchCandidate[]) => list.map((r) => r.path)

describe('text rows', () => {
  it('one row per tag and per frontmatter string value, the page\'s title as its label and the matched text as its snippet; app keys, long values and the title itself left out', () => {
    const text = textCandidates(records)
    expect(text.map((r) => [r.label, r.name, r.snippet])).toEqual([
      ['conjecture (vocab)', 'vocab', '#vocab'],
      ['conjecture (vocab)', 'maths', '#maths'],
      ['conjecture (vocab)', 'Mochi scouting', 'source: Mochi scouting'],
      ['conjecture (vocab)', 'learning', 'status: learning'],
      ['React', 'frontend', '#frontend'],
      ['React', 'A library for UI', 'summary: A library for UI'],
    ])
  })

  it('a tag or a value finds its page through the shared matcher, after the title matches', () => {
    expect(exploreRows(rows(), 'scouting').map((r) => [r.label, r.snippet])).toEqual([['conjecture (vocab)', 'source: Mochi scouting']])
    // "vocab" is in a title and a tag of one page: the title row alone shows (the tag's exact match would rank first, and twice is noise).
    expect(exploreRows(rows(), 'vocab').map((r) => [r.path, r.snippet])).toEqual([['/vault/words/conjecture.md', undefined]])
  })
})

describe('the typo pass', () => {
  it('edits allowed: none under 4 letters, one to 8, two from 9', () => {
    expect([editsAllowed(3), editsAllowed(FUZZY_MIN), editsAllowed(8), editsAllowed(9), editsAllowed(20)]).toEqual([0, 1, 1, 2, 2])
  })

  it('approxDistance is the least edit distance to any substring, stopped past the limit', () => {
    const prev = new Int32Array(16)
    const col = new Int32Array(16)
    expect(approxDistance('conjecture (vocab)', 'conjeture', 1, prev, col)).toBe(1)
    expect(approxDistance('conjecture (vocab)', 'conjecture', 1, prev, col)).toBe(0)
    expect(approxDistance('working log', 'conjeture', 2, prev, col)).toBe(3)
    expect(approxDistance('precipitous', 'precipitus', 1, prev, col)).toBe(1)
    expect(approxDistance('precipitous', 'xprecipitous', 1, prev, col)).toBe(1)
  })

  it('"conjeture" finds conjecture (the scouting\'s missing letter); "precipitus" finds precipitous; a nonsense word finds nothing', () => {
    expect(paths(exploreRows(rows(), 'conjeture'))).toEqual(['/vault/words/conjecture.md'])
    expect(paths(exploreRows(rows(), 'precipitus'))).toEqual(['/vault/words/precipitous.md'])
    expect(exploreRows(rows(), 'zzqqxxyy')).toEqual([])
  })

  it('runs only from 4 letters, and not when the exact pass found 8 rows or more', () => {
    const stats: SearchStats = { fuzzy: 0 }
    exploreRows(rows(), 'con', stats)
    expect(stats.fuzzy).toBe(0)
    const many = Array.from({ length: 10 }, (_, i) => rec(`/vault/n${i}.md`, `Page ${i}`))
    exploreRows(searchCandidates(many), 'page', stats)
    expect(stats.fuzzy).toBe(0)
    exploreRows(searchCandidates(many), 'nite', stats)
    expect(stats.fuzzy).toBe(10)
  })

  it('leaves out the rows the exact pass shows, and a page shows once', () => {
    const list = rows()
    expect(fuzzyRows(list, 'conjeture', new Set(['/vault/words/conjecture.md']), SEARCH_CAP)).toEqual([])
    // The title row and the tag rows of conjecture are all within one edit of "conjecture (vocab)"'s parts: one row shows.
    expect(paths(exploreRows(list, 'conjeture'))).toEqual(['/vault/words/conjecture.md'])
  })
})

describe('the keystroke guard: a 5,000-page index', () => {
  const big = Array.from({ length: 5000 }, (_, i) => rec(`/vault/f${i % 50}/page-${i}.md`, i === 4242 ? 'conjecture (vocab)' : `Page ${i}`, { aliases: [`N${i}`], tags: ['t'], properties: { status: i % 2 === 0 ? 'open' : 'done' } }))
  const list = [...folderCandidates('/vault', Array.from({ length: 50 }, (_, i) => `/vault/f${i}`), []), ...searchCandidates(big), ...textCandidates(big)]

  it('a typo query costs one typo scan over the rows, no read and no second index; a plain query costs none', () => {
    const reads = vi.fn()
    const stats: SearchStats = { fuzzy: 0 }
    const found = exploreRows(list, 'conjeture', stats)
    expect(paths(found)).toEqual(['/vault/f42/page-4242.md'])
    // One look at each row at most: the exact pass's own scan, then the typo pass over the rows it missed that are
    // long enough to hold the text within two edits ("Page 1", "N12", "t", "open" are not: skipped unread).
    expect(stats.fuzzy).toBe(list.filter((c) => c.lower.length >= 'conjeture'.length - editsAllowed('conjeture'.length)).length)
    expect(stats.fuzzy).toBeLessThanOrEqual(list.length)
    expect(stats.fuzzy).toBeGreaterThan(4000)
    expect(reads).not.toHaveBeenCalled()
    const plain: SearchStats = { fuzzy: 0 }
    const pages = exploreRows(list, 'page 1', plain)
    expect(pages.length).toBe(SEARCH_CAP)
    expect(plain.fuzzy).toBe(0)
    expect(FUZZY_WHEN).toBe(8)
  })

  it('the rows are built once per snapshot: 5,000 pages give one title, one alias, one tag and one value row each', () => {
    // Plus one file-name row (YAZ-3748 B4): the conjecture page's file name says nothing of its title.
    expect(searchCandidates(big)).toHaveLength(10001)
    expect(textCandidates(big)).toHaveLength(10000)
  })
})

describe('`#5` in the explore search (YAZ-2571 round 5)', () => {
  const emb = [
    rec('/vault/emb-5.md', '04 Resize04 Resize04 Resize04', { id: 'EMB-5', tags: ['5'] }),
    rec('/vault/emb-6.md', '05 The view', { id: 'EMB-6' }),
    rec('/vault/emb-1234.md', 'Big', { id: 'EMB-1234' }),
    rec('/vault/emb-12.md', 'Page #1235 draft', { id: 'EMB-12', properties: { ticket: '#1234' } }),
  ]
  const list = () => [...searchCandidates(emb, ['EMB']), ...textCandidates(emb)]

  it('`#5` is EMB-5 alone: no title, tag or value row, and no typo pass', () => {
    const stats: SearchStats = { fuzzy: 0 }
    expect(exploreRows(list(), '#5', stats).map((c) => c.label)).toEqual(['EMB-5 — 04 Resize04 Resize04 Resize04'])
    expect(exploreRows(list(), '#1234', stats).map((c) => c.id)).toEqual(['EMB-1234'])
    expect(stats.fuzzy).toBe(0)
  })

  it('a bare `5` is EMB-5 first, then the other matches as before', () => {
    expect(exploreRows(list(), '5').map((c) => c.path)).toEqual(['/vault/emb-5.md', '/vault/emb-6.md', '/vault/emb-12.md'])
  })

  it('a vault without IDs is unchanged: `#1234` reads as text, the typo pass too', () => {
    const plain = emb.map(({ id: _id, ...r }) => r)
    const rows = [...searchCandidates(plain), ...textCandidates(plain)]
    expect(exploreRows(rows, '#1234').map((c) => c.path)).toEqual(['/vault/emb-12.md', '/vault/emb-1234.md'])
  })
})
