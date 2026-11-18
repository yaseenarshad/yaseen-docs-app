/** A sidebar place for each page tab (YAZ-5701): the tab's place is saved, read, pruned to the strip and dropped. */
import { afterEach, describe, expect, it } from 'vitest'
import { clearPlaces, dropBlankPlace, foldersChangedHere, lastPlace, markFoldersChanged, prunePlaces, readPlace, savePlace, type TabPlace } from './tabPlace'

const place = (lens: TabPlace['lens'], scrollTop: number): TabPlace => ({ lens, expanded: [`/v/${lens}`], shut: { focus: new Set(['f']), favorites: new Set() }, scrollTop, selected: [] })

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
})
