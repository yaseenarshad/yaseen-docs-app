import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  _resetPageUnlockStore,
  flushPageUnlockDependents,
  getPageUnlockUntil,
  publishPageUnlock,
  registerPageUnlockFlush,
  subscribePageUnlock,
  usePageUnlockUntil,
  usePublishPageUnlock,
} from './pageUnlockStore'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  if (root !== null) {
    act(() => root?.unmount())
    root = null
  }
  container?.remove()
  container = null
  _resetPageUnlockStore()
})

describe('pageUnlockStore', () => {
  it('tracks active timed unlocks per path and returns max across multiple tabs of the same page', () => {
    const t1 = Symbol('tab1')
    const t2 = Symbol('tab2')
    const path = '/v/Notes.md'

    expect(getPageUnlockUntil(path)).toBeNull()

    publishPageUnlock(path, t1, 1000)
    expect(getPageUnlockUntil(path)).toBe(1000)

    // Second tab with a later deadline wins
    publishPageUnlock(path, t2, 5000)
    expect(getPageUnlockUntil(path)).toBe(5000)

    // Infinity ("Until I close this tab") beats any finite timestamp
    publishPageUnlock(path, t1, Infinity)
    expect(getPageUnlockUntil(path)).toBe(Infinity)

    // Clearing the Infinity tab falls back to the remaining finite tab
    publishPageUnlock(path, t1, null)
    expect(getPageUnlockUntil(path)).toBe(5000)

    // Clearing the last tab returns to null
    publishPageUnlock(path, t2, null)
    expect(getPageUnlockUntil(path)).toBeNull()
  })

  it('notifies only subscribers of the affected path and only when effective until changes', () => {
    const t1 = Symbol('tab1')
    const t2 = Symbol('tab2')
    const onA = vi.fn()
    const onB = vi.fn()
    const offA = subscribePageUnlock('/v/A.md', onA)
    const offB = subscribePageUnlock('/v/B.md', onB)

    // Publishing null when already null does not notify
    publishPageUnlock('/v/A.md', t1, null)
    expect(onA).not.toHaveBeenCalled()

    publishPageUnlock('/v/A.md', t1, 2000)
    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).not.toHaveBeenCalled()

    // Adding a shorter deadline does not change effective max -> no redundant notification
    publishPageUnlock('/v/A.md', t2, 1000)
    expect(onA).toHaveBeenCalledTimes(1)

    // Extending beyond max notifies
    publishPageUnlock('/v/A.md', t2, 3000)
    expect(onA).toHaveBeenCalledTimes(2)

    offA()
    publishPageUnlock('/v/A.md', t1, null)
    publishPageUnlock('/v/A.md', t2, null)
    expect(onA).toHaveBeenCalledTimes(2)
    offB()
  })

  it('usePageUnlockUntil and usePublishPageUnlock sync live, survive extension without flickering null, and clean up on path change / unmount', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    const seen: (number | null)[] = []
    function Consumer({ path }: { path: string | null }) {
      const until = usePageUnlockUntil(path)
      seen.push(until)
      return createElement('span', { 'data-until': String(until) })
    }
    function Publisher({ path, until }: { path: string; until: number | null }) {
      usePublishPageUnlock(path, until)
      return null
    }

    const renderBoth = (pubPath: string, until: number | null, subPath: string | null) =>
      createElement(Fragment, null, createElement(Publisher, { path: pubPath, until }), createElement(Consumer, { path: subPath }))

    act(() => {
      root!.render(renderBoth('/v/Doc.md', null, '/v/Doc.md'))
    })
    expect(seen).toEqual([null])

    // Unlock for 1 minute
    act(() => {
      root!.render(renderBoth('/v/Doc.md', 10_000, '/v/Doc.md'))
    })
    expect(seen.at(-1)).toBe(10_000)

    // Extend to 10 minutes: must NOT flicker to null in between
    const observedTransitions: (number | null)[] = []
    const offSub = subscribePageUnlock('/v/Doc.md', () => observedTransitions.push(getPageUnlockUntil('/v/Doc.md')))
    act(() => {
      root!.render(renderBoth('/v/Doc.md', 60_000, '/v/Doc.md'))
    })
    offSub()
    expect(observedTransitions).toEqual([60_000])
    expect(seen.at(-1)).toBe(60_000)

    // Publisher path changes: old path clears immediately, new path receives the unlock
    act(() => {
      root!.render(renderBoth('/v/Renamed.md', 60_000, '/v/Doc.md'))
    })
    expect(getPageUnlockUntil('/v/Doc.md')).toBeNull()
    expect(getPageUnlockUntil('/v/Renamed.md')).toBe(60_000)
    expect(seen.at(-1)).toBeNull()

    // Null consumer path always reads null
    act(() => {
      root!.render(renderBoth('/v/Renamed.md', 60_000, null))
    })
    expect(seen.at(-1)).toBeNull()

    // Unmount publisher cleans up its path
    act(() => {
      root!.render(createElement(Consumer, { path: '/v/Renamed.md' }))
    })
    expect(getPageUnlockUntil('/v/Renamed.md')).toBeNull()
    expect(seen.at(-1)).toBeNull()
  })

  it('flushPageUnlockDependents awaits all registered flushes for that path and isolates failures', async () => {
    const order: string[] = []
    let releaseFirst!: () => void
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const off1 = registerPageUnlockFlush('/v/Page.md', async () => {
      order.push('start-1')
      await first
      order.push('end-1')
    })
    const off2 = registerPageUnlockFlush('/v/Page.md', () => {
      order.push('throw-2')
      throw new Error('sync boom')
    })
    const off3 = registerPageUnlockFlush('/v/Page.md', async () => {
      order.push('reject-3')
      throw new Error('async boom')
    })
    const other = vi.fn()
    const offOther = registerPageUnlockFlush('/v/Other.md', other)

    const flushing = flushPageUnlockDependents('/v/Page.md')
    expect(order).toEqual(['start-1', 'throw-2', 'reject-3'])
    expect(other).not.toHaveBeenCalled()

    releaseFirst()
    await flushing
    expect(order).toEqual(['start-1', 'throw-2', 'reject-3', 'end-1'])

    off1()
    off2()
    off3()
    offOther()

    // After unregistering, flushing is a no-op
    order.length = 0
    await flushPageUnlockDependents('/v/Page.md')
    expect(order).toEqual([])
  })
})
