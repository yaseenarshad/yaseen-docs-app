/**
 * Links to folders (YAZ-2290 D10): each case pins ONE locked rule — a note, path or alias of
 * the name always wins, the shallowest of two folders takes the bare name, an id reaches its
 * folder, the root is not linkable — then the picker rows and the belongs-to picker built on them.
 * The resolvers are pure over a folder list; only the belongs-to picker reads the Files tree, so
 * `api.tree` is mocked and each of its cases stands in its own root, with its own feed.
 */
import { describe, expect, it, vi } from 'vitest'
import type { IndexRecord, TreeNode } from '@shared/types'
import { fetchTree } from '../lib/treeFeed'
import { resolverFor } from '../views/engine'
import { linkCandidates, matchLinkCandidates } from './completion'
import { belongsToBasenames, folderLinkCandidates, folderResolver, linkResolver, vaultDirs } from './folderLinks'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { tree: vi.fn() },
}))

import { api } from '../api'

const rec = (path: string, over: Partial<IndexRecord> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice(path.indexOf('/', 1) + 1)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: 'md',
    size: 1,
    ctime: 1,
    mtime: 1,
    properties: {},
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
    ...over,
  }
}

const NOTE_ID = 'k3m9x2pq7abc'
const FOLDER_ID = 'f7n2w8rt4xyz'

/** The Files tree's folders, outer before inner (`allDirs`): two named Projects, one of them deeper. */
const DIRS = ['/vault/Archive', '/vault/Archive/Old', '/vault/Projects', '/vault/Work', '/vault/Work/Projects']

describe('linkResolver (YAZ-2290 D10): a folder takes a name only when nothing else holds it', () => {
  it('`[[Projects]]` is the folder when no note is named Projects', () => {
    const resolve = linkResolver([rec('/vault/Note.md')], '/vault', DIRS)
    expect(resolve('Projects')).toBe('/vault/Projects')
    expect(resolve('[[Projects|the work]]')).toBe('/vault/Projects')
    expect(resolve('Projects#Scope')).toBe('/vault/Projects')
    expect(resolve('Nowhere')).toBeNull()
  })

  it('a note named Projects wins, wherever it lives', () => {
    const resolve = linkResolver([rec('/vault/Archive/Old/Projects.md')], '/vault', DIRS)
    expect(resolve('Projects')).toBe('/vault/Archive/Old/Projects.md')
  })

  it('so does a note merely ALIASED Projects', () => {
    const resolve = linkResolver([rec('/vault/Roadmap.md', { aliases: ['Projects'] })], '/vault', DIRS)
    expect(resolve('Projects')).toBe('/vault/Roadmap.md')
  })

  it('two folders of one name: the shallowest takes the bare name, a root-relative path picks the deeper', () => {
    const resolve = linkResolver([], '/vault', [...DIRS].reverse()) // whatever order the tree lists them in
    expect(resolve('Projects')).toBe('/vault/Projects')
    expect(resolve('Work/Projects')).toBe('/vault/Work/Projects')
    expect(resolve('/Work/Projects/')).toBe('/vault/Work/Projects')
    expect(resolve('Old')).toBe('/vault/Archive/Old') // a name only a deep folder has
    expect(resolve('Work/Old')).toBeNull() // a path is exact: no name fallback behind it
  })

  it('is case-insensitive, like note names', () => {
    const resolve = linkResolver([], '/vault', DIRS)
    expect(resolve('pROJECTS')).toBe('/vault/Projects')
    expect(resolve('work/projects')).toBe('/vault/Work/Projects')
  })

  it('the vault root is not linkable: by name, by path or by the id of its own settings file', () => {
    const resolve = linkResolver([], '/vault', DIRS, [rec('/vault/.folder.md', { id: FOLDER_ID })])
    expect(resolve('vault')).toBeNull()
    expect(resolve('/vault')).toBeNull()
    expect(resolve('/')).toBeNull()
    expect(resolve(FOLDER_ID)).toBeNull()
  })

  it('`[[<id>]]` of a `.folder.md` is its folder; a note id is still the note', () => {
    const records = [rec('/vault/Projects/Plan.md', { id: NOTE_ID })]
    const resolve = linkResolver(records, '/vault', DIRS, [rec('/vault/Work/Projects/.folder.md', { id: FOLDER_ID })])
    expect(resolve(FOLDER_ID)).toBe('/vault/Work/Projects')
    expect(resolve(`[[${FOLDER_ID}]]`)).toBe('/vault/Work/Projects')
    expect(resolve(NOTE_ID)).toBe('/vault/Projects/Plan.md')
  })

  it('no folder list, or an id whose folder the tree does not hold: nothing resolves', () => {
    expect(folderResolver('/vault', [])('Projects')).toBeNull()
    expect(folderResolver('/vault', DIRS, [rec('/vault/Gone/.folder.md', { id: FOLDER_ID })])(FOLDER_ID)).toBeNull()
  })
})

