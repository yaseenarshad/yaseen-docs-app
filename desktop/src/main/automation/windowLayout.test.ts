import { describe, expect, it } from 'vitest'
import { TILE_PRESETS, type DisplayInfo } from '@shared/automationNavigation'
import type { WindowBounds } from '@shared/types'
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  clampCustomBounds,
  displayIdForBounds,
  resolveDisplay,
  tileBounds,
} from './windowLayout'

const PRIMARY: DisplayInfo = {
  id: 1,
  label: 'Built-in',
  primary: true,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 25, width: 1920, height: 1055 },
}

const LEFT_NEGATIVE: DisplayInfo = {
  id: 2,
  label: 'Left External',
  primary: false,
  bounds: { x: -2560, y: -120, width: 2560, height: 1440 },
  workArea: { x: -2560, y: -95, width: 2560, height: 1415 },
}

const RIGHT_DISPLAY: DisplayInfo = {
  id: 3,
  label: 'Right External',
  primary: false,
  bounds: { x: 1920, y: 0, width: 1440, height: 900 },
  workArea: { x: 1920, y: 25, width: 1440, height: 875 },
}

const DISPLAYS = [PRIMARY, LEFT_NEGATIVE, RIGHT_DISPLAY]

describe('windowLayout.tileBounds', () => {
  it('computes exact integer bounds for all 15 presets on a standard workArea', () => {
    const wa = PRIMARY.workArea // { x: 0, y: 25, width: 1920, height: 1055 }
    expect(tileBounds('left', wa)).toEqual({ x: 0, y: 25, width: 960, height: 1055 })
    expect(tileBounds('right', wa)).toEqual({ x: 960, y: 25, width: 960, height: 1055 })
    expect(tileBounds('top', wa)).toEqual({ x: 0, y: 25, width: 1920, height: 527 })
    expect(tileBounds('bottom', wa)).toEqual({ x: 0, y: 552, width: 1920, height: 528 })
    expect(tileBounds('top-left', wa)).toEqual({ x: 0, y: 25, width: 960, height: 527 })
    expect(tileBounds('top-right', wa)).toEqual({ x: 960, y: 25, width: 960, height: 527 })
    expect(tileBounds('bottom-left', wa)).toEqual({ x: 0, y: 552, width: 960, height: 528 })
    expect(tileBounds('bottom-right', wa)).toEqual({ x: 960, y: 552, width: 960, height: 528 })
    expect(tileBounds('left-third', wa)).toEqual({ x: 0, y: 25, width: 640, height: 1055 })
    expect(tileBounds('center-third', wa)).toEqual({ x: 640, y: 25, width: 640, height: 1055 })
    expect(tileBounds('right-third', wa)).toEqual({ x: 1280, y: 25, width: 640, height: 1055 })
    expect(tileBounds('left-two-thirds', wa)).toEqual({ x: 0, y: 25, width: 1280, height: 1055 })
    expect(tileBounds('right-two-thirds', wa)).toEqual({ x: 640, y: 25, width: 1280, height: 1055 })
    expect(tileBounds('center', wa)).toEqual({ x: 192, y: 130, width: 1536, height: 844 })
    expect(tileBounds('maximize', wa)).toEqual({ x: 0, y: 25, width: 1920, height: 1055 })
  })

  it('handles negative multi-monitor coordinates for all 15 presets', () => {
    const wa = LEFT_NEGATIVE.workArea // { x: -2560, y: -95, width: 2560, height: 1415 }
    for (const preset of TILE_PRESETS) {
      const b = tileBounds(preset, wa)
      expect(Number.isInteger(b.x), `${preset}.x`).toBe(true)
      expect(Number.isInteger(b.y), `${preset}.y`).toBe(true)
      expect(Number.isInteger(b.width), `${preset}.width`).toBe(true)
      expect(Number.isInteger(b.height), `${preset}.height`).toBe(true)
      expect(b.x, `${preset}.x >= wa.x`).toBeGreaterThanOrEqual(wa.x)
      expect(b.y, `${preset}.y >= wa.y`).toBeGreaterThanOrEqual(wa.y)
      expect(b.x + b.width, `${preset} right <= wa right`).toBeLessThanOrEqual(wa.x + wa.width)
      expect(b.y + b.height, `${preset} bottom <= wa bottom`).toBeLessThanOrEqual(wa.y + wa.height)
    }
    expect(tileBounds('left', wa)).toEqual({ x: -2560, y: -95, width: 1280, height: 1415 })
    expect(tileBounds('right', wa)).toEqual({ x: -1280, y: -95, width: 1280, height: 1415 })
    expect(tileBounds('maximize', wa)).toEqual(wa)
  })

  it('partitions odd workArea dimensions with zero gaps and zero overlaps', () => {
    const odd: WindowBounds = { x: -1441, y: 37, width: 1441, height: 901 }
    const l = tileBounds('left', odd)
    const r = tileBounds('right', odd)
    expect(l.x + l.width).toBe(r.x)
    expect(l.width + r.width).toBe(odd.width)

    const t = tileBounds('top', odd)
    const b = tileBounds('bottom', odd)
    expect(t.y + t.height).toBe(b.y)
    expect(t.height + b.height).toBe(odd.height)

    const t1 = tileBounds('left-third', odd)
    const t2 = tileBounds('center-third', odd)
    const t3 = tileBounds('right-third', odd)
    expect(t1.x + t1.width).toBe(t2.x)
    expect(t2.x + t2.width).toBe(t3.x)
    expect(t1.width + t2.width + t3.width).toBe(odd.width)

    const l23 = tileBounds('left-two-thirds', odd)
    const r23 = tileBounds('right-two-thirds', odd)
    expect(l23.x + l23.width).toBe(t3.x)
    expect(t1.x + t1.width).toBe(r23.x)
    expect(r23.x + r23.width).toBe(odd.x + odd.width)
  })
})

