/** Excalidraw's public libraries (YAZ-4157 demo 6K): the item ids, the index as items, and one item's elements. */
import { describe, expect, it } from 'vitest'
import { indexItems, libraryItemElements, parseDrawingId } from './excalidrawLibraries'

const tools = {
  name: 'Tools',
  source: 'pixelass/tools.excalidrawlib',
  authors: [{ name: 'Gregor Adams', url: 'http://pixelass.com' }],
  itemNames: ['Nail', 'Hammer', '  '],
}

describe('parseDrawingId', () => {
  it('reads <source>#<index>, and nothing that could leave the libraries folder', () => {
    expect(parseDrawingId('pixelass/tools.excalidrawlib#3')).toEqual({ source: 'pixelass/tools.excalidrawlib', index: 3 })
    expect(parseDrawingId('../etc/passwd#1')).toBeNull()
    expect(parseDrawingId('a/b.excalidrawlib#-1')).toBeNull()
    expect(parseDrawingId('a/b.excalidrawlib')).toBeNull()
    expect(parseDrawingId('https://evil.test/a.excalidrawlib#0')).toBeNull()
  })
})

describe('indexItems', () => {
  it('one item per named item; a library with no names, or a bad source, gives none', () => {
    const items = indexItems([tools, { name: 'Old', source: 'a/old.excalidrawlib' }, { ...tools, source: '../x' }])
    expect(items.map((i) => [i.itemKey, i.title])).toEqual([
      ['excalidraw:pixelass/tools.excalidrawlib#0', 'Nail'],
      ['excalidraw:pixelass/tools.excalidrawlib#1', 'Hammer'],
    ])
    expect(items[0]).toMatchObject({ provider: 'excalidraw', kind: 'drawing', collectionName: 'Tools', creator: 'Gregor Adams' })
    // An http:// author page is not linked.
    expect(items[0].creatorUrl).toBeUndefined()
    expect(indexItems('not a list')).toEqual([])
  })
})

describe('libraryItemElements', () => {
  const v2 = { type: 'excalidrawlib', version: 2, libraryItems: [{ name: 'Nail', elements: [{ id: 'n' }] }, { name: 'Hammer', elements: [{ id: 'h' }] }] }

  it('version 2: the item at the index, when its name is the one the index gave', () => {
    expect(libraryItemElements(v2, 1, 'Hammer')).toEqual([{ id: 'h' }])
  })

  it('version 2: a library updated since the index was read is searched by the name', () => {
    expect(libraryItemElements(v2, 0, 'Hammer')).toEqual([{ id: 'h' }])
    expect(libraryItemElements(v2, 0, 'Saw')).toBeNull()
  })

  it('version 1: library[i]; anything else is no item', () => {
    expect(libraryItemElements({ library: [[{ id: 'a' }]] }, 0, null)).toEqual([{ id: 'a' }])
    expect(libraryItemElements({ library: [] }, 0, null)).toBeNull()
    expect(libraryItemElements('nope', 0, null)).toBeNull()
  })
})
