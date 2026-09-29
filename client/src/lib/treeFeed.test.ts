/**
 * The window's one tree feed (YAZ-2191): same-turn calls share a request, a call during an older
 * request shares the one queued behind it, and every answer reaches every listener in order.
 * `api.tree` is mocked so each request can be held open and counted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STALE_FLIGHT_MS, type TreeResponse } from '@shared/types'
import { currentTurn, fetchTree, onTree, treeSentSince } from './treeFeed'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { tree: vi.fn() },
}))

import { api } from '../api'

let root = ''
let seq = 0
const held: Array<{ answer: (tree: TreeResponse) => void; fail: (err: unknown) => void }> = []
const nextTurn = () => new Promise<void>((r) => setTimeout(r, 0))

beforeEach(() => {
  root = `/vault-${++seq}` // a fresh feed per test: feeds are per root and live for the window
  held.length = 0
  vi.mocked(api.tree).mockReset().mockImplementation(
    () => new Promise<TreeResponse>((answer, fail) => held.push({ answer, fail })),
  )
})

const response = (generatedAt: number): TreeResponse => ({ root, tree: [], generatedAt })

describe('the tree feed (YAZ-2191)', () => {
  it('calls in one turn — a window booting its sidebar, probe and catalog — share ONE request', async () => {
    const calls = [fetchTree(root), fetchTree(root), fetchTree(root)]
    expect(api.tree).toHaveBeenCalledTimes(1)
    held[0].answer(response(1))
    expect(await Promise.all(calls)).toEqual([response(1), response(1), response(1)])
  })

  it('calls during an older request share the ONE request queued behind it, never the running answer', async () => {
    const first = fetchTree(root)
    await nextTurn()
    const late = [fetchTree(root), fetchTree(root)]
    expect(api.tree).toHaveBeenCalledTimes(1)
    held[0].answer(response(1))
    expect(await first).toEqual(response(1))
    await vi.waitFor(() => expect(api.tree).toHaveBeenCalledTimes(2))
    held[1].answer(response(2))
    expect(await Promise.all(late)).toEqual([response(2), response(2)])
  })

  it('every answer, and every failure, reaches every listener of the root in request order', async () => {
    const seen: string[] = []
    const off = onTree(root, (o) => seen.push(o.status === 'fulfilled' ? `tree ${o.value.generatedAt}` : 'failed'))
    const first = fetchTree(root)
    await nextTurn()
    const second = fetchTree(root).catch(() => undefined)
    held[0].answer(response(1))
    await first
    await vi.waitFor(() => expect(held).toHaveLength(2))
    held[1].fail(new Error('gone'))
    await second
    expect(seen).toEqual(['tree 1', 'failed'])
    off()
    void fetchTree(root)
    held[2].answer(response(3))
    await nextTurn()
    expect(seen).toHaveLength(2) // unsubscribed
  })

  it('treeSentSince: a request sent in the turn of an event, before or after it was seen, covers it', async () => {
    const seenAt = currentTurn()
    expect(treeSentSince(root, seenAt)).toBe(false)
    void fetchTree(root)
    expect(treeSentSince(root, seenAt)).toBe(true)
    held[0].answer(response(1))
    await nextTurn()
    expect(treeSentSince(root, currentTurn())).toBe(false)
  })

  it('liveness: a call after a request has hung STALE_FLIGHT_MS sends its own; the hung answer, if it ever comes, is never applied over it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const seen: number[] = []
      const off = onTree(root, (o) => o.status === 'fulfilled' && seen.push(o.value.generatedAt))
      void fetchTree(root) // held[0]: hangs
      await nextTurn()
      vi.setSystemTime(Date.now() + STALE_FLIGHT_MS + 1)
      const fresh = fetchTree(root)
      expect(api.tree).toHaveBeenCalledTimes(2)
      held[1].answer(response(2))
      expect(await fresh).toEqual(response(2))
      held[0].answer(response(1)) // the volume recovers late
      await nextTurn()
      expect(seen).toEqual([2])
      off()
    } finally {
      vi.useRealTimers()
    }
  })
})
