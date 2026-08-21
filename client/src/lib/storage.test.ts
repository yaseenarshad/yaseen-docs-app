import { beforeEach, describe, expect, it } from 'vitest'
import { LS_KEYS, MAX_FOLD_KEYS_PER_FILE } from '@shared/types'
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

  it('folds are keyed by root then file, capped, and pruned when empty', () => {
    expect(storage.getFolds('/r1', '/r1/a.md')).toEqual([])
    storage.setFolds('/r1', '/r1/a.md', ['k1', 'k2'])
    storage.setFolds('/r1', '/r1/b.md', ['k3'])
    storage.setFolds('/r2', '/r2/a.md', ['k4'])
    expect(storage.getFolds('/r1', '/r1/a.md')).toEqual(['k1', 'k2'])
    expect(storage.getFolds('/r1', '/r1/b.md')).toEqual(['k3'])
    expect(storage.getFolds('/r2', '/r1/a.md')).toEqual([])
    // Replacing with the live set drops keys the plugin no longer reports.
    storage.setFolds('/r1', '/r1/a.md', ['k2'])
    expect(storage.getFolds('/r1', '/r1/a.md')).toEqual(['k2'])
    storage.setFolds('/r1', '/r1/a.md', [])
    storage.setFolds('/r1', '/r1/b.md', [])
    expect(JSON.parse(localStorage.getItem(LS_KEYS.folds)!)).toEqual({ '/r2': { '/r2/a.md': ['k4'] } })
    storage.setFolds('/r2', '/r2/a.md', Array.from({ length: MAX_FOLD_KEYS_PER_FILE + 50 }, (_, i) => `k${i}`))
    expect(storage.getFolds('/r2', '/r2/a.md')).toHaveLength(MAX_FOLD_KEYS_PER_FILE)
  })

  it('sidebarCollapsed defaults to false, round-trips, and clears the key when false', () => {
    expect(storage.getSidebarCollapsed()).toBe(false)
    storage.setSidebarCollapsed(true)
    expect(storage.getSidebarCollapsed()).toBe(true)
    expect(localStorage.getItem(LS_KEYS.sidebarCollapsed)).toBe('true')
    storage.setSidebarCollapsed(false)
    expect(storage.getSidebarCollapsed()).toBe(false)
    expect(localStorage.getItem(LS_KEYS.sidebarCollapsed)).toBeNull()
  })

  it('treats invalid JSON / wrong shapes as absent', () => {
    localStorage.setItem(LS_KEYS.recentRoots, '{not json')
    localStorage.setItem(LS_KEYS.expanded, JSON.stringify({ '/r': 'nope' }))
    localStorage.setItem(LS_KEYS.lastFile, JSON.stringify([1, 2]))
    localStorage.setItem(LS_KEYS.folds, JSON.stringify({ '/r': { '/r/a.md': 'nope' } }))
    expect(storage.getRecentRoots()).toEqual([])
    expect(storage.getExpanded('/r')).toEqual([])
    expect(storage.getLastFile('/r')).toBeNull()
    expect(storage.getFolds('/r', '/r/a.md')).toEqual([])
  })
})
