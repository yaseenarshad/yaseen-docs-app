/** The JS heap ask of Settings › Memory (YAZ-3737 D1): the preload's answer, only from the window asked, else null after 1 s. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { SPECIAL } from '@shared/ipc'
import { HEAP_WAIT_MS, askHeap, registerMemoryIpc } from './memory'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

registerMemoryIpc({ report: vi.fn() })
const reply = vi.mocked(ipcMain.on).mock.calls.find(([ch]) => ch === SPECIAL.memoryHeapReply)![1] as (e: unknown, msg: unknown) => void

afterEach(() => vi.useRealTimers())

describe('askHeap', () => {
  it('resolves with the bytes the asked window answers; an answer from another window, or a bad one, is ignored', async () => {
    vi.useFakeTimers()
    const wc = { id: 7, send: vi.fn() }
    const heap = askHeap(wc)
    expect(wc.send).toHaveBeenCalledExactlyOnceWith(SPECIAL.memoryHeap, expect.any(String))
    const token = wc.send.mock.calls[0][1] as string
    reply({ sender: { id: 8 } }, { token, bytes: 1 }) // not the window asked
    reply({ sender: { id: 7 } }, { token: 'other', bytes: 2 })
    reply({ sender: { id: 7 } }, { token, bytes: 40_000_000 })
    expect(await heap).toBe(40_000_000)
    // A second answer to the same token reaches no one.
    expect(() => reply({ sender: { id: 7 } }, { token, bytes: 3 })).not.toThrow()

    const silent = askHeap({ id: 9, send: vi.fn() })
    vi.advanceTimersByTime(HEAP_WAIT_MS)
    expect(await silent).toBeNull()
    const gone = askHeap({ id: 10, send: () => { throw new Error('destroyed') } })
    expect(await gone).toBeNull()
  })
})
