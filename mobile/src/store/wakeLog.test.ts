// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WAKE_LOG_KEY, WAKE_LOG_MAX, noteStorageCall, noteSyncStatus, readWakeLog, startWakeLog } from './wakeLog'

/** YAZ-5596 item 15: the wake log (Settings › Vault health). */
function fakeDoc() {
  const listeners: (() => void)[] = []
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: string, fn: () => void) => void listeners.push(fn),
  }
  const show = (state: DocumentVisibilityState) => {
    doc.visibilityState = state
    for (const fn of listeners) fn()
  }
  return { doc: doc as unknown as Document, show }
}

beforeEach(() => localStorage.clear())

describe('YAZ-5596 item 15: the wake log', () => {
  it('each start and return is an entry with the first sync, the first and slowest storage call, and the time limits', () => {
    const { doc, show } = fakeDoc()
    startWakeLog(doc)
    noteStorageCall(4, false)
    noteSyncStatus('syncing')
    noteSyncStatus('synced')
    show('hidden')
    show('visible')
    noteStorageCall(30, false)
    noteStorageCall(8000, true)
    noteSyncStatus('syncing')
    noteSyncStatus('off')
    noteSyncStatus('syncing')
    noteSyncStatus('synced') // only the first pass after the return counts
    const log = readWakeLog()
    expect(log.map((e) => e.kind)).toEqual(['start', 'return'])
    expect(log[0]).toMatchObject({ storageMs: 4, slowestMs: 4, syncEnd: 'synced', timeouts: 0 })
    expect(log[1]).toMatchObject({ storageMs: 30, slowestMs: 8000, syncEnd: 'off', timeouts: 1 })
    expect(typeof log[1].syncMs).toBe('number')
  })

  it(`keeps the last ${WAKE_LOG_MAX}; a broken or missing local storage only loses the log`, () => {
    const { doc, show } = fakeDoc()
    startWakeLog(doc)
    for (let i = 0; i < 30; i++) {
      vi.setSystemTime(Date.UTC(2026, 10, 15, 6, i))
      show('visible')
    }
    vi.useRealTimers()
    expect(readWakeLog()).toHaveLength(WAKE_LOG_MAX)
    localStorage.setItem(WAKE_LOG_KEY, '{not json')
    expect(readWakeLog()).toEqual([])
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => show('visible')).not.toThrow()
    expect(() => noteStorageCall(5, true)).not.toThrow()
    set.mockRestore()
  })

  it('the many quick storage calls after a return write the log only when the first or the slowest changes', () => {
    const { doc, show } = fakeDoc()
    startWakeLog(doc)
    show('visible')
    const set = vi.spyOn(Storage.prototype, 'setItem')
    for (let i = 0; i < 500; i++) noteStorageCall(i === 250 ? 40 : 1, false)
    expect(set.mock.calls.length).toBeLessThanOrEqual(2)
    set.mockRestore()
    expect(readWakeLog().at(-1)).toMatchObject({ storageMs: 1, slowestMs: 40 })
  })
})
