/**
 * What both hosts share (YAZ-4834 A17): the first size (A6, A7), the scroll root (YAZ-4862), the mount into the box
 * and its "Can't show …", the flush registry (A8), and the chunk load that forgets a failure (A12).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EmbedOptions } from '@shared/embedOptions'
import type { BoardWindowHandle, BoardWindowHost } from './types'

const chunk = vi.hoisted(() => ({ hosts: [] as BoardWindowHost[] }))
vi.mock('./boardWindow', () => {
  return {
    mountBoardWindow: (host: BoardWindowHost): BoardWindowHandle => {
      chunk.hosts.push(host)
      const dom = document.createElement('div')
      const noop = () => {}
      return { dom, update: noop, setSelected: noop, handleKey: () => false, setFolded: noop, setFoldable: noop, menuRows: () => [], fit: noop, flush: noop, destroy: noop }
    },
  }
})

import { firstWindowSize, flushBoardWindows, mountInBox, onFlush, scrollRootOf } from './hostWindow'

const opts = (over: Partial<EmbedOptions> = {}): EmbedOptions => ({ width: 640, height: 360, view: null, locked: false, page: null, rest: [], ...over })
const host = (): BoardWindowHost => ({ ref: { root: '/v', path: 'a.drawio', kind: 'diagram', name: 'a', vault: null }, options: null, editable: true, columnWidth: () => 700 })

afterEach(() => {
  chunk.hosts.length = 0
  document.body.replaceChildren()
})

describe('the first size (A6, A7)', () => {
  it('the stored size; a width alone or none takes 16:9, then the board`s shape, 160 to 480', () => {
    expect(firstWindowSize(opts(), null, 700)).toEqual({ width: 640, height: 360 })
    expect(firstWindowSize(null, null, 700)).toEqual({ width: 700, height: 394 })
    expect(firstWindowSize(null, { x: 0, y: 0, width: 1000, height: 500 }, 700)).toEqual({ width: 700, height: 350 })
    expect(firstWindowSize(opts({ width: 300, height: null }), null, 700)).toEqual({ width: 300, height: 169 })
    expect(firstWindowSize(null, { x: 0, y: 0, width: 100, height: 1000 }, 700).height).toBe(480)
  })
})

describe('the box', () => {
  it('holds the first height before the window (no jump from 0, A6); the window gets the box`s scroll root (YAZ-4862)', async () => {
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    const box = document.createElement('span')
    scroller.appendChild(box)
    document.body.appendChild(scroller)
    const done = vi.fn()
    mountInBox(box, { options: null, columnWidth: () => 700, host, live: () => true, done, state: () => ({ selected: true, fold: { foldable: false, folded: false } }), name: () => 'a' })
    expect(box.style.getPropertyValue('--board-embed-height')).toBe('394px')
    await vi.waitFor(() => expect(done).toHaveBeenCalled())
    expect(box.style.getPropertyValue('--board-embed-height')).toBe('')
    expect(chunk.hosts[0]!.scrollRoot).toBe(scroller)
    expect(scrollRootOf(box)).toBe(scroller)
    expect(scrollRootOf(scroller)).toBeNull()
  })
})

describe('the flush registry (A8)', () => {
  it('runs every window`s flush of that view, and none after it is removed', () => {
    const view = {}
    const a = vi.fn()
    const off = onFlush(view, a)
    flushBoardWindows(view)
    flushBoardWindows({})
    expect(a).toHaveBeenCalledTimes(1)
    off()
    flushBoardWindows(view)
    expect(a).toHaveBeenCalledTimes(1)
  })
})

describe('the chunk (A12)', () => {
  it('a failed load is forgotten: the box says "Can`t show …", and the next embed loads it again', async () => {
    vi.resetModules()
    vi.doMock('./boardWindow', () => {
      throw new Error('chunk failed to load')
    })
    const { mountInBox: mountFresh } = await import('./hostWindow')
    const { loadBoardWindow } = await import('./types')
    const box = document.createElement('span')
    mountFresh(box, { options: opts(), columnWidth: () => 700, host, live: () => true, done: vi.fn(), state: () => ({ selected: false, fold: { foldable: false, folded: false } }), name: () => 'CloudFront' })
    await vi.waitFor(() => expect(box.textContent).toBe("Can't show CloudFront"))
    expect(box.classList.contains('board-embed--broken')).toBe(true)
    vi.doMock('./boardWindow', () => ({ mountBoardWindow: () => null }))
    await expect(loadBoardWindow()).resolves.toHaveProperty('mountBoardWindow')
  })
})
