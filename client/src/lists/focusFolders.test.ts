/**
 * The pure rules of the focus and favorite folders (YAZ-4460 F2; YAZ-4470 1, 3, 13): the merge of each vault's copy,
 * the owner of an item, the drag order, and how an item finds its vault.
 */
import { describe, expect, it } from 'vitest'
import type { FocusFolder } from '@shared/types'
import { itemOf, mergeFolders, resolveItem, vaultOfFolder } from './focusFolders'

const folder = (id: string, at: number, items: FocusFolder['items'], extra: Partial<FocusFolder> = {}): FocusFolder => ({ id, name: id, created: 1, at, items, ...extra })

describe('mergeFolders', () => {
  it('keeps the newest copy of each folder, a tombstone hides every older copy, and the order is the made order', () => {
    const merged = mergeFolders([
      [folder('b', 5, []), folder('a', 1, [], { created: 0 })],
      [folder('b', 9, [{ vault: 'Notes', path: 'x.md' }]), folder('gone', 9, [], { deleted: true })],
      [folder('gone', 3, [{ vault: 'Notes', path: 'y.md' }])],
    ])
    expect(merged.map((f) => [f.id, f.at])).toEqual([['a', 1], ['b', 9]])
  })

  it('YAZ-4470 13: a dragged order (`pos`) comes first; a folder with none goes after, by the made order', () => {
    const merged = mergeFolders([[folder('old', 1, [], { created: 1 }), folder('second', 1, [], { created: 2, pos: 1 }), folder('first', 1, [], { created: 3, pos: 0 }), folder('new', 1, [], { created: 4 })]])
    expect(merged.map((f) => f.id)).toEqual(['first', 'second', 'old', 'new'])
  })

  it('YAZ-4470 1: each vault owns its items — an older copy from a window without Work cannot bring back a Work file renamed since', () => {
    // Work renamed Roadmap.md: its own copy holds the new name. Notes kept the old copy, and a Notes-alone window then
    // renamed the folder, so Notes' copy is the newest — with Work's old item in it.
    const work = folder('f', 5, [{ vault: 'Notes', path: 'plan.md' }, { vault: 'Work', path: 'Roadmap 2026.md' }])
    const notes = folder('f', 8, [{ vault: 'Notes', path: 'plan.md' }, { vault: 'Work', path: 'Roadmap.md' }], { name: 'Renamed' })
    const [merged] = mergeFolders({ '/x/Work': [work], '/x/Notes': [notes] })
    expect(merged.name).toBe('Renamed') // the newest copy still wins the folder itself
    expect(merged.items).toEqual([{ vault: 'Notes', path: 'plan.md' }, { vault: 'Work', path: 'Roadmap 2026.md' }])
  })

  it('YAZ-4470 1: an item of a vault with no copy of the folder, or a tombstone there, stays as the newest copy has it', () => {
    const notes = folder('f', 8, [{ vault: 'Work', path: 'Roadmap.md' }])
    expect(mergeFolders({ '/x/Notes': [notes], '/x/Work': [] })[0].items).toEqual([{ vault: 'Work', path: 'Roadmap.md' }])
    const gone = folder('f', 2, [], { deleted: true })
    expect(mergeFolders({ '/x/Notes': [notes], '/x/Work': [gone] })[0].items).toEqual([{ vault: 'Work', path: 'Roadmap.md' }])
  })
})

describe('resolveItem and itemOf', () => {
  it('an item opens in the vault of its folder name; a vault not in the window makes a ghost', () => {
    expect(resolveItem({ vault: 'Work', path: 'a/b.md' }, ['/x/Notes', '/x/Work/'])).toEqual({ path: '/x/Work/a/b.md' })
    expect(resolveItem({ vault: 'Research', path: 'p.md' }, ['/x/Notes'])).toEqual({ ghost: 'Research' })
  })

  it('YAZ-4470 3: two vaults of the window with that folder name make a ghost with `clash`, never a guess', () => {
    expect(resolveItem({ vault: 'Notes', path: 'Plan.md' }, ['/home/Notes', '/work/Notes'])).toEqual({ ghost: 'Notes', clash: true })
  })

  it('a path of the window as an item: its vault name and the path inside; a vault root or a path outside is none', () => {
    expect(itemOf('/x/Work/a/b.md', ['/x/Notes', '/x/Work'])).toEqual({ vault: 'Work', path: 'a/b.md' })
    expect(itemOf('/x/Work', ['/x/Work'])).toBeNull()
    expect(itemOf('/elsewhere/n.md', ['/x/Work'])).toBeNull()
  })
})

describe('vaultOfFolder (YAZ-4782)', () => {
  const roots = ['/a/Notes/', '/b/Work']
  it('is the vault of the first item the window shows; a ghost is skipped; an empty folder, or none, is the first vault — no slash at the end', () => {
    expect(vaultOfFolder(folder('f', 1, [{ vault: 'Away', path: 'x.md' }, { vault: 'Work', path: 'w.md' }, { vault: 'Notes', path: 'n.md' }]), roots)).toBe('/b/Work')
    expect(vaultOfFolder(folder('f', 1, []), roots)).toBe('/a/Notes')
    expect(vaultOfFolder(undefined, roots)).toBe('/a/Notes')
  })
})
