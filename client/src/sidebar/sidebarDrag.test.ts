import { afterEach, describe, expect, it, vi } from 'vitest'
import { lastSidebarDrag, onSidebarDrag, setSidebarDrag, sidebarDragOn } from './sidebarDrag'

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
})
