import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { folderShortcuts } from './folderShortcuts'

const record = (folder: string, basename: string, properties: Record<string, unknown> = {}): IndexRecord => ({
  path: `/v/${folder === '' ? '' : `${folder}/`}${basename}.md`,
  name: `${basename}.md`,
  basename,
  title: basename,
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

describe('folderShortcuts: the shortcut rows (YAZ-2290 D2)', () => {
  const id = 'k3m9x2pq7abc'
  const folders = [{ ...record('Projects', '.folder'), id }]
  const row = (folder: string, basename: string) => ({ type: 'file', name: `${basename}.md`, path: `/v/${folder}/${basename}.md`, size: 1, mtime: 1, kind: 'markdown' })

  it("each folder's shortcuts as file rows, keyed by its absolute path — the notes it shows that live elsewhere, in index order; a trailing slash on the root changes nothing", () => {
    const records = [record('Areas', 'health', { also_in: [id] }), record('Projects', 'a', { also_in: [id] }), record('Zebra', 'z', { also_in: id })]
    for (const root of ['/v', '/v/']) expect([...folderShortcuts(root, records, folders)]).toEqual([['/v/Projects', [row('Areas', 'health'), row('Zebra', 'z')]]])
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
    expect(folderShortcuts('/v', records, nested)).toEqual(
      new Map([
        ['/v/Projects', [row('Areas', 'wealth')]],
        ['/v/Projects/Alpha', [row('Areas', 'health'), row('Projects', 'a')]],
      ]),
    )
  })

  it('a folder with no shortcut has no entry, and neither has the vault root — it has no row to stand under', () => {
    const rootId = 'z8y7x6w5v4t3'
    expect(folderShortcuts('/v', [record('Areas', 'health', { also_in: [rootId] }), record('Projects', 'a')], [...folders, { ...record('', '.folder'), id: rootId }]).size).toBe(0)
  })
})
