import { beforeEach, describe, expect, it } from 'vitest'
import { LS_KEYS } from '@shared/types'
import { addRecentRoot, storage } from './storage'

beforeEach(() => localStorage.clear())

describe('addRecentRoot', () => {
  it('prepends, de-dupes and caps at 10', () => {
    let list = addRecentRoot([], '/a', 1)
    list = addRecentRoot(list, '/b', 2)
    list = addRecentRoot(list, '/a', 3)
    expect(list).toEqual([
      { path: '/a', lastOpened: 3 },
      { path: '/b', lastOpened: 2 },
    ])
    for (let i = 0; i < 20; i++) list = addRecentRoot(list, `/x${i}`, 10 + i)
    expect(list).toHaveLength(10)
    expect(list[0].path).toBe('/x19')
  })
})

describe('storage', () => {
  it('root round-trips and can be cleared', () => {
    expect(storage.getRoot()).toBeNull()
    storage.setRoot('/notes')
    expect(storage.getRoot()).toBe('/notes')
    storage.setRoot(null)
    expect(storage.getRoot()).toBeNull()
  })

  it('recent roots persist under LS_KEYS.recentRoots', () => {
    storage.pushRecentRoot('/a', 5)
    storage.pushRecentRoot('/b', 6)
    expect(JSON.parse(localStorage.getItem(LS_KEYS.recentRoots)!)).toEqual([
      { path: '/b', lastOpened: 6 },
      { path: '/a', lastOpened: 5 },
    ])
    expect(storage.getRecentRoots()[0].path).toBe('/b')
  })

  it('expanded and lastFile are keyed by root', () => {
    storage.setExpanded('/r1', ['/r1/a'])
    storage.setExpanded('/r2', ['/r2/b'])
    expect(storage.getExpanded('/r1')).toEqual(['/r1/a'])
    expect(storage.getExpanded('/r2')).toEqual(['/r2/b'])
    expect(storage.getExpanded('/r3')).toEqual([])
    storage.setLastFile('/r1', '/r1/a/x.md')
    expect(storage.getLastFile('/r1')).toBe('/r1/a/x.md')
    expect(storage.getLastFile('/r2')).toBeNull()
    storage.setLastFile('/r1', null)
    expect(storage.getLastFile('/r1')).toBeNull()
    expect(JSON.parse(localStorage.getItem(LS_KEYS.expanded)!)).toEqual({ '/r1': ['/r1/a'], '/r2': ['/r2/b'] })
  })

  it('treats invalid JSON / wrong shapes as absent', () => {
    localStorage.setItem(LS_KEYS.recentRoots, '{not json')
    localStorage.setItem(LS_KEYS.expanded, JSON.stringify({ '/r': 'nope' }))
    localStorage.setItem(LS_KEYS.lastFile, JSON.stringify([1, 2]))
    expect(storage.getRecentRoots()).toEqual([])
    expect(storage.getExpanded('/r')).toEqual([])
    expect(storage.getLastFile('/r')).toBeNull()
  })
})