describe('folderLinkCandidates: the `[[` picker offers folders', () => {
  const rows = (records: IndexRecord[]) => {
    const resolve = linkResolver(records, '/vault', DIRS)
    return [...linkCandidates(records), ...folderLinkCandidates('/vault', DIRS, resolve)]
  }

  it('a folder inserts its NAME — or its path when a shallower folder has the name', () => {
    expect(folderLinkCandidates('/vault', DIRS, linkResolver([], '/vault', DIRS)).map((c) => c.insert)).toEqual(['Archive', 'Old', 'Projects', 'Work', 'Work/Projects'])
  })

  it('and its path when a note has the name; every row links back to its own folder', () => {
    const records = [rec('/vault/Notes/Old.md')]
    const resolve = linkResolver(records, '/vault', DIRS)
    const candidates = folderLinkCandidates('/vault', DIRS, resolve)
    expect(candidates.map((c) => c.insert)).toEqual(['Archive', 'Archive/Old', 'Projects', 'Work', 'Work/Projects'])
    expect(candidates.map((c) => resolve(c.insert))).toEqual(DIRS)
  })

  it('a folder whose very path a note holds gets no row: nothing inserted would reach it', () => {
    const records = [rec('/vault/Projects.md'), rec('/vault/Work/Projects.md')]
    expect(folderLinkCandidates('/vault', DIRS, linkResolver(records, '/vault', DIRS)).map((c) => c.insert)).toEqual(['Archive', 'Old', 'Work'])
  })

  it('on an equal match the note ranks above the folder', () => {
    // Both are prefix matches, and the folder sorts first by name: the note still leads.
    const matches = matchLinkCandidates(rows([rec('/vault/Zed/Prospect.md')]), 'pro')
    expect(matches.map((c) => c.insert)).toEqual(['Prospect', 'Projects', 'Work/Projects'])
    // The same name on both: the note has it, and the folder is offered by its path.
    const taken = matchLinkCandidates(rows([rec('/vault/Notes/Old.md')]), 'old')
    expect(taken.map((c) => c.insert)).toEqual(['Old', 'Archive/Old'])
  })
})

describe('belongsToBasenames: a link column narrowed to the notes in a FOLDER', () => {
  const dir = (path: string, children: TreeNode[] = []): TreeNode => ({ type: 'dir', name: path.slice(path.lastIndexOf('/') + 1), path, children })

  /** A vault under its own root: People holds two notes and a subfolder's one, Empty holds none. */
  async function vault(root: string): Promise<{ records: IndexRecord[]; names: (target: string) => string[] }> {
    const records = [
      rec(`${root}/Empty Note.md`),
      rec(`${root}/KPIs.md`),
      rec(`${root}/People/Alice.md`, { id: NOTE_ID }),
      rec(`${root}/People/Bob.md`),
      rec(`${root}/People/Teams/Core.md`),
    ]
    vi.mocked(api.tree).mockResolvedValueOnce({ root, tree: [dir(`${root}/Empty`), dir(`${root}/People`, [dir(`${root}/People/Teams`)])], generatedAt: 1 })
    await fetchTree(root)
    return { records, names: (target) => belongsToBasenames(records, [], linkResolver(records, root, vaultDirs(root)), root, target).map((c) => c.name) }
  }
  const ALL = ['Empty Note', 'KPIs', 'Alice', 'Bob', 'Core']

  it('reads the folders off the Files tree', async () => {
    await vault('/dirs')
    expect(vaultDirs('/dirs')).toEqual(['/dirs/Empty', '/dirs/People', '/dirs/People/Teams'])
    expect(vaultDirs('/dirs')).toBe(vaultDirs('/dirs')) // walked once per tree
    expect(vaultDirs('/no-tree-yet')).toEqual([])
  })

  it('a link column whose `target` is `[[Folder]]` narrows to that folder’s rows — its subfolders’ notes included — written by id', async () => {
    const { records, names } = await vault('/narrow')
    expect(names('[[People]]')).toEqual(['Alice', 'Bob', 'Core'])
    expect(names('People')).toEqual(['Alice', 'Bob', 'Core']) // a bare name is the same target
    expect(names('[[People/Teams]]')).toEqual(['Core'])
    expect(belongsToBasenames(records, [], linkResolver(records, '/narrow', vaultDirs('/narrow')), '/narrow', '[[People]]').map((c) => c.insert)).toEqual([NOTE_ID, 'Bob', 'Core'])
  })

  it("a note that is in the target folder by a SHORTCUT is offered with the ones that live there (D2)", async () => {
    const { records } = await vault('/shortcut')
    const shortcut = rec('/shortcut/Guest.md', { properties: { also_in: [FOLDER_ID] } })
    const folders = [rec('/shortcut/People/.folder.md', { id: FOLDER_ID })]
    const all = [...records, shortcut].sort((a, b) => (a.path < b.path ? -1 : 1))
    const resolve = linkResolver(all, '/shortcut', vaultDirs('/shortcut'), folders)
    expect(belongsToBasenames(all, folders, resolve, '/shortcut', '[[People]]').map((c) => c.name)).toEqual(['Guest', 'Alice', 'Bob', 'Core'])
    // The folder's id names it too (YAZ-2293): a target written by id narrows the same way.
    expect(belongsToBasenames(all, folders, resolve, '/shortcut', `[[${FOLDER_ID}]]`).map((c) => c.name)).toEqual(['Guest', 'Alice', 'Bob', 'Core'])
  })

  it('falls back to ALL notes when the target is no folder, or the folder is empty', async () => {
    const { names } = await vault('/fallback')
    expect(names('[[Nowhere]]')).toEqual(ALL)
    expect(names('[[Empty]]')).toEqual(ALL)
    expect(names('[[Empty Note]]')).toEqual(ALL) // a note, not a folder
  })
})
