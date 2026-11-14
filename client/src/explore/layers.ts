/**
 * The explore stack's model (YAZ-2571): an ordered list of layers over the workspace, the newest on top. A search
 * layer holds a search panel; a page layer holds one page, read or edited. Each opening is its own layer with its
 * own id, so A → B → A is three layers, each with its own scroll place. Pure: the component (`ExploreStack.tsx`)
 * keeps the list in state and the DOM keeps each layer's scroll.
 */
import { fileKind } from '@shared/fileKind'
import type { CardPlace } from '../editor/card/cardOpen'
import { LEGACY_EXPLORE_PAGE_BOX_KEY, movedStorageItem } from '@shared/legacyNames'

export type ExploreLayer =
  | { id: number; kind: 'search' }
  | {
      id: number
      kind: 'page'
      path: string
      mode: 'read' | 'edit'
      /** Opened from a search layer (round 3): that layer's id and the row's place in its list, where ‹ › step from. A page from a link has none. */
      from?: { search: number; at: number }
      /** Bumped when the page was deleted under the layer: the layer reads again and says it is gone. */
      gone?: number
      /** Bumped by E in a Read only vault (YAZ-4939): the layer asks with its timed "Allow edits", or edits while unlocked. */
      editAsk?: number
      /** Bumped by ⌘↵ in edit (YAZ-4988): the layer saves, locks again if its timed unlock runs (Lock now), and reads. */
      leaveAsk?: number
      /** The card to land on when the page opens (YAZ-4962): its ID, and its place among the page's cards (YAZ-5164: found by its ID). */
      card?: CardPlace
      /** The Inbox's E (YAZ-5145): once the layer edits, the card opens in Edit card (`card` of a page, else the card file's). */
      editCard?: boolean
      /** Opened from the Inbox (YAZ-5009, YAZ-5145): ⌘↵ while reading goes back to the Inbox, not to a tab. */
      fromInbox?: boolean
    }
  | {
      id: number
      /** One card of a page (YAZ-4962, D13): the card read-only, its strip and its Reviews table. */
      kind: 'card'
      path: string
      /** The card's ID; null while it has none yet (then `index` finds it). */
      cardId: string | null
      /** Its place among the page's cards (`pageCards` order). */
      index: number
    }
  | {
      id: number
      /** A drawing or a diagram, for READING (YAZ-4943): the board embed's view-only window fills the layer; no edit. */
      kind: 'board'
      path: string
      /** As a page's: the search it came from, so ‹ › step through it (a step may turn it into a page layer). */
      from?: { search: number; at: number }
    }

/** The most layers the stack holds (the recommendation on YAZ-2571): a 13th push is refused with a notice. */
export const MAX_LAYERS = 12

/** The widths of the two panels in CSS px (Mochi's 500 for search; a page reads at the preview panel's 720), and the gap kept to the window's edges. */
export const SEARCH_WIDTH = 500
export const PAGE_WIDTH = 720
export const EDGE_GAP = 72

/** Each layer sits this much right of the one under it; the first one also this much lower (Mochi's desktop offsets). */
export const LAYER_STEP = 15

/** The motion of a new layer: a search in 100 ms, a page in 150 ms, `cubic-bezier(.4,.3,0,1)`, fade-up. */
export const SEARCH_MS = 100
export const PAGE_MS = 150

let nextId = 1
/** A fresh layer id: unique for the window's life, never a page's id. */
export const newLayerId = (): number => nextId++

/** The list with `layer` on top, or null when the stack is full. */
export function pushLayer(layers: readonly ExploreLayer[], layer: ExploreLayer): ExploreLayer[] | null {
  return layers.length >= MAX_LAYERS ? null : [...layers, layer]
}

/** A layer that shows a file: a page, a board, or a card of a page (its page is the file). */
export type FileLayer = Extract<ExploreLayer, { kind: 'page' | 'board' | 'card' }>

/**
 * What App asks the stack to open (YAZ-4962): a page (landing on a card), or a card window (a page card's Open card).
 * The Inbox's O and E (YAZ-5145) ask for the page layer Explore itself opens: `edit` asks it to edit as Explore's own E
 * does (a Read only vault asks "Allow edits?" first), `editCard` then opens the landed card's Edit card, and
 * `fromInbox` makes ⌘↵ while reading go back to the Inbox.
 */
export type ExploreRequest = { kind: 'page'; path: string; card?: CardPlace; edit?: boolean; editCard?: boolean; fromInbox?: boolean } | { kind: 'card'; path: string; cardId: string | null; index: number }

/** The page, board or card layer nearest the top, or null: what ⌘↵ opens in a tab (a card's page). */
export function topPage(layers: readonly ExploreLayer[]): FileLayer | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (layer.kind !== 'search') return layer
  }
  return null
}

