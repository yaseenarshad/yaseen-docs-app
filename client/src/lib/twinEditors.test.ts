import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetTwinEditors, announceTwinSave, onTwinSave } from './twinEditors'

afterEach(() => _resetTwinEditors())

describe('twinEditors: a save reaches every copy of its file in this window (YAZ-2940 D4, S23)', () => {
  it('reaches every listener of the saved path with the mtime, and no listener of another path', () => {
    const copyA = vi.fn()
    const copyB = vi.fn()
    const other = vi.fn()
    onTwinSave('/v/a.md', copyA)
    onTwinSave('/v/a.md', copyB)
    onTwinSave('/v/b.md', other)
    announceTwinSave('/v/a.md', 42)
    expect(copyA).toHaveBeenCalledExactlyOnceWith(42)
    expect(copyB).toHaveBeenCalledExactlyOnceWith(42)
    expect(other).not.toHaveBeenCalled()
  })

  it('an unsubscribed copy hears nothing more; the others still do; a path with no listener is a no-op', () => {
    const copyA = vi.fn()
    const copyB = vi.fn()
    const offA = onTwinSave('/v/a.md', copyA)
    const offB = onTwinSave('/v/a.md', copyB)
    offA()
    offA() // a second call is harmless
    announceTwinSave('/v/a.md', 2)
    expect(copyA).not.toHaveBeenCalled()
    expect(copyB).toHaveBeenCalledExactlyOnceWith(2)
    offB()
    expect(() => announceTwinSave('/v/a.md', 3)).not.toThrow()
    expect(copyB).toHaveBeenCalledTimes(1)
  })

  it('a listener that unsubscribes while it is told does not skip the next one', () => {
    const calls: string[] = []
    const off = onTwinSave('/v/a.md', () => {
      calls.push('first')
      off()
    })
    onTwinSave('/v/a.md', () => void calls.push('second'))
    announceTwinSave('/v/a.md', 5)
    expect(calls).toEqual(['first', 'second'])
  })
})
