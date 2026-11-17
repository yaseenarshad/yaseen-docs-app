/**
 * How today's daily page is MADE (YAZ-3607 D5, D6, D9), pinned before the rules move to `@shared/pageBirth`
 * (YAZ-4269 D1): the calls to the disk and the path that comes back. `api` mocked like scaffold.test.ts; the rules run
 * over the bridge (`bridgeDisk`), as they did when the renderer made the page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFrontmatter } from '@shared/frontmatter'
import type { CreateFileRequest } from '@shared/types'
import { testDoor } from '../testPageIds'
import { makeDailyPage as birth, type DailyPageSettings } from '@shared/pageBirth'
import { bridgeDisk } from '../views/scaffold'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), createFile: vi.fn(), createDir: vi.fn(), mintPageId: vi.fn() },
}))

import { api, BridgeRequestError } from '../api'

const readFile = vi.mocked(api.readFile)
const createFile = vi.mocked(api.createFile)
const createDir = vi.mocked(api.createDir)
const mintPageId = vi.mocked(api.mintPageId)

const notFound = () => new BridgeRequestError('NOT_FOUND', 'path does not exist')
const alreadyExists = () => new BridgeRequestError('ALREADY_EXISTS', 'path already exists')

const TITLE = '11_03- Tue'
const TEMPLATE = '---\ntags:\n  - daily\n---\nPLAN\n'
const FLAT = { dailyPageFolder: 'daily', dailyPageDayFolder: false }
const DAY = { dailyPageFolder: 'daily', dailyPageDayFolder: true }

/** The template at `at`, and nothing else on disk. */
const templateAt = (at: string) => readFile.mockImplementation(async (path) => (path === at ? { path, content: TEMPLATE, mtime: 1 } as never : Promise.reject(notFound())))

/** The rules over the bridge, as the renderer ran them until the main process made the page (YAZ-4269 D2). */
const makeDailyPage = (vault: string, settings: DailyPageSettings, title: string, ids: boolean) => birth(bridgeDisk, vault, settings, title, ids)

beforeEach(() => {
  vi.resetAllMocks()
  mintPageId.mockImplementation(testDoor())
})

describe('makeDailyPage in a vault with IDs', () => {
  it('flat: the page is `<kebab-title>-<id>.md` in the daily pages folder, from its template, titled', async () => {
    templateAt('/v/daily/.template.md')

    await expect(makeDailyPage('/v', FLAT, TITLE, true)).resolves.toBe('/v/daily/11-03-tue-yaz-1.md')

    expect(createDir).not.toHaveBeenCalled()
    expect(createFile.mock.calls).toEqual([[{ path: '/v/daily/11-03-tue-yaz-1.md', content: buildFrontmatter({ tags: ['daily'], title: TITLE }) + 'PLAN\n', id: 'YAZ-1' }]])
  })

  it('a day folder: made first, titled, in kebab-case; the page inside it takes the daily pages folder’s template', async () => {
    templateAt('/v/daily/.template.md')

    await expect(makeDailyPage('/v', DAY, TITLE, true)).resolves.toBe('/v/daily/11-03-tue/11-03-tue-yaz-1.md')

    expect(createDir.mock.calls).toEqual([[{ path: '/v/daily/11-03-tue', title: TITLE }]])
    expect(readFile.mock.calls).toEqual([['/v/daily/.template.md']])
    expect(createFile.mock.calls[0][0]).toMatchObject({ path: '/v/daily/11-03-tue/11-03-tue-yaz-1.md', id: 'YAZ-1' })
  })

  it('a day folder that is already there is used', async () => {
    templateAt('/v/daily/.template.md')
    createDir.mockRejectedValue(alreadyExists())

    await expect(makeDailyPage('/v', DAY, TITLE, true)).resolves.toBe('/v/daily/11-03-tue/11-03-tue-yaz-1.md')
  })

  it('no template: the page holds only its title', async () => {
    readFile.mockRejectedValue(notFound())

    await makeDailyPage('/v', FLAT, TITLE, true)

    expect((createFile.mock.calls[0][0] as CreateFileRequest).content).toBe(`---\ntitle: ${TITLE}\n---\n`)
  })

  it('the vault folder as the daily pages folder: the page and the template are at the vault’s top', async () => {
    templateAt('/v/.template.md')

    await expect(makeDailyPage('/v', { dailyPageFolder: '', dailyPageDayFolder: false }, TITLE, true)).resolves.toBe('/v/11-03-tue-yaz-1.md')

    expect((createFile.mock.calls[0][0] as CreateFileRequest).content).toBe(buildFrontmatter({ tags: ['daily'], title: TITLE }) + 'PLAN\n')
  })

  it('a create that is refused because the file is there is not swallowed: the name holds a new id, so it is a real failure', async () => {
    readFile.mockRejectedValue(notFound())
    createFile.mockRejectedValue(alreadyExists())

    await expect(makeDailyPage('/v', FLAT, TITLE, true)).rejects.toThrow('path already exists')
  })

  it('a day folder that cannot be made for another reason: the failure propagates, and no page is made', async () => {
    createDir.mockRejectedValue(new BridgeRequestError('FORBIDDEN', 'no'))

    await expect(makeDailyPage('/v', DAY, TITLE, true)).rejects.toThrow('no')
    expect(createFile).not.toHaveBeenCalled()
  })
})

describe('makeDailyPage in a vault without IDs', () => {
  it('flat: the file is named by the title, the template as it is; no id is taken', async () => {
    templateAt('/v/daily/.template.md')

    await expect(makeDailyPage('/v', FLAT, TITLE, false)).resolves.toBe(`/v/daily/${TITLE}.md`)

    expect(mintPageId).not.toHaveBeenCalled()
    expect(createFile.mock.calls).toEqual([[{ path: `/v/daily/${TITLE}.md`, content: TEMPLATE }]])
  })

  it('a day folder is named by the title, with no title written', async () => {
    readFile.mockRejectedValue(notFound())

    await expect(makeDailyPage('/v', DAY, TITLE, false)).resolves.toBe(`/v/daily/${TITLE}/${TITLE}.md`)

    expect(createDir.mock.calls).toEqual([[{ path: `/v/daily/${TITLE}` }]])
    expect(createFile.mock.calls).toEqual([[{ path: `/v/daily/${TITLE}/${TITLE}.md`, content: '' }]])
  })

  it('a page that is already there is today’s page: its path comes back', async () => {
    readFile.mockRejectedValue(notFound())
    createFile.mockRejectedValue(alreadyExists())

    await expect(makeDailyPage('/v', FLAT, TITLE, false)).resolves.toBe(`/v/daily/${TITLE}.md`)
  })
})
