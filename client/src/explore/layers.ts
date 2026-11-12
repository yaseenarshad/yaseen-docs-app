/**
 * The explore stack's model (YAZ-2571): an ordered list of layers over the workspace, the newest on top. A search
 * layer holds a search panel; a note layer holds one note, read or edited. Each opening is its own layer with its
 * own id, so A → B → A is three layers, each with its own scroll place. Pure: the component (`ExploreStack.tsx`)
 * keeps the list in state and the DOM keeps each layer's scroll.
 */
import { fileKind } from '@shared/fileKind'

export type ExploreLayer =
  | { id: number; kind: 'search' }
  | {
      id: number
      kind: 'note'
      path: string
      mode: 'read' | 'edit'
      /** Opened from a search layer (round 3): that layer's id and the row's place in its list, where ‹ › step from. A note from a link has none. */
      from?: { search: number; at: number }
      /** Bumped when the note was deleted under the layer: the layer reads again and says it is gone. */
      gone?: number
    }

/** The most layers the stack holds (the recommendation on YAZ-2571): a 13th push is refused with a notice. */
export const MAX_LAYERS = 12

/** The widths of the two panels in CSS px (Mochi's 500 for search; a note reads at the preview panel's 720), and the gap kept to the window's edges. */
export const SEARCH_WIDTH = 500
export const NOTE_WIDTH = 720
export const EDGE_GAP = 72

/** Each layer sits this much right of the one under it; the first one also this much lower (Mochi's desktop offsets). */
export const LAYER_STEP = 15

/** The motion of a new layer: a search in 100 ms, a note in 150 ms, `cubic-bezier(.4,.3,0,1)`, fade-up. */
export const SEARCH_MS = 100
export const NOTE_MS = 150

let nextId = 1
/** A fresh layer id: unique for the window's life, never a note's id. */
export const newLayerId = (): number => nextId++

/** The list with `layer` on top, or null when the stack is full. */
export function pushLayer(layers: readonly ExploreLayer[], layer: ExploreLayer): ExploreLayer[] | null {
  return layers.length >= MAX_LAYERS ? null : [...layers, layer]
}

/** The note layer nearest the top, or null: what ⌘↵ opens in a tab. */
export function topNote(layers: readonly ExploreLayer[]): Extract<ExploreLayer, { kind: 'note' }> | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (layer.kind === 'note') return layer
  }
  return null
}

/** A panel's width in a window `windowWidth` wide: its own, cut to leave `EDGE_GAP` at each side. */
export const panelWidth = (kind: ExploreLayer['kind'], windowWidth: number): number => Math.max(240, Math.min(kind === 'search' ? SEARCH_WIDTH : NOTE_WIDTH, windowWidth - 2 * EDGE_GAP))

/**
 * Where layer `index` stands: `left` from the window's left edge, in CSS px, and `top` added to the 10vh margin. The
 * offset is `index × 15` right and `min(index, 1) × 15` down, clamped so the panel keeps 8 px to the window's right
 * edge: a narrow window gets a smaller offset, never a panel off screen.
 */
export function layerPlace(kind: ExploreLayer['kind'], index: number, windowWidth: number): { left: number; top: number; width: number } {
  const width = panelWidth(kind, windowWidth)
  const centred = Math.max(0, Math.floor((windowWidth - width) / 2))
  const room = Math.max(0, windowWidth - 8 - width - centred)
  return { left: centred + Math.min(index * LAYER_STEP, room), top: Math.min(index, 1) * LAYER_STEP, width }
}

/* ---------- ‹ › through the search (round 3) ---------- */

/**
 * The row ‹ › go to from the note at `at` (its place when it opened or last stepped) in the search's `rows`, one step
 * `dir`: the next note row in that direction, a folder or another file skipped (they open in a tab, never in a
 * layer). A note no longer at `at` is found again; one gone from the rows steps from `at` as the mini window does.
 * Null at the end of the list.
 */
export function stepResult(rows: readonly { path: string }[], at: number, path: string, dir: -1 | 1): { at: number; path: string } | null {
  const here = rows[at]?.path === path ? at : rows.findIndex((r) => r.path === path)
  let i = here === -1 ? (dir === 1 ? at : at - 1) : here + dir
  for (; i >= 0 && i < rows.length; i += dir) if (fileKind(rows[i].path) === 'markdown') return { at: i, path: rows[i].path }
  return null
}

