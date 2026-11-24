/** "Show IDs" (YAZ-4940): the vault file's shape, which ID a search row shows under each rule, and the files list's map. */
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { idNumber } from '@shared/pageId'
import { DEFAULT_SHOW_IDS, sanitizeShowIds, shownId, useAllPathIds, usePageId, type PathIds } from './showIds'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { pathInfo } from '../editor/wikilink/linkPillLook'
import type { IndexRecord } from '@shared/types'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('Show IDs in search', () => {
  it('reads the vault file; Always is the default, and anything else reads as Always', () => {
    expect(DEFAULT_SHOW_IDS).toEqual({ search: 'always', title: true, files: 'off', tabs: 'off', tabsLayout: 'inline' })
    expect(sanitizeShowIds({ search: 'match' })).toEqual({ search: 'match', title: true, files: 'off', tabs: 'off', tabsLayout: 'inline' })
    expect(sanitizeShowIds({ search: 'always' })).toEqual({ search: 'always', title: true, files: 'off', tabs: 'off', tabsLayout: 'inline' })
    expect(sanitizeShowIds({ search: 'sometimes' })).toEqual({ search: 'always', title: true, files: 'off', tabs: 'off', tabsLayout: 'inline' })
    expect(sanitizeShowIds(null)).toEqual({ search: 'always', title: true, files: 'off', tabs: 'off', tabsLayout: 'inline' })
  })

  it('a row shows its ID always, or only when the search found it by its ID (`searchRows` put "ID — " in front of its label); a row with no ID shows none', () => {
    const byTitle = { id: 'WIKI-38', label: 'S3 (AWS)' }
    const byId = { id: 'WIKI-38', label: 'WIKI-38 — S3 (AWS)' }
    expect(shownId(byTitle, 'always')).toBe('WIKI-38')
    expect(shownId(byTitle, 'match')).toBeNull()
    expect(shownId(byId, 'always')).toBe('WIKI-38')
    expect(shownId(byId, 'match')).toBe('WIKI-38')
    expect(shownId({ label: 'Plain' }, 'always')).toBeNull()
  })
})

