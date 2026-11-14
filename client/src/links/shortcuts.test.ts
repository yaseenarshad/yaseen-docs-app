/**
 * Shortcuts (YAZ-2290 D2/D4): what a folder shows, over an index snapshot. Each case pins ONE rule
 * of the lookup — who lives there, who is there by a shortcut, what is ignored quietly, and the
 * order — on bare records. The write below it
 * runs the real one-key writer over an in-memory disk behind `api`, so what lands is real bytes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isPageId } from '@shared/pageId'
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
      // The door in the main process (YAZ-2677 D4): the vault's next number.
      mintPageId: (await import('../testPageIds')).testDoor(),
    },
  }
})

import { alsoIn } from '@shared/alsoIn'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { api } from '../api'
import { addShortcut, directlyIn, folderRows, foldersById, foldersShowing, isFolderRow, isShortcut, removeShortcut, rowPage, rowsByFolder, setShortcutEntries, subfolderRows } from './shortcuts'

const rec = (path: string, properties: Record<string, unknown> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/vault/'.length)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    title: name.replace(/\.md$/, ''),
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
const DEEP_ID = 'd5e6f7g8h9j2'
const DEEPER_ID = 'm4n5p6q7r8s9'

/** A folder's settings file: its `id` is the folder's id. */
const settings = (folder: string, id?: string): IndexRecord => ({ ...rec(`/vault/${folder}/.folder.md`), id })

const FOLDERS = [settings('Areas', AREAS_ID), settings('Projects', PROJECTS_ID)]
/** The same two, and two folders under Projects — one inside the other. */
const NESTED = [...FOLDERS, settings('Projects/Deep', DEEP_ID), settings('Projects/Deep/Deeper', DEEPER_ID)]
const pathsIn = (records: readonly IndexRecord[], folder: string, folders: readonly IndexRecord[] = FOLDERS): string[] =>
  folderRows(records, folders, folder).map((r) => r.path)

