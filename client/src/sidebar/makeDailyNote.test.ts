/**
 * How today's daily note is MADE (YAZ-3607 D5, D6, D9), pinned before the rules move to `@shared/noteBirth`
 * (YAZ-4269 D1): the calls to the disk and the path that comes back. `api` mocked like scaffold.test.ts; the rules run
 * over the bridge (`bridgeDisk`), as they did when the renderer made the note.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFrontmatter } from '@shared/frontmatter'
import type { CreateFileRequest } from '@shared/types'
import { testDoor } from '../testNoteIds'
import { makeDailyNote as birth, type DailyNoteSettings } from '@shared/noteBirth'
import { bridgeDisk } from '../views/scaffold'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), createFile: vi.fn(), createDir: vi.fn(), mintNoteId: vi.fn() },
}))

import { api, BridgeRequestError } from '../api'

const readFile = vi.mocked(api.readFile)
const createFile = vi.mocked(api.createFile)
const createDir = vi.mocked(api.createDir)
const mintNoteId = vi.mocked(api.mintNoteId)

const notFound = () => new BridgeRequestError('NOT_FOUND', 'path does not exist')
const alreadyExists = () => new BridgeRequestError('ALREADY_EXISTS', 'path already exists')

const TITLE = '11_03- Tue'
const TEMPLATE = '---\ntags:\n  - daily\n---\nPLAN\n'
const FLAT = { dailyNoteFolder: 'daily', dailyNoteDayFolder: false }
const DAY = { dailyNoteFolder: 'daily', dailyNoteDayFolder: true }

/** The template at `at`, and nothing else on disk. */
const templateAt = (at: string) => readFile.mockImplementation(async (path) => (path === at ? { path, content: TEMPLATE, mtime: 1 } as never : Promise.reject(notFound())))

/** The rules over the bridge, as the renderer ran them until the main process made the note (YAZ-4269 D2). */
const makeDailyNote = (vault: string, settings: DailyNoteSettings, title: string, ids: boolean) => birth(bridgeDisk, vault, settings, title, ids)

beforeEach(() => {
  vi.resetAllMocks()
  mintNoteId.mockImplementation(testDoor())
})

describe('makeDailyNote in a vault with IDs', () => {
  it('flat: the note is `<kebab-title>-<id>.md` in the daily notes folder, from its template, titled', async () => {
    templateAt('/v/daily/.template.md')

    await expect(makeDailyNote('/v', FLAT, TITLE, true)).resolves.toBe('/v/daily/11-03-tue-yaz-1.md')

    expect(createDir).not.toHaveBeenCalled()
    expect(createFile.mock.calls).toEqual([[{ path: '/v/daily/11-03-tue-yaz-1.md', content: buildFrontmatter({ tags: ['daily'], title: TITLE }) + 'PLAN\n', id: 'YAZ-1' }]])
  })

  it('a day folder: made first, titled, in kebab-case; the note inside it takes the daily notes folder’s template', async () => {
    templateAt('/v/daily/.template.md')

    await expect(makeDailyNote('/v', DAY, TITLE, true)).resolves.toBe('/v/daily/11-03-tue/11-03-tue-yaz-1.md')

    expect(createDir.mock.calls).toEqual([[{ path: '/v/daily/11-03-tue', title: TITLE }]])
    expect(readFile.mock.calls).toEqual([['/v/daily/.template.md']])
    expect(createFile.mock.calls[0][0]).toMatchObject({ path: '/v/daily/11-03-tue/11-03-tue-yaz-1.md', id: 'YAZ-1' })
  })

  it('a day folder that is already there is used', async () => {
    templateAt('/v/daily/.template.md')
    createDir.mockRejectedValue(alreadyExists())

    await expect(makeDailyNote('/v', DAY, TITLE, true)).resolves.toBe('/v/daily/11-03-tue/11-03-tue-yaz-1.md')
  })

  it('no template: the note holds only its title', async () => {
    readFile.mockRejectedValue(notFound())

    await makeDailyNote('/v', FLAT, TITLE, true)

    expect((createFile.mock.calls[0][0] as CreateFileRequest).content).toBe(`---\ntitle: ${TITLE}\n---\n`)
  })

  it('the vault folder as the daily notes folder: the note and the template are at the vault’s top', async () => {
    templateAt('/v/.template.md')

    await expect(makeDailyNote('/v', { dailyNoteFolder: '', dailyNoteDayFolder: false }, TITLE, true)).resolves.toBe('/v/11-03-tue-yaz-1.md')

    expect((createFile.mock.calls[0][0] as CreateFileRequest).content).toBe(buildFrontmatter({ tags: ['daily'], title: TITLE }) + 'PLAN\n')
  })

  it('a create that is refused because the file is there is not swallowed: the name holds a new id, so it is a real failure', async () => {
    readFile.mockRejectedValue(notFound())
    createFile.mockRejectedValue(alreadyExists())

    await expect(makeDailyNote('/v', FLAT, TITLE, true)).rejects.toThrow('path already exists')
  })

  it('a day folder that cannot be made for another reason: the failure propagates, and no note is made', async () => {
    createDir.mockRejectedValue(new BridgeRequestError('FORBIDDEN', 'no'))

    await expect(makeDailyNote('/v', DAY, TITLE, true)).rejects.toThrow('no')
    expect(createFile).not.toHaveBeenCalled()
  })
})

describe('makeDailyNote in a vault without IDs', () => {
  it('flat: the file is named by the title, the template as it is; no id is taken', async () => {
    templateAt('/v/daily/.template.md')

    await expect(makeDailyNote('/v', FLAT, TITLE, false)).resolves.toBe(`/v/daily/${TITLE}.md`)

    expect(mintNoteId).not.toHaveBeenCalled()
    expect(createFile.mock.calls).toEqual([[{ path: `/v/daily/${TITLE}.md`, content: TEMPLATE }]])
  })

  it('a day folder is named by the title, with no title written', async () => {
    readFile.mockRejectedValue(notFound())

    await expect(makeDailyNote('/v', DAY, TITLE, false)).resolves.toBe(`/v/daily/${TITLE}/${TITLE}.md`)

    expect(createDir.mock.calls).toEqual([[{ path: `/v/daily/${TITLE}` }]])
    expect(createFile.mock.calls).toEqual([[{ path: `/v/daily/${TITLE}/${TITLE}.md`, content: '' }]])
  })

  it('a note that is already there is today’s note: its path comes back', async () => {
    readFile.mockRejectedValue(notFound())
    createFile.mockRejectedValue(alreadyExists())

    await expect(makeDailyNote('/v', FLAT, TITLE, false)).resolves.toBe(`/v/daily/${TITLE}.md`)
  })
})
