/**
 * `writeProperty` (GRO-2141): read → rewrite one key → write with `expectedMtime`,
 * with a single re-read-and-retry on CONFLICT. `api` is mocked so every call is observable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FrontmatterWriteError } from '@shared/frontmatter'
import { settleFileWrites, transformFile, writeProperties, writeProperty, writeRouted } from './writeProperty'

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

describe('transformFile quiet (YAZ-3235 D1)', () => {
  it('a quiet tidy-up asks the door not to log it; a plain one sends no `quiet`', async () => {
    readFile.mockResolvedValue(file('a\n', 100))
    writeFile.mockResolvedValue({ path: PATH, mtime: 200, size: 2 })
    await transformFile(PATH, () => 'b\n', true)
    expect(writeFile).toHaveBeenLastCalledWith({ path: PATH, content: 'b\n', expectedMtime: 100, quiet: true })
    await transformFile(PATH, () => 'c\n')
    expect(writeFile).toHaveBeenLastCalledWith({ path: PATH, content: 'c\n', expectedMtime: 100 })
  })
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

    await expect(writeProperty(SETTINGS, 'folder_settings', { views: [] })).resolves.toMatchObject({ mtime: 60 })

    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: SETTINGS, content: '---\nfolder_settings:\n  views: []\n---\n', expectedMtime: 0 })
  })

  it('no file and a change that comes to nothing, or throws: nothing is left on disk', async () => {
    readFile.mockRejectedValue(missing())

    await expect(transformFile(SETTINGS, (content) => content)).resolves.toEqual({ mtime: 0, content: '' })
    await expect(transformFile(SETTINGS, () => { throw new Error('refused') })).rejects.toThrow('refused')

    expect(createFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('a second change finds the file', async () => {
    readFile.mockResolvedValue(settings('---\nfolder_settings:\n  views: []\n---\n', 60))
    writeFile.mockResolvedValue({ path: SETTINGS, mtime: 70, size: 20 })

    await writeProperty(SETTINGS, 'folder_settings', { views: [{ type: 'table', name: 'Table' }] })

    expect(writeFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ expectedMtime: 60 }))
  })

  it('another writer creating it first is a CONFLICT: its file is read and written into', async () => {
    readFile.mockRejectedValueOnce(missing()).mockResolvedValueOnce(settings('---\nfolder_settings:\n  defaultView: Board\n---\n', 55))
    writeFile.mockRejectedValueOnce(conflict(55)).mockResolvedValueOnce({ path: SETTINGS, mtime: 60, size: 20 })

    await expect(writeProperty(SETTINGS, 'tags', ['x'])).resolves.toMatchObject({ mtime: 60 })

    expect(writeFile.mock.calls[1][0]).toMatchObject({ expectedMtime: 55 })
    expect(writeFile.mock.calls[1][0].content).toContain('defaultView: Board') // the winner's bytes survive
  })

  it('a missing PAGE is still an error: only the settings file is created by a write', async () => {
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
    const settle = settleFileWrites().then((landed) => ((settled = true), landed))
    const second = transformFile(PATH, () => 'y') // a write the first one's caller starts mid-flush

    await new Promise((r) => setTimeout(r, 0))
    expect(settled).toBe(false)
    releaseRead()
    expect(await settle).toBe(false) // it answers that a write it waited for failed (YAZ-3737 D2)
    expect(await first).toBe('rejected')
    await expect(second).resolves.toEqual({ mtime: 300, content: 'y' })
    expect(writeFile).toHaveBeenCalledTimes(2)
  })

  it('resolves at once when nothing is in flight', async () => {
    await expect(settleFileWrites()).resolves.toBe(true)
  })
})

describe('writeRouted: one key, capitals ignored (YAZ-4769)', () => {
  const written = () => (writeFile.mock.calls[0][0] as { content: string }).content

  beforeEach(() => writeFile.mockResolvedValue({ path: PATH, mtime: 200, size: 1 }))

  it('a write under `Dessert Column` takes the page’s `dessert column` in the same write: renamed in place, its comment kept', async () => {
    readFile.mockResolvedValue(file('---\nstatus: draft\n# the kind\ndessert column: Pie\ntags: []\n---\nBody\n', 100))
    await writeRouted(PATH, [{ key: 'Dessert Column', value: 'Cake' }], new Set(), undefined)
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(written()).toBe('---\nstatus: draft\n# the kind\nDessert Column: Cake\ntags: []\n---\nBody\n')
  })

  it('a page holding both spellings keeps one: the column’s, with the value written; the other goes', async () => {
    readFile.mockResolvedValue(file('---\nDessert Column: Pie\nDESSERT COLUMN: Tart\n---\n', 100))
    await writeRouted(PATH, [{ key: 'Dessert Column', value: 'Cake' }], new Set(), undefined)
    expect(written()).toBe('---\nDessert Column: Cake\n---\n')
  })

  it('a clear removes every spelling', async () => {
    readFile.mockResolvedValue(file('---\ndessert column: Pie\nDessert column: Tart\nkeep: 1\n---\n', 100))
    await writeRouted(PATH, [{ key: 'Dessert Column', value: undefined }], new Set(), undefined)
    expect(written()).toBe('---\nkeep: 1\n---\n')
  })

  it('the app’s keys are never folded away: a `Title` column’s write leaves `title`', async () => {
    readFile.mockResolvedValue(file('---\ntitle: Deep Work\n---\n', 100))
    await writeRouted(PATH, [{ key: 'Title', value: 'x' }], new Set(), undefined)
    expect(written()).toBe('---\ntitle: Deep Work\nTitle: x\n---\n')
  })

  it('a separate value (C3) is written in the page’s block, and the block’s other spelling goes', async () => {
    readFile.mockResolvedValue(file('---\nin:\n  f1:\n    dessert column: Pie\n---\n', 100))
    await writeRouted(PATH, [{ key: 'Dessert Column', value: 'Cake' }], new Set(['Dessert Column']), 'f1')
    expect(written()).toBe('---\nin:\n  f1:\n    Dessert Column: Cake\n---\n')
  })
})
