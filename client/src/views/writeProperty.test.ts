/**
 * `writeProperty` (GRO-2141): read → rewrite one key → write with `expectedMtime`,
 * with a single re-read-and-retry on CONFLICT. `api` is mocked so every call is observable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FrontmatterWriteError } from '@shared/frontmatter'
import { writeProperty } from './writeProperty'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn() },
}))

import { BridgeRequestError, api } from '../api'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)

const PATH = '/vault/Deep Work.md'

const file = (content: string, mtime: number) => ({ path: PATH, content, mtime, size: content.length })
const conflict = (mtime: number) => new BridgeRequestError('CONFLICT', 'file changed on disk', mtime)

beforeEach(() => {
  readFile.mockReset()
  writeFile.mockReset()
})

describe('writeProperty', () => {
  it('reads, rewrites one key and writes with the read mtime', async () => {
    readFile.mockResolvedValue(file('---\nstatus: draft\n---\nBody\n', 100))
    writeFile.mockResolvedValue({ path: PATH, mtime: 200, size: 26 })

    await expect(writeProperty(PATH, 'status', 'done')).resolves.toEqual({ mtime: 200 })

    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith({
      path: PATH,
      content: '---\nstatus: done\n---\nBody\n',
      expectedMtime: 100,
    })
  })

  it('skips the write when the value is already what is on disk', async () => {
    readFile.mockResolvedValue(file('---\nstatus: draft\n---\nBody\n', 100))

    await expect(writeProperty(PATH, 'status', 'draft')).resolves.toEqual({ mtime: 100 })

    expect(writeFile).not.toHaveBeenCalled()
  })

  it('re-reads and retries once on CONFLICT, keeping the concurrent edit', async () => {
    readFile
      .mockResolvedValueOnce(file('---\nstatus: draft\n---\nBody\n', 100))
      .mockResolvedValueOnce(file('---\nstatus: draft\ntags: [new]\n---\nBody\n', 150))
    writeFile.mockRejectedValueOnce(conflict(150)).mockResolvedValueOnce({ path: PATH, mtime: 300, size: 40 })

    await expect(writeProperty(PATH, 'status', 'done')).resolves.toEqual({ mtime: 300 })

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
