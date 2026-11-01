/**
 * The renderer's own joiners of the close/quit handshake (YAZ-2174): every registered flusher runs,
 * then the flush waits for the whole-file writes still in flight, including the ones the flushers
 * just started. `api` is mocked so a write can be held open.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { transformFile } from '../views/writeProperty'
import { flushWindow, onWindowFlush } from './windowFlush'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn() },
}))

import { api } from '../api'

const PATH = '/vault/Home.md'

beforeEach(() => {
  vi.mocked(api.readFile).mockReset().mockResolvedValue({ path: PATH, content: 'before', mtime: 100, size: 6 })
  vi.mocked(api.writeFile).mockReset()
})

describe('flushWindow (YAZ-2174)', () => {
  it('runs every flusher, then holds until the writes they started have landed', async () => {
    let landWrite!: () => void
    vi.mocked(api.writeFile).mockImplementationOnce(() => new Promise((r) => (landWrite = () => r({ path: PATH, mtime: 200, size: 5 }))))
    const off = onWindowFlush(() => void transformFile(PATH, () => 'after'))
    let done = false
    const flushing = flushWindow().then((clean) => ((done = true), clean))

    await vi.waitFor(() => expect(api.writeFile).toHaveBeenCalledOnce())
    expect(done).toBe(false)
    landWrite()
    expect(await flushing).toBe(true) // nothing failed: clean (YAZ-3737 D2)
    off()
  })

  it('a write it waited for that failed makes the flush not clean (YAZ-3737 D2)', async () => {
    vi.mocked(api.writeFile).mockRejectedValueOnce(new Error('disk full'))
    const off = onWindowFlush(() => void transformFile(PATH, () => 'after').catch(() => undefined))
    await expect(flushWindow()).resolves.toBe(false)
    off()
  })

  it('one flusher throwing does not skip the next, and the flush still settles', async () => {
    const second = vi.fn()
    const offs = [
      onWindowFlush(() => {
        throw new Error('boom')
      }),
      onWindowFlush(second),
    ]
    await expect(flushWindow()).resolves.toBe(false) // a flusher that threw may have lost its edit
    expect(second).toHaveBeenCalledOnce()
    offs.forEach((off) => off())
  })

  it('an unregistered flusher is not run', async () => {
    const flusher = vi.fn()
    onWindowFlush(flusher)()
    await flushWindow()
    expect(flusher).not.toHaveBeenCalled()
  })
})
