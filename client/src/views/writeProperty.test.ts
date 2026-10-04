/**
 * `writeProperty` (GRO-2141): read → rewrite one key → write with `expectedMtime`,
 * with a single re-read-and-retry on CONFLICT. `api` is mocked so every call is observable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FrontmatterWriteError } from '@shared/frontmatter'
import { settleFileWrites, transformFile, writeProperties, writeProperty } from './writeProperty'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn(), createFile: vi.fn() },
}))

import { BridgeRequestError, api } from '../api'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)
const createFile = vi.mocked(api.createFile)

const PATH = '/vault/Deep Work.md'

const file = (content: string, mtime: number) => ({ path: PATH, content, mtime, size: content.length })
const conflict = (mtime: number) => new BridgeRequestError('CONFLICT', 'file changed on disk', mtime)

beforeEach(() => {
  readFile.mockReset()
  writeFile.mockReset()
  createFile.mockReset()
})

describe('writeProperty', () => {
  it('reads, rewrites one key and writes with the read mtime', async () => {
    readFile.mockResolvedValue(file('---\nstatus: draft\n---\nBody\n', 100))
    writeFile.mockResolvedValue({ path: PATH, mtime: 200, size: 26 })

    await expect(writeProperty(PATH, 'status', 'done')).resolves.toMatchObject({ mtime: 200 })

    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith({
      path: PATH,
      content: '---\nstatus: done\n---\nBody\n',
      expectedMtime: 100,
    })
  })

  it('skips the write when the value is already what is on disk', async () => {
    readFile.mockResolvedValue(file('---\nstatus: draft\n---\nBody\n', 100))

    await expect(writeProperty(PATH, 'status', 'draft')).resolves.toMatchObject({ mtime: 100 })

    expect(writeFile).not.toHaveBeenCalled()
  })

  it('re-reads and retries once on CONFLICT, keeping the concurrent edit', async () => {
    readFile
      .mockResolvedValueOnce(file('---\nstatus: draft\n---\nBody\n', 100))
      .mockResolvedValueOnce(file('---\nstatus: draft\ntags: [new]\n---\nBody\n', 150))
    writeFile.mockRejectedValueOnce(conflict(150)).mockResolvedValueOnce({ path: PATH, mtime: 300, size: 40 })

    await expect(writeProperty(PATH, 'status', 'done')).resolves.toMatchObject({ mtime: 300 })

    expect(readFile).toHaveBeenCalledTimes(2)
    expect(writeFile).toHaveBeenCalledTimes(2)
    expect(writeFile).toHaveBeenLastCalledWith({
      path: PATH,
      content: '---\nstatus: done\ntags: [new]\n---\nBody\n',
      expectedMtime: 150,
    })
  })

  it('rethrows a second CONFLICT', async () => {
    readFile.mockResolvedValue(file('---\nstatus: draft\n---\nBody\n', 100))
    writeFile.mockRejectedValue(conflict(150))

    await expect(writeProperty(PATH, 'status', 'done')).rejects.toBeInstanceOf(BridgeRequestError)

    expect(writeFile).toHaveBeenCalledTimes(2)
  })

  it('rethrows a non-CONFLICT api error without retrying', async () => {
    readFile.mockResolvedValue(file('---\nstatus: draft\n---\nBody\n', 100))
    writeFile.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'disk on fire'))

    await expect(writeProperty(PATH, 'status', 'done')).rejects.toBeInstanceOf(BridgeRequestError)

    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it('propagates FrontmatterWriteError and never writes', async () => {
    readFile.mockResolvedValue(file('---\ntags: [a, b\nstatus: : :\n---\nBody\n', 100))

    await expect(writeProperty(PATH, 'status', 'done')).rejects.toBeInstanceOf(FrontmatterWriteError)

    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('writeProperties', () => {
  it('commits several keys in one guarded whole-file write', async () => {
    readFile.mockResolvedValue(file('---\nproc: Intake\ndept: Finance\n---\nBody\n', 100))
    writeFile.mockResolvedValue({ path: PATH, mtime: 200, size: 38 })

    await expect(
      writeProperties(PATH, [
        { key: 'proc', value: 'Review' },
        { key: 'dept', value: 'Ops' },
      ]),
    ).resolves.toMatchObject({ mtime: 200 })

    expect(writeFile).toHaveBeenCalledExactlyOnceWith({
      path: PATH,
      content: '---\nproc: Review\ndept: Ops\n---\nBody\n',
      expectedMtime: 100,
    })
  })
})

describe("a folder's settings file is created on its first change (YAZ-2290 D1)", () => {
  const SETTINGS = '/vault/Projects/.folder.md'
  const missing = () => new BridgeRequestError('NOT_FOUND', 'path does not exist')
  const settings = (content: string, mtime: number) => ({ path: SETTINGS, content, mtime, size: content.length })

  it('no file: it reads as empty, and the write creates it with the change in it', async () => {
    readFile.mockRejectedValueOnce(missing())
    writeFile.mockResolvedValue({ path: SETTINGS, mtime: 60, size: 20 })

    await expect(writeProperty(SETTINGS, 'folder_page_settings', { views: [] })).resolves.toMatchObject({ mtime: 60 })

    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: SETTINGS, content: '---\nfolder_page_settings:\n  views: []\n---\n', expectedMtime: 0 })
  })

  it('no file and a change that comes to nothing, or throws: nothing is left on disk', async () => {
    readFile.mockRejectedValue(missing())

    await expect(transformFile(SETTINGS, (content) => content)).resolves.toEqual({ mtime: 0, content: '' })
    await expect(transformFile(SETTINGS, () => { throw new Error('refused') })).rejects.toThrow('refused')

    expect(createFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('a second change finds the file', async () => {
    readFile.mockResolvedValue(settings('---\nfolder_page_settings:\n  views: []\n---\n', 60))
    writeFile.mockResolvedValue({ path: SETTINGS, mtime: 70, size: 20 })

    await writeProperty(SETTINGS, 'folder_page_settings', { views: [{ type: 'table', name: 'Table' }] })

    expect(writeFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ expectedMtime: 60 }))
  })

  it('another writer creating it first is a CONFLICT: its file is read and written into', async () => {
    readFile.mockRejectedValueOnce(missing()).mockResolvedValueOnce(settings('---\nfolder_page_settings:\n  defaultView: Board\n---\n', 55))
    writeFile.mockRejectedValueOnce(conflict(55)).mockResolvedValueOnce({ path: SETTINGS, mtime: 60, size: 20 })

    await expect(writeProperty(SETTINGS, 'tags', ['x'])).resolves.toMatchObject({ mtime: 60 })

    expect(writeFile.mock.calls[1][0]).toMatchObject({ expectedMtime: 55 })
    expect(writeFile.mock.calls[1][0].content).toContain('defaultView: Board') // the winner's bytes survive
  })

  it('a missing NOTE is still an error: only the settings file is created by a write', async () => {
    readFile.mockRejectedValue(missing())

    await expect(writeProperty(PATH, 'status', 'done')).rejects.toBeInstanceOf(BridgeRequestError)

    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('transformFile', () => {
  it('recomputes the whole transformation over fresh bytes after one conflict', async () => {
    readFile
      .mockResolvedValueOnce(file('first', 100))
      .mockResolvedValueOnce(file('concurrent', 150))
    writeFile.mockRejectedValueOnce(conflict(150)).mockResolvedValueOnce({ path: PATH, mtime: 300, size: 22 })

    await expect(transformFile(PATH, (content) => `${content}-transformed`)).resolves.toEqual({ mtime: 300, content: 'concurrent-transformed' })

    expect(writeFile).toHaveBeenCalledTimes(2)
    expect(writeFile).toHaveBeenLastCalledWith({
      path: PATH,
      content: 'concurrent-transformed',
      expectedMtime: 150,
    })
  })

  it('skips the retry write when the concurrent bytes already satisfy the transform', async () => {
    readFile
      .mockResolvedValueOnce(file('before', 100))
      .mockResolvedValueOnce(file('after', 150))
    writeFile.mockRejectedValueOnce(conflict(150))

    await expect(transformFile(PATH, (content) => (content === 'before' ? 'after' : content))).resolves.toEqual({ mtime: 150, content: 'after' })

    expect(writeFile).toHaveBeenCalledTimes(1)
  })
})

describe('settleFileWrites (YAZ-2174)', () => {
  it('waits for every transform in flight, including one started while it waits, and never rejects', async () => {
    let releaseRead!: () => void
    readFile.mockImplementationOnce(() => new Promise((r) => (releaseRead = () => r(file('a', 100)))))
    writeFile.mockImplementation(async ({ content }) => {
      if (content === 'x') throw new BridgeRequestError('IO_ERROR', 'disk full')
      return { path: PATH, mtime: 300, size: 1 }
    })
    readFile.mockResolvedValue(file('b', 150))
    const first = transformFile(PATH, () => 'x').catch(() => 'rejected')
    let settled = false
    const settle = settleFileWrites().then(() => (settled = true))
    const second = transformFile(PATH, () => 'y') // a write the first one's caller starts mid-flush

    await new Promise((r) => setTimeout(r, 0))
    expect(settled).toBe(false)
    releaseRead()
    await settle
    expect(await first).toBe('rejected')
    await expect(second).resolves.toEqual({ mtime: 300, content: 'y' })
    expect(writeFile).toHaveBeenCalledTimes(2)
  })

  it('resolves at once when nothing is in flight', async () => {
    await expect(settleFileWrites()).resolves.toBeUndefined()
  })
})
