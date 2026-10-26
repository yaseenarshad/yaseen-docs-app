import { describe, expect, it } from 'vitest'
import { filesClickHow } from './filesWindow'

describe('filesClickHow (YAZ-3357 D7)', () => {
  it('a pointer click previews; Enter, or the click a key makes (detail 0), keeps — while that event is being handled', () => {
    const during = (event: Event): ReturnType<typeof filesClickHow> => {
      let how: ReturnType<typeof filesClickHow> | undefined
      const el = document.createElement('button')
      el.addEventListener(event.type, (e) => (how = filesClickHow(e)))
      el.dispatchEvent(event)
      return how!
    }
    expect(during(new MouseEvent('click', { detail: 1 }))).toBe('preview')
    expect(during(new MouseEvent('click', { detail: 0 }))).toBe('keep')
    expect(during(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe('keep')
    expect(during(new KeyboardEvent('keydown', { key: 'a' }))).toBe('preview')
  })

  it('an event that is no longer being handled — a stale `window.event`, or none — never decides: the open previews', () => {
    const stale = new MouseEvent('click', { detail: 0 })
    document.body.dispatchEvent(stale)
    expect(filesClickHow(stale)).toBe('preview')
    expect(filesClickHow(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe('preview')
    expect(filesClickHow(undefined)).toBe('preview')
  })
})
