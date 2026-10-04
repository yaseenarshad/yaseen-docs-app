/**
 * Shortcuts (YAZ-2290 D2/D4): what a folder shows, over an index snapshot. Each case pins ONE rule
 * of the lookup — who lives there, who is there by a shortcut, what is ignored quietly, and the
 * order — on bare records, the way `folderPages.test.ts` pins the legacy lookup. The write below it
 * runs the real one-key writer over an in-memory disk behind `api`, so what lands is real bytes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isNoteId } from '@shared/noteId'
import type { FileWriteRequest, IndexRecord } from '@shared/types'

/** The vault the writes land in: path → content. */
const { disk } = vi.hoisted(() => ({ disk: new Map<string, string>() }))
vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>()
  return {
    ...real,
    api: {
      readFile: vi.fn(async (path: string) => {
        const content = disk.get(path)
        if (content === undefined) throw new real.BridgeRequestError('NOT_FOUND', `no such file: ${path}`)
        return { path, content, mtime: 1, size: content.length }
      }),
      writeFile: vi.fn(async ({ path, content }: FileWriteRequest) => {
        disk.set(path, content)
        return { path, mtime: 2, size: content.length }
      }),
    },
  }
})

import { alsoIn } from '@shared/alsoIn'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { api } from '../api'
import { addShortcut, folderRows, isShortcut, removeShortcut, rowsByFolder } from './shortcuts'

const rec = (path: string, properties: Record<string, unknown> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/vault/'.length)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: 'md',
    size: 1,
    ctime: 1,
    mtime: 1,
    properties,
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  }
}

const PROJECTS_ID = 'k3m9x2pq7abc'
const AREAS_ID = 'z8y7x6w5v4t3'
const NOBODY_ID = 'a1b2c3d4e5f6'

/** A folder's settings file: its `id` is the folder's id. */
const settings = (folder: string, id?: string): IndexRecord => ({ ...rec(`/vault/${folder}/.folder.md`), id })

const FOLDERS = [settings('Areas', AREAS_ID), settings('Projects', PROJECTS_ID)]
const pathsIn = (records: readonly IndexRecord[], folder: string, folders: readonly IndexRecord[] = FOLDERS): string[] =>
  folderRows(records, folders, folder).map((r) => r.path)

describe('what a folder shows (YAZ-2290 D4)', () => {
  it('the notes that live DIRECTLY in it — not a subfolder’s, not another folder’s', () => {
    const records = [rec('/vault/Other.md'), rec('/vault/Projects/A.md'), rec('/vault/Projects/Deep/B.md'), rec('/vault/Projects/C.md')]
    expect(pathsIn(records, 'Projects')).toEqual(['/vault/Projects/A.md', '/vault/Projects/C.md'])
  })

  it('plus the notes whose `also_in` holds the folder’s id — the `id` of its `.folder.md`', () => {
    const records = [rec('/vault/Areas/Health.md', { also_in: [PROJECTS_ID] }), rec('/vault/Projects/A.md')]
    expect(pathsIn(records, 'Projects')).toEqual(['/vault/Areas/Health.md', '/vault/Projects/A.md'])
    expect(pathsIn(records, 'Areas')).toEqual(['/vault/Areas/Health.md'])
  })

  it('a note that lives in the folder AND names it shows once; so does one naming it twice', () => {
    const records = [rec('/vault/Areas/Twice.md', { also_in: [PROJECTS_ID, PROJECTS_ID] }), rec('/vault/Projects/A.md', { also_in: [PROJECTS_ID] })]
    expect(pathsIn(records, 'Projects')).toEqual(['/vault/Areas/Twice.md', '/vault/Projects/A.md'])
  })

  it('an id no folder has is ignored quietly', () => {
    const records = [rec('/vault/Areas/Health.md', { also_in: [NOBODY_ID, 'Projects'] })]
    expect(pathsIn(records, 'Projects')).toEqual([])
    expect([...rowsByFolder(records, FOLDERS).keys()]).toEqual(['Areas'])
  })

  it('a scalar `also_in` is ONE entry', () => {
    expect(pathsIn([rec('/vault/Areas/Health.md', { also_in: PROJECTS_ID })], 'Projects')).toEqual(['/vault/Areas/Health.md'])
  })

  it('a folder with no `.folder.md` — or one with no id — has no id, so nothing is a shortcut in it', () => {
    const records = [rec('/vault/Areas/Health.md', { also_in: [PROJECTS_ID] }), rec('/vault/Projects/A.md')]
    expect(pathsIn(records, 'Projects', [])).toEqual(['/vault/Projects/A.md'])
    expect(pathsIn(records, 'Projects', [settings('Projects')])).toEqual(['/vault/Projects/A.md'])
  })

  it('rows come in the order the index gives them, lived-in and shortcut alike', () => {
    const records = [rec('/vault/Areas/B.md', { also_in: [PROJECTS_ID] }), rec('/vault/Projects/A.md'), rec('/vault/Zebra/C.md', { also_in: [PROJECTS_ID] })]
    expect(pathsIn(records, 'Projects')).toEqual(['/vault/Areas/B.md', '/vault/Projects/A.md', '/vault/Zebra/C.md'])
  })

  it('of two folders still sharing an id, the first in path order is the one it names', () => {
    const records = [rec('/vault/Inbox/N.md', { also_in: [PROJECTS_ID] })]
    const twins = [settings('Areas', PROJECTS_ID), settings('Projects', PROJECTS_ID)]
    expect(pathsIn(records, 'Areas', twins)).toEqual(['/vault/Inbox/N.md'])
    expect(pathsIn(records, 'Projects', twins)).toEqual([])
  })
})

