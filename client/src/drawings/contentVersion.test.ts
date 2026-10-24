import { describe, expect, it } from 'vitest'
import { contentVersion } from './contentVersion'

const text = { id: 't', type: 'text', text: 'Hi', lineBolds: [true], version: 4, versionNonce: 11, updated: 100 }
const rect = { id: 'r', type: 'rectangle', x: 0, version: 2, versionNonce: 22, updated: 100 }

describe('contentVersion', () => {
  it('starts at the sum of the versions it is first shown', () => {
    expect(contentVersion()([text, rect])).toBe(6)
  })

  it('a bump that rewrote the same content (a text editor left with no edit) does not count (YAZ-3210)', () => {
    const count = contentVersion()
    const base = count([text, rect])
    // `newElementWith` hands back fresh line arrays with the same values, and new stamps.
    expect(count([{ ...text, lineBolds: [true], version: 5, versionNonce: 99, updated: 200 }, rect])).toBe(base)
    expect(count([{ ...text, lineBolds: [true], version: 6, versionNonce: 98, updated: 300 }, rect])).toBe(base)
  })

  it('a real edit counts, and a no-op bump after it does not take it back', () => {
    const count = contentVersion()
    const base = count([text, rect])
    const edited = count([{ ...text, text: 'Hi!', version: 5 }, rect])
    expect(edited).not.toBe(base)
    expect(count([{ ...text, text: 'Hi!', version: 6, versionNonce: 1 }, rect])).toBe(edited)
    expect(count([{ ...text, text: 'Hi!', lineBolds: [false], version: 7 }, rect])).toBeGreaterThan(edited)
  })

  it('never falls: content returned to what was first seen is another change, not a return to clean', () => {
    const count = contentVersion()
    const base = count([rect])
    count([{ ...rect, x: 40, version: 3 }])
    expect(count([{ ...rect, x: 0, version: 4 }])).toBeGreaterThan(base)
  })

  it('a deletion is content: `isDeleted` moving counts', () => {
    const count = contentVersion()
    const base = count([text, rect])
    expect(count([text, { ...rect, isDeleted: true, version: 3 }])).toBeGreaterThan(base)
  })
})
