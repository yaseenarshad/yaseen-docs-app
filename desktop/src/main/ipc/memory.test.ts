/** The JS heap and tabs asks of Settings › Memory (YAZ-3737 D1, YAZ-3946) and the views ask (D4): the preload's answer, only from the window asked, else null after 1 s. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { SPECIAL } from '@shared/ipc'
import { HEAP_WAIT_MS, TABS_WAIT_MS, VIEWS_WAIT_MS, askHeap, askTabs, askViews, registerMemoryIpc } from './memory'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

registerMemoryIpc({ report: vi.fn() })
const reply = vi.mocked(ipcMain.on).mock.calls.find(([ch]) => ch === SPECIAL.memoryHeapReply)![1] as (e: unknown, msg: unknown) => void
const viewsReply = vi.mocked(ipcMain.on).mock.calls.find(([ch]) => ch === SPECIAL.windowViewsReply)![1] as (e: unknown, msg: unknown) => void
const tabsReply = vi.mocked(ipcMain.on).mock.calls.find(([ch]) => ch === SPECIAL.windowTabsReply)![1] as (e: unknown, msg: unknown) => void

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

describe('askViews (YAZ-3737 D4)', () => {
  it('resolves the asked window\'s views in strip order, a bad entry as null; no answer in 1 s, or no list, is null', async () => {
    vi.useFakeTimers()
    const wc = { id: 7, send: vi.fn() }
    const views = askViews(wc)
    expect(wc.send).toHaveBeenCalledExactlyOnceWith(SPECIAL.windowViews, expect.any(String))
    const token = wc.send.mock.calls[0][1] as string
    const view = { scrollTop: 40, zoomKey: null, folds: ['f:0'], magnification: 100, selection: { anchor: 2, head: 2 } }
    viewsReply({ sender: { id: 8 } }, { token, views: [] }) // not the window asked
    viewsReply({ sender: { id: 7 } }, { token, views: [{ path: '/v/a.md', view }, null, { path: '/v/b.md', view: { scrollTop: 'x' } }, { view }] })
    expect(await views).toEqual([{ path: '/v/a.md', view }, null, null, null])

    const silent = askViews({ id: 9, send: vi.fn() })
    vi.advanceTimersByTime(VIEWS_WAIT_MS)
    expect(await silent).toBeNull()
    const odd = { id: 10, send: vi.fn() }
    const notList = askViews(odd)
    viewsReply({ sender: { id: 10 } }, { token: odd.send.mock.calls[0][1], views: 'all' })
    expect(await notList).toBeNull()
  })
})

describe('askTabs (YAZ-3946)', () => {
  it('resolves the asked window\'s tabs in strip order, a bad entry dropped and a bad stamp null; no answer in 1 s, or no list, is null', async () => {
    vi.useFakeTimers()
    const wc = { id: 7, send: vi.fn() }
    const tabs = askTabs(wc)
    expect(wc.send).toHaveBeenCalledExactlyOnceWith(SPECIAL.windowTabs, expect.any(String))
    const token = wc.send.mock.calls[0][1] as string
    const good = { path: '/v/a.md', title: 'Start here', state: 'awake', lastSeen: 5, sleepsAt: 900_005 }
    tabsReply({ sender: { id: 8 } }, { token, tabs: [] }) // not the window asked
    tabsReply({ sender: { id: 7 } }, { token, tabs: [good, { ...good, state: 'dozing' }, { ...good, title: 1 }, null, { ...good, path: '/v/b.md', state: 'shown', lastSeen: 'x', sleepsAt: undefined }] })
    expect(await tabs).toEqual([good, { path: '/v/b.md', title: 'Start here', state: 'shown', lastSeen: null, sleepsAt: null }])

    const silent = askTabs({ id: 9, send: vi.fn() })
    vi.advanceTimersByTime(TABS_WAIT_MS)
    expect(await silent).toBeNull()
    const welcome = { id: 10, send: vi.fn() }
    const none = askTabs(welcome)
    tabsReply({ sender: { id: 10 } }, { token: welcome.send.mock.calls[0][1], tabs: null }) // no listener: the Welcome window
    expect(await none).toBeNull()
  })
})
