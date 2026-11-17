/** A sidebar place for each page tab (YAZ-5701): the tab's place is saved, read, pruned to the strip and dropped. */
import { afterEach, describe, expect, it } from 'vitest'
import { clearPlaces, lastPlace, prunePlaces, readPlace, savePlace, type TabPlace } from './tabPlace'

const place = (lens: TabPlace['lens'], scrollTop: number): TabPlace => ({ lens, expanded: [`/v/${lens}`], shut: { focus: new Set(['f']), favorites: new Set() }, scrollTop })

afterEach(clearPlaces)

describe('tabPlace', () => {
  it('saves and reads a place for each tab; the place saved last is last; a closed tab drops its place; clear drops all', () => {
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
    clearPlaces()
    expect([readPlace('b'), lastPlace()]).toEqual([undefined, undefined])
  })
})