describe('`also_in`, read tolerantly', () => {
  it('keeps the ids and ignores everything else: non-strings, non-ids, a map', () => {
    expect(alsoIn({ also_in: [PROJECTS_ID, 7, null, 'Projects', '[[Projects]]', AREAS_ID] })).toEqual([PROJECTS_ID, AREAS_ID])
    expect(alsoIn({ also_in: { a: 1 } })).toEqual([])
    expect(alsoIn({ also_in: null })).toEqual([])
    expect(alsoIn({})).toEqual([])
  })
})

describe('a row is a shortcut where it does not live', () => {
  it('says so for the folder being shown', () => {
    const health = rec('/vault/Areas/Health.md', { also_in: [PROJECTS_ID] })
    expect(isShortcut(health, 'Projects')).toBe(true)
    expect(isShortcut(health, 'Areas')).toBe(false)
  })
})

describe('rowsByFolder is built once per snapshot', () => {
  it('the same two arrays answer with the same Map; a new array of either builds again', () => {
    const records = [rec('/vault/Areas/Health.md', { also_in: [PROJECTS_ID] })]
    const rows = rowsByFolder(records, FOLDERS)
    expect(rowsByFolder(records, FOLDERS)).toBe(rows)
    expect(rowsByFolder([...records], FOLDERS)).not.toBe(rows)
    expect(rowsByFolder(records, [...FOLDERS])).not.toBe(rows)
  })
})

