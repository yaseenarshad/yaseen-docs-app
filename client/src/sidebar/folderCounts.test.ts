import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { folderRows } from '../links/shortcuts'
import { folderCounts } from './folderCounts'

const record = (folder: string, basename: string, properties: Record<string, unknown> = {}): IndexRecord => ({
  path: `/v/${folder === '' ? '' : `${folder}/`}${basename}.md`,
  name: `${basename}.md`,
  basename,
  folder,
  ext: 'md',
  size: 1,
  ctime: 1,
  mtime: 1,
  properties,
  aliases: [],
  tags: [],
  links: [],
  embeds: [],
})

describe('folderCounts (🔒 E6, YAZ-2290)', () => {
  it("the count beside a folder is every note under it, at any depth, keyed by the folder's absolute path", () => {
    const { counts } = folderCounts('/v', [record('Projects', 'a'), record('Projects', 'b'), record('Projects/Alpha', 'c'), record('Projects/Alpha/Deep', 'd'), record('', 'top')], [])
    expect([...counts]).toEqual([
      ['/v/Projects', 4],
      ['/v/Projects/Alpha', 2],
      ['/v/Projects/Alpha/Deep', 1],
    ])
  })

  it('a folder with no notes of its own counts the notes in its subfolders; one with none under it has no entry; a trailing slash on the root changes nothing', () => {
    const { counts } = folderCounts('/v/', [record('Projects/Alpha', 'c')], [])
    expect(new Map(counts)).toEqual(new Map([['/v/Projects', 1], ['/v/Projects/Alpha', 1]]))
  })

  it("a folder's shortcuts count with the notes that live in it (D2) — each note once", () => {
    const id = 'k3m9x2pq7abc'
    const folders = [{ ...record('Projects', '.folder'), id }]
    const { counts } = folderCounts('/v', [record('Areas', 'health', { also_in: [id] }), record('Projects', 'a', { also_in: [id] }), record('Projects', 'b')], folders)
    expect([...counts]).toEqual([
      ['/v/Areas', 1],
      ['/v/Projects', 3],
    ])
  })

  it('the count is the number of rows the folder’s table shows: a shortcut into a subfolder counts in the subfolder and in every folder above it, each note once', () => {
    const [projects, alpha] = ['k3m9x2pq7abc', 'z8y7x6w5v4t3']
    const folders = [{ ...record('Projects', '.folder'), id: projects }, { ...record('Projects/Alpha', '.folder'), id: alpha }]
    const records = [
      record('Areas', 'health', { also_in: [alpha] }),
      record('Projects', 'a', { also_in: [alpha, projects] }),
      record('Projects/Alpha', 'c', { also_in: [projects] }),
    ]
    const { counts } = folderCounts('/v', records, folders)
    expect(new Map(counts)).toEqual(new Map([['/v/Areas', 1], ['/v/Projects', 3], ['/v/Projects/Alpha', 3]]))
    for (const folder of ['Areas', 'Projects', 'Projects/Alpha']) expect(counts.get(`/v/${folder}`)).toBe(folderRows(records, folders, folder).length)
  })
})

describe('folderCounts: the shortcut rows (YAZ-2290 D2)', () => {
  const id = 'k3m9x2pq7abc'
  const folders = [{ ...record('Projects', '.folder'), id }]
  const row = (folder: string, basename: string) => ({ type: 'file', name: `${basename}.md`, path: `/v/${folder}/${basename}.md`, size: 1, mtime: 1, kind: 'markdown' })

  it("each folder's shortcuts as file rows, keyed by its absolute path — the notes it shows that live elsewhere, in index order", () => {
    const records = [record('Areas', 'health', { also_in: [id] }), record('Projects', 'a', { also_in: [id] }), record('Zebra', 'z', { also_in: id })]
    expect([...folderCounts('/v', records, folders).shortcuts]).toEqual([['/v/Projects', [row('Areas', 'health'), row('Zebra', 'z')]]])
  })

  it('the shortcut rows the tree draws under a folder: only notes whose `also_in` names THAT folder and that do not live under it', () => {
    const alpha = 'z8y7x6w5v4t3'
    const nested = [...folders, { ...record('Projects/Alpha', '.folder'), id: alpha }]
    const records = [
      record('Areas', 'health', { also_in: [alpha] }), // into the subfolder: drawn under it, never again under Projects
      record('Areas', 'wealth', { also_in: [id] }),
      record('Projects', 'a', { also_in: [alpha] }), // lives in Projects, a shortcut in Alpha
      record('Projects/Alpha', 'c', { also_in: [id] }), // lives under Projects: no shortcut row there
      record('Projects/Alpha', 'd'), // a subfolder's note is no shortcut row of the parent
    ]
    expect(new Map(folderCounts('/v', records, nested).shortcuts)).toEqual(
      new Map([
        ['/v/Projects', [row('Areas', 'wealth')]],
        ['/v/Projects/Alpha', [row('Areas', 'health'), row('Projects', 'a')]],
      ]),
    )
  })

  it('a folder with no shortcut has no entry, and neither has the vault root — it has no row to stand under', () => {
    const rootId = 'z8y7x6w5v4t3'
    const { shortcuts } = folderCounts('/v', [record('Areas', 'health', { also_in: [rootId] }), record('Projects', 'a')], [...folders, { ...record('', '.folder'), id: rootId }])
    expect(shortcuts.size).toBe(0)
  })
})
