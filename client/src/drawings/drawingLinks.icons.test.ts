/**
 * YAZ-4074 6A item 7: pill icons that finish loading in one frame wake the boards once, not once for each icon.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'

const ready = vi.hoisted(() => [] as Array<() => void>)
vi.mock('./drawingLinkIcons', () => ({
  setDrawingLinkIcons: () => false,
  // Each icon is still loading: it calls back when it is drawn.
  drawingLinkIcon: (_path: string, _folder: boolean, onReady: () => void) => {
    ready.push(onReady)
    return undefined
  },
}))

import { drawingHostLinks, mountDrawingVault, windowLinkLook } from './drawingLinks'

afterEach(() => vi.useRealTimers())

describe('pill icons that load (YAZ-4074 6A item 7)', () => {
  it('three icons ready in one frame wake the boards once', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
    const pages: Record<string, string> = { A: '/v/A.md', B: '/v/B.md', C: '/v/C.md' }
    const source = createWikilinkResolveSource()
    source.update((target) => pages[target] ?? null, Object.values(pages).map((path) => ({ path, title: path })) as unknown as IndexRecord[], [], true)
    const unmount = mountDrawingVault('/v', source)
    const listener = vi.fn()
    const off = drawingHostLinks(() => ({}) as never).subscribe(listener)
    for (const inner of ['A', 'B', 'C']) windowLinkLook(inner)
    expect(ready).toHaveLength(3)
    ready.forEach((onReady) => onReady())
    expect(listener).not.toHaveBeenCalled()
    vi.advanceTimersToNextFrame()
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    unmount()
  })
})
