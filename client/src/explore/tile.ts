/**
 * TILE (YAZ-4944): the explore windows arranged in one click. Pure: the stack (`ExploreStack.tsx`) picks the
 * windows, these say where each goes, and `useLayerBoxes` writes the boxes (style only, as a drag does).
 *
 *   two          side by side            ⌥⌘2
 *   three        three across            ⌥⌘3
 *   grid         2 × 2                   ⌥⌘4
 *   gridCentre   2 × 2 and one in the middle, on top   ⌥⌘5
 *   stack        back to the stack places              ⌥⌘0
 *
 * Even `TILE_GAP` gaps, inside the area under the top bar. The Tile button picks the layout by how many notes and
 * boards are open (`layoutForCount`); more than 5: the 5 used last. A tiled window is still a window: a drag, a
 * resize, a raise and × work as before.
 */
import type { LayerBox } from './layers'

export type TileLayout = 'two' | 'three' | 'grid' | 'gridCentre'
export type ArrangeLayout = TileLayout | 'stack'

/** How many windows each layout holds. */
export const TILE_PLACES: Record<TileLayout, number> = { two: 2, three: 3, grid: 4, gridCentre: 5 }
/** The gap between the windows and around them, in CSS px. */
export const TILE_GAP = 12
/** The glide to the new places (none with reduced motion). */
export const TILE_MS = 200

/** The layout for `count` open notes and boards; null under 2 (nothing to arrange). */
export function layoutForCount(count: number): TileLayout | null {
  return count < 2 ? null : count === 2 ? 'two' : count === 3 ? 'three' : count === 4 ? 'grid' : 'gridCentre'
}

export interface TileArea {
  x: number
  y: number
  width: number
  height: number
}

/** The cells of `layout` in `area`, in reading order; the grid + centre's fifth cell is the middle one. */
export function tileCells(layout: TileLayout, area: TileArea, gap = TILE_GAP): LayerBox[] {
  const cols = layout === 'two' ? 2 : layout === 'three' ? 3 : 2
  const rows = layout === 'grid' || layout === 'gridCentre' ? 2 : 1
  const width = (area.width - (cols + 1) * gap) / cols
  const height = (area.height - (rows + 1) * gap) / rows
  const cells: LayerBox[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: area.x + gap + c * (width + gap), y: area.y + gap + r * (height + gap), width, height })
  if (layout === 'gridCentre') cells.push({ x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height })
  return cells
}

/** The windows a layout takes by default: the most recently used first (the front order), notes and boards, searches only when asked. */
export function pickRecent(backToFront: readonly { id: number; kind: string }[], places: number, includeSearches: boolean): number[] {
  return backToFront
    .filter((l) => includeSearches || l.kind !== 'search')
    .map((l) => l.id)
    .reverse()
    .slice(0, places)
}

/** Each picked window's cell (`picked` most recent first): in the grid + centre the most recent takes the middle. */
export function tileBoxes(layout: TileLayout, picked: readonly number[], area: TileArea): Map<number, LayerBox> {
  const cells = tileCells(layout, area)
  const ids = layout === 'gridCentre' && picked.length === cells.length ? [...picked.slice(1), picked[0]] : picked
  return new Map(ids.slice(0, cells.length).map((id, i) => [id, cells[i]]))
}

/**
 * The front order after a tile (by id, back to front): the other windows behind as they were, the tiled ones in
 * front, the most recently used still the frontmost (so the next Tile picks the same ones), which puts the grid +
 * centre's middle one on top.
 */
export function tileOrder(backToFront: readonly { id: number }[], picked: readonly number[]): number[] {
  const set = new Set(picked)
  const rest = backToFront.map((l) => l.id).filter((id) => !set.has(id))
  return [...rest, ...[...picked].reverse()]
}
