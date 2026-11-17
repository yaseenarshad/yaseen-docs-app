import { describe, expect, it } from 'vitest'
import { REVIEW_ZOOM_KEY, readReviewZoom, writeReviewZoom } from './reviewZoomPref'

/** YAZ-5706: the phone Review's zoom, kept on this phone (not the vault): a Mac zoom step, 100 by default and never written. */
const memory = () => {
  const m = new Map<string, string>()
  return { m, s: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } }
}

describe('YAZ-5706: the Review zoom kept on this phone', () => {
  it('100 with nothing kept; a step kept and read back; 100 takes the entry away', () => {
    const { m, s } = memory()
    expect(readReviewZoom(s)).toBe(100)
    writeReviewZoom(150, s)
    expect(m.get(REVIEW_ZOOM_KEY)).toBe('150')
    expect(readReviewZoom(s)).toBe(150)
    writeReviewZoom(100, s)
    expect(m.has(REVIEW_ZOOM_KEY)).toBe(false)
  })

  it('a value off the Mac\'s steps, or out of range, reads as 100', () => {
    const { m, s } = memory()
    for (const bad of ['117', '20', '900', 'big', '']) {
      m.set(REVIEW_ZOOM_KEY, bad)
      expect(readReviewZoom(s)).toBe(100)
    }
  })

  it('no storage (Private Browsing): 100, and a write does nothing', () => {
    const broken = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') }, removeItem: () => { throw new Error('no') } }
    expect(readReviewZoom(broken)).toBe(100)
    expect(() => writeReviewZoom(200, broken)).not.toThrow()
    expect(readReviewZoom(null)).toBe(100)
  })
})
