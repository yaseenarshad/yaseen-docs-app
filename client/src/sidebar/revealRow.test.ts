import { afterEach, describe, expect, it, vi } from 'vitest'
import { SIDEBAR_REVEAL_MS, flashTreeRows } from './revealRow'

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView
})

const row = (path: string) => {
  const button = document.createElement('button')
  button.className = 'tree__row'
  button.dataset.path = path
  return button
}

describe('flashTreeRows (YAZ-1065)', () => {
  it('marks every exact-path occurrence, scrolls only the first, keeps focus, and clears at 3000 ms', () => {
    vi.useFakeTimers()
    const scroll = vi.fn()
    ;(HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView = scroll
    const focused = document.createElement('button')
    const host = document.createElement('div')
    const first = row('/v/Note.md')
    const other = row('/v/Other.md')
    const second = row('/v/Note.md')
    host.append(first, other, second)
    document.body.append(focused, host)
    focused.focus()

    const cleanup = flashTreeRows(host, '/v/Note.md')
    expect(cleanup).not.toBeNull()
    expect([first, other, second].map((item) => item.classList.contains('tree__row--revealed'))).toEqual([true, false, true])
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' })
    expect(scroll.mock.contexts[0]).toBe(first)
    expect(document.activeElement).toBe(focused)

    vi.advanceTimersByTime(SIDEBAR_REVEAL_MS - 1)
    expect(first.classList.contains('tree__row--revealed')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(first.classList.contains('tree__row--revealed')).toBe(false)
    expect(second.classList.contains('tree__row--revealed')).toBe(false)
  })

  it('with `focus` the first occurrence gets the keyboard focus too (YAZ-2662 D1, D8)', () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    const first = row('/v/Note.md')
    const second = row('/v/Note.md')
    host.append(row('/v/Other.md'), first, second)
    document.body.append(host)

    const cleanup = flashTreeRows(host, '/v/Note.md', true)
    expect(document.activeElement).toBe(first)
    expect([first, second].map((item) => item.classList.contains('tree__row--revealed'))).toEqual([true, true])
    cleanup?.()
    expect(document.activeElement).toBe(first) // the flash ends; the focus stays where the keys are
  })

  it('cleanup removes the class/timer, and a repeat starts a fresh full interval', () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    const target = row('/v/Note.md')
    target.classList.add('tree__row--active')
    host.append(target)
    document.body.append(host)

    const firstCleanup = flashTreeRows(host, '/v/Note.md')
    vi.advanceTimersByTime(2000)
    firstCleanup?.()
    expect(target.classList.contains('tree__row--revealed')).toBe(false)

    const secondCleanup = flashTreeRows(host, '/v/Note.md')
    vi.advanceTimersByTime(SIDEBAR_REVEAL_MS - 1)
    expect(target.classList.contains('tree__row--revealed')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(target.classList.contains('tree__row--revealed')).toBe(false)
    expect(target.classList.contains('tree__row--active')).toBe(true)
    secondCleanup?.()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('quiet (YAZ-3440 D13): no flash, no focus, no timer; the first row scrolls to the centre only if it is outside the host', () => {
    vi.useFakeTimers()
    const scroll = vi.fn()
    ;(HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView = scroll
    const focused = document.createElement('button')
    const host = document.createElement('div')
    const first = row('/v/Note.md')
    host.append(first, row('/v/Note.md'))
    document.body.append(focused, host)
    focused.focus()
    const timers = vi.getTimerCount()
    // jsdom's empty boxes: the row shows, so nothing scrolls.
    expect(flashTreeRows(host, '/v/Note.md', true, { quiet: true })).toBeTypeOf('function')
    expect([scroll.mock.calls, host.querySelectorAll('.tree__row--revealed').length, document.activeElement, vi.getTimerCount()]).toEqual([[], 0, focused, timers])
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 100, height: 100 }))
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 0, y: 150, width: 100, height: 20 }))
    flashTreeRows(host, '/v/Note.md', false, { quiet: true })
    expect(scroll.mock.calls).toEqual([[{ block: 'center' }]])
    expect(scroll.mock.contexts).toEqual([first])
  })

  it('returns null and schedules nothing when the exact row is absent', () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    host.append(row('/v/Other.md'))
    expect(flashTreeRows(host, '/v/Note.md')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
