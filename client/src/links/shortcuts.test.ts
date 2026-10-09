/**
 * Shortcuts (YAZ-2290 D2/D4): what a folder shows, over an index snapshot. Each case pins ONE rule
 * of the lookup — who lives there, who is there by a shortcut, what is ignored quietly, and the
 * order — on bare records. The write below it
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
      // The door in the main process (YAZ-2677 D4): the vault's next number.
      mintNoteId: (await import('../testNoteIds')).testDoor(),
    },
  }
})

import { alsoIn } from '@shared/alsoIn'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { api } from '../api'
import { addShortcut, dropFolderValuesAfterMove, dropStaleFolderValues, folderRows, foldersById, foldersShowing, isShortcut, removeShortcut, rowsByFolder, valuesLeftBehind, valuesLeftByShortcut, type Move } from './shortcuts'

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
  it('a note directly in the folder is a row; another folder’s note is not', () => {
    const records = [rec('/vault/Other.md'), rec('/vault/Projects/A.md'), rec('/vault/Projects-old/X.md'), rec('/vault/Projects/C.md')]
    expect(pathsIn(records, 'Projects')).toEqual(['/vault/Projects/A.md', '/vault/Projects/C.md'])
  })

  it('a note in a subfolder, at any depth, is a row', () => {
    const records = [rec('/vault/Projects/A.md'), rec('/vault/Projects/Deep/B.md'), rec('/vault/Projects/Deep/Deeper/C.md')]
    expect(pathsIn(records, 'Projects')).toEqual(['/vault/Projects/A.md', '/vault/Projects/Deep/B.md', '/vault/Projects/Deep/Deeper/C.md'])
    expect(pathsIn(records, 'Projects/Deep')).toEqual(['/vault/Projects/Deep/B.md', '/vault/Projects/Deep/Deeper/C.md'])
    expect(pathsIn(records, 'Projects/Deep/Deeper')).toEqual(['/vault/Projects/Deep/Deeper/C.md'])
  })

  it('a folder with no notes of its own but notes in its subfolders shows all of them', () => {
    const records = [rec('/vault/Projects/Deep/B.md'), rec('/vault/Projects/Deep/Deeper/C.md'), rec('/vault/Projects/Other/D.md')]
    expect(pathsIn(records, 'Projects')).toEqual(['/vault/Projects/Deep/B.md', '/vault/Projects/Deep/Deeper/C.md', '/vault/Projects/Other/D.md'])
  })

  it('a subfolder is never a row: every row is a note of the snapshot', () => {
    const records = [rec('/vault/Projects/A.md'), rec('/vault/Projects/Deep/B.md')]
    expect(folderRows(records, NESTED, 'Projects')).toEqual(records)
  })

  it('a shortcut into one of its subfolders is a row in the subfolder AND in every folder above it', () => {
    const records = [rec('/vault/Areas/Health.md', { also_in: [DEEPER_ID] })]
    for (const folder of ['Projects/Deep/Deeper', 'Projects/Deep', 'Projects']) expect(pathsIn(records, folder, NESTED)).toEqual(['/vault/Areas/Health.md'])
  })

  it('a note that would be a row twice is shown once: it lives under the folder and is also a shortcut into it, or into a subfolder of it', () => {
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

  it('the vault root has no "everything" list: its entry is the notes directly in the root, as before', () => {
    const records = [rec('/vault/Projects/A.md'), rec('/vault/Projects/Deep/B.md', { also_in: [AREAS_ID] }), rec('/vault/Top.md')]
    expect(pathsIn(records, '', NESTED)).toEqual(['/vault/Top.md'])
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

  // The ID vault's half is `plus the notes whose also_in holds the folder's id`, above.
  it('in a vault that does not use IDs no row is a shortcut: its index hands out no folder id, so a note\u2019s `also_in` names nothing (YAZ-2523 V5)', () => {
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

describe('the folders that show a note', () => {
  const showing = (record: IndexRecord, folders: readonly IndexRecord[] = NESTED): string[] => foldersShowing(record.folder, record.properties, foldersById(folders))

  it('the folder it lives in, then each folder above it, nearest first — never the root', () => {
    expect(showing(rec('/vault/Projects/Deep/Deeper/C.md'))).toEqual(['Projects/Deep/Deeper', 'Projects/Deep', 'Projects'])
    expect(showing(rec('/vault/Projects/A.md'))).toEqual(['Projects'])
  })

  it('then each folder it is a shortcut in, followed by the folders above that one — each folder once', () => {
    const note = rec('/vault/Areas/Health.md', { also_in: [DEEPER_ID, PROJECTS_ID, AREAS_ID, NOBODY_ID] })
    expect(showing(note)).toEqual(['Areas', 'Projects/Deep/Deeper', 'Projects/Deep', 'Projects'])
  })

  it('a note directly in the vault root is shown by the root alone', () => {
    expect(showing(rec('/vault/Top.md'))).toEqual([''])
  })

  it('agrees with the rows: a folder shows a note exactly when it is one of the folders showing that note', () => {
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
  it('the shortcut mark: a note that is not under the folder being shown is there by a shortcut', () => {
    const health = rec('/vault/Areas/Health.md', { also_in: [PROJECTS_ID] })
    expect(isShortcut(health, 'Projects')).toBe(true)
    expect(isShortcut(health, 'Areas')).toBe(false)
    expect(isShortcut(rec('/vault/Projects-old/X.md'), 'Projects')).toBe(true)
  })

  it('a note from a subfolder, at any depth, is no shortcut', () => {
    expect(isShortcut(rec('/vault/Projects/Deep/B.md'), 'Projects')).toBe(false)
    expect(isShortcut(rec('/vault/Projects/Deep/Deeper/C.md'), 'Projects')).toBe(false)
    expect(isShortcut(rec('/vault/Projects/A.md'), 'Projects/Deep')).toBe(true)
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

  it('a folder with NO settings file: the file is written holding just a fresh id — the next number, from the door (YAZ-2677 D4) — and that id is the one used', async () => {
    const asked = vi.mocked(api.mintNoteId).mock.calls.length
    await pickTwice()
    const { id } = frontmatterOf(SETTINGS_FILE)
    expect(isNoteId(id)).toBe(true)
    expect(id).toMatch(/^YAZ-[1-9]\d*$/)
    expect(disk.get(SETTINGS_FILE)).toBe(`---\nid: ${String(id)}\n---\n`)
    expect(frontmatterOf(NOTE).also_in).toEqual([AREAS_ID, 'Old Folder', id])
    // One number, asked for the folder; the second pick found the id and took none.
    expect(vi.mocked(api.mintNoteId).mock.calls.slice(asked)).toEqual([[PROJECTS]])
  })

  it('a folder that holds its id costs no number, and a number ID written by hand in another case is used as the index holds it (YAZ-2677 R2)', async () => {
    const asked = vi.mocked(api.mintNoteId).mock.calls.length
    disk.set(SETTINGS_FILE, '---\nid: yaz-77\n---\n')
    await pickTwice()
    expect(disk.get(SETTINGS_FILE)).toBe('---\nid: yaz-77\n---\n')
    expect(frontmatterOf(NOTE).also_in).toEqual([AREAS_ID, 'Old Folder', 'YAZ-77'])
    expect(vi.mocked(api.mintNoteId).mock.calls).toHaveLength(asked)
  })

  it('an `also_in` entry written by hand in another case names the same folder: no second entry is added, and "Remove shortcut" takes it out (YAZ-2677 R2)', async () => {
    disk.set(SETTINGS_FILE, '---\nid: YAZ-77\n---\n')
    disk.set(NOTE, '---\nalso_in:\n  - yaz-77\n  - Old Folder\n---\nBody\n')
    await addShortcut(PROJECTS, NOTE)
    expect(disk.get(NOTE)).toBe('---\nalso_in:\n  - yaz-77\n  - Old Folder\n---\nBody\n')
    await removeShortcut(PROJECTS, NOTE, [{ ...rec('/vault/Projects/.folder.md'), id: 'YAZ-77' }], '/vault')
    expect(frontmatterOf(NOTE).also_in).toEqual(['Old Folder'])
  })

  it('an id that reaches the settings file while the door is asked stays: the number taken is a gap, and the id in the file is the one used', async () => {
    vi.mocked(api.mintNoteId).mockImplementationOnce(async () => {
      disk.set(SETTINGS_FILE, `---\nid: ${PROJECTS_ID}\n---\n`) // the sweep in the main process was first
      return 'YAZ-500'
    })
    await addShortcut(PROJECTS, NOTE)
    expect(disk.get(SETTINGS_FILE)).toBe(`---\nid: ${PROJECTS_ID}\n---\n`)
    expect(frontmatterOf(NOTE).also_in).toEqual([AREAS_ID, 'Old Folder', PROJECTS_ID])
  })

  it('a vault that does not use IDs after all (the door answers null): the shortcut is refused, and nothing is written', async () => {
    vi.mocked(api.mintNoteId).mockResolvedValueOnce(null)
    const note = disk.get(NOTE)
    await expect(addShortcut(PROJECTS, NOTE)).rejects.toThrow('this vault does not use IDs')
    expect(disk.get(NOTE)).toBe(note)
    expect(disk.has(SETTINGS_FILE)).toBe(false)
  })

  it('a settings file with NO id: a fresh one is written into it beside its settings, then used', async () => {
    disk.set(SETTINGS_FILE, '---\nfolder_settings:\n  views:\n    - type: table\n      name: Table\n---\n')
    await pickTwice()
    const { id, folder_settings } = frontmatterOf(SETTINGS_FILE)
    expect(isNoteId(id)).toBe(true)
    expect(folder_settings).toEqual({ views: [{ type: 'table', name: 'Table' }] })
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

  it('a settings file whose `id` is another tool’s value is one with no id: this app’s is written over it, then used (YAZ-2420 D30)', async () => {
    disk.set(SETTINGS_FILE, '---\nid: my-own-id\n---\n')
    await pickTwice()
    const { id } = frontmatterOf(SETTINGS_FILE)
    expect(isNoteId(id)).toBe(true)
    expect(disk.get(SETTINGS_FILE)).toBe(`---\nid: ${String(id)}\n---\n`)
    expect(frontmatterOf(NOTE).also_in).toEqual([AREAS_ID, 'Old Folder', id])
  })
})

describe('removing a shortcut (YAZ-2290 E5)', () => {
  const NOTE = '/vault/Areas/Health.md'

  it('takes the folder’s id out of the note’s `also_in` and leaves every other entry, and byte, alone', async () => {
    disk.set(NOTE, `---\nalso_in:\n  - ${AREAS_ID}\n  - ${PROJECTS_ID}\n  - Old Folder\ntitle: Health\n---\nBody\n`)
    await removeShortcut('/vault/Projects', NOTE, FOLDERS, '/vault')
    expect(disk.get(NOTE)).toBe(`---\nalso_in:\n  - ${AREAS_ID}\n  - Old Folder\ntitle: Health\n---\nBody\n`)
  })

  it('"Remove shortcut" removes the entries naming the folder OR any folder under it, and never deletes the note', async () => {
    disk.set(NOTE, `---\nalso_in:\n  - ${DEEPER_ID}\n  - ${AREAS_ID}\n  - ${PROJECTS_ID}\n  - ${DEEP_ID}\ntitle: Health\n---\nBody\n`)
    await removeShortcut('/vault/Projects/Deep', NOTE, NESTED, '/vault')
    expect(disk.get(NOTE)).toBe(`---\nalso_in:\n  - ${AREAS_ID}\n  - ${PROJECTS_ID}\ntitle: Health\n---\nBody\n`)
    await removeShortcut('/vault/Projects', NOTE, NESTED, '/vault')
    expect(disk.get(NOTE)).toBe(`---\nalso_in:\n  - ${AREAS_ID}\ntitle: Health\n---\nBody\n`)
  })

  it('a folder with no `.folder.md` of its own still removes the entries naming the folders under it', async () => {
    disk.set(NOTE, `---\nalso_in:\n  - ${DEEP_ID}\n  - ${AREAS_ID}\n---\nBody\n`)
    await removeShortcut('/vault/Projects', NOTE, [settings('Projects/Deep', DEEP_ID), settings('Projects-old', AREAS_ID)], '/vault')
    expect(disk.get(NOTE)).toBe(`---\nalso_in:\n  - ${AREAS_ID}\n---\nBody\n`)
  })

  it('the key goes with its last entry — list or scalar: an emptied list is no list', async () => {
    disk.set(NOTE, `---\nalso_in:\n  - ${PROJECTS_ID}\ntitle: Health\n---\nBody\n`)
    await removeShortcut('/vault/Projects', NOTE, FOLDERS, '/vault')
    expect(disk.get(NOTE)).toBe('---\ntitle: Health\n---\nBody\n')
    disk.set(NOTE, `---\nalso_in: ${PROJECTS_ID}\n---\nBody\n`)
    await removeShortcut('/vault/Projects', NOTE, FOLDERS, '/vault')
    expect(disk.get(NOTE)).toBe('---\n---\nBody\n') // the one-key writer's own empty block
  })

  it('a folder with no `.folder.md`, or one that holds no id, names nothing: the note is not written', async () => {
    vi.mocked(api.writeFile).mockClear()
    disk.set(NOTE, `---\nalso_in:\n  - ${PROJECTS_ID}\n---\nBody\n`)
    await removeShortcut('/vault/Projects', NOTE, [], '/vault')
    await removeShortcut('/vault/Projects', NOTE, [settings('Projects')], '/vault')
    expect(api.writeFile).not.toHaveBeenCalled()
  })

  it('a note that does not name the folder is not written', async () => {
    vi.mocked(api.writeFile).mockClear()
    disk.set(NOTE, `---\nalso_in:\n  - ${AREAS_ID}\n---\nBody\n`)
    await removeShortcut('/vault/Projects', NOTE, FOLDERS, '/vault')
    expect(api.writeFile).not.toHaveBeenCalled()
  })
})

/** A note's `in`, written: one block per id, each holding `order`. */
const blocks = (...ids: string[]): string => `in:\n${ids.map((id) => `  ${id}:\n    order: 1\n`).join('')}`
const inOf = (path: string): string[] => Object.keys((parseFrontmatter(splitFrontmatter(disk.get(path) ?? '').frontmatter).properties.in as Record<string, unknown> | undefined) ?? {})

