/**
 * The main-thread side of the worker (YAZ-2643, S59, S60 and S65): ONE worker per window, started on
 * the first request; one that fails rejects what waits on it and is replaced by the next request. jsdom has no `Worker`, so a stand-in records what the module does with one; the
 * worker's own code is held by `tools/lineNumbersWorker.test.mjs`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlockLines } from './blockLines'

class FakeWorker {
  static made: FakeWorker[] = []
  onmessage: ((event: { data: BlockLines & { id: number } }) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  posted: Array<{ id: number; text: string }> = []
  terminate = vi.fn()
  constructor(readonly url: URL, readonly options?: WorkerOptions) {
    FakeWorker.made.push(this)
  }
  postMessage(message: { id: number; text: string }): void {
    this.posted.push(message)
  }
}

let requestBlockLines: (text: string) => Promise<BlockLines>

beforeEach(async () => {
  FakeWorker.made = []
  vi.stubGlobal('Worker', FakeWorker)
  // A fresh module: the worker it holds is per window, so per import.
  vi.resetModules()
  ;({ requestBlockLines } = await import('./lineNumbers'))
})

afterEach(() => vi.unstubAllGlobals())

describe('requestBlockLines', () => {
  it('starts no worker until the first request, then one module worker for every request after it', () => {
    expect(FakeWorker.made).toHaveLength(0)
    void requestBlockLines('one')
    void requestBlockLines('two')
    expect(FakeWorker.made).toHaveLength(1)
    const [worker] = FakeWorker.made
    expect(worker.url.pathname.endsWith('/lineNumbers.worker.ts')).toBe(true)
    expect(worker.options).toEqual({ type: 'module' })
    expect(worker.posted.map(({ text }) => text)).toEqual(['one', 'two'])
    expect(worker.terminate).not.toHaveBeenCalled()
  })

  it('gives each answer to the request it belongs to, whatever order they come back in', async () => {
    const first = requestBlockLines('one')
    const second = requestBlockLines('two')
    const [worker] = FakeWorker.made
    const [a, b] = worker.posted
    expect(a.id).not.toBe(b.id)
    worker.onmessage!({ data: { id: b.id, lines: [2], ends: [2], kinds: 'h' } })
    worker.onmessage!({ data: { id: a.id, lines: [1], ends: [1], kinds: 'p' } })
    expect(await first).toMatchObject({ lines: [1], ends: [1], kinds: 'p' })
    expect(await second).toMatchObject({ lines: [2], ends: [2], kinds: 'h' })
  })

  it.each(['onerror', 'onmessageerror'] as const)('a worker that fails (%s) rejects every waiting request and is terminated; the next request starts a new worker (S65)', async (failure) => {
    const first = requestBlockLines('one')
    const second = requestBlockLines('two')
    const [failed] = FakeWorker.made
    failed[failure]!()
    await expect(first).rejects.toThrow('line-number worker')
    await expect(second).rejects.toThrow('line-number worker')
    expect(failed.terminate).toHaveBeenCalledTimes(1)
    const third = requestBlockLines('three')
    expect(FakeWorker.made).toHaveLength(2)
    const [, fresh] = FakeWorker.made
    expect(fresh.posted.map(({ text }) => text)).toEqual(['three'])
    fresh.onmessage!({ data: { id: fresh.posted[0].id, lines: [3], ends: [3], kinds: 'p' } })
    expect(await third).toMatchObject({ lines: [3], ends: [3], kinds: 'p' })
    expect(fresh.terminate).not.toHaveBeenCalled()
  })

  it('a second failure rejects only what waits then: the first failure left nothing behind (S65)', async () => {
    const first = requestBlockLines('one')
    const settled = vi.fn()
    void first.catch(settled)
    FakeWorker.made[0].onerror!()
    await expect(first).rejects.toThrow()
    expect(settled).toHaveBeenCalledTimes(1)
    const second = requestBlockLines('two')
    FakeWorker.made[1].onerror!()
    await expect(second).rejects.toThrow()
    expect(FakeWorker.made[0].terminate).toHaveBeenCalledTimes(1)
    expect(FakeWorker.made[1].terminate).toHaveBeenCalledTimes(1)
  })
})
