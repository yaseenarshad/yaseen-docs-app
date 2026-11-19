/** The Mac's selection colour for the editor in dark (YAZ-5941). */
import { describe, expect, it, vi } from 'vitest'
import { darkSelectionColour, luminance, parseMacColour, watchSelectionColour } from './selectionColour'

describe('parseMacColour', () => {
  it('reads getColor`s #RRGGBBAA, and #RRGGBB, as lower-case #rrggbb', () => {
    expect(parseMacColour('#3F638BFF')).toBe('#3f638b')
    expect(parseMacColour('#3F638B')).toBe('#3f638b')
  })
  it('anything else is none', () => {
    for (const raw of ['', '3F638B', '#3F6', '#3F638BF', 'blue', null, undefined, 42]) expect(parseMacColour(raw)).toBeNull()
  })
})

describe('darkSelectionColour', () => {
  it('the dark colours macOS gives are used (default blue, and a dark yellow)', () => {
    expect(darkSelectionColour('#3F638BFF')).toBe('#3f638b')
    expect(darkSelectionColour('#7A6A2CFF')).toBe('#7a6a2c')
  })
  it('the light colour (the Mac in Light, the app dark) is none: white text could not be read on it', () => {
    expect(luminance('#b3d7ff')).toBeGreaterThan(0.3)
    expect(darkSelectionColour('#B3D7FFFF')).toBeNull()
  })
})

describe('watchSelectionColour', () => {
  const source = (colours: string[]) => {
    let changed: () => void = () => undefined
    const off = vi.fn()
    let i = 0
    return {
      fire: () => changed(),
      off,
      read: vi.fn(() => colours[Math.min(i++, colours.length - 1)]),
      subscribe: (fn: () => void) => ((changed = fn), off),
    }
  }

  it('reads at once, and sends only a colour that changed', () => {
    const s = source(['#3F638BFF', '#3F638BFF', '#7A6A2CFF', '#B3D7FFFF'])
    const emit = vi.fn()
    const w = watchSelectionColour(s, emit)
    expect(w.current()).toBe('#3f638b')
    s.fire()
    expect(emit).not.toHaveBeenCalled()
    s.fire()
    expect(emit).toHaveBeenLastCalledWith('#7a6a2c')
    s.fire()
    expect(emit).toHaveBeenLastCalledWith(null)
    expect(w.current()).toBeNull()
    expect(emit).toHaveBeenCalledTimes(2)
    w.stop()
    expect(s.off).toHaveBeenCalled()
  })

  it('a read that throws (off macOS) is none', () => {
    const w = watchSelectionColour({ read: () => { throw new Error('no') }, subscribe: () => () => undefined }, vi.fn())
    expect(w.current()).toBeNull()
  })
})
