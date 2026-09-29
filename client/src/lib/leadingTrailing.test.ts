import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { leadingTrailing } from './leadingTrailing'

describe('leadingTrailing (YAZ-2240)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const gate = () => {
    const run = vi.fn()
    return { run, g: leadingTrailing(run, 100) }
  }

  it('a lone call runs at once, and nothing follows it', () => {
    const { run, g } = gate()
    g.call()
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(500)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('a burst is one leading run and one trailing run, 100 ms after its last call', () => {
    const { run, g } = gate()
    for (let i = 0; i < 230; i++) {
      g.call()
      vi.advanceTimersByTime(5)
    }
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(94)
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(500)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('after a quiet spell the next call leads again', () => {
    const { run, g } = gate()
    g.call()
    vi.advanceTimersByTime(100)
    g.call()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('flush runs at once and drops the pending trailing run; cancel drops it without running', () => {
    const { run, g } = gate()
    g.call()
    g.call()
    g.flush()
    expect(run).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(500)
    expect(run).toHaveBeenCalledTimes(2)
    g.call()
    g.call()
    g.cancel()
    vi.advanceTimersByTime(500)
    expect(run).toHaveBeenCalledTimes(3)
  })
})
