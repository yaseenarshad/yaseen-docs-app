/**
 * A note is born from its folder's template and what the seed makes of it (YAZ-2290 E1/E3), in
 * one atomic content-at-create call (GRO-2202). `api` mocked like writeProperty.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseFrontmatter } from '@shared/frontmatter'
import { isNoteId } from '@shared/noteId'
import type { IndexRecord } from '@shared/types'
import { createNote, ensureFolder, folderPath } from './scaffold'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    readFile: vi.fn(),
    createFile: vi.fn(),
    writeFile: vi.fn(),
    createDir: vi.fn(),
    index: vi.fn(),
  },
}))

import { api, BridgeRequestError } from '../api'

const readFile = vi.mocked(api.readFile)
const createFile = vi.mocked(api.createFile)
const createDir = vi.mocked(api.createDir)

const notFound = () => new BridgeRequestError('NOT_FOUND', 'path does not exist')
const alreadyExists = () => new BridgeRequestError('ALREADY_EXISTS', 'path already exists')

/** The index's folders, by their settings records. */
const held = (...folders: Array<[folder: string, title: string]>): IndexRecord[] =>
  folders.map(([folder, title]) => ({ path: `/v/${folder}/.folder.md`, name: '.folder.md', basename: '.folder', title, folder, ext: 'md', size: 0, ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [] }))

beforeEach(() => {
  vi.clearAllMocks()
})

const ID = 'k3m9x2pq7abc'

describe('createNote (YAZ-2290 E1/E3)', () => {
  it('B: a note titled `UP-001 - Abdul Rehman R` is `up-001-abdul-rehman-r-<id>.md`, born with that id and its `title`; its path is what comes back (YAZ-2420 D20)', async () => {
    readFile.mockRejectedValue(notFound())

    await expect(createNote('/v/Projects', 'UP-001 - Abdul Rehman R', true, undefined, ID)).resolves.toBe(`/v/Projects/up-001-abdul-rehman-r-${ID}.md`)

    expect(createFile.mock.calls).toEqual([[{ path: `/v/Projects/up-001-abdul-rehman-r-${ID}.md`, content: '---\ntitle: UP-001 - Abdul Rehman R\n---\n', id: ID }]])
  })

  it('B: with no id handed in, one is made here and is the id in the name; two notes of one title are two files (YAZ-2420 D20)', async () => {
    readFile.mockRejectedValue(notFound())

    const [a, b] = [await createNote('/v/Projects', 'Untitled', true), await createNote('/v/Projects', 'Untitled', true)]

    const ids = createFile.mock.calls.map((c) => (c[0] as { id: string }).id)
    expect(ids.every(isNoteId)).toBe(true)
    expect([a, b]).toEqual(ids.map((id) => `/v/Projects/untitled-${id}.md`))
    expect(a).not.toBe(b)
  })

  it('B: a title is free text, `/`, `:`, `?` and quotes included; one with no letter or digit is named by the id alone (YAZ-2420 D20)', async () => {
    readFile.mockRejectedValue(notFound())
    const title = 'Q3/Q4: "what" now?'

    await expect(createNote('/v', title, true, undefined, ID)).resolves.toBe(`/v/q3-q4-what-now-${ID}.md`)
    await expect(createNote('/v', '—', true, undefined, ID)).resolves.toBe(`/v/${ID}.md`)

    expect(createFile.mock.calls.map((c) => parseFrontmatter((c[0] as { content: string }).content).properties)).toEqual([{ title }, { title: '—' }])
  })

  it('no template: the seed and the title alone — no column is stamped', async () => {
    readFile.mockRejectedValue(notFound())

    await createNote('/v/Projects', 'A', true, (template) => ({ ...template, status: '2-Todo' }), ID)

    expect(readFile).toHaveBeenCalledWith('/v/Projects/.template.md') // hidden, in the folder itself
    expect(createFile.mock.calls).toEqual([[{ path: `/v/Projects/a-${ID}.md`, content: '---\nstatus: 2-Todo\ntitle: A\n---\n', id: ID }]])
    expect(api.writeFile).not.toHaveBeenCalled() // ONE atomic create, never a follow-up write
  })

  it('the template gives its frontmatter and body; the seed is handed its properties and what it returns is the note’s', async () => {
    readFile.mockResolvedValue({ path: '/v/Projects/.template.md', content: '---\nowner: me\nstatus: 1-Backlog\n---\n## Notes\n', mtime: 1, size: 1 })

    await createNote('/v/Projects', 'A', true, (template) => ({ ...template, status: '2-Todo' }), ID)
    await createNote('/v/Projects', 'B', true, undefined, ID)

    expect(createFile.mock.calls.map((c) => (c[0] as { content: string }).content)).toEqual([
      '---\nowner: me\nstatus: 2-Todo\ntitle: A\n---\n## Notes\n',
      '---\nowner: me\nstatus: 1-Backlog\ntitle: B\n---\n## Notes\n', // no seed: the template as written
    ])
  })

  it('B: in a folder with a `.template.md`, the template’s properties come first and the typed title replaces its `title` (YAZ-2420 D20)', async () => {
    readFile.mockResolvedValue({ path: '/v/Projects/.template.md', content: '---\ntitle: Template\nstatus: 1-Backlog\n---\n', mtime: 1, size: 1 })

    await createNote('/v/Projects', 'Typed', true, (template) => ({ ...template, title: 'Seeded' }), ID)

    expect(createFile.mock.calls).toEqual([[{ path: `/v/Projects/typed-${ID}.md`, content: '---\ntitle: Typed\nstatus: 1-Backlog\n---\n', id: ID }]])
  })

  it('a read failure other than a missing template, and a create failure, propagate', async () => {
    readFile.mockRejectedValueOnce(new BridgeRequestError('FORBIDDEN', 'permission denied'))
    await expect(createNote('/v/Projects', 'A', true)).rejects.toThrow('permission denied')
    expect(createFile).not.toHaveBeenCalled()

    readFile.mockRejectedValue(notFound())
    createFile.mockRejectedValue(new Error('parent folder does not exist'))
    await expect(createNote('/v/Projects', 'A', true)).rejects.toThrow('parent folder does not exist')
  })
})

