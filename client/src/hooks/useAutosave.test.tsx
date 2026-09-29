/**
 * `useAutosave` (YAZ-2131 1E, YAZ-2172): the hook that owns one note's `Autosave` controller.
 * `lib/autosave.ts` has its own state-machine suite; this pins what the hook adds on top: the held
 * frontmatter re-prepended on every write, the frontmatter-only absorb (GRO-2186), the CONFLICT
 * mtime and "keep mine", the flush on unmount and the close/quit handshake (GRO-2160). The bridge
 * (`api.writeFile`, `window.yaseenDocs.window.onFlush`) is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Autosave } from '../lib/autosave'
import { useAutosave, type AutosaveHandle } from './useAutosave'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn() },
}))

import { api, BridgeRequestError } from '../api'

const writeFile = vi.mocked(api.writeFile)
const readFile = vi.mocked(api.readFile)
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PATH = '/vault/note.md'
const FM = '---\nstatus: draft\n---\n'

let root: Root | null = null
let handle: AutosaveHandle
/** The listener the hook registered on the close/quit handshake; `offFlush` is its unsubscribe. */
let flushListener: (() => Promise<void> | void) | null
const offFlush = vi.fn()

function Probe() {
  handle = useAutosave(PATH)
  return null
}

/** Mounts the hook and attaches a note whose live editor body is whatever `body()` returns. */
function mountAttached(body: () => string, mtime = 1): Autosave {
  root = createRoot(document.createElement('div'))
  act(() => root?.render(<Probe />))
  let autosave!: Autosave
  act(() => void (autosave = handle.attach(body, mtime, FM, 'body')))
  return autosave
}

