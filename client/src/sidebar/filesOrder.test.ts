import { describe, expect, it } from 'vitest'
import { carriedOrder, filesOrderOf, inOrder, renamedOrders } from '@shared/filesOrder'

describe('the Files Manual order (YAZ-5916)', () => {
  it('reads only a valid file, with safe keys and names', () => {
    expect(filesOrderOf({ version: 1, at: '2026-11-18T10:00:00.000Z', folders: { '': ['a', 'a', 'b/c', '..'], '../x': ['y'], P: [] }, sort: 'manual', reverse: false })).toEqual({ at: Date.parse('2026-11-18T10:00:00.000Z'), folders: { '': ['a'] }, sort: { by: 'manual', reverse: false } })
    expect(filesOrderOf({ version: 2, at: '2026-11-18T10:00:00.000Z', folders: {} })).toBeNull()
    expect(filesOrderOf({ version: 1, at: 'soon', folders: {} })).toBeNull()
  })

  it('named items first in the list order, unknown ones last in the Name order', () => {
    const byName = (a: string, b: string) => a.localeCompare(b)
    expect(inOrder(['a', 'b', 'c', 'd'], (x) => x, ['c', 'gone', 'a'], byName)).toEqual(['c', 'a', 'b', 'd'])
    expect(inOrder(['b', 'a'], (x) => x, undefined, byName)).toEqual(['a', 'b'])
  })

  it('a rename keeps the place, a move goes last, an item out of the vault leaves', () => {
    const folders = { '': ['z.md', 'P', 'a.md'], P: ['q.md'], 'P/Deep': ['d.md'] }
    expect(renamedOrders(folders, 'z.md', 'zz.md')).toEqual({ '': ['zz.md', 'P', 'a.md'], P: ['q.md'], 'P/Deep': ['d.md'] })
    expect(renamedOrders(folders, 'z.md', 'P/z.md')).toEqual({ '': ['P', 'a.md'], P: ['q.md', 'z.md'], 'P/Deep': ['d.md'] })
    expect(renamedOrders(folders, 'P', 'Q')).toEqual({ '': ['z.md', 'Q', 'a.md'], Q: ['q.md'], 'Q/Deep': ['d.md'] })
    expect(renamedOrders(folders, 'P', null)).toEqual({ '': ['z.md', 'a.md'] })
    expect(renamedOrders(folders, 'nope.md', 'nope2.md')).toBeNull()
  })

  it('a name the new list lost keeps its old place while the tree still shows it (YAZ-5934)', () => {
    const shows = (...names: string[]) => (name: string) => names.includes(name)
    const now = ['see.md', 'P', 'b.md']
    // The rename's order came first: `c.md` stands where it stood, before the new name.
    expect(carriedOrder(['c.md', 'P', 'b.md'], now, shows('c.md', 'P', 'b.md'))).toEqual(['c.md', 'see.md', 'P', 'b.md'])
    // A delete: `P` keeps its place after `see.md`.
    expect(carriedOrder(['see.md', 'P', 'b.md'], ['see.md', 'b.md'], shows('see.md', 'P', 'b.md'))).toEqual(['see.md', 'P', 'b.md'])
    // The tree no longer shows it: nothing is carried, and the same list comes back.
    expect(carriedOrder(['c.md', 'see.md', 'P', 'b.md'], now, shows('see.md', 'P', 'b.md'))).toBe(now)
    expect(carriedOrder(undefined, now, shows('x.md'))).toBe(now)
  })
})
