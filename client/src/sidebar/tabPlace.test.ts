/** A sidebar place for each page tab (YAZ-5701): the tab's place is saved, read, pruned to the strip and dropped. */
import { afterEach, describe, expect, it } from 'vitest'
import { clearPlaces, foldersChangedHere, lastPlace, markFoldersChanged, prunePlaces, readPlace, savePlace, type TabPlace } from './tabPlace'

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
    // The window's folder mark (YAZ-5751): a prune keeps it; "One place for the window" drops it with the places.
    expect(foldersChangedHere()).toBe(false)
    markFoldersChanged()
    prunePlaces([])
    expect(foldersChangedHere()).toBe(true)
    clearPlaces()
    expect([readPlace('b'), lastPlace(), foldersChangedHere()]).toEqual([undefined, undefined, false])
  })
})