// The ID vault's half of each row is `createNote (YAZ-2290 E1/E3)`, above.
describe('createNote in a vault that does not use IDs (YAZ-2523 V3)', () => {
  beforeEach(() => {
    createFile.mockResolvedValue({ path: '', mtime: 1, size: 0 })
  })

  it('a note named `Meeting notes` is `Meeting notes.md`, empty: no id is made, and no `title` or `id` is sent', async () => {
    readFile.mockRejectedValue(notFound())

    await expect(createNote('/v/Projects', 'Meeting notes', false)).resolves.toBe('/v/Projects/Meeting notes.md')

    expect(createFile.mock.calls).toEqual([[{ path: '/v/Projects/Meeting notes.md', content: '' }]])
  })

  it('a name typed with its `.md` is that file, not `Name.md.md`', async () => {
    readFile.mockRejectedValue(notFound())

    await expect(createNote('/v', 'README.md', false)).resolves.toBe('/v/README.md')
  })

  it('the folder\u2019s `.template.md` is the note as it is, comments and its own `title` and `id` lines included', async () => {
    const template = '---\n# who owns it\nowner: me\ntitle: Template\nid: k3m9x2pq7abc\n---\n## Notes\n'
    readFile.mockResolvedValue({ path: '/v/Projects/.template.md', content: template, mtime: 1, size: 1 })

    await createNote('/v/Projects', 'A', false)

    expect(createFile.mock.calls).toEqual([[{ path: '/v/Projects/A.md', content: template }]])
  })

  it('a seed is applied to the template\u2019s properties, and no `title` is added to what it returns', async () => {
    readFile.mockResolvedValueOnce({ path: '/v/Projects/.template.md', content: '---\nowner: me\nstatus: 1-Backlog\n---\n## Notes\n', mtime: 1, size: 1 })
    readFile.mockRejectedValue(notFound())

    await createNote('/v/Projects', 'A', false, (template) => ({ ...template, status: '2-Todo' }))
    await createNote('/v/Projects', 'B', false, (template) => template)

    expect(createFile.mock.calls).toEqual([
      [{ path: '/v/Projects/A.md', content: '---\nowner: me\nstatus: 2-Todo\n---\n## Notes\n' }],
      [{ path: '/v/Projects/B.md', content: '' }],
    ])
  })

  it('a name a file cannot hold is refused with the reason, before anything is read or made', async () => {
    await expect(createNote('/v', 'Q3/Q4', false)).rejects.toThrow('Name cannot contain "/"')
    await expect(createNote('/v', '.hidden', false)).rejects.toThrow('Names starting with "." are hidden')
    expect(readFile).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
  })

  it('a name that is taken is refused as the bridge refuses it', async () => {
    readFile.mockRejectedValue(notFound())
    createFile.mockRejectedValue(alreadyExists())
    await expect(createNote('/v', 'Taken', false)).rejects.toThrow('path already exists')
  })
})

