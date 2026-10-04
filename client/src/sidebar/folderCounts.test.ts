import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
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
  it("counts the notecards that live DIRECTLY in each folder, keyed by the folder's absolute path", () => {
    const { counts } = folderCounts('/v', [record('Projects', 'a'), record('Projects', 'b'), record('Projects/Alpha', 'c'), record('', 'top')], [])
    expect([...counts]).toEqual([
      ['/v/Projects', 2],
      ['/v/Projects/Alpha', 1],
    ])
  })

  it('a folder holding no notecard has no entry, and a trailing slash on the root changes nothing', () => {
    const { counts } = folderCounts('/v/', [record('Projects/Alpha', 'c')], [])
    expect(counts.has('/v/Projects')).toBe(false)
    expect(counts.get('/v/Projects/Alpha')).toBe(1)
  })

  it("a folder's shortcuts count with the notecards that live in it (D2) — each notecard once", () => {
    const id = 'k3m9x2pq7abc'
    const folders = [{ ...record('Projects', '.folder'), id }]
    const { counts } = folderCounts('/v', [record('Areas', 'health', { also_in: [id] }), record('Projects', 'a', { also_in: [id] }), record('Projects', 'b')], folders)
    expect([...counts]).toEqual([
      ['/v/Areas', 1],
      ['/v/Projects', 3],
    ])
  })
})

describe('folderCounts: the shortcut rows (YAZ-2290 D2)', () => {
  const id = 'k3m9x2pq7abc'
  const folders = [{ ...record('Projects', '.folder'), id }]

  it("each folder's shortcuts as file rows, keyed by its absolute path — the notecards it shows that live elsewhere, in index order", () => {
    const records = [record('Areas', 'health', { also_in: [id] }), record('Projects', 'a', { also_in: [id] }), record('Zebra', 'z', { also_in: id })]
    expect([...folderCounts('/v', records, folders).shortcuts]).toEqual([
      [
        '/v/Projects',
        [
          { type: 'file', name: 'health.md', path: '/v/Areas/health.md', size: 1, mtime: 1, kind: 'markdown' },
          { type: 'file', name: 'z.md', path: '/v/Zebra/z.md', size: 1, mtime: 1, kind: 'markdown' },
        ],
      ],
    ])
  })

  it('a folder with no shortcut has no entry, and neither has the vault root — it has no row to stand under', () => {
    const rootId = 'z8y7x6w5v4t3'
    const { shortcuts } = folderCounts('/v', [record('Areas', 'health', { also_in: [rootId] }), record('Projects', 'a')], [...folders, { ...record('', '.folder'), id: rootId }])
    expect(shortcuts.size).toBe(0)
  })
})