describe('what a folder shows (YAZ-2375 D4)', () => {
  it('a page directly in the folder is a row; another folder’s page is not', () => {
    const records = [rec('/vault/Other.md'), rec('/vault/Projects/A.md'), rec('/vault/Projects-old/X.md'), rec('/vault/Projects/C.md')]
    expect(pathsIn(records, 'Projects')).toEqual(['/vault/Projects/A.md', '/vault/Projects/C.md'])
  })

  it('a page in a subfolder, at any depth, is a row', () => {
    const records = [rec('/vault/Projects/A.md'), rec('/vault/Projects/Deep/B.md'), rec('/vault/Projects/Deep/Deeper/C.md')]
    expect(pathsIn(records, 'Projects')).toEqual(['/vault/Projects/A.md', '/vault/Projects/Deep/B.md', '/vault/Projects/Deep/Deeper/C.md'])
    expect(pathsIn(records, 'Projects/Deep')).toEqual(['/vault/Projects/Deep/B.md', '/vault/Projects/Deep/Deeper/C.md'])
    expect(pathsIn(records, 'Projects/Deep/Deeper')).toEqual(['/vault/Projects/Deep/Deeper/C.md'])
  })

  it('a folder with no pages of its own but pages in its subfolders shows all of them', () => {
    const records = [rec('/vault/Projects/Deep/B.md'), rec('/vault/Projects/Deep/Deeper/C.md'), rec('/vault/Projects/Other/D.md')]
    expect(pathsIn(records, 'Projects')).toEqual(['/vault/Projects/Deep/B.md', '/vault/Projects/Deep/Deeper/C.md', '/vault/Projects/Other/D.md'])
  })

  it('a subfolder is never a row: every row is a page of the snapshot', () => {
    const records = [rec('/vault/Projects/A.md'), rec('/vault/Projects/Deep/B.md')]
    expect(folderRows(records, NESTED, 'Projects')).toEqual(records)
  })

  it('a shortcut into one of its subfolders is a row in the subfolder AND in every folder above it', () => {
    const records = [rec('/vault/Areas/Health.md', { also_in: [DEEPER_ID] })]
    for (const folder of ['Projects/Deep/Deeper', 'Projects/Deep', 'Projects']) expect(pathsIn(records, folder, NESTED)).toEqual(['/vault/Areas/Health.md'])
  })

  it('a page that would be a row twice is shown once: it lives under the folder and is also a shortcut into it, or into a subfolder of it', () => {
    const records = [
      rec('/vault/Areas/Both.md', { also_in: [PROJECTS_ID, DEEP_ID, DEEPER_ID] }),
      rec('/vault/Projects/A.md', { also_in: [DEEP_ID] }),
      rec('/vault/Projects/Deep/B.md', { also_in: [PROJECTS_ID] }),
      rec('/vault/Projects/Deep/Deeper/C.md', { also_in: [DEEP_ID] }),
    ]
    const all = records.map((r) => r.path)
    expect(pathsIn(records, 'Projects', NESTED)).toEqual(all)
    expect(pathsIn(records, 'Projects/Deep', NESTED)).toEqual(all)
  })

  it('the vault root\'s entry is EVERY page of the vault, each once (YAZ-4921: the root\'s own page lists the whole vault), in the index\'s order', () => {
    const records = [rec('/vault/Projects/A.md'), rec('/vault/Projects/Deep/B.md', { also_in: [AREAS_ID] }), rec('/vault/Top.md')]
    expect(pathsIn(records, '', NESTED)).toEqual(['/vault/Projects/A.md', '/vault/Projects/Deep/B.md', '/vault/Top.md'])
  })

  it('plus the pages whose `also_in` holds the folder’s id — the `id` of its `.folder.md`', () => {
    const records = [rec('/vault/Areas/Health.md', { also_in: [PROJECTS_ID] }), rec('/vault/Projects/A.md')]
    expect(pathsIn(records, 'Projects')).toEqual(['/vault/Areas/Health.md', '/vault/Projects/A.md'])
    expect(pathsIn(records, 'Areas')).toEqual(['/vault/Areas/Health.md'])
  })

  it('a page that lives in the folder AND names it shows once; so does one naming it twice', () => {
    const records = [rec('/vault/Areas/Twice.md', { also_in: [PROJECTS_ID, PROJECTS_ID] }), rec('/vault/Projects/A.md', { also_in: [PROJECTS_ID] })]
    expect(pathsIn(records, 'Projects')).toEqual(['/vault/Areas/Twice.md', '/vault/Projects/A.md'])
  })

  it('an id no folder has is ignored quietly', () => {
    const records = [rec('/vault/Areas/Health.md', { also_in: [NOBODY_ID, 'Projects'] })]
    expect(pathsIn(records, 'Projects')).toEqual([])
    expect([...rowsByFolder(records, FOLDERS).keys()]).toEqual(['Areas', '']) // the root shows every page (YAZ-4921)
  })

  it('a scalar `also_in` is ONE entry', () => {
    expect(pathsIn([rec('/vault/Areas/Health.md', { also_in: PROJECTS_ID })], 'Projects')).toEqual(['/vault/Areas/Health.md'])
  })

  it('a folder with no `.folder.md` — or one with no id — has no id, so nothing is a shortcut in it', () => {
    const records = [rec('/vault/Areas/Health.md', { also_in: [PROJECTS_ID] }), rec('/vault/Projects/A.md')]
    expect(pathsIn(records, 'Projects', [])).toEqual(['/vault/Projects/A.md'])
    expect(pathsIn(records, 'Projects', [settings('Projects')])).toEqual(['/vault/Projects/A.md'])
  })

  // The ID vault's half is `plus the pages whose also_in holds the folder's id`, above.
  it('in a vault that does not use IDs no row is a shortcut: its index hands out no folder id, so a page\u2019s `also_in` names nothing (YAZ-2523 V5)', () => {
    const records = [rec('/vault/Areas/Health.md', { also_in: [PROJECTS_ID] }), rec('/vault/Projects/A.md')]
    // The same folders as such a vault's index hands them out: the `id` line is a property, and the record has no id.
    const plain = FOLDERS.map(({ id, ...folder }) => ({ ...folder, properties: { id } }))
    expect(pathsIn(records, 'Projects', plain)).toEqual(['/vault/Projects/A.md'])
    expect(pathsIn(records, 'Areas', plain)).toEqual(['/vault/Areas/Health.md'])
    for (const folder of ['Projects', 'Areas']) expect(folderRows(records, plain, folder).some((r) => isShortcut(r, folder))).toBe(false)
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

describe('the folders that show a page', () => {
  const showing = (record: IndexRecord, folders: readonly IndexRecord[] = NESTED): string[] => foldersShowing(record.folder, record.properties, foldersById(folders))

  it('the folder it lives in, then each folder above it, nearest first — and the vault root last, whose own page lists every page (YAZ-4921)', () => {
    expect(showing(rec('/vault/Projects/Deep/Deeper/C.md'))).toEqual(['Projects/Deep/Deeper', 'Projects/Deep', 'Projects', ''])
    expect(showing(rec('/vault/Projects/A.md'))).toEqual(['Projects', ''])
  })

  it('then each folder it is a shortcut in, followed by the folders above that one — each folder once, the root last', () => {
    const page = rec('/vault/Areas/Health.md', { also_in: [DEEPER_ID, PROJECTS_ID, AREAS_ID, NOBODY_ID] })
    expect(showing(page)).toEqual(['Areas', 'Projects/Deep/Deeper', 'Projects/Deep', 'Projects', ''])
  })

  it('a page directly in the vault root is shown by the root alone', () => {
    expect(showing(rec('/vault/Top.md'))).toEqual([''])
  })

  it('agrees with the rows: a folder shows a page exactly when it is one of the folders showing that page', () => {
    const records = [
      rec('/vault/Top.md', { also_in: [DEEP_ID] }),
      rec('/vault/Areas/Health.md', { also_in: [DEEPER_ID, NOBODY_ID] }),
      rec('/vault/Projects/A.md', { also_in: [AREAS_ID] }),
      rec('/vault/Projects/Deep/Deeper/C.md'),
    ]
    const rows = rowsByFolder(records, NESTED)
    for (const record of records) {
      expect([...rows].filter(([, shown]) => shown.includes(record)).map(([folder]) => folder).sort()).toEqual(showing(record).sort())
    }
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

describe('a row is a shortcut where it does not live under the folder', () => {
  it('the shortcut mark: a page that is not under the folder being shown is there by a shortcut', () => {
    const health = rec('/vault/Areas/Health.md', { also_in: [PROJECTS_ID] })
    expect(isShortcut(health, 'Projects')).toBe(true)
    expect(isShortcut(health, 'Areas')).toBe(false)
    expect(isShortcut(rec('/vault/Projects-old/X.md'), 'Projects')).toBe(true)
  })

  it('a page from a subfolder, at any depth, is no shortcut', () => {
    expect(isShortcut(rec('/vault/Projects/Deep/B.md'), 'Projects')).toBe(false)
    expect(isShortcut(rec('/vault/Projects/Deep/Deeper/C.md'), 'Projects')).toBe(false)
    expect(isShortcut(rec('/vault/Projects/A.md'), 'Projects/Deep')).toBe(true)
  })
})

describe('"Pages in subfolders: Hide" keeps a row directly in the folder (YAZ-4564 D25)', () => {
  it('a page directly in the folder and a shortcut stay; a page in a subfolder, at any depth, goes', () => {
    expect(directlyIn(rec('/vault/Projects/A.md'), 'Projects')).toBe(true)
    expect(directlyIn(rec('/vault/Areas/Health.md', { also_in: [PROJECTS_ID] }), 'Projects')).toBe(true)
    expect(directlyIn(rec('/vault/Projects/Deep/B.md'), 'Projects')).toBe(false)
    expect(directlyIn(rec('/vault/Projects/Deep/Deeper/C.md'), 'Projects')).toBe(false)
  })
})

describe('subfolders as rows (YAZ-4579 D31)', () => {
  /** The Files tree's folders, absolute (`vaultDirs`): Projects/Plain has no `.folder.md`. */
  const DIRS = ['/vault/Areas', '/vault/Projects', '/vault/Projects/Deep', '/vault/Projects/Deep/Deeper', '/vault/Projects/Plain']

  it('the DIRECT subfolders only, in path order: each its own `.folder.md` record, with `folder` = the parent', () => {
    const rows = subfolderRows('/vault', 'Projects', DIRS, NESTED)
    expect(rows.map((r) => r.path)).toEqual(['/vault/Projects/Deep/.folder.md', '/vault/Projects/Plain/.folder.md'])
    expect(rows[0]).toEqual({ ...settings('Projects/Deep', DEEP_ID), folder: 'Projects' })
  })

  it('a folder with no `.folder.md` is an empty stand-in at the path its first write creates, titled by its directory', () => {
    const plain = subfolderRows('/vault', 'Projects', DIRS, NESTED)[1]
    expect(plain).toMatchObject({ path: '/vault/Projects/Plain/.folder.md', name: '.folder.md', title: 'Plain', folder: 'Projects', properties: {} })
    expect(plain.id).toBeUndefined()
  })

  it('a settings record the tree does not list yet is a row too; the vault root’s subfolders are its top folders', () => {
    expect(subfolderRows('/vault', 'Projects', [], NESTED).map((r) => r.path)).toEqual(['/vault/Projects/Deep/.folder.md'])
    expect(subfolderRows('/vault', '', DIRS, NESTED).map((r) => r.folder)).toEqual(['', ''])
  })

  it('the kind marker is the file name, and a folder row’s page is its directory', () => {
    expect(isFolderRow(settings('Projects/Deep'))).toBe(true)
    expect(isFolderRow(rec('/vault/Projects/A.md'))).toBe(false)
    expect(rowPage('/vault/Projects/Deep/.folder.md')).toBe('/vault/Projects/Deep')
    expect(rowPage('/vault/Projects/A.md')).toBe('/vault/Projects/A.md')
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
  const PAGE = '/vault/Areas/Health.md'
  const PROJECTS = '/vault/Projects'
  const SETTINGS_FILE = '/vault/Projects/.folder.md'
  const frontmatterOf = (path: string): Record<string, unknown> => parseFrontmatter(splitFrontmatter(disk.get(path) ?? '').frontmatter).properties

  beforeEach(() => {
    disk.clear()
    // Already a shortcut in Areas, and carrying an entry this app does not understand.
    disk.set(PAGE, `---\nalso_in:\n  - ${AREAS_ID}\n  - Old Folder\ntitle: Health\n---\nBody\n`)
  })

  /** Pick the page for Projects — twice: the second pick must change nothing. */
  const pickTwice = async (): Promise<void> => {
    await addShortcut(PROJECTS, PAGE)
    const [page, folder] = [disk.get(PAGE), disk.get(SETTINGS_FILE)]
    await addShortcut(PROJECTS, PAGE)
    expect(disk.get(PAGE)).toBe(page)
    expect(disk.get(SETTINGS_FILE)).toBe(folder)
  }

  it('a folder whose settings file has an id: that id is appended, every entry already there kept as written', async () => {
    disk.set(SETTINGS_FILE, `---\nid: ${PROJECTS_ID}\n---\n`)
    await pickTwice()
    expect(frontmatterOf(PAGE).also_in).toEqual([AREAS_ID, 'Old Folder', PROJECTS_ID])
    expect(disk.get(PAGE)).toContain('title: Health\n---\nBody\n')
    expect(disk.get(SETTINGS_FILE)).toBe(`---\nid: ${PROJECTS_ID}\n---\n`)
  })

  it('a folder with NO settings file: the file is written holding just a fresh id — the next number, from the door (YAZ-2677 D4) — and that id is the one used', async () => {
    const asked = vi.mocked(api.mintPageId).mock.calls.length
    await pickTwice()
    const { id } = frontmatterOf(SETTINGS_FILE)
    expect(isPageId(id)).toBe(true)
    expect(id).toMatch(/^YAZ-[1-9]\d*$/)
    expect(disk.get(SETTINGS_FILE)).toBe(`---\nid: ${String(id)}\n---\n`)
    expect(frontmatterOf(PAGE).also_in).toEqual([AREAS_ID, 'Old Folder', id])
    // The folder's id is quiet (YAZ-3235 D1): bookkeeping. The page's `also_in` is the user's shortcut: a save of the page.
    const writes = vi.mocked(api.writeFile).mock.calls.map(([req]) => req)
    expect(writes.filter((req) => req.path === SETTINGS_FILE).every((req) => req.quiet === true)).toBe(true)
    expect(writes.filter((req) => req.path === PAGE).every((req) => req.quiet === undefined)).toBe(true)
    // One number, asked for the folder; the second pick found the id and took none.
    expect(vi.mocked(api.mintPageId).mock.calls.slice(asked)).toEqual([[PROJECTS]])
  })

  it('a folder that holds its id costs no number, and a number ID written by hand in another case is used as the index holds it (YAZ-2677 R2)', async () => {
    const asked = vi.mocked(api.mintPageId).mock.calls.length
    disk.set(SETTINGS_FILE, '---\nid: yaz-77\n---\n')
    await pickTwice()
    expect(disk.get(SETTINGS_FILE)).toBe('---\nid: yaz-77\n---\n')
    expect(frontmatterOf(PAGE).also_in).toEqual([AREAS_ID, 'Old Folder', 'YAZ-77'])
    expect(vi.mocked(api.mintPageId).mock.calls).toHaveLength(asked)
  })

  it('an `also_in` entry written by hand in another case names the same folder: no second entry is added, and "Remove shortcut" takes it out (YAZ-2677 R2)', async () => {
    disk.set(SETTINGS_FILE, '---\nid: YAZ-77\n---\n')
    disk.set(PAGE, '---\nalso_in:\n  - yaz-77\n  - Old Folder\n---\nBody\n')
    await addShortcut(PROJECTS, PAGE)
    expect(disk.get(PAGE)).toBe('---\nalso_in:\n  - yaz-77\n  - Old Folder\n---\nBody\n')
    await removeShortcut(PROJECTS, PAGE, [{ ...rec('/vault/Projects/.folder.md'), id: 'YAZ-77' }])
    expect(frontmatterOf(PAGE).also_in).toEqual(['Old Folder'])
  })

  it('an id that reaches the settings file while the door is asked stays: the number taken is a gap, and the id in the file is the one used', async () => {
    vi.mocked(api.mintPageId).mockImplementationOnce(async () => {
      disk.set(SETTINGS_FILE, `---\nid: ${PROJECTS_ID}\n---\n`) // the sweep in the main process was first
      return 'YAZ-500'
    })
    await addShortcut(PROJECTS, PAGE)
    expect(disk.get(SETTINGS_FILE)).toBe(`---\nid: ${PROJECTS_ID}\n---\n`)
    expect(frontmatterOf(PAGE).also_in).toEqual([AREAS_ID, 'Old Folder', PROJECTS_ID])
  })

  it('a vault that does not use IDs after all (the door answers null): the shortcut is refused, and nothing is written', async () => {
    vi.mocked(api.mintPageId).mockResolvedValueOnce(null)
    const page = disk.get(PAGE)
    await expect(addShortcut(PROJECTS, PAGE)).rejects.toThrow('this vault does not use IDs')
    expect(disk.get(PAGE)).toBe(page)
    expect(disk.has(SETTINGS_FILE)).toBe(false)
  })

  it('a settings file with NO id: a fresh one is written into it beside its settings, then used', async () => {
    disk.set(SETTINGS_FILE, '---\nfolder_settings:\n  views:\n    - type: table\n      name: Table\n---\n')
    await pickTwice()
    const { id, folder_settings } = frontmatterOf(SETTINGS_FILE)
    expect(isPageId(id)).toBe(true)
    expect(folder_settings).toEqual({ views: [{ type: 'table', name: 'Table' }] })
    expect(frontmatterOf(PAGE).also_in).toEqual([AREAS_ID, 'Old Folder', id])
  })

  it('a page with no `also_in` gains the key, and a scalar one becomes a list that keeps it', async () => {
    disk.set(SETTINGS_FILE, `---\nid: ${PROJECTS_ID}\n---\n`)
    disk.set(PAGE, 'Body\n')
    await addShortcut(PROJECTS, PAGE)
    expect(disk.get(PAGE)).toBe(`---\nalso_in:\n  - ${PROJECTS_ID}\n---\nBody\n`)
    disk.set(PAGE, `---\nalso_in: ${AREAS_ID}\n---\nBody\n`)
    await addShortcut(PROJECTS, PAGE)
    expect(frontmatterOf(PAGE).also_in).toEqual([AREAS_ID, PROJECTS_ID])
  })

  it('a settings file whose `id` is another tool’s value is one with no id: this app’s is written over it, then used (YAZ-2420 D30)', async () => {
    disk.set(SETTINGS_FILE, '---\nid: my-own-id\n---\n')
    await pickTwice()
    const { id } = frontmatterOf(SETTINGS_FILE)
    expect(isPageId(id)).toBe(true)
    expect(disk.get(SETTINGS_FILE)).toBe(`---\nid: ${String(id)}\n---\n`)
    expect(frontmatterOf(PAGE).also_in).toEqual([AREAS_ID, 'Old Folder', id])
  })
})

describe('removing a shortcut (YAZ-2290 E5)', () => {
  const PAGE = '/vault/Areas/Health.md'

  it('takes the folder’s id out of the page’s `also_in` and leaves every other entry, and byte, alone', async () => {
    disk.set(PAGE, `---\nalso_in:\n  - ${AREAS_ID}\n  - ${PROJECTS_ID}\n  - Old Folder\ntitle: Health\n---\nBody\n`)
    await removeShortcut('/vault/Projects', PAGE, FOLDERS)
    expect(disk.get(PAGE)).toBe(`---\nalso_in:\n  - ${AREAS_ID}\n  - Old Folder\ntitle: Health\n---\nBody\n`)
  })

  it('"Remove shortcut" removes the entries naming the folder OR any folder under it, and never deletes the page', async () => {
    disk.set(PAGE, `---\nalso_in:\n  - ${DEEPER_ID}\n  - ${AREAS_ID}\n  - ${PROJECTS_ID}\n  - ${DEEP_ID}\ntitle: Health\n---\nBody\n`)
    await removeShortcut('/vault/Projects/Deep', PAGE, NESTED)
    expect(disk.get(PAGE)).toBe(`---\nalso_in:\n  - ${AREAS_ID}\n  - ${PROJECTS_ID}\ntitle: Health\n---\nBody\n`)
    await removeShortcut('/vault/Projects', PAGE, NESTED)
    expect(disk.get(PAGE)).toBe(`---\nalso_in:\n  - ${AREAS_ID}\ntitle: Health\n---\nBody\n`)
  })

  it('a folder with no `.folder.md` of its own still removes the entries naming the folders under it', async () => {
    disk.set(PAGE, `---\nalso_in:\n  - ${DEEP_ID}\n  - ${AREAS_ID}\n---\nBody\n`)
    await removeShortcut('/vault/Projects', PAGE, [settings('Projects/Deep', DEEP_ID), settings('Projects-old', AREAS_ID)])
    expect(disk.get(PAGE)).toBe(`---\nalso_in:\n  - ${AREAS_ID}\n---\nBody\n`)
  })

  it('the key goes with its last entry — list or scalar: an emptied list is no list', async () => {
    disk.set(PAGE, `---\nalso_in:\n  - ${PROJECTS_ID}\ntitle: Health\n---\nBody\n`)
    await removeShortcut('/vault/Projects', PAGE, FOLDERS)
    expect(disk.get(PAGE)).toBe('---\ntitle: Health\n---\nBody\n')
    disk.set(PAGE, `---\nalso_in: ${PROJECTS_ID}\n---\nBody\n`)
    await removeShortcut('/vault/Projects', PAGE, FOLDERS)
    expect(disk.get(PAGE)).toBe('---\n---\nBody\n') // the one-key writer's own empty block
  })

  it('a folder with no `.folder.md`, or one that holds no id, names nothing: the page is not written', async () => {
    vi.mocked(api.writeFile).mockClear()
    disk.set(PAGE, `---\nalso_in:\n  - ${PROJECTS_ID}\n---\nBody\n`)
    await removeShortcut('/vault/Projects', PAGE, [])
    await removeShortcut('/vault/Projects', PAGE, [settings('Projects')])
    expect(api.writeFile).not.toHaveBeenCalled()
  })

  it('a page that does not name the folder is not written', async () => {
    vi.mocked(api.writeFile).mockClear()
    disk.set(PAGE, `---\nalso_in:\n  - ${AREAS_ID}\n---\nBody\n`)
    await removeShortcut('/vault/Projects', PAGE, FOLDERS)
    expect(api.writeFile).not.toHaveBeenCalled()
  })
})

/** A page's `in`, written: one block per id, each holding `order`. */
const blocks = (...ids: string[]): string => `in:\n${ids.map((id) => `  ${id}:\n    order: 1\n`).join('')}`

describe('a move never deletes values (YAZ-4713 C9)', () => {
  const PAGE = '/vault/Areas/Health.md'

  it('"Remove shortcut" takes only the `also_in` entry: every field and every block of `in` stays, byte for byte', async () => {
    disk.set(PAGE, `---\nalso_in:\n  - ${DEEP_ID}\ntitle: Health\ndomain: Billing\n${blocks(AREAS_ID, PROJECTS_ID, DEEP_ID, NOBODY_ID)}---\nBody\n`)
    await removeShortcut('/vault/Projects/Deep', PAGE, NESTED)
    expect(disk.get(PAGE)).toBe(`---\ntitle: Health\ndomain: Billing\n${blocks(AREAS_ID, PROJECTS_ID, DEEP_ID, NOBODY_ID)}---\nBody\n`)
  })

  it('the write the removal rides on is refused: nothing is removed', async () => {
    const page = `---\nalso_in:\n  - ${PROJECTS_ID}\n${blocks(PROJECTS_ID)}---\n`
    disk.set(PAGE, page)
    vi.mocked(api.writeFile).mockRejectedValueOnce(new Error('disk full'))
    await expect(removeShortcut('/vault/Projects', PAGE, FOLDERS)).rejects.toThrow('disk full')
    expect(disk.get(PAGE)).toBe(page)
  })
})

describe('checker round 2 (8E): each Undo of a folder page shortcut puts back exactly what was there', () => {
  const PAGE = '/vault/Areas/Health.md'

  it('add to Projects, then its Undo (drop the added id), keeps the shortcut in Projects/Deep', async () => {
    disk.clear()
    disk.set('/vault/Projects/.folder.md', `---\nid: ${PROJECTS_ID}\n---\n`)
    // A shortcut in Projects/Deep already. Projects is not a holder, so the menu offers it.
    disk.set(PAGE, `---\nalso_in:\n  - ${DEEP_ID}\n---\nBody\n`)
    const before = disk.get(PAGE)
    const added = await addShortcut('/vault/Projects', PAGE)
    expect(added).toBe(PROJECTS_ID)
    await setShortcutEntries(PAGE, { drop: [added] })
    expect(disk.get(PAGE)).toBe(before)
  })

  it('an add the page holds already writes nothing and answers null: there is nothing to undo', async () => {
    disk.clear()
    disk.set('/vault/Projects/.folder.md', `---\nid: ${PROJECTS_ID}\n---\n`)
    disk.set(PAGE, `---\nalso_in:\n  - ${PROJECTS_ID}\n---\nBody\n`)
    const before = disk.get(PAGE)
    expect(await addShortcut('/vault/Projects', PAGE)).toBeNull()
    expect(disk.get(PAGE)).toBe(before)
  })

  it('remove from Projects takes Projects and Projects/Deep out; its Undo (restore those) puts both back', async () => {
    disk.clear()
    disk.set(PAGE, `---\nalso_in:\n  - ${AREAS_ID}\n  - ${PROJECTS_ID}\n  - ${DEEP_ID}\n---\nBody\n`)
    const removed = await removeShortcut('/vault/Projects', PAGE, NESTED)
    expect(removed).toEqual([PROJECTS_ID, DEEP_ID])
    expect(alsoIn(parseFrontmatter(splitFrontmatter(disk.get(PAGE)!).frontmatter).properties)).toEqual([AREAS_ID])
    await setShortcutEntries(PAGE, { restore: removed })
    expect(alsoIn(parseFrontmatter(splitFrontmatter(disk.get(PAGE)!).frontmatter).properties)).toEqual([AREAS_ID, PROJECTS_ID, DEEP_ID])
  })
})