describe('ensureFolder', () => {
  it('creates each missing level, tolerates existing ones, resolves the absolute dir', async () => {
    createDir.mockRejectedValueOnce(alreadyExists())
    createDir.mockResolvedValue({ path: '' })

    expect(await ensureFolder('/v', 'kpis/growth')).toBe('/v/kpis/growth')
    expect(createDir.mock.calls.map((c) => c[0])).toEqual([{ path: '/v/kpis' }, { path: '/v/kpis/growth' }])
  })

  it('C: titled levels are each made as a folder is in the app — a kebab-case directory holding its title — and the directory made is what resolves (YAZ-2420 D6)', async () => {
    createDir.mockRejectedValueOnce(alreadyExists())
    createDir.mockResolvedValue({ path: '' })

    expect(await ensureFolder('/v', 'Upwork 2026/10_04- Standup', [])).toBe('/v/upwork-2026/10-04-standup')
    expect(createDir.mock.calls.map((c) => c[0])).toEqual([
      { path: '/v/upwork-2026', title: 'Upwork 2026' },
      { path: '/v/upwork-2026/10-04-standup', title: '10_04- Standup' },
    ])
  })

  it('a titled level that names a folder already there — by its title, else by its directory name, in the folder reached so far — is that folder; only a level that names none is made (YAZ-2478)', async () => {
    createDir.mockResolvedValue({ path: '' })

    expect(await ensureFolder('/v', 'Upwork 2026/standup/Day One', held(['upwork', 'Upwork 2026'], ['upwork/Standup', 'Standup'], ['Standup', 'Standup']))).toBe('/v/upwork/Standup/day-one')
    expect(api.index).not.toHaveBeenCalled()
    expect(createDir.mock.calls.map((c) => c[0])).toEqual([{ path: '/v/upwork/Standup/day-one', title: 'Day One' }])
  })

  it('C: a titled level with no letter or digit is refused, and nothing is made (YAZ-2420 D25)', async () => {
    await expect(ensureFolder('/v', '—', [])).rejects.toThrow('A folder name needs a letter or a digit')
    expect(createDir).not.toHaveBeenCalled()
  })

  it('other failures propagate', async () => {
    createDir.mockRejectedValue(new BridgeRequestError('FORBIDDEN', 'permission denied'))
    await expect(ensureFolder('/v', 'kpis')).rejects.toThrow('permission denied')
  })
})

describe('folderPath (YAZ-2420 D6)', () => {
  it('C: a folder titled `Upwork 2026` stands at `upwork-2026`; a dated one, `10_04- Standup`, at `10-04-standup`', () => {
    expect(folderPath('/v', 'Upwork 2026', true)).toBe('/v/upwork-2026')
    expect(folderPath('/v/sub', '10_04- Standup', true)).toBe('/v/sub/10-04-standup')
  })

  it('in a vault that does not use IDs a folder named `Q3 Plans` stands at `Q3 Plans`; a name a folder cannot hold is refused (YAZ-2523 V3)', () => {
    expect(folderPath('/v', 'Q3 Plans', false)).toBe('/v/Q3 Plans')
    expect(folderPath('/v/sub', '10_04- Standup', false)).toBe('/v/sub/10_04- Standup')
    expect(() => folderPath('/v', '.git', false)).toThrow('Names starting with "." are hidden')
    expect(() => folderPath('/v', 'a/b', false)).toThrow('Name cannot contain "/"')
  })
})
