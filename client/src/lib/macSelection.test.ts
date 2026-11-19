/** The Mac's selection colour on the root (YAZ-5941). */
import { describe, expect, it, vi } from 'vitest'
import { applyMacSelection, followMacSelection, MAC_SELECTION_VAR } from './macSelection'

const root = () => document.createElement('div')
const value = (el: HTMLElement) => el.style.getPropertyValue(MAC_SELECTION_VAR)

describe('applyMacSelection', () => {
  it('sets a #rrggbb colour and removes it for null or anything else', () => {
    const el = root()
    applyMacSelection('#3f638b', el)
    expect(value(el)).toBe('#3f638b')
    applyMacSelection(null, el)
    expect(value(el)).toBe('')
    applyMacSelection('#3f638b', el)
    applyMacSelection('red; color: blue', el)
    expect(value(el)).toBe('')
  })
})

describe('followMacSelection', () => {
  it('reads once, then follows main`s pushes; unsubscribes', async () => {
    const el = root()
    let push: (c: string | null) => void = () => undefined
    const off = vi.fn()
    const stop = followMacSelection({ selectionColour: async () => '#3f638b', onSelectionColour: (fn) => ((push = fn), off) }, el)
    await Promise.resolve()
    expect(value(el)).toBe('#3f638b')
    push('#7a6a2c')
    expect(value(el)).toBe('#7a6a2c')
    push(null)
    expect(value(el)).toBe('')
    stop()
    expect(off).toHaveBeenCalled()
  })

  it('a push before the read answers wins over the read', async () => {
    const el = root()
    let answer: (c: string | null) => void = () => undefined
    let push: (c: string | null) => void = () => undefined
    followMacSelection({ selectionColour: () => new Promise((r) => (answer = r)), onSelectionColour: (fn) => ((push = fn), () => undefined) }, el)
    push('#7a6a2c')
    answer('#3f638b')
    await Promise.resolve()
    expect(value(el)).toBe('#7a6a2c')
  })

  it('no bridge (a test, the phone, the web) sets nothing; a failed read sets nothing', async () => {
    const el = root()
    expect(() => followMacSelection(undefined, el)()).not.toThrow()
    followMacSelection({ selectionColour: () => Promise.reject(new Error('older main')), onSelectionColour: () => () => undefined }, el)
    await Promise.resolve()
    expect(value(el)).toBe('')
  })
})