/** The place of the note among the rows, 1-based, for "n/m": its `at` while the row is still there, else found again; 0 when gone. */
export const stepPlace = (rows: readonly { path: string }[], at: number, path: string): number => (rows[at]?.path === path ? at : rows.findIndex((r) => r.path === path)) + 1

/* ---------- layers that move like a cell note (round 3) ---------- */

/** A layer's box on the window, in CSS px; `height` null = the CSS height (80vh for a note, the content for a search). */
export interface LayerBox {
  x: number
  y: number
  width: number
  height: number | null
}

/** The least size a resize leaves (the mini window's). */
export const MIN_BOX_WIDTH = 240
export const MIN_BOX_HEIGHT = 120

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max))

/** `box` inside a window `W` × `H`: the size cut to the window, the corner kept on screen. */
export function fitBox(box: LayerBox, W: number, H: number): LayerBox {
  const width = clamp(box.width, Math.min(MIN_BOX_WIDTH, W), Math.max(MIN_BOX_WIDTH, W))
  const x = clamp(box.x, 0, Math.max(0, W - width))
  const y = clamp(box.y, 0, Math.max(0, H - MIN_BOX_HEIGHT))
  const height = box.height === null ? null : clamp(box.height, MIN_BOX_HEIGHT, Math.max(MIN_BOX_HEIGHT, H - y))
  return { x, y, width, height }
}

/**
 * Where every layer stands in a window `W` × `H`: its stack place (`layerPlace`, under the 10vh margin) shifted by
 * however far the layer under it was moved from ITS stack place, so a new layer opens next to the layer under it
 * wherever that one is now; a layer moved or resized by hand (`moved`) stands in its own box. Each box fits the window.
 */
export function layerBoxes(layers: readonly ExploreLayer[], moved: ReadonlyMap<number, LayerBox>, W: number, H: number): LayerBox[] {
  const margin = Math.round(H * 0.1)
  const out: LayerBox[] = []
  let dx = 0
  let dy = 0
  layers.forEach((layer, index) => {
    const base = layerPlace(layer.kind, index, W)
    const own = moved.get(layer.id)
    const box = fitBox(own ?? { x: base.left + dx, y: margin + base.top + dy, width: base.width, height: null }, W, H)
    dx = box.x - base.left
    dy = box.y - (margin + base.top)
    out.push(box)
  })
  return out
}

/**
 * The first layer's box, kept for this window across restarts in its localStorage (as a cell note keeps its place):
 * the box of the last first layer of that kind that was moved, resized or put back. A search and a note each keep their own.
 */
const BOX_KEY = (kind: ExploreLayer['kind']): string => `explore:box:${kind}`
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export function savedLayerBox(kind: ExploreLayer['kind']): LayerBox | null {
  try {
    const raw = localStorage.getItem(BOX_KEY(kind))
    if (raw === null) return null
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return null
    const { x, y, width, height } = v as Record<string, unknown>
    const fx = finite(x)
    const fy = finite(y)
    const fw = finite(width)
    return fx === null || fy === null || fw === null ? null : { x: fx, y: fy, width: fw, height: finite(height) }
  } catch {
    return null
  }
}
/**
 * The ONE zoom of every explore note layer (round 4), kept across restarts in this window's localStorage: a whole
 * percent in the page zoom's range (50–400), 100 by default. A note tab's zoom is its own and never this one.
 */
const ZOOM_KEY = 'explore:zoom'
export function savedExploreZoom(): number {
  try {
    const n = Number(localStorage.getItem(ZOOM_KEY))
    return Number.isInteger(n) && n >= 50 && n <= 400 ? n : 100
  } catch {
    return 100
  }
}
export function saveExploreZoom(zoom: number): void {
  try {
    if (zoom === 100) localStorage.removeItem(ZOOM_KEY)
    else localStorage.setItem(ZOOM_KEY, String(zoom))
  } catch {
    // No storage: the zoom lasts the stack.
  }
}

export function saveLayerBox(kind: ExploreLayer['kind'], box: LayerBox | null): void {
  try {
    if (box === null) localStorage.removeItem(BOX_KEY(kind))
    else localStorage.setItem(BOX_KEY(kind), JSON.stringify(box))
  } catch {
    // No storage (a private window, a full quota): the place lasts the stack.
  }
}