describe('a folder’s values leave the note when the note leaves the folder (D20)', () => {
  const GONE_ID = NOBODY_ID // a block for a folder no settings record has: deleted, or not synced yet

  beforeEach(() => {
    disk.clear()
    vi.mocked(api.readFile).mockClear()
    vi.mocked(api.writeFile).mockClear()
  })

  describe('in the bytes being written (`dropStaleFolderValues`)', () => {
    const tidy = (path: string, content: string, folders = NESTED): string => dropStaleFolderValues('/vault', path, folders)(content)

    it('"shows it" is asked of the note’s CURRENT folder and the `also_in` in the bytes: the folder it lives in, the folders above it and the ones it is a shortcut in keep their blocks; every other folder that exists loses its block', () => {
      const note = `---\nalso_in:\n  - ${AREAS_ID}\n${blocks(DEEPER_ID, DEEP_ID, PROJECTS_ID, AREAS_ID)}title: x\n---\nBody\n`
      expect(tidy('/vault/Projects/Deep/Deeper/N.md', note)).toBe(note)
      expect(tidy('/vault/Projects/Deep/N.md', note)).toBe(note.replace(`  ${DEEPER_ID}:\n    order: 1\n`, ''))
      expect(tidy('/vault/N.md', note)).toBe(`---\nalso_in:\n  - ${AREAS_ID}\n${blocks(AREAS_ID)}title: x\n---\nBody\n`)
      // Without the shortcut the last block goes, and `in` with it.
      expect(tidy('/vault/N.md', `---\n${blocks(PROJECTS_ID, AREAS_ID)}title: x\n---\n`)).toBe('---\ntitle: x\n---\n')
    })

    it('the blocks that stay keep their quoting and layout: only the stale block’s lines go', () => {
      const note = `---\nin:\n  ${AREAS_ID}:\n    Status: "Doing" # by Sam\n    on: '2026-09-07'\n  ${PROJECTS_ID}:\n    Status: "Done"\n---\n`
      expect(tidy('/vault/Areas/N.md', note)).toBe(note.replace(`  ${PROJECTS_ID}:\n    Status: "Done"\n`, ''))
    })

    it('a block for a folder the app cannot find is kept, always', () => {
      const note = `---\n${blocks(GONE_ID, PROJECTS_ID)}---\n`
      expect(tidy('/vault/Areas/N.md', note)).toBe(`---\n${blocks(GONE_ID)}---\n`)
      expect(tidy('/vault/Areas/N.md', note, [])).toBe(note) // no folder is known: nothing goes
    })

    it('a folder that still shows the note keeps its block — of two folders still sharing an id, either', () => {
      const twins = [settings('Projects', PROJECTS_ID), settings('Projects copy', PROJECTS_ID)]
      const note = `---\n${blocks(PROJECTS_ID)}---\n`
      expect(tidy('/vault/Projects copy/N.md', note, twins)).toBe(note)
      expect(tidy('/vault/Projects/N.md', note, twins)).toBe(note)
    })

    it('a note outside the vault, and one whose frontmatter will not parse, are left as they are', () => {
      const note = `---\n${blocks(PROJECTS_ID)}---\n`
      expect(tidy('/elsewhere/N.md', note)).toBe(note)
      const broken = `---\nStatus: [unclosed\n${blocks(PROJECTS_ID)}---\n`
      expect(tidy('/vault/Areas/N.md', broken)).toBe(broken)
    })
  })

  describe('a move in the app (`dropFolderValuesAfterMove`)', () => {
    const move = (oldPath: string, newPath: string, kind: 'file' | 'dir', records: IndexRecord[], folders = NESTED): Promise<void> =>
      dropFolderValuesAfterMove({ root: '/vault', oldPath, newPath, kind, records, folders })
    const holding = (path: string, ...ids: string[]): IndexRecord => rec(path, { in: Object.fromEntries(ids.map((id) => [id, { order: 1 }])) })
    const put = (path: string, ...ids: string[]): void => void disk.set(path, `---\n${blocks(...ids)}---\nBody\n`)

    it('a note is moved to another folder in the app: in that move, the block of each folder that no longer shows it is removed; the folders above its new place that showed it before keep theirs; the new folder’s columns start empty', async () => {
      put('/vault/Projects/N.md', DEEPER_ID, DEEP_ID, PROJECTS_ID, GONE_ID)
      await move('/vault/Projects/Deep/Deeper/N.md', '/vault/Projects/N.md', 'file', [holding('/vault/Projects/Deep/Deeper/N.md', DEEPER_ID, DEEP_ID, PROJECTS_ID, GONE_ID)])
      expect(inOf('/vault/Projects/N.md')).toEqual([PROJECTS_ID, GONE_ID])
      expect(api.writeFile).toHaveBeenCalledTimes(1)
      put('/vault/Areas/M.md', PROJECTS_ID)
      await move('/vault/Projects/M.md', '/vault/Areas/M.md', 'file', [holding('/vault/Projects/M.md', PROJECTS_ID)])
      expect(disk.get('/vault/Areas/M.md')).toBe('---\n---\nBody\n') // nothing for Projects, nothing yet for Areas
    })

    it('a note moved out of a folder and back: that folder’s columns are empty for it', async () => {
      put('/vault/Areas/N.md', PROJECTS_ID)
      await move('/vault/Projects/N.md', '/vault/Areas/N.md', 'file', [holding('/vault/Projects/N.md', PROJECTS_ID)])
      const out = disk.get('/vault/Areas/N.md')!
      disk.set('/vault/Projects/N.md', out)
      await move('/vault/Areas/N.md', '/vault/Projects/N.md', 'file', [rec('/vault/Areas/N.md')])
      expect(inOf('/vault/Projects/N.md')).toEqual([])
    })

    it('a note is moved by a folder move in the app: nothing is removed for the folders that move with it — their ids are unchanged — and a folder left behind that no longer shows the note loses its block', async () => {
      // `Projects/Deep` moves under Areas: Deep and Deeper go with their notes, Projects stays behind.
      put('/vault/Areas/Deep/Deeper/N.md', DEEPER_ID, DEEP_ID, PROJECTS_ID)
      put('/vault/Areas/Deep/M.md', DEEP_ID)
      const records = [holding('/vault/Projects/Deep/Deeper/N.md', DEEPER_ID, DEEP_ID, PROJECTS_ID), holding('/vault/Projects/Deep/M.md', DEEP_ID), holding('/vault/Projects/Stay.md', PROJECTS_ID, AREAS_ID)]
      await move('/vault/Projects/Deep', '/vault/Areas/Deep', 'dir', records)
      expect(inOf('/vault/Areas/Deep/Deeper/N.md')).toEqual([DEEPER_ID, DEEP_ID])
      // Only the note that holds a stale block is read or written: decided on the snapshot.
      expect(vi.mocked(api.readFile).mock.calls.map(([path]) => path)).toEqual(['/vault/Areas/Deep/Deeper/N.md'])
      expect(vi.mocked(api.writeFile).mock.calls.map(([req]) => req.path)).toEqual(['/vault/Areas/Deep/Deeper/N.md'])
    })

    it('a pure rename, or a move under the same folders above, writes NOTHING — and reads nothing', async () => {
      const records = [holding('/vault/Projects/Deep/Deeper/N.md', DEEPER_ID, DEEP_ID, PROJECTS_ID), holding('/vault/Projects/Deep/M.md', DEEP_ID, PROJECTS_ID)]
      await move('/vault/Projects/Deep', '/vault/Projects/Shallow', 'dir', records) // a folder renamed
      await move('/vault/Projects/Deep/Deeper', '/vault/Projects/Deep/Other', 'dir', records)
      await move('/vault/Projects', '/vault/Work', 'dir', records)
      await move('/vault/Projects/Deep/M.md', '/vault/Projects/Deep/Renamed.md', 'file', records) // a note renamed
      expect(api.readFile).not.toHaveBeenCalled()
      expect(api.writeFile).not.toHaveBeenCalled()
    })

    it('a note that cannot be written keeps its blocks, and the move goes on to the next note', async () => {
      put('/vault/Areas/Deep/B.md', PROJECTS_ID) // `A.md` is not on disk at its new path
      await move('/vault/Projects/Deep', '/vault/Areas/Deep', 'dir', [holding('/vault/Projects/Deep/A.md', PROJECTS_ID), holding('/vault/Projects/Deep/B.md', PROJECTS_ID)])
      expect(inOf('/vault/Areas/Deep/B.md')).toEqual([])
    })
  })

  describe('"Remove shortcut"', () => {
    const NOTE = '/vault/Areas/Health.md'

    it('a shortcut is removed in the app: in the same write that removes the `also_in` entry, the blocks of the folders that no longer show the note are removed', async () => {
      disk.set(NOTE, `---\nalso_in:\n  - ${DEEP_ID}\ntitle: Health\n${blocks(AREAS_ID, PROJECTS_ID, DEEP_ID, GONE_ID)}---\nBody\n`)
      await removeShortcut('/vault/Projects/Deep', NOTE, NESTED, '/vault')
      // The shortcut in Deep showed it in Projects too: both go. Its own folder's block and the unknown one stay.
      expect(disk.get(NOTE)).toBe(`---\ntitle: Health\n${blocks(AREAS_ID, GONE_ID)}---\nBody\n`)
      expect(api.writeFile).toHaveBeenCalledTimes(1)
    })

    it('a folder that still shows the note keeps its block: another shortcut under the same folder above', async () => {
      disk.set(NOTE, `---\nalso_in:\n  - ${DEEP_ID}\n  - ${PROJECTS_ID}\n${blocks(PROJECTS_ID, DEEP_ID)}---\n`)
      await removeShortcut('/vault/Projects/Deep', NOTE, NESTED, '/vault')
      expect(disk.get(NOTE)).toBe(`---\nalso_in:\n  - ${PROJECTS_ID}\n${blocks(PROJECTS_ID)}---\n`)
    })

    it('the write the removal rides on is refused: nothing is removed', async () => {
      const note = `---\nalso_in:\n  - ${PROJECTS_ID}\n${blocks(PROJECTS_ID)}---\n`
      disk.set(NOTE, note)
      vi.mocked(api.writeFile).mockRejectedValueOnce(new Error('disk full'))
      await expect(removeShortcut('/vault/Projects', NOTE, FOLDERS, '/vault')).rejects.toThrow('disk full')
      expect(disk.get(NOTE)).toBe(note)
    })

    it('a note that does not name the folder is not written, whatever blocks it holds', async () => {
      disk.set(NOTE, `---\n${blocks(PROJECTS_ID)}---\n`)
      await removeShortcut('/vault/Projects', NOTE, FOLDERS, '/vault')
      expect(api.writeFile).not.toHaveBeenCalled()
    })
  })
})

