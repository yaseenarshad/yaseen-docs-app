/**
 * YAZ-5247 (CP5): which input arms the phone code's gate in main (`ipc/phone.ts`). Only a click (a mouse down or up)
 * or an activation key (Enter, Space) down or up, as the OS gives it to the page. Not a mouse move, a wheel, a char,
 * typing other keys, a focus. The time is per web contents, and goes with it.
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { WebContents } from 'electron'
import { lastInputAt, trackInput } from './inputSeen'

let ids = 100
function fakeContents() {
  const e = new EventEmitter() as EventEmitter & { id: number }
  e.id = ids++
  return { contents: e as unknown as WebContents, emit: (input: Record<string, unknown>) => e.emit('input-event', {}, input), destroy: () => e.emit('destroyed') }
}

describe('trackInput (YAZ-5247)', () => {
  it('a mouse down or up, and Enter or Space down or up, count', () => {
    for (const input of [{ type: 'mouseDown' }, { type: 'mouseUp' }, { type: 'keyDown', key: 'Enter' }, { type: 'rawKeyDown', key: ' ' }, { type: 'keyUp', key: 'Enter' }]) {
      const f = fakeContents()
      let t = 500
      trackInput(f.contents, () => t)
      f.emit(input)
      expect(lastInputAt(f.contents)).toBe(500)
      t = 900
    }
  })

  it('a mouse move, a wheel, a char, other keys, a touch, an enter of the mouse do not', () => {
    const f = fakeContents()
    trackInput(f.contents, () => 1)
    for (const input of [{ type: 'mouseMove' }, { type: 'mouseWheel' }, { type: 'char', key: 'a' }, { type: 'keyDown', key: 'a' }, { type: 'rawKeyDown', key: 'Tab' }, { type: 'mouseEnter' }, { type: 'touchStart' }, { type: 'gestureTap' }, {}])
      f.emit(input)
    expect(lastInputAt(f.contents)).toBeNull()
  })

  it('the time is per web contents, and is gone when the contents is destroyed', () => {
    const a = fakeContents()
    const b = fakeContents()
    trackInput(a.contents, () => 7)
    trackInput(b.contents, () => 8)
    a.emit({ type: 'mouseDown' })
    expect(lastInputAt(a.contents)).toBe(7)
    expect(lastInputAt(b.contents)).toBeNull()
    a.destroy()
    expect(lastInputAt(a.contents)).toBeNull()
  })
})
