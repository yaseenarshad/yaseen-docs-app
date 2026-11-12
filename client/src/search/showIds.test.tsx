/** "Show IDs" (YAZ-4940): the vault file's shape, which ID a search row shows under each rule, and the files list's map. */
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { DEFAULT_SHOW_IDS, sanitizeShowIds, shownId, useAllPathIds, useNoteId, type PathIds } from './showIds'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { IndexRecord } from '@shared/types'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('Show IDs in search', () => {
  it('reads the vault file; Always is the default, and anything else reads as Always', () => {
    expect(DEFAULT_SHOW_IDS).toEqual({ search: 'always', title: true, files: false })
    expect(sanitizeShowIds({ search: 'match' })).toEqual({ search: 'match', title: true, files: false })
    expect(sanitizeShowIds({ search: 'always' })).toEqual({ search: 'always', title: true, files: false })
    expect(sanitizeShowIds({ search: 'sometimes' })).toEqual({ search: 'always', title: true, files: false })
    expect(sanitizeShowIds(null)).toEqual({ search: 'always', title: true, files: false })
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
  it('an old file with `search` alone reads as title On, files list Off; the two fields round-trip; anything else is the default', () => {
    expect(sanitizeShowIds({ search: 'match' })).toEqual({ search: 'match', title: true, files: false })
    expect(sanitizeShowIds({ search: 'always', title: false, files: true })).toEqual({ search: 'always', title: false, files: true })
    expect(sanitizeShowIds({ title: 'off', files: 'on' })).toEqual({ search: 'always', title: true, files: false })
    expect(sanitizeShowIds({ title: false })).toEqual({ search: 'always', title: false, files: false })
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

  it('`useNoteId` reads the note\'s ID off the index, follows a snapshot that changes it, and reads nothing with no source (the choice Off)', () => {
    const source = createWikilinkResolveSource()
    source.update(() => null, [record('/v/a.md', 'EMB-1'), record('/v/b.md')], [], true)
    const a = probe(() => useNoteId(source, '/v/a.md'))
    const b = probe(() => useNoteId(source, '/v/b.md'))
    const off = probe(() => useNoteId(undefined, '/v/a.md'))
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

  it('`useAllPathIds` is undefined with no source, else one Map over the vaults that chose it, kept while no ID changed', () => {
    const one = createWikilinkResolveSource()
    one.update(() => null, [record('/v/a.md', 'EMB-1'), record('/v/plain.md')], [], true)
    const two = createWikilinkResolveSource()
    two.update(() => null, [record('/w/x.md', 'WIKI-7')], [], true)
    const none = probe(() => useAllPathIds([]))
    expect(none.seen.at(-1)).toBeUndefined()
    const sources = [one, two]
    const both = probe(() => useAllPathIds(sources))
    const first = both.seen.at(-1) as PathIds
    expect([...first]).toEqual([
      ['/v/a.md', 'EMB-1'],
      ['/w/x.md', 'WIKI-7'],
    ])
    // A snapshot that changed no ID (a title edit) keeps the Map: the memo tree re-renders nothing for it.
    act(() => one.update(() => null, [{ ...record('/v/a.md', 'EMB-1'), title: 'Renamed' }, record('/v/plain.md')], [], true))
    expect(both.seen.at(-1)).toBe(first)
    act(() => two.update(() => null, [record('/w/x.md', 'WIKI-8')], [], true))
    expect(both.seen.at(-1)).not.toBe(first)
    expect(both.seen.at(-1)?.get('/w/x.md')).toBe('WIKI-8')
    none.unmount()
    both.unmount()
  })
})