describe('adding a shortcut (YAZ-2290 D2)', () => {
  const NOTE = '/vault/Areas/Health.md'
  const PROJECTS = '/vault/Projects'
  const SETTINGS_FILE = '/vault/Projects/.folder.md'
  const frontmatterOf = (path: string): Record<string, unknown> => parseFrontmatter(splitFrontmatter(disk.get(path) ?? '').frontmatter).properties

  beforeEach(() => {
    disk.clear()
    // Already a shortcut in Areas, and carrying an entry this app does not understand.
    disk.set(NOTE, `---\nalso_in:\n  - ${AREAS_ID}\n  - Old Folder\ntitle: Health\n---\nBody\n`)
  })

  /** Pick the note for Projects — twice: the second pick must change nothing. */
  const pickTwice = async (): Promise<void> => {
    await addShortcut(PROJECTS, NOTE)
    const [note, folder] = [disk.get(NOTE), disk.get(SETTINGS_FILE)]
    await addShortcut(PROJECTS, NOTE)
    expect(disk.get(NOTE)).toBe(note)
    expect(disk.get(SETTINGS_FILE)).toBe(folder)
  }

  it('a folder whose settings file has an id: that id is appended, every entry already there kept as written', async () => {
    disk.set(SETTINGS_FILE, `---\nid: ${PROJECTS_ID}\n---\n`)
    await pickTwice()
    expect(frontmatterOf(NOTE).also_in).toEqual([AREAS_ID, 'Old Folder', PROJECTS_ID])
    expect(disk.get(NOTE)).toContain('title: Health\n---\nBody\n')
    expect(disk.get(SETTINGS_FILE)).toBe(`---\nid: ${PROJECTS_ID}\n---\n`)
  })

  it('a folder with NO settings file: the file is written holding just a fresh id, and that id is the one used', async () => {
    await pickTwice()
    const { id } = frontmatterOf(SETTINGS_FILE)
    expect(isNoteId(id)).toBe(true)
    expect(disk.get(SETTINGS_FILE)).toBe(`---\nid: ${String(id)}\n---\n`)
    expect(frontmatterOf(NOTE).also_in).toEqual([AREAS_ID, 'Old Folder', id])
  })

  it('a settings file with NO id: a fresh one is written into it beside its settings, then used', async () => {
    disk.set(SETTINGS_FILE, '---\nfolder_page_settings:\n  views:\n    - type: table\n      name: Table\n---\n')
    await pickTwice()
    const { id, folder_page_settings } = frontmatterOf(SETTINGS_FILE)
    expect(isNoteId(id)).toBe(true)
    expect(folder_page_settings).toEqual({ views: [{ type: 'table', name: 'Table' }] })
    expect(frontmatterOf(NOTE).also_in).toEqual([AREAS_ID, 'Old Folder', id])
  })

  it('a note with no `also_in` gains the key, and a scalar one becomes a list that keeps it', async () => {
    disk.set(SETTINGS_FILE, `---\nid: ${PROJECTS_ID}\n---\n`)
    disk.set(NOTE, 'Body\n')
    await addShortcut(PROJECTS, NOTE)
    expect(disk.get(NOTE)).toBe(`---\nalso_in:\n  - ${PROJECTS_ID}\n---\nBody\n`)
    disk.set(NOTE, `---\nalso_in: ${AREAS_ID}\n---\nBody\n`)
    await addShortcut(PROJECTS, NOTE)
    expect(frontmatterOf(NOTE).also_in).toEqual([AREAS_ID, PROJECTS_ID])
  })

  it('a settings file whose `id` is someone else’s value is refused: nothing is overwritten, the note untouched', async () => {
    disk.set(SETTINGS_FILE, '---\nid: my-own-id\n---\n')
    const before = disk.get(NOTE)
    await expect(addShortcut(PROJECTS, NOTE)).rejects.toThrow(/not a page id/)
    expect(disk.get(SETTINGS_FILE)).toBe('---\nid: my-own-id\n---\n')
    expect(disk.get(NOTE)).toBe(before)
  })
})

describe('removing a shortcut (YAZ-2290 E5)', () => {
  const NOTE = '/vault/Areas/Health.md'

  it('takes the folder’s id out of the note’s `also_in` and leaves every other entry, and byte, alone', async () => {
    disk.set(NOTE, `---\nalso_in:\n  - ${AREAS_ID}\n  - ${PROJECTS_ID}\n  - Old Folder\ntitle: Health\n---\nBody\n`)
    await removeShortcut('/vault/Projects', NOTE, FOLDERS)
    expect(disk.get(NOTE)).toBe(`---\nalso_in:\n  - ${AREAS_ID}\n  - Old Folder\ntitle: Health\n---\nBody\n`)
  })

  it('the key goes with its last entry — list or scalar: an emptied list is no list', async () => {
    disk.set(NOTE, `---\nalso_in:\n  - ${PROJECTS_ID}\ntitle: Health\n---\nBody\n`)
    await removeShortcut('/vault/Projects', NOTE, FOLDERS)
    expect(disk.get(NOTE)).toBe('---\ntitle: Health\n---\nBody\n')
    disk.set(NOTE, `---\nalso_in: ${PROJECTS_ID}\n---\nBody\n`)
    await removeShortcut('/vault/Projects', NOTE, FOLDERS)
    expect(disk.get(NOTE)).toBe('---\n---\nBody\n') // the one-key writer's own empty block
  })

  it('a folder with no `.folder.md`, or one that holds no id, names nothing: the note is not written', async () => {
    vi.mocked(api.writeFile).mockClear()
    disk.set(NOTE, `---\nalso_in:\n  - ${PROJECTS_ID}\n---\nBody\n`)
    await removeShortcut('/vault/Projects', NOTE, [])
    await removeShortcut('/vault/Projects', NOTE, [settings('Projects')])
    expect(api.writeFile).not.toHaveBeenCalled()
  })

  it('a note that does not name the folder is not written', async () => {
    vi.mocked(api.writeFile).mockClear()
    disk.set(NOTE, `---\nalso_in:\n  - ${AREAS_ID}\n---\nBody\n`)
    await removeShortcut('/vault/Projects', NOTE, FOLDERS)
    expect(api.writeFile).not.toHaveBeenCalled()
  })
})
