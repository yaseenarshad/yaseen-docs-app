/** View › Save Heap Snapshot (YAZ-3737 D9, S23): the chunks into one file, the debugger always detached, a taken debugger left alone. */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { saveHeapSnapshot, type SnapshotDebugger } from './heapSnapshot'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-heap-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

type Listener = (event: unknown, method: string, params: { chunk?: string }) => void

/** A debugger that answers `takeHeapSnapshot` with `chunks`, or fails it with `fail`. */
function fakeDebugger({ attached = false, attachThrows = false, chunks = ['{"a":', '1}'], fail }: { attached?: boolean; attachThrows?: boolean; chunks?: string[]; fail?: Error } = {}) {
  const listeners = new Set<Listener>()
  const dbg = {
    isAttached: vi.fn(() => attached),
    attach: vi.fn(() => {
      if (attachThrows) throw new Error('Another debugger is already attached to this target')
    }),
    detach: vi.fn(),
    sendCommand: vi.fn(async (method: string) => {
      if (method !== 'HeapProfiler.takeHeapSnapshot') return {}
      for (const chunk of chunks) for (const l of listeners) l({}, 'HeapProfiler.addHeapSnapshotChunk', { chunk })
      if (fail !== undefined) throw fail
      return {}
    }),
    on: vi.fn((_e: 'message', l: Listener) => listeners.add(l)),
    removeListener: vi.fn((_e: 'message', l: Listener) => listeners.delete(l)),
  } satisfies SnapshotDebugger
  return { dbg, listeners }
}

const AT = new Date('2026-10-30T12:34:56.789Z')

describe('saveHeapSnapshot', () => {
  it('writes every chunk into <window>-<iso>.heapsnapshot, then detaches', async () => {
    const { dbg, listeners } = fakeDebugger()
    const file = await saveHeapSnapshot(dbg, path.join(dir, 'yaseen-docs-heap'), 'w1', AT)
    expect(file).toBe(path.join(dir, 'yaseen-docs-heap', 'w1-2026-10-30T12-34-56.789Z.heapsnapshot'))
    expect(await readFile(file!, 'utf8')).toBe('{"a":1}')
    expect(dbg.attach).toHaveBeenCalledExactlyOnceWith('1.3')
    expect(dbg.detach).toHaveBeenCalledTimes(1)
    expect(listeners.size).toBe(0)
  })

  it('S23: a debugger already attached (DevTools open) → null; nothing attached, nothing written, nothing detached', async () => {
    for (const taken of [fakeDebugger({ attached: true }), fakeDebugger({ attachThrows: true })]) {
      expect(await saveHeapSnapshot(taken.dbg, dir, 'w1', AT)).toBeNull()
      expect(taken.dbg.sendCommand).not.toHaveBeenCalled()
      expect(taken.dbg.detach).not.toHaveBeenCalled()
    }
    expect(await readdir(dir)).toEqual([])
  })

  it('a snapshot that fails leaves no file and still detaches', async () => {
    const { dbg } = fakeDebugger({ fail: new Error('target closed') })
    await expect(saveHeapSnapshot(dbg, dir, 'w1', AT)).rejects.toThrow('target closed')
    expect(await readdir(dir)).toEqual([])
    expect(dbg.detach).toHaveBeenCalledTimes(1)
  })
})
