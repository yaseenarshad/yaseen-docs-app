/**
 * The explore stack's model (YAZ-2571): an ordered list of layers over the workspace, the newest on top. A search
 * layer holds a search panel; a page layer holds one page, read or edited. Each opening is its own layer with its
 * own id, so A → B → A is three layers, each with its own scroll place. Pure: the component (`ExploreStack.tsx`)
 * keeps the list in state and the DOM keeps each layer's scroll.
 */
import { fileKind } from '@shared/fileKind'
import { inlineCardRowPath, inlineDrawingRowPath, parseInlineRef } from '@shared/inlineRef'
import type { CardPlace } from '../editor/card/cardOpen'
import { LEGACY_EXPLORE_PAGE_BOX_KEY, movedStorageItem } from '@shared/legacyNames'
import { savedZoom, saveZoom } from '../editor/DocumentZoom'

export type ExploreLayer =
  | { id: number; kind: 'search' }
  | {
      id: number
      kind: 'page'
      path: string
      mode: 'read' | 'edit'
      /** Opened from a search layer (round 3): that layer's id, the row's place in its list, and optional synthetic row path (inline card), where ‹ › step from. A page from a link has none. */
      from?: { search: number; at: number; rowPath?: string }
      /** Bumped when the page was deleted under the layer: the layer reads again and says it is gone. */
      gone?: number
      /** Bumped by E in a Read only vault (YAZ-4939): the layer asks with its timed "Allow edits", or edits while unlocked. */
      editAsk?: number
      /** Bumped by ⌘↵ in edit (YAZ-4988): the layer saves, locks again if its timed unlock runs (Lock now), and reads. */
      leaveAsk?: number
      /** The card to land on when the page opens (YAZ-4962): its ID, and its place among the page's cards (YAZ-5164: found by its ID). */
      card?: CardPlace
      /** The inline drawing (0-based index) to land on when the page opens (YAZ-6470). */
      drawing?: number
      /** The Inbox's E on a card in a page (YAZ-5145): once the layer edits, the card at `card` opens in Edit card. A card file's opens by itself (round 3). */
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
      /** An inline Excalidraw drawing inside `path` (YAZ-6470): renders the block's scene JSON instead of a standalone board file. */
      inlineDrawing?: { index: number; title?: string }
      /** As a page's: the search it came from, so ‹ › step through it (a step may turn it into a page layer). */
      from?: { search: number; at: number; rowPath?: string }
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
 * does (a Read only vault asks "Allow edits?" first; a card file then opens in Edit card, as on Explore's own E),
 * `editCard` opens the landed card's Edit card (a card in a page), and
 * `fromInbox` makes ⌘↵ while reading go back to the Inbox.
 */
export type ExploreRequest = { kind: 'page'; path: string; card?: CardPlace; edit?: boolean; editCard?: boolean; fromInbox?: boolean } | { kind: 'card'; path: string; cardId: string | null; index: number } | { kind: 'board'; path: string; inlineDrawing: { index: number; title?: string } }

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

/**
 * A panel's width in a window `windowWidth` wide, cut to leave `EDGE_GAP` at each side. The search: its own times Search
 * size (`size`, a factor: 1.25 for 125%, YAZ-5881 D2; the search alone since YAZ-5977). A page or board window: Settings'
 * Explore window width (`custom`, YAZ-5976), else its own width; Search size never scales it.
 */
export const panelWidth = (kind: ExploreLayer['kind'], windowWidth: number, size = 1, custom: number | null = null): number =>
  Math.max(240, Math.min(kind === 'search' ? Math.round(SEARCH_WIDTH * size) : (custom ?? PAGE_WIDTH), windowWidth - 2 * EDGE_GAP))

/**
 * Where layer `index` stands: `left` from the window's left edge, in CSS px, and `top` added to the 10vh margin. The
 * offset is `index × 15` right and `min(index, 1) × 15` down, clamped so the panel keeps 8 px to the window's right
 * edge: a narrow window gets a smaller offset, never a panel off screen. `size` is Search size (`panelWidth`: the search's only).
 */
export function layerPlace(kind: ExploreLayer['kind'], index: number, windowWidth: number, size = 1, custom: number | null = null): { left: number; top: number; width: number } {
  const width = panelWidth(kind, windowWidth, size, custom)
  const centred = Math.max(0, Math.floor((windowWidth - width) / 2))
  const room = Math.max(0, windowWidth - 8 - width - centred)
  return { left: centred + Math.min(index * LAYER_STEP, room), top: Math.min(index, 1) * LAYER_STEP, width }
}

/* ---------- ‹ › through the search (round 3) ---------- */

/** A row in a search list that ‹ › inspects (pages, boards, inline cards, inline drawings). */
export interface StepRow {
  path: string
  card?: true
  inlineDrawing?: true
}

/** True when a search row opens inside Explore (page, board, inline card, or inline drawing) and can be stepped to with ‹ › (YAZ-6470). */
export function isSteppableRow(row: StepRow): boolean {
  if (row.inlineDrawing === true || row.card === true) return true
  if (parseInlineRef(row.path) !== null) return true
  return layerKindOf(row.path) !== null
}

/** The search row `path` corresponding to a page or board layer (synthetic `#<id>` or `#drawing-<index>` for inline items). */
export function layerRowPath(layer: Extract<ExploreLayer, { kind: 'page' | 'board' }>): string {
  if (layer.kind === 'board' && layer.inlineDrawing !== undefined) return inlineDrawingRowPath(layer.path, layer.inlineDrawing.index)
  if (layer.kind === 'page' && layer.card?.id != null) return inlineCardRowPath(layer.path, layer.card.id)
  return layer.path
}

/**
 * The row ‹ › go to from the page at `at` (its place when it opened or last stepped) in the search's `rows`, one step
 * `dir`: the next page, board, inline card, or inline drawing row in that direction (YAZ-4943, YAZ-6470), a folder or
 * another file skipped (they open in a tab, never in a layer). A row no longer at `at` is found again; one gone from
 * the rows steps from `at` as the mini window does. Null at the end of the list.
 */
export function stepResult(rows: readonly StepRow[], at: number, path: string, dir: -1 | 1): { at: number; path: string } | null {
  const here = rows[at]?.path === path ? at : rows.findIndex((r) => r.path === path)
  let i = here === -1 ? (dir === 1 ? at : at - 1) : here + dir
  for (; i >= 0 && i < rows.length; i += dir) if (isSteppableRow(rows[i])) return { at: i, path: rows[i].path }
  return null
}

/**
 * The place of the row among the rows ‹ › step to (pages, boards, inline cards, inline drawings), 1-based, for "n/m":
 * its `at` while the row is still there, else found again; 0 when gone. A folder or another file before it is not counted (YAZ-2571).
 */
export function stepPlace(rows: readonly StepRow[], at: number, path: string): number {
  const here = rows[at]?.path === path ? at : rows.findIndex((r) => r.path === path)
  if (here === -1) return 0
  let place = 0
  for (let i = 0; i <= here; i++) if (isSteppableRow(rows[i])) place++
  return place
}

/** The "m" of "n/m": the rows ‹ › step to (pages, boards, inline cards, inline drawings), not folders or other files (YAZ-2571, YAZ-6470). */
export const stepCount = (rows: readonly StepRow[]): number => rows.reduce((n, r) => (isSteppableRow(r) ? n + 1 : n), 0)

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
 * `size` is Search size (`panelWidth`): it widens the search's stack place only, never a box moved or resized by hand.
 * `custom` is Settings' Explore window width (YAZ-5976): a fresh page or board layer's width when set.
 *
 * THE SIZE OF THE LAYER IT OPENED FROM (YAZ-5975, Yaseen: "does it not follow the same sizing that you then create for
 * the previous window?"): a page or board layer opened on a page, board or card layer whose box was set by hand (moved or
 * resized), or took its size that way, takes that layer's width and height, `LAYER_STEP` right and down of it. So each
 * link followed from a window made narrow opens as narrow. A layer on a search keeps its stack place (the search is
 * another shape); a layer sized by hand keeps its own box.
 */
export function layerBoxes(layers: readonly ExploreLayer[], moved: ReadonlyMap<number, LayerBox>, W: number, H: number, size = 1, custom: number | null = null): LayerBox[] {
  const margin = Math.round(H * 0.1)
  const out: LayerBox[] = []
  let dx = 0
  let dy = 0
  /** The layer under this one had a box set by hand, or one taken from such a box. */
  let sized = false
  layers.forEach((layer, index) => {
    const base = layerPlace(layer.kind, index, W, size, custom)
    const own = moved.get(layer.id)
    const under = index > 0 ? layers[index - 1] : undefined
    const prev = out[index - 1]
    const inherit = own === undefined && sized && prev !== undefined && under !== undefined && under.kind !== 'search' && layer.kind !== 'search'
    const box = fitBox(own ?? (inherit ? { x: prev.x + LAYER_STEP, y: prev.y + LAYER_STEP, width: prev.width, height: prev.height } : { x: base.left + dx, y: margin + base.top + dy, width: base.width, height: null }), W, H)
    sized = own !== undefined || inherit
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
 * The first layer's box as a stack opens (YAZ-5976): its kept box (`savedLayerBox`), but with Settings' Explore window
 * width set (`custom`), a page or board layer starts at that width, at the kept place and height. Yaseen: "set the
 * default for all of them, even a fresh one". Null: no kept box (the stack place, which takes the width too).
 */
export function firstLayerBox(kind: ExploreLayer['kind'], custom: number | null): LayerBox | null {
  const kept = savedLayerBox(kind)
  return kept === null || custom === null || kind === 'search' ? kept : { ...kept, width: custom }
}

/**
 * The ONE zoom of every explore page layer (round 4), kept across restarts in this window's localStorage: a whole
 * percent in the page zoom's range (50–400), 125 by default (YAZ-5977 Q6, Yaseen: "125%, keep the old look": the look
 * the pages had when Search size still scaled them). The default is no entry; a saved value (100 too) stays. ⌘0 goes
 * back to it. A page tab's zoom is its own and never this one.
 */
const ZOOM_KEY = 'explore:zoom'
export const EXPLORE_PAGE_ZOOM_DEFAULT = 125
export const savedExploreZoom = (): number => savedZoom(ZOOM_KEY, EXPLORE_PAGE_ZOOM_DEFAULT)
export const saveExploreZoom = (zoom: number): void => saveZoom(ZOOM_KEY, zoom, EXPLORE_PAGE_ZOOM_DEFAULT)

export function saveLayerBox(kind: ExploreLayer['kind'], box: LayerBox | null): void {
  try {
    if (box === null) localStorage.removeItem(BOX_KEY(kind))
    else localStorage.setItem(BOX_KEY(kind), JSON.stringify(box))
  } catch {
    // No storage (a private window, a full quota): the place lasts the stack.
  }
}
