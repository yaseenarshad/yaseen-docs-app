import { describe, expect, it } from 'vitest'
import { inStripBand } from './blockHandleGate'

describe('inStripBand', () => {
  // Geometry mirrors guideLines.ts: strip centre = ul.left − (2.15em/2 + 5px), half-width 5px.
  // At 16px font: centre = left − 22.2.
  it('hits the 10px band centred left of the list edge', () => {
    const left = 342
    const centre = left - (2.15 * 16) / 2 - 5
    expect(inStripBand(centre, left, 16)).toBe(true)
    expect(inStripBand(centre - 5, left, 16)).toBe(true)
    expect(inStripBand(centre + 5, left, 16)).toBe(true)
    expect(inStripBand(centre - 6, left, 16)).toBe(false)
    expect(inStripBand(centre + 6, left, 16)).toBe(false)
  })

  it('scales with the font size like the CSS strip does', () => {
    const left = 100
    expect(inStripBand(left - (2.15 * 28) / 2 - 5, left, 28)).toBe(true)
    // The 16px-font centre is 12.9px away from the 28px-font centre — outside the 5px half-width.
    expect(inStripBand(left - (2.15 * 16) / 2 - 5, left, 28)).toBe(false)
  })
})
