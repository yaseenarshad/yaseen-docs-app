import { describe, expect, it, vi } from 'vitest'
import { createLinkQueue } from './linkQueue'

// E1 (GRO-2171): macOS delivers cold-start `open-url` before `ready`; URLs queue until
// `flush()` runs after `restoreAll()`, then flow straight through.

describe('createLinkQueue', () => {
  it('queues pushes before flush, then replays them in order', () => {
    const handle = vi.fn()
    const q = createLinkQueue(handle)
    q.push('yaseendocs:///v/a.md')
    q.push('yaseendocs:///v/b.md')
    expect(handle).not.toHaveBeenCalled()
    q.flush()
    expect(handle.mock.calls).toEqual([['yaseendocs:///v/a.md'], ['yaseendocs:///v/b.md']])
  })

  it('handles pushes directly once flushed', () => {
    const handle = vi.fn()
    const q = createLinkQueue(handle)
    q.flush()
    q.push('yaseendocs:///v/a.md')
    expect(handle).toHaveBeenCalledWith('yaseendocs:///v/a.md')
    expect(handle).toHaveBeenCalledTimes(1)
  })

  it('a second flush replays nothing twice', () => {
    const handle = vi.fn()
    const q = createLinkQueue(handle)
    q.push('yaseendocs:///v/a.md')
    q.flush()
    q.flush()
    expect(handle).toHaveBeenCalledTimes(1)
  })
})
