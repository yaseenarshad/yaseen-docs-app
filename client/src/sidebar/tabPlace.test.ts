/** A sidebar place for each page tab (YAZ-5701, YAZ-6064): the tab's place is saved, read, pruned to the strip and dropped. */
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearPlaces,
  deletePlacesFilesOnly,
  dropBlankPlace,
  foldersChangedHere,
  lastPlace,
  markFoldersChanged,
  prunePlaces,
  prunePlacesFilesOnly,
  readCollapsed,
  readPlace,
  renamePlacesFilesOnly,
  saveCollapsed,
  savePlace,
  type TabPlace,
} from './tabPlace'

const place = (lens: TabPlace['lens'], scrollTop: number, extra: Partial<TabPlace> = {}): TabPlace => ({
  lens,
  expanded: [`/v/${lens}`],
  shut: { focus: new Set(['f']), favorites: new Set() },
  scrollTop,
  selected: [],
  filesOnly: null,
  focusOnly: null,
  closedVaults: [],
  ...extra,
})

afterEach(clearPlaces)

describe('tabPlace', () => {
  it('saves and reads a place for each tab; the place saved last is last; a closed tab drops its place; clear drops all, the folder mark too', () => {
    savePlace('a', place('focus', 40))
    savePlace('b', place('files', 0))
    expect(readPlace('a')).toEqual(place('focus', 40))
    expect(readPlace('c')).toBeUndefined()
    expect(lastPlace()?.lens).toBe('files')
    // A second save of a tab is its newest place, and the last one.
    savePlace('a', place('favorites', 12))
    expect([readPlace('a')?.lens, lastPlace()?.lens]).toEqual(['favorites', 'favorites'])
    prunePlaces(['b', 'c'])
    expect([readPlace('a'), readPlace('b')?.lens]).toEqual([undefined, 'files'])
    // The window's folder marks (YAZ-5751), by vault (YAZ-5756): a prune keeps them; "One place for the window" drops them with the places.
    expect(foldersChangedHere('/v')).toBe(false)
    markFoldersChanged(['/v'])
    prunePlaces([])
    expect([foldersChangedHere('/v'), foldersChangedHere('/w')]).toEqual([true, false])
    clearPlaces()
    expect([readPlace('b'), lastPlace(), foldersChangedHere('/v')]).toEqual([undefined, undefined, false])
  })

  it('YAZ-5757: a New tab (no tab id) keeps one place of its own, apart from the tabs; it goes with the tab, and with "One place for the window"', () => {
    savePlace('a', place('focus', 40))
    savePlace(null, place('files', 8))
    expect([readPlace(null)?.lens, readPlace('a')?.lens, lastPlace()?.lens]).toEqual(['files', 'focus', 'focus'])
    dropBlankPlace()
    expect(readPlace(null)).toBeUndefined()
    savePlace(null, place('files', 8))
    clearPlaces()
    expect(readPlace(null)).toBeUndefined()
  })

  it('YAZ-6064: preserves filesOnly, focusOnly, and closedVaults on each tab place', () => {
    const p = place('files', 16, { filesOnly: '/v/Projects', focusOnly: 'stack-1', closedVaults: ['/w'] })
    savePlace('a', p)
    expect(readPlace('a')).toEqual(p)
  })

  it('YAZ-6064 D2: saveCollapsed and readCollapsed track per-tab and blank state; prunePlaces, dropBlankPlace, and clearPlaces clean them up', () => {
    expect([readCollapsed('a'), readCollapsed(null)]).toEqual([undefined, undefined])
    saveCollapsed('a', true)
    saveCollapsed('b', false)
    saveCollapsed(null, true)
    expect([readCollapsed('a'), readCollapsed('b'), readCollapsed(null)]).toEqual([true, false, true])

    // dropBlankPlace clears both blank place and blank collapsed state without touching named tabs.
    savePlace(null, place('files', 4))
    dropBlankPlace()
    expect([readPlace(null), readCollapsed(null), readCollapsed('a')]).toEqual([undefined, undefined, true])

    // prunePlaces drops closed tabs' collapsed state even when `places` has no entries for them.
    prunePlaces(['b'])
    expect([readCollapsed('a'), readCollapsed('b')]).toEqual([undefined, false])

    // clearPlaces drops all collapsed state.
    saveCollapsed(null, true)
    clearPlaces()
    expect([readCollapsed('b'), readCollapsed(null)]).toEqual([undefined, undefined])
  })

  it('YAZ-6064 D1: renamePlacesFilesOnly updates matching and nested filesOnly in saved tabs and blank', () => {
    savePlace('exact', place('files', 0, { filesOnly: '/v/Projects' }))
    savePlace('nested', place('files', 0, { filesOnly: '/v/Projects/Alpha' }))
    savePlace('other', place('files', 0, { filesOnly: '/v/Projects2' }))
    savePlace('none', place('files', 0, { filesOnly: null }))
    savePlace(null, place('files', 0, { filesOnly: '/v/Projects/Beta' }))

    renamePlacesFilesOnly('/v/Projects', '/v/Work')

    expect(readPlace('exact')?.filesOnly).toBe('/v/Work')
    expect(readPlace('nested')?.filesOnly).toBe('/v/Work/Alpha')
    expect(readPlace('other')?.filesOnly).toBe('/v/Projects2')
    expect(readPlace('none')?.filesOnly).toBeNull()
    expect(readPlace(null)?.filesOnly).toBe('/v/Work/Beta')
  })

  it('YAZ-6064 D1: deletePlacesFilesOnly clears matching and nested filesOnly in saved tabs and blank', () => {
    savePlace('exact', place('files', 0, { filesOnly: '/v/Projects' }))
    savePlace('nested', place('files', 0, { filesOnly: '/v/Projects/Alpha' }))
    savePlace('other', place('files', 0, { filesOnly: '/v/Projects2' }))
    savePlace('none', place('files', 0, { filesOnly: null }))
    savePlace(null, place('files', 0, { filesOnly: '/v/Projects/Beta' }))

    deletePlacesFilesOnly('/v/Projects')

    expect(readPlace('exact')?.filesOnly).toBeNull()
    expect(readPlace('nested')?.filesOnly).toBeNull()
    expect(readPlace('other')?.filesOnly).toBe('/v/Projects2')
    expect(readPlace('none')?.filesOnly).toBeNull()
    expect(readPlace(null)?.filesOnly).toBeNull()
  })

  it('YAZ-6064 D1: prunePlacesFilesOnly clears filesOnly outside current roots in saved tabs and blank', () => {
    savePlace('kept', place('files', 0, { filesOnly: '/v/Projects' }))
    savePlace('gone', place('files', 0, { filesOnly: '/w/Notes' }))
    savePlace('none', place('files', 0, { filesOnly: null }))
    savePlace(null, place('files', 0, { filesOnly: '/w/Inbox' }))

    prunePlacesFilesOnly(['/v'])

    expect(readPlace('kept')?.filesOnly).toBe('/v/Projects')
    expect(readPlace('gone')?.filesOnly).toBeNull()
    expect(readPlace('none')?.filesOnly).toBeNull()
    expect(readPlace(null)?.filesOnly).toBeNull()
  })

  it('YAZ-6574: rename, delete, and prune keep disk-path focusOnly synced without touching custom folder IDs', () => {
    savePlace('disk', place('favorites', 0, { focusOnly: '/v/Projects' }))
    savePlace('nested', place('focus', 0, { focusOnly: '/v/Projects/Alpha' }))
    savePlace('custom', place('focus', 0, { focusOnly: 'stack-1' }))
    savePlace(null, place('favorites', 0, { focusOnly: '/w/Notes' }))

    renamePlacesFilesOnly('/v/Projects', '/v/Work')
    expect(readPlace('disk')?.focusOnly).toBe('/v/Work')
    expect(readPlace('nested')?.focusOnly).toBe('/v/Work/Alpha')
    expect(readPlace('custom')?.focusOnly).toBe('stack-1')

    deletePlacesFilesOnly('/v/Work/Alpha')
    expect(readPlace('disk')?.focusOnly).toBe('/v/Work')
    expect(readPlace('nested')?.focusOnly).toBeNull()
    expect(readPlace('custom')?.focusOnly).toBe('stack-1')

    prunePlacesFilesOnly(['/v'])
    expect(readPlace('disk')?.focusOnly).toBe('/v/Work')
    expect(readPlace('custom')?.focusOnly).toBe('stack-1')
    expect(readPlace(null)?.focusOnly).toBeNull()
  })
})