/** The layer a file opens as (YAZ-4943): a page, a board (a drawing or a diagram), or none (a folder, a PDF: a tab). */
export function layerKindOf(path: string): 'page' | 'board' | null {
  const kind = fileKind(path)
  return kind === 'markdown' ? 'page' : kind === 'drawing' || kind === 'diagram' ? 'board' : null
}

/* ---------- layers act like windows (round 6) ---------- */

/**
 * The layers from back to front. The list keeps its meaning (the open order: stack places, the trail, ‹ ›'s `from`);
 * `order` is the front order as of the last raise, by id. A layer not in it opened after that raise, so it stands
 * in front, in list order; a closed layer simply leaves.
 */
export function frontOrder<L extends { id: number }>(layers: readonly L[], order: readonly number[]): L[] {
  if (order.length === 0) return [...layers]
  const byId = new Map(layers.map((l) => [l.id, l]))
  const out: L[] = []
  for (const id of order) {
    const layer = byId.get(id)
    if (layer !== undefined) out.push(layer)
  }
  const raised = new Set(order)
  for (const layer of layers) if (!raised.has(layer.id)) out.push(layer)
  return out
}

/** The front order with layer `id` in front and the others in their order; the same order when it is in front or unknown. */
export function raiseLayer(layers: readonly { id: number }[], order: readonly number[], id: number): readonly number[] {
  const ids = frontOrder(layers, order).map((l) => l.id)
  if (!ids.includes(id) || ids[ids.length - 1] === id) return order
  return [...ids.filter((x) => x !== id), id]
}

/** A panel's width in a window `windowWidth` wide: its own, cut to leave `EDGE_GAP` at each side. */
export const panelWidth = (kind: ExploreLayer['kind'], windowWidth: number): number => Math.max(240, Math.min(kind === 'search' ? SEARCH_WIDTH : PAGE_WIDTH, windowWidth - 2 * EDGE_GAP))

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
 * The row ‹ › go to from the page at `at` (its place when it opened or last stepped) in the search's `rows`, one step
 * `dir`: the next page or board row in that direction (YAZ-4943), a folder or another file skipped (they open in a
 * tab, never in a layer). A page no longer at `at` is found again; one gone from the rows steps from `at` as the mini
 * window does. Null at the end of the list.
 */
export function stepResult(rows: readonly { path: string }[], at: number, path: string, dir: -1 | 1): { at: number; path: string } | null {
  const here = rows[at]?.path === path ? at : rows.findIndex((r) => r.path === path)
  let i = here === -1 ? (dir === 1 ? at : at - 1) : here + dir
  for (; i >= 0 && i < rows.length; i += dir) if (layerKindOf(rows[i].path) !== null) return { at: i, path: rows[i].path }
  return null
}

/**
 * The place of the page among the rows ‹ › step to (pages and boards), 1-based, for "n/m": its `at` while the row is
 * still there, else found again; 0 when gone. A folder or another file before it is not counted (YAZ-2571).
 */
export function stepPlace(rows: readonly { path: string }[], at: number, path: string): number {
  const here = rows[at]?.path === path ? at : rows.findIndex((r) => r.path === path)
  if (here === -1) return 0
  let place = 0
  for (let i = 0; i <= here; i++) if (layerKindOf(rows[i].path) !== null) place++
  return place
}

/** The "m" of "n/m": the rows ‹ › step to (pages and boards), not the folders or other files (YAZ-2571). */
export const stepCount = (rows: readonly { path: string }[]): number => rows.reduce((n, r) => (layerKindOf(r.path) !== null ? n + 1 : n), 0)

/* ---------- layers that move like a cell note (round 3) ---------- */

/** A layer's box on the window, in CSS px; `height` null = the CSS height (80vh for a page, the content for a search). */
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
 * the box of the last first layer of that kind that was moved, resized or put back. A search and a page each keep their own.
 */
const BOX_KEY = (kind: ExploreLayer['kind']): string => `explore:box:${kind}`
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export function savedLayerBox(kind: ExploreLayer['kind']): LayerBox | null {
  try {
    // YAZ-5036: the page layer's box saved before the rename (`explore:box:note`) moves to the new key once.
    const raw = kind === 'page' ? movedStorageItem(localStorage, BOX_KEY(kind), LEGACY_EXPLORE_PAGE_BOX_KEY) : localStorage.getItem(BOX_KEY(kind))
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
 * The ONE zoom of every explore page layer (round 4), kept across restarts in this window's localStorage: a whole
 * percent in the page zoom's range (50–400), 100 by default. A page tab's zoom is its own and never this one.
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