/**
 * The app asks before a move that clears values (D21). What the sheet says is answered here, from
 * a snapshot, by D20's own rule: the notes that would lose a block, and the folders — as their
 * directories — whose values would go.
 */
describe('what a move would clear, from a snapshot (D21)', () => {
  const holding = (path: string, ...ids: string[]): IndexRecord => rec(path, ids.length === 0 ? {} : { in: Object.fromEntries(ids.map((id) => [id, { order: 1 }])) })
  const file = (oldPath: string, newPath: string): Move => ({ oldPath, newPath, kind: 'file' })
  const dir = (oldPath: string, newPath: string): Move => ({ oldPath, newPath, kind: 'dir' })
  const left = (moves: Move[], records: IndexRecord[], folders = NESTED) => valuesLeftBehind({ root: '/vault', moves, records, folders })
  const NOTHING = { notes: 0, folders: [] }

  beforeEach(() => {
    disk.clear()
    vi.mocked(api.readFile).mockClear()
  })

  it('a note is moved in the app to a place where a folder that shows it now will not show it, and the note holds values for that folder: one note, and those folders', () => {
    const records = [holding('/vault/Projects/Deep/N.md', DEEP_ID, PROJECTS_ID, AREAS_ID)]
    // Deep stops showing it; Projects, above its new place, still does; Areas never did, and its block goes too (D20).
    expect(left([file('/vault/Projects/Deep/N.md', '/vault/Projects/N.md')], records)).toEqual({ notes: 1, folders: ['/vault/Projects/Deep', '/vault/Areas'] })
  })

  it('a move that clears nothing: the same folders show the note before and after; or the note holds no values for the folders it leaves; or its only such block is for a folder the app cannot find', () => {
    expect(left([file('/vault/Projects/Deep/N.md', '/vault/Projects/Deep/Deeper/N.md')], [holding('/vault/Projects/Deep/N.md', DEEP_ID, PROJECTS_ID)])).toEqual(NOTHING)
    expect(left([file('/vault/Projects/N.md', '/vault/Areas/N.md')], [rec('/vault/Projects/N.md', { also_in: [PROJECTS_ID], in: { [PROJECTS_ID]: { order: 1 } } })])).toEqual(NOTHING)
    expect(left([file('/vault/Projects/N.md', '/vault/Areas/N.md')], [holding('/vault/Projects/N.md')])).toEqual(NOTHING)
    expect(left([file('/vault/Projects/N.md', '/vault/Areas/N.md')], [holding('/vault/Projects/N.md', NOBODY_ID)])).toEqual(NOTHING)
  })

  // The ID vault's half is the test above, and `in the bytes being written`.
  it('in a vault that does not use IDs no block is ever stale: its index hands out no folder id, so a move would clear nothing, clears nothing, and a write drops nothing (YAZ-2523 V13)', async () => {
    const plain = NESTED.map(({ id: _id, ...folder }) => folder)
    const records = [holding('/vault/Projects/Deep/N.md', DEEP_ID, PROJECTS_ID, AREAS_ID)]
    const note = `---\n${blocks(DEEP_ID, PROJECTS_ID, AREAS_ID)}---\nBody\n`
    const moves = [file('/vault/Projects/Deep/N.md', '/vault/Areas/N.md'), dir('/vault/Projects/Deep', '/vault/Deep')]
    expect(left(moves, records, plain)).toEqual(NOTHING)
    for (const move of moves) await dropFolderValuesAfterMove({ root: '/vault', ...move, records, folders: plain })
    expect(api.readFile).not.toHaveBeenCalled()
    expect(dropStaleFolderValues('/vault', '/vault/Areas/N.md', plain)(note)).toBe(note)
  })

  it('a folder is moved and notes under it would lose values: the notes are counted, and the folders that move with them are not named', () => {
    const records = [holding('/vault/Projects/Deep/Deeper/N.md', DEEPER_ID, DEEP_ID, PROJECTS_ID), holding('/vault/Projects/Deep/M.md', DEEP_ID), holding('/vault/Projects/Deep/K.md', PROJECTS_ID), holding('/vault/Projects/Stay.md', PROJECTS_ID, AREAS_ID)]
    expect(left([dir('/vault/Projects/Deep', '/vault/Areas/Deep')], records)).toEqual({ notes: 2, folders: ['/vault/Projects'] })
    expect(left([dir('/vault/Projects/Deep', '/vault/Projects/Shallow')], records)).toEqual(NOTHING) // a folder renamed
  })

  it('Cut, then Paste into a folder, several items: ONE answer for all of them — each note once, each move judged as D20 judges it', () => {
    const records = [holding('/vault/Projects/Deep/N.md', DEEP_ID), holding('/vault/Projects/M.md', PROJECTS_ID), holding('/vault/Projects/Plain.md')]
    const moves = [file('/vault/Projects/Deep/N.md', '/vault/Areas/N.md'), file('/vault/Projects/M.md', '/vault/Areas/M.md'), file('/vault/Projects/Plain.md', '/vault/Areas/Plain.md')]
    expect(left(moves, records)).toEqual({ notes: 2, folders: ['/vault/Projects/Deep', '/vault/Projects'] })
    expect(left([], records)).toEqual(NOTHING)
  })

  it('the folders named: nearest to the note first, whatever the order of its blocks — the folder it lives in, the folders above it, then the ones it is a shortcut in; across several notes the union, in the order first met', () => {
    const near = rec('/vault/Projects/Deep/Deeper/N.md', { also_in: [AREAS_ID], in: Object.fromEntries([AREAS_ID, PROJECTS_ID, DEEPER_ID, DEEP_ID].map((id) => [id, { order: 1 }])) })
    expect(left([file(near.path, '/vault/N.md')], [near]).folders).toEqual(['/vault/Projects/Deep/Deeper', '/vault/Projects/Deep', '/vault/Projects'])
    const records = [holding('/vault/Projects/A.md', PROJECTS_ID), holding('/vault/Projects/Deep/B.md', PROJECTS_ID, DEEP_ID)]
    expect(left([dir('/vault/Projects', '/vault/Areas/Projects')], records)).toEqual(NOTHING) // Projects still shows both
    expect(left([file('/vault/Projects/A.md', '/vault/Areas/A.md'), file('/vault/Projects/Deep/B.md', '/vault/Areas/B.md')], records).folders).toEqual(['/vault/Projects', '/vault/Projects/Deep'])
  })

  it('a move out of the vault’s top level: the root’s own folder is named by the vault’s directory', () => {
    const folders = [...FOLDERS, { ...rec('/vault/.folder.md'), id: DEEP_ID }]
    expect(left([file('/vault/N.md', '/vault/Areas/N.md')], [holding('/vault/N.md', DEEP_ID)], folders)).toEqual({ notes: 1, folders: ['/vault'] })
  })

  it('"Remove shortcut", and the note holds values for a folder that will no longer show it: the folders its shortcut alone made show it', () => {
    const note = rec('/vault/Areas/Health.md', { also_in: [DEEP_ID], in: Object.fromEntries([AREAS_ID, PROJECTS_ID, DEEP_ID, NOBODY_ID].map((id) => [id, { order: 1 }])) })
    expect(valuesLeftByShortcut('/vault/Projects/Deep', note.path, [note], NESTED)).toEqual({ notes: 1, folders: ['/vault/Projects/Deep', '/vault/Projects'] })
    // Removed from the folder above: the entry naming the folder under it goes with it.
    expect(valuesLeftByShortcut('/vault/Projects', note.path, [note], NESTED)).toEqual({ notes: 1, folders: ['/vault/Projects/Deep', '/vault/Projects'] })
  })

  it('"Remove shortcut" with no such values: nothing — no block, a block only for a folder that still shows it, or a note the snapshot does not hold', () => {
    const plain = rec('/vault/Areas/Health.md', { also_in: [PROJECTS_ID] })
    expect(valuesLeftByShortcut('/vault/Projects', plain.path, [plain], NESTED)).toEqual(NOTHING)
    const twice = rec('/vault/Areas/Health.md', { also_in: [DEEP_ID, PROJECTS_ID], in: { [PROJECTS_ID]: { order: 1 }, [AREAS_ID]: { order: 1 } } })
    expect(valuesLeftByShortcut('/vault/Projects/Deep', twice.path, [twice], NESTED)).toEqual(NOTHING)
    expect(valuesLeftByShortcut('/vault/Projects', '/vault/Areas/Other.md', [twice], NESTED)).toEqual(NOTHING)
  })

  it('the index is behind: the answer is the snapshot’s alone and reads nothing — and it counts exactly the notes D20 then reads', async () => {
    const records = [holding('/vault/Projects/Deep/Deeper/N.md', DEEPER_ID, DEEP_ID, PROJECTS_ID), holding('/vault/Projects/Deep/M.md', DEEP_ID), holding('/vault/Projects/Deep/K.md', PROJECTS_ID), holding('/vault/Projects/Stay.md', PROJECTS_ID)]
    expect(left([file('/vault/Projects/Deep/M.md', '/vault/Areas/M.md')], [])).toEqual(NOTHING) // not in the snapshot yet
    for (const move of [dir('/vault/Projects/Deep', '/vault/Areas/Deep'), dir('/vault/Projects/Deep', '/vault/Projects/Other'), file('/vault/Projects/Deep/M.md', '/vault/Projects/M.md'), file('/vault/Projects/Stay.md', '/vault/Stay.md')]) {
      const asked = left([move], records).notes
      expect(api.readFile).not.toHaveBeenCalled()
      await dropFolderValuesAfterMove({ root: '/vault', ...move, records, folders: NESTED })
      expect(vi.mocked(api.readFile).mock.calls).toHaveLength(asked)
      vi.mocked(api.readFile).mockClear()
    }
  })
})
