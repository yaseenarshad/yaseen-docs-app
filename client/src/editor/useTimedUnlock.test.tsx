/**
 * `useTimedUnlock` (YAZ-4939): one page's timed "Allow edits". One timeout per unlock, none otherwise; at zero the page
 * saves, then locks; "Lock now" the same at once; "Until I close this tab" arms nothing; the close clears the timer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ALLOW_MS, useTimedUnlock, type TimedUnlock } from './useTimedUnlock'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let state: TimedUnlock
let renders = 0
let save: ReturnType<typeof vi.fn<() => Promise<void> | void>>

function Probe() {
  renders++
  state = useTimedUnlock(save)
  return null
}

function mount(): void {
  root = createRoot(document.createElement('div'))
  act(() => root?.render(<Probe />))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-11T10:00:00Z'))
  renders = 0
  save = vi.fn()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
})

describe('useTimedUnlock', () => {
  it('starts locked, with no timer', () => {
    mount()
    expect(state.until).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('"15 minutes" says when it ends and arms ONE timeout; at zero the page saves, then locks (fake timers)', async () => {
    mount()
    let saved: () => void = () => undefined
    save.mockImplementation(() => new Promise<void>((resolve) => (saved = resolve)))
    act(() => state.allow('fifteen'))
    expect(state.until).toBe(Date.now() + ALLOW_MS.fifteen)
    expect(vi.getTimerCount()).toBe(1)
    const before = renders
    // No work while it runs: the host does not render again until the end.
    await act(async () => void vi.advanceTimersByTime(ALLOW_MS.fifteen - 1))
    expect(renders).toBe(before)
    expect(state.until).not.toBeNull()
    await act(async () => void vi.advanceTimersByTime(1))
    expect(save).toHaveBeenCalledTimes(1)
    // Still unlocked until the save settles…
    expect(state.until).not.toBeNull()
    await act(async () => saved())
    // …then locked, with nothing armed.
    expect(state.until).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('"1 hour" is an hour', () => {
    mount()
    act(() => state.allow('hour'))
    expect(state.until).toBe(Date.now() + 60 * 60_000)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('"Until I close this tab" is Infinity and arms nothing; a time choice after it arms one', () => {
    mount()
    act(() => state.allow('close'))
    expect(state.until).toBe(Infinity)
    expect(vi.getTimerCount()).toBe(0)
    act(() => state.allow('fifteen'))
    expect(vi.getTimerCount()).toBe(1)
  })

  it('a second choice replaces the first: one timer, the new end', () => {
    mount()
    act(() => state.allow('fifteen'))
    act(() => state.allow('hour'))
    expect(vi.getTimerCount()).toBe(1)
    expect(state.until).toBe(Date.now() + ALLOW_MS.hour)
    act(() => void vi.advanceTimersByTime(ALLOW_MS.fifteen))
    expect(state.until).not.toBeNull()
    expect(save).not.toHaveBeenCalled()
  })

  it('"Lock now" saves, then locks at once, and clears the timer', async () => {
    mount()
    act(() => state.allow('fifteen'))
    await act(async () => state.lock())
    expect(save).toHaveBeenCalledTimes(1)
    expect(state.until).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    act(() => void vi.advanceTimersByTime(ALLOW_MS.fifteen))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('a save that fails still locks', async () => {
    mount()
    save.mockImplementation(() => Promise.reject(new Error('disk')))
    act(() => state.allow('fifteen'))
    await act(async () => state.lock())
    expect(state.until).toBeNull()
  })

  it('an allow during the end\'s save wins: the page stays unlocked', async () => {
    mount()
    let saved: () => void = () => undefined
    save.mockImplementation(() => new Promise<void>((resolve) => (saved = resolve)))
    act(() => state.allow('fifteen'))
    await act(async () => void vi.advanceTimersByTime(ALLOW_MS.fifteen))
    act(() => state.allow('hour'))
    await act(async () => saved())
    expect(state.until).toBe(Date.now() + ALLOW_MS.hour)
  })

  it('the close clears the timer', () => {
    mount()
    act(() => state.allow('fifteen'))
    act(() => root?.unmount())
    root = null
    expect(vi.getTimerCount()).toBe(0)
  })
})
