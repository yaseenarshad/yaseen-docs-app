/** Tile (YAZ-4944): the layout by count, each layout's cells with even gaps, and which windows a layout takes. */
import { describe, expect, it } from 'vitest'
import { blockersOf, clashesOf, keyRow } from '@shared/keys'
import { MIN_BOX_WIDTH } from './layers'
import { layoutForCount, pickRecent, TILE_GAP, TILE_PLACES, tileBoxes, tileCells, tileOrder } from './tile'

const area = { x: 0, y: 60, width: 1212, height: 812 }
const g = TILE_GAP

describe('the layout by count', () => {
  it('2 side by side, 3 across, 4 a grid, 5 a grid + centre; more than 5: the grid + centre; fewer than 2: none', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(layoutForCount)).toEqual([null, null, 'two', 'three', 'grid', 'gridCentre', 'gridCentre'])
    expect(TILE_PLACES).toEqual({ two: 2, three: 3, grid: 4, gridCentre: 5 })
  })
})

describe('the cells: even 12 px gaps, inside the area', () => {
  it('side by side and three across: full height, equal widths', () => {
    const two = tileCells('two', area)
    const w2 = (1212 - 3 * g) / 2
    expect(two).toEqual([
      { x: g, y: 60 + g, width: w2, height: 812 - 2 * g },
      { x: 2 * g + w2, y: 60 + g, width: w2, height: 812 - 2 * g },
    ])
    const three = tileCells('three', area)
    expect(three.map((c) => c.width)).toEqual([388, 388, 388])
    expect(three.map((c) => c.x)).toEqual([12, 412, 812])
  })

  it('a grid: four equal cells; the grid + centre: the same four and a fifth of the same size in the middle', () => {
    const w = (1212 - 3 * g) / 2
    const h = (812 - 3 * g) / 2
    const grid = tileCells('grid', area)
    expect(grid).toEqual([
      { x: g, y: 60 + g, width: w, height: h },
      { x: 2 * g + w, y: 60 + g, width: w, height: h },
      { x: g, y: 60 + 2 * g + h, width: w, height: h },
      { x: 2 * g + w, y: 60 + 2 * g + h, width: w, height: h },
    ])
    const five = tileCells('gridCentre', area)
    expect(five.slice(0, 4)).toEqual(grid)
    expect(five[4]).toEqual({ x: (1212 - w) / 2, y: 60 + (812 - h) / 2, width: w, height: h })
  })
})

describe('a narrow window (YAZ-4944 nit): fewer columns, never an overlap', () => {
  const overlap = (a: { x: number; y: number; width: number; height: number | null }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + (b.height ?? 0) && b.y < a.y + (a.height ?? 0)
  const noOverlap = (cells: ReturnType<typeof tileCells>) => cells.every((a, i) => cells.every((b, j) => i === j || !overlap(a, b)))

  it('three across where a third would be under 240 px: two on top, one under them across the width', () => {
    const narrow = { x: 0, y: 60, width: 700, height: 600 }
    const three = tileCells('three', narrow)
    const w = (700 - 3 * g) / 2
    const h = (600 - 3 * g) / 2
    expect(three).toEqual([
      { x: g, y: 60 + g, width: w, height: h },
      { x: 2 * g + w, y: 60 + g, width: w, height: h },
      { x: g, y: 60 + 2 * g + h, width: 700 - 2 * g, height: h },
    ])
    expect(three.every((c) => c.width >= MIN_BOX_WIDTH)).toBe(true)
    expect(noOverlap(three)).toBe(true)
  })

  it('two and the grid where a half would be under 240 px: one column, each window across the width', () => {
    const tiny = { x: 0, y: 60, width: 480, height: 800 }
    const two = tileCells('two', tiny)
    expect(two.map((c) => [c.x, c.width])).toEqual([[g, 480 - 2 * g], [g, 480 - 2 * g]])
    expect(noOverlap(two)).toBe(true)
    const grid = tileCells('grid', tiny)
    expect(grid).toHaveLength(4)
    expect(grid.every((c) => c.width === 480 - 2 * g)).toBe(true)
    expect(noOverlap(grid)).toBe(true)
    // The grid + centre keeps its fifth in the middle, on top, by design.
    expect(noOverlap(tileCells('gridCentre', tiny).slice(0, 4))).toBe(true)
  })

  it('at every width from 300 to 1400 px, no cell of any layout is under 240 px wide where one fits, and none overlap', () => {
    for (let width = 300; width <= 1400; width += 10) {
      const box = { x: 0, y: 60, width, height: 800 }
      for (const layout of ['two', 'three', 'grid'] as const) {
        const cells = tileCells(layout, box)
        expect(cells).toHaveLength(TILE_PLACES[layout])
        expect(noOverlap(cells)).toBe(true)
        if (width - 2 * g >= MIN_BOX_WIDTH) expect(cells.every((c) => c.width >= MIN_BOX_WIDTH)).toBe(true)
      }
    }
  })
})

describe('which windows a layout takes', () => {
  // Back to front: s1, n1, b1, s2, n2, n3 (n3 in front).
  const layers = [
    { id: 1, kind: 'search' },
    { id: 2, kind: 'page' },
    { id: 3, kind: 'board' },
    { id: 4, kind: 'search' },
    { id: 5, kind: 'page' },
    { id: 6, kind: 'page' },
  ] as const

  it('the most recently used first (the front order), searches left out unless asked; at most the places', () => {
    expect(pickRecent(layers, 5, false)).toEqual([6, 5, 3, 2])
    expect(pickRecent(layers, 2, false)).toEqual([6, 5])
    expect(pickRecent(layers, 5, true)).toEqual([6, 5, 4, 3, 2])
  })

  it('the front order after a tile: the tiled windows in front of the others, the most recent still in front (the centre one on top)', () => {
    expect(tileOrder(layers, [6, 5, 3, 2])).toEqual([1, 4, 2, 3, 5, 6])
    // The grid + centre: the most recent window takes the centre and stands on top.
    expect(tileOrder(layers, [6, 5, 4, 3, 2])).toEqual([1, 2, 3, 4, 5, 6])
    expect(tileBoxes('gridCentre', [6, 5, 4, 3, 2], area).get(6)).toEqual(tileCells('gridCentre', area)[4])
  })
})

describe('the Tile keys (Settings › Hotkeys › Explore)', () => {
  const IDS = ['explore.tileTwo', 'explore.tileThree', 'explore.tileGrid', 'explore.tileGridCentre', 'explore.tileStack']
  it('⌥⌘2 … ⌥⌘5 and ⌥⌘0, changeable, in the Explore place; no row blocks them and they block none', () => {
    expect(IDS.map((id) => keyRow(id)?.keys)).toEqual([['CmdOrCtrl+Alt+2'], ['CmdOrCtrl+Alt+3'], ['CmdOrCtrl+Alt+4'], ['CmdOrCtrl+Alt+5'], ['CmdOrCtrl+Alt+0']])
    for (const id of IDS) {
      const row = keyRow(id)!
      expect(row.scope).toBe('explore')
      expect(row.changeable).toBe(true)
      expect(clashesOf(row, row.keys[0], undefined, undefined)).toEqual([])
      expect(blockersOf(row, undefined, undefined)).toEqual([])
    }
  })
})