describe('Show IDs in the title and in the files list (YAZ-4940 part 2)', () => {
  it('an old file with `search` alone reads as title On, files list Off, tabs Off, tabsLayout Inline; fields round-trip; anything else is the default', () => {
    expect(sanitizeShowIds({ search: 'match' })).toEqual({ search: 'match', title: true, files: 'off', tabs: 'off', tabsLayout: 'inline' })
    expect(sanitizeShowIds({ search: 'always', title: false, files: 'full', tabs: 'number', tabsLayout: 'stacked' })).toEqual({ search: 'always', title: false, files: 'full', tabs: 'number', tabsLayout: 'stacked' })
    expect(sanitizeShowIds({ title: 'off', files: 'on', tabs: true, tabsLayout: 'two-lines' })).toEqual({ search: 'always', title: true, files: 'off', tabs: 'off', tabsLayout: 'inline' })
    expect(sanitizeShowIds({ title: false })).toEqual({ search: 'always', title: false, files: 'off', tabs: 'off', tabsLayout: 'inline' })
  })

  it('"In the files list" has three choices; the old file\'s `true` (round 2\'s On) reads as Number, `false` or nothing as Off', () => {
    expect(sanitizeShowIds({ search: 'always', files: true })).toEqual({ search: 'always', title: true, files: 'number', tabs: 'off', tabsLayout: 'inline' })
    expect(sanitizeShowIds({ search: 'always', files: false })).toEqual({ search: 'always', title: true, files: 'off', tabs: 'off', tabsLayout: 'inline' })
    expect(sanitizeShowIds({ search: 'always' }).files).toBe('off')
    expect(sanitizeShowIds({ files: 'number' }).files).toBe('number')
    expect(sanitizeShowIds({ files: 'full' }).files).toBe('full')
    expect(sanitizeShowIds({ files: 'off' }).files).toBe('off')
    expect(sanitizeShowIds({ files: 'all' }).files).toBe('off')
  })

  it('"In tabs" and "Tab ID layout" (YAZ-6464): valid values round-trip, missing or invalid values fall back to off / inline', () => {
    expect(sanitizeShowIds({ tabs: 'number' }).tabs).toBe('number')
    expect(sanitizeShowIds({ tabs: 'full' }).tabs).toBe('full')
    expect(sanitizeShowIds({ tabs: 'off' }).tabs).toBe('off')
    expect(sanitizeShowIds({ tabs: 'all' }).tabs).toBe('off')
    expect(sanitizeShowIds({ tabs: true }).tabs).toBe('off')
    expect(sanitizeShowIds({ tabsLayout: 'inline' }).tabsLayout).toBe('inline')
    expect(sanitizeShowIds({ tabsLayout: 'stacked' }).tabsLayout).toBe('stacked')
    expect(sanitizeShowIds({ tabsLayout: 'two-lines' }).tabsLayout).toBe('inline')
  })

  it('the number is the digits after the ID\'s last "-" (one rule for the files list\'s "#12" and a pill\'s {number}); an ID with no such digits has none', () => {
    expect(idNumber('EMB-12')).toBe('12')
    expect(idNumber('WIKI-7')).toBe('7')
    expect(idNumber('AB-CD-305')).toBe('305')
    expect(idNumber('EMB-012')).toBe('012')
    expect(idNumber('EMB12')).toBeUndefined()
    expect(idNumber('EMB-')).toBeUndefined()
    expect(idNumber('EMB-12a')).toBeUndefined()
  })

  const record = (path: string, id?: string): IndexRecord => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return { path, name, basename: name.replace(/\.md$/, ''), title: name.replace(/\.md$/, ''), folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...(id !== undefined && { id }) }
  }

  /** The hook's answer at each render, as a component reads it. */
  function probe<T>(use: () => T) {
    const seen: T[] = []
    const Probe = () => {
      seen.push(use())
      return null
    }
    const el = document.createElement('div')
    const root = createRoot(el)
    act(() => root.render(<Probe />))
    return { seen, unmount: () => act(() => root.unmount()) }
  }

  it('`usePageId` reads the page\'s ID off the index, follows a snapshot that changes it, and reads nothing with no source (the choice Off)', () => {
    const source = createWikilinkResolveSource()
    source.update(() => null, [record('/v/a.md', 'EMB-1'), record('/v/b.md')], [], true)
    const a = probe(() => usePageId(source, '/v/a.md'))
    const b = probe(() => usePageId(source, '/v/b.md'))
    const off = probe(() => usePageId(undefined, '/v/a.md'))
    expect(a.seen.at(-1)).toBe('EMB-1')
    expect(b.seen.at(-1)).toBeUndefined()
    expect(off.seen.at(-1)).toBeUndefined()
    act(() => source.update(() => null, [record('/v/a.md', 'EMB-2')], [], true))
    expect(a.seen.at(-1)).toBe('EMB-2')
    // A vault without IDs holds no `id` on its records: nothing to show.
    act(() => source.update(() => null, [record('/v/a.md')], [], false))
    expect(a.seen.at(-1)).toBeUndefined()
    a.unmount()
    b.unmount()
    off.unmount()
  })

  it('`usePageId` shows a card file\'s card ID after its title (YAZ-5546), display only: its record and `pathInfo` keep no `id`', () => {
    const source = createWikilinkResolveSource()
    const cardFile: IndexRecord = { ...record('/v/cards/demo-40.md'), kind: 'card', cards: [{ id: 'DEMO-40', off: false, next: false, reviews: [] }] }
    const unswept: IndexRecord = { ...record('/v/cards/new.md'), kind: 'card', cards: [{ id: null, off: false, next: false, reviews: [] }] }
    const pageWithCards: IndexRecord = { ...record('/v/page.md', 'DEMO-7'), cards: [{ id: 'DEMO-41', off: false, next: false, reviews: [] }] }
    const plainWithCards: IndexRecord = { ...record('/v/plain.md'), cards: [{ id: 'DEMO-42', off: false, next: false, reviews: [] }] }
    source.update(() => null, [cardFile, unswept, pageWithCards, plainWithCards], [], true)
    const card = probe(() => usePageId(source, '/v/cards/demo-40.md'))
    const fresh = probe(() => usePageId(source, '/v/cards/new.md'))
    const page = probe(() => usePageId(source, '/v/page.md'))
    const plain = probe(() => usePageId(source, '/v/plain.md'))
    expect(card.seen.at(-1)).toBe('DEMO-40')
    expect(fresh.seen.at(-1)).toBeUndefined()
    expect(page.seen.at(-1)).toBe('DEMO-7')
    expect(plain.seen.at(-1)).toBeUndefined()
    // Display only: links, pills and comments read `pathInfo` and the record, which hold no ID for the card file.
    expect(pathInfo(source.records, source.folders).get('/v/cards/demo-40.md')?.id).toBeUndefined()
    expect(source.records.find((r) => r.path === '/v/cards/demo-40.md')?.id).toBeUndefined()
    // A new card ID on the line follows.
    act(() => source.update(() => null, [{ ...cardFile, cards: [{ id: 'DEMO-43', off: false, next: false, reviews: [] }] }], [], true))
    expect(card.seen.at(-1)).toBe('DEMO-43')
    for (const p of [card, fresh, page, plain]) p.unmount()
  })

  it('`useAllPathIds` is undefined with no source, else one Map over the vaults that chose it, each in its form, kept while no ID changed', () => {
    const one = createWikilinkResolveSource()
    one.update(() => null, [record('/v/a.md', 'EMB-1'), record('/v/plain.md'), record('/v/old.md', 'a1b2c3d4e5f6')], [], true)
    const two = createWikilinkResolveSource()
    two.update(() => null, [record('/w/x.md', 'WIKI-7')], [], true)
    const none = probe(() => useAllPathIds([]))
    expect(none.seen.at(-1)).toBeUndefined()
    const sources = [
      { index: one, form: 'number' as const },
      { index: two, form: 'full' as const },
    ]
    const both = probe(() => useAllPathIds(sources))
    const first = both.seen.at(-1) as PathIds
    expect([...first]).toEqual([
      ['/v/a.md', '#1'],
      ['/v/old.md', 'a1b2c3d4e5f6'],
      ['/w/x.md', 'WIKI-7'],
    ])
    // A snapshot that changed no ID (a title edit) keeps the Map: the memo tree re-renders nothing for it.
    act(() => one.update(() => null, [{ ...record('/v/a.md', 'EMB-1'), title: 'Renamed' }, record('/v/plain.md'), record('/v/old.md', 'a1b2c3d4e5f6')], [], true))
    expect(both.seen.at(-1)).toBe(first)
    act(() => two.update(() => null, [record('/w/x.md', 'WIKI-8')], [], true))
    expect(both.seen.at(-1)).not.toBe(first)
    expect(both.seen.at(-1)?.get('/w/x.md')).toBe('WIKI-8')
    none.unmount()
    both.unmount()
  })

  it('`useAllPathIds` shows a card file\'s ID, off its card line (YAZ-5546): it holds no `id:`; a page with its own `id` is unchanged', () => {
    const one = createWikilinkResolveSource()
    const cardFile: IndexRecord = { ...record('/v/cards/demo-40.md'), kind: 'card', title: 'Made-up card', cards: [{ id: 'DEMO-40', off: false, next: false, reviews: [], title: 'Made-up card' }] }
    const unswept: IndexRecord = { ...record('/v/cards/new.md'), kind: 'card', cards: [{ id: null, off: false, next: false, reviews: [] }] }
    const pageWithCards: IndexRecord = { ...record('/v/page.md', 'DEMO-7'), cards: [{ id: 'DEMO-41', off: false, next: false, reviews: [] }] }
    one.update(() => null, [cardFile, unswept, pageWithCards, record('/v/plain.md')], [], true)
    const seen: (PathIds | undefined)[] = []
    const Probe = ({ form }: { form: 'number' | 'full' }) => {
      seen.push(useAllPathIds([{ index: one, form }]))
      return null
    }
    const el = document.createElement('div')
    const root = createRoot(el)
    act(() => root.render(<Probe form="number" />))
    expect(seen.at(-1)?.get('/v/cards/demo-40.md')).toBe('#40')
    expect(seen.at(-1)?.get('/v/page.md')).toBe('#7')
    expect(seen.at(-1)?.has('/v/cards/new.md')).toBe(false)
    expect(seen.at(-1)?.has('/v/plain.md')).toBe(false)
    act(() => root.render(<Probe form="full" />))
    expect(seen.at(-1)?.get('/v/cards/demo-40.md')).toBe('DEMO-40')
    expect(seen.at(-1)?.get('/v/page.md')).toBe('DEMO-7')
    act(() => root.unmount())
  })

  it('`useAllPathIds` follows a change of form on the same index: Number to Full ID redraws the map', () => {
    const one = createWikilinkResolveSource()
    one.update(() => null, [record('/v/a.md', 'EMB-12')], [], true)
    const seen: (PathIds | undefined)[] = []
    const Probe = ({ form }: { form: 'number' | 'full' }) => {
      seen.push(useAllPathIds([{ index: one, form }]))
      return null
    }
    const el = document.createElement('div')
    const root = createRoot(el)
    act(() => root.render(<Probe form="number" />))
    expect(seen.at(-1)?.get('/v/a.md')).toBe('#12')
    act(() => root.render(<Probe form="full" />))
    expect(seen.at(-1)?.get('/v/a.md')).toBe('EMB-12')
    act(() => root.unmount())
  })

  it('`useAllPathIds` with `includeFolders: true` includes folder page IDs keyed by `dirname(folder.path)` and excludes folders when omitted (YAZ-6464)', () => {
    const one = createWikilinkResolveSource()
    const folderWithId = record('/v/Projects/.folder.md', 'EMB-99')
    const folderNoId = record('/v/Notes/.folder.md')
    one.update(() => null, [record('/v/a.md', 'EMB-12')], [folderWithId, folderNoId], true)
    const seen: (PathIds | undefined)[] = []
    const Probe = ({ form, includeFolders }: { form: 'number' | 'full'; includeFolders?: boolean }) => {
      seen.push(useAllPathIds([{ index: one, form, includeFolders }]))
      return null
    }
    const el = document.createElement('div')
    const root = createRoot(el)
    // Omitted: sidebar files list does not include folders.
    act(() => root.render(<Probe form="number" />))
    expect(seen.at(-1)?.get('/v/a.md')).toBe('#12')
    expect(seen.at(-1)?.has('/v/Projects')).toBe(false)
    expect(seen.at(-1)?.has('/v/Projects/.folder.md')).toBe(false)
    // Enabled: open tabs get folder page IDs keyed by folder directory path.
    act(() => root.render(<Probe form="number" includeFolders />))
    expect(seen.at(-1)?.get('/v/a.md')).toBe('#12')
    expect(seen.at(-1)?.get('/v/Projects')).toBe('#99')
    expect(seen.at(-1)?.has('/v/Notes')).toBe(false)
    // Switching form updates folder IDs too.
    act(() => root.render(<Probe form="full" includeFolders />))
    expect(seen.at(-1)?.get('/v/Projects')).toBe('EMB-99')
    // Folder snapshot update reflects new ID.
    act(() => one.update(() => null, [record('/v/a.md', 'EMB-12')], [record('/v/Projects/.folder.md', 'EMB-100'), folderNoId], true))
    expect(seen.at(-1)?.get('/v/Projects')).toBe('EMB-100')
    act(() => root.unmount())
  })
})