describe('windowLayout.resolveDisplay', () => {
  it('resolves primary, cursor, next, numeric ID, and default selectors', () => {
    expect(resolveDisplay(DISPLAYS, 'primary')).toBe(PRIMARY)
    expect(resolveDisplay(DISPLAYS, 'cursor', undefined, { x: -500, y: 100 })).toBe(LEFT_NEGATIVE)
    expect(resolveDisplay(DISPLAYS, 'cursor', undefined, { x: 2000, y: 300 })).toBe(RIGHT_DISPLAY)
    // Default with currentBounds stays on that display; without falls back to primary.
    expect(resolveDisplay(DISPLAYS, undefined, { x: -2000, y: 0, width: 800, height: 600 })).toBe(LEFT_NEGATIVE)
    expect(resolveDisplay(DISPLAYS, undefined)).toBe(PRIMARY)
    // 'next' cycles through the display array and wraps around.
    expect(resolveDisplay(DISPLAYS, 'next', { x: 100, y: 100, width: 800, height: 600 })).toBe(LEFT_NEGATIVE)
    expect(resolveDisplay(DISPLAYS, 'next', { x: -2000, y: 0, width: 800, height: 600 })).toBe(RIGHT_DISPLAY)
    expect(resolveDisplay(DISPLAYS, 'next', { x: 2000, y: 100, width: 800, height: 600 })).toBe(PRIMARY)
    // Single-display 'next' returns that display.
    expect(resolveDisplay([PRIMARY], 'next', { x: 100, y: 100, width: 800, height: 600 })).toBe(PRIMARY)
    // Explicit numeric display ID.
    expect(resolveDisplay(DISPLAYS, 2)).toBe(LEFT_NEGATIVE)
    expect(resolveDisplay(DISPLAYS, 3)).toBe(RIGHT_DISPLAY)
  })

  it('throws DISPLAY_NOT_FOUND for unknown numeric ID or empty display list, and INVALID_INPUT for bad strings', () => {
    expect(() => resolveDisplay(DISPLAYS, 999)).toThrow(expect.objectContaining({ code: 'DISPLAY_NOT_FOUND' }))
    expect(() => resolveDisplay([], 'primary')).toThrow(expect.objectContaining({ code: 'DISPLAY_NOT_FOUND' }))
    expect(() => resolveDisplay(DISPLAYS, 'bogus' as never)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }))
  })

  it('finds displayIdForBounds by largest overlap or nearest center', () => {
    expect(displayIdForBounds(DISPLAYS, { x: -1000, y: 100, width: 800, height: 600 })).toBe(2)
    expect(displayIdForBounds(DISPLAYS, { x: 5000, y: 100, width: 800, height: 600 })).toBe(3)
    expect(displayIdForBounds([], { x: 0, y: 0, width: 800, height: 600 })).toBe(0)
  })
})

describe('windowLayout.clampCustomBounds', () => {
  it('merges partial updates onto current bounds and enforces minimum and maximum sizes', () => {
    const current: WindowBounds = { x: 100, y: 100, width: 1000, height: 700 }
    expect(clampCustomBounds({ x: 200 }, current, PRIMARY.workArea)).toEqual({ x: 200, y: 100, width: 1000, height: 700 })
    expect(clampCustomBounds({ width: 100, height: 50 }, current, PRIMARY.workArea)).toEqual({
      x: 100,
      y: 100,
      width: MIN_WINDOW_WIDTH,
      height: MIN_WINDOW_HEIGHT,
    })
    expect(clampCustomBounds({ width: 5000, height: 4000 }, current, PRIMARY.workArea)).toEqual(PRIMARY.workArea)
  })

  it('respects tiny workAreas smaller than MIN_WINDOW_WIDTH/HEIGHT', () => {
    const tiny: WindowBounds = { x: 0, y: 0, width: 320, height: 240 }
    expect(clampCustomBounds({ width: 100, height: 100 }, { x: 0, y: 0, width: 320, height: 240 }, tiny)).toEqual(tiny)
  })

  it('preserves negative coordinates on left/top external displays without clamping x >= 0', () => {
    const wa = LEFT_NEGATIVE.workArea // { x: -2560, y: -95, width: 2560, height: 1415 }
    const current: WindowBounds = { x: -2000, y: 0, width: 1000, height: 700 }
    expect(clampCustomBounds({ x: -2400, y: -50 }, current, wa)).toEqual({
      x: -2400,
      y: -50,
      width: 1000,
      height: 700,
    })
    // Pushing past left/top clamps to wa.x / wa.y (not 0).
    expect(clampCustomBounds({ x: -4000, y: -500 }, current, wa)).toEqual({
      x: -2560,
      y: -95,
      width: 1000,
      height: 700,
    })
    // Pushing past right/bottom keeps the window inside wa.
    expect(clampCustomBounds({ x: 500, y: 2000 }, current, wa)).toEqual({
      x: -1000,
      y: 620,
      width: 1000,
      height: 700,
    })
  })
})