beforeEach(() => {
  flushListener = null
  writeFile.mockReset()
  writeFile.mockResolvedValue({ path: PATH, mtime: 2, size: 0 })
  // What a CONFLICT re-read finds unless a test says otherwise: someone else changed the BODY.
  readFile.mockReset()
  readFile.mockResolvedValue({ path: PATH, content: `${FM}someone else`, mtime: 42, size: 0 })
  Object.defineProperty(window, 'yaseenDocs', {
    value: { window: { onFlush: (listener: () => Promise<void> | void) => ((flushListener = listener), offFlush) } },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
  delete (window as unknown as Record<string, unknown>).yaseenDocs
})

describe('useAutosave (YAZ-2172)', () => {
  it('saves 500 ms after the last edit, re-prepending the held frontmatter and guarding on the disk mtime', async () => {
    vi.useFakeTimers()
    const autosave = mountAttached(() => 'body')
    act(() => autosave.update('body edited'))
    expect(handle.status).toBe('unsaved')
    await act(() => vi.advanceTimersByTimeAsync(499))
    expect(writeFile).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: `${FM}body edited`, expectedMtime: 1 })
    expect(handle.status).toBe('saved')
  })

  it('absorbs a frontmatter-only external change silently: the unsaved edit stays, the next save carries the new block and mtime (GRO-2186)', async () => {
    let live = 'body'
    const autosave = mountAttached(() => live)
    live = 'body edited'
    act(() => autosave.update(live))
    const fm2 = '---\nstatus: done\n---\n'
    expect(handle.absorbFrontmatterOnly(`${fm2}body`, 7)).toBe(true)
    expect(handle.conflictMtime).toBeNull()
    await act(async () => void (await flushListener!()))
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: `${fm2}body edited`, expectedMtime: 7 })
    // A disk BODY change is not frontmatter-only: nothing is absorbed.
    expect(handle.absorbFrontmatterOnly('---\nstatus: gone\n---\nsomeone else', 9)).toBe(false)
  })

  it('a CONFLICT reply surfaces the disk mtime and pauses; keep mine overwrites against that mtime', async () => {
    writeFile.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'newer on disk', 42))
    const autosave = mountAttached(() => 'body')
    act(() => autosave.update('mine'))
    await act(() => autosave.flush())
    expect(handle.conflictMtime).toBe(42)
    expect(handle.status).toBe('unsaved')
    await act(async () => handle.keepMine())
    expect(writeFile).toHaveBeenLastCalledWith({ path: PATH, content: `${FM}mine`, expectedMtime: 42 })
    expect(handle.conflictMtime).toBeNull()
    expect(handle.status).toBe('saved')
  })

  it('unmount saves the live editor body at once, even before the editor reported it (file switch, tab close)', () => {
    let live = 'body'
    mountAttached(() => live)
    live = 'typed a second ago'
    act(() => root?.unmount())
    root = null
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: `${FM}typed a second ago`, expectedMtime: 1 })
    expect(offFlush).toHaveBeenCalled()
  })

  it('the close/quit handshake saves the live body and settles only once it is written (GRO-2160)', async () => {
    let written!: () => void
    writeFile.mockImplementationOnce(() => new Promise((r) => (written = () => r({ path: PATH, mtime: 2, size: 0 }))))
    let live = 'body'
    mountAttached(() => live)
    live = 'last words'
    let settled = false
    let handshake!: Promise<void>
    act(() => void (handshake = Promise.resolve(flushListener!()).then(() => void (settled = true))))
    expect(writeFile).toHaveBeenCalledExactlyOnceWith({ path: PATH, content: `${FM}last words`, expectedMtime: 1 })
    await act(async () => undefined)
    expect(settled).toBe(false)
    await act(async () => {
      written()
      await handshake
    })
    expect(settled).toBe(true)
  })

  describe('a CONFLICT whose disk change is frontmatter only (YAZ-2175)', () => {
    const FM2 = '---\nstatus: done\n---\n'

    it("is the app's own property/comment write: the save adopts the new block and retries once, with no bar", async () => {
      writeFile.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'newer on disk', 42)).mockResolvedValueOnce({ path: PATH, mtime: 43, size: 0 })
      readFile.mockResolvedValueOnce({ path: PATH, content: `${FM2}body`, mtime: 42, size: 0 })
      const autosave = mountAttached(() => 'body')
      act(() => autosave.update('mine'))
      await act(() => autosave.flush())
      expect(writeFile).toHaveBeenLastCalledWith({ path: PATH, content: `${FM2}mine`, expectedMtime: 42 })
      expect(writeFile).toHaveBeenCalledTimes(2)
      expect(handle.conflictMtime).toBeNull()
      expect(handle.status).toBe('saved')
      // The block stays adopted: the next save carries it and the landed mtime.
      act(() => autosave.update('mine again'))
      await act(() => autosave.flush())
      expect(writeFile).toHaveBeenLastCalledWith({ path: PATH, content: `${FM2}mine again`, expectedMtime: 43 })
    })

    it('a genuine BODY change on disk still raises the bar, with no second write', async () => {
      writeFile.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'newer on disk', 42))
      readFile.mockResolvedValueOnce({ path: PATH, content: `${FM2}someone else's body`, mtime: 42, size: 0 })
      const autosave = mountAttached(() => 'body')
      act(() => autosave.update('mine'))
      await act(() => autosave.flush())
      expect(writeFile).toHaveBeenCalledTimes(1)
      expect(handle.conflictMtime).toBe(42)
      expect(handle.status).toBe('unsaved')
    })

    it('retries once only: a second CONFLICT raises the bar with the newest mtime', async () => {
      writeFile.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'newer on disk', 42)).mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'newer again', 44))
      readFile.mockResolvedValueOnce({ path: PATH, content: `${FM2}body`, mtime: 42, size: 0 })
      const autosave = mountAttached(() => 'body')
      act(() => autosave.update('mine'))
      await act(() => autosave.flush())
      expect(writeFile).toHaveBeenCalledTimes(2)
      expect(readFile).toHaveBeenCalledTimes(1)
      expect(handle.conflictMtime).toBe(44)
    })

    it('a re-read that fails raises the bar as before', async () => {
      writeFile.mockRejectedValueOnce(new BridgeRequestError('CONFLICT', 'newer on disk', 42))
      readFile.mockRejectedValueOnce(new BridgeRequestError('NOT_FOUND', 'gone'))
      const autosave = mountAttached(() => 'body')
      act(() => autosave.update('mine'))
      await act(() => autosave.flush())
      expect(writeFile).toHaveBeenCalledTimes(1)
      expect(handle.conflictMtime).toBe(42)
    })
  })
})
