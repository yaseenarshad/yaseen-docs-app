/**
 * A note is born from its folder's template and the seed alone (YAZ-2290 E1/E3), in one
 * atomic content-at-create call (GRO-2202). `api` mocked like writeProperty.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNote, ensureFolder } from './scaffold'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    readFile: vi.fn(),
    createFile: vi.fn(),
    writeFile: vi.fn(),
    createDir: vi.fn(),
  },
}))

import { api, BridgeRequestError } from '../api'

const readFile = vi.mocked(api.readFile)
const createFile = vi.mocked(api.createFile)
const createDir = vi.mocked(api.createDir)

const notFound = () => new BridgeRequestError('NOT_FOUND', 'path does not exist')
const alreadyExists = () => new BridgeRequestError('ALREADY_EXISTS', 'path already exists')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createNote (YAZ-2290 E1/E3)', () => {
  it('no template: the seed alone — no column is stamped — and an empty seed is an empty file', async () => {
    readFile.mockRejectedValue(notFound())

    await createNote('/v/Projects/A.md', { status: '2-Todo' })
    await createNote('/v/Projects/B.md')

    expect(readFile).toHaveBeenCalledWith('/v/Projects/.template.md') // hidden, in the folder itself
    expect(createFile.mock.calls).toEqual([[{ path: '/v/Projects/A.md', content: '---\nstatus: 2-Todo\n---\n' }], [{ path: '/v/Projects/B.md', content: '' }]])
    expect(api.writeFile).not.toHaveBeenCalled() // ONE atomic create, never a follow-up write
  })

  it('the template gives its frontmatter and body; the seed wins a key they share', async () => {
    readFile.mockResolvedValue({ path: '/v/Projects/.template.md', content: '---\nowner: me\nstatus: 1-Backlog\n---\n## Notes\n', mtime: 1, size: 1 })

    await createNote('/v/Projects/A.md', { status: '2-Todo' })

    expect(createFile).toHaveBeenCalledExactlyOnceWith({ path: '/v/Projects/A.md', content: '---\nowner: me\nstatus: 2-Todo\n---\n## Notes\n' })
  })

  it('a read failure other than a missing template, and a create failure, propagate', async () => {
    readFile.mockRejectedValueOnce(new BridgeRequestError('FORBIDDEN', 'permission denied'))
    await expect(createNote('/v/Projects/A.md')).rejects.toThrow('permission denied')
    expect(createFile).not.toHaveBeenCalled()

    readFile.mockRejectedValue(notFound())
    createFile.mockRejectedValue(new Error('parent folder does not exist'))
    await expect(createNote('/v/Projects/A.md')).rejects.toThrow('parent folder does not exist')
  })
})

describe('ensureFolder', () => {
  it('creates each missing level, tolerates existing ones, resolves the absolute dir', async () => {
    createDir.mockRejectedValueOnce(alreadyExists())
    createDir.mockResolvedValue({ path: '' })

    expect(await ensureFolder('/v', 'kpis/growth')).toBe('/v/kpis/growth')
    expect(createDir.mock.calls.map((c) => c[0])).toEqual(['/v/kpis', '/v/kpis/growth'])
  })

  it('other failures propagate', async () => {
    createDir.mockRejectedValue(new BridgeRequestError('FORBIDDEN', 'permission denied'))
    await expect(ensureFolder('/v', 'kpis')).rejects.toThrow('permission denied')
  })
})
