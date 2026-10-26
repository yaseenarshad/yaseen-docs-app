import { afterEach, describe, expect, it, vi } from 'vitest'
import { filesClickHow, watchFilesKeys } from './filesWindow'

describe('filesClickHow (YAZ-3357 D7, bug YAZ-3399)', () => {
  let stop: (() => void) | undefined
  afterEach(() => {
    stop?.()
    vi.useRealTimers()
  })

  it('an open during an Enter key press keeps the tab; any other open previews', () => {
    stop = watchFilesKeys(window)
    expect(filesClickHow()).toBe('preview')
    let how: ReturnType<typeof filesClickHow> | undefined
    const onEnter = (): void => {
      how = filesClickHow()
    }
    window.addEventListener('keydown', onEnter)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    window.removeEventListener('keydown', onEnter)
    expect(how).toBe('keep')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
  })

  it('the Enter ends with its task: a later open previews, and a stale click event never decides', () => {
    vi.useFakeTimers()
    stop = watchFilesKeys(window)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(filesClickHow()).toBe('keep')
    vi.runAllTimers()
    expect(filesClickHow()).toBe('preview')
    // A click with no pointer, its dispatch long over (what `window.event` could hold): it plays no part.
    document.body.dispatchEvent(new MouseEvent('click', { detail: 0 }))
    expect(filesClickHow()).toBe('preview')
  })

  it('an Enter of an IME composition is no Enter; with the watch stopped nothing counts', () => {
    stop = watchFilesKeys(window)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))
    expect(filesClickHow()).toBe('preview')
    stop()
    stop = undefined
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(filesClickHow()).toBe('preview')
  })
})
