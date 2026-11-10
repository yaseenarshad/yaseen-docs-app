import { afterEach, describe, expect, it, vi } from 'vitest'
import { lastSidebarDrag, onSidebarDrag, setSidebarDrag, sidebarDragOn, sidebarDropInFrame, sidebarDroppedInFrame } from './sidebarDrag'

describe('the sidebar’s drag, for a diagram’s drop (YAZ-4748 D4)', () => {
  afterEach(() => setSidebarDrag([]))

  it('is on while the sidebar drags, keeps the last drag’s pages after it ends, and tells each change once', () => {
    const heard = vi.fn()
    const off = onSidebarDrag(heard)
    const paths = ['/vault/A.md', '/vault/B.md']
    setSidebarDrag(paths)
    setSidebarDrag(paths)
    expect(sidebarDragOn()).toBe(true)
    setSidebarDrag([])
    expect(sidebarDragOn()).toBe(false)
    // The drop can land after the end is heard: the pages stay until the next drag.
    expect(lastSidebarDrag()).toEqual(paths)
    expect(heard).toHaveBeenCalledTimes(2)
    off()
    setSidebarDrag(['/vault/C.md'])
    expect(heard).toHaveBeenCalledTimes(2)
    expect(lastSidebarDrag()).toEqual(['/vault/C.md'])
  })

  it('A5: a drop a diagram took is a drop inside — the "dragged out to Finder" box does not ask — until the next drag', () => {
    setSidebarDrag(['/vault/A.md'])
    expect(sidebarDroppedInFrame()).toEqual([])
    setSidebarDrag([])
    // The diagram's word can come after main's end of the drag.
    sidebarDropInFrame()
    expect(sidebarDroppedInFrame()).toEqual(['/vault/A.md'])
    setSidebarDrag(['/vault/B.md'])
    expect(sidebarDroppedInFrame()).toEqual([])
  })
})
