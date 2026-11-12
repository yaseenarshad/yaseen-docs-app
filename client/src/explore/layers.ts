/**
 * The explore stack's model (YAZ-2571): an ordered list of layers over the workspace, the newest on top. A search
 * layer holds a search panel; a note layer holds one note, read or edited. Each opening is its own layer with its
 * own id, so A → B → A is three layers, each with its own scroll place. Pure: the component (`ExploreStack.tsx`)
 * keeps the list in state and the DOM keeps each layer's scroll.
 */

export type ExploreLayer = { id: number; kind: 'search' } | { id: number; kind: 'note'; path: string; mode: 'read' | 'edit'; wide: boolean; /** Bumped when the note was deleted under the layer: the layer reads again and says it is gone. */ gone?: number }

/** The most layers the stack holds (the recommendation on YAZ-2571): a 13th push is refused with a notice. */
export const MAX_LAYERS = 12

/** The widths of the two panels in CSS px (Mochi's 500 for search; a note reads at the preview panel's 720), and the gap kept to the window's edges. */
export const SEARCH_WIDTH = 500
export const NOTE_WIDTH = 720
/** A wide note layer (YAZ-4927): room for a table or a board; cut to the window as the others are. */
export const WIDE_NOTE_WIDTH = 1100
export const EDGE_GAP = 72

/** The remembered choice of YAZ-4927: wide or narrow for the next note layers, across restarts, in this window's localStorage. */
const WIDE_KEY = 'explore:wide'
export function preferWide(): boolean {
  try {
    return localStorage.getItem(WIDE_KEY) === '1'
  } catch {
    return false
  }
}
export function setPreferWide(on: boolean): void {
  try {
    if (on) localStorage.setItem(WIDE_KEY, '1')
    else localStorage.removeItem(WIDE_KEY)
  } catch {
    // No storage: the choice lasts the stack.
  }
}

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

/** A panel's width in a window `windowWidth` wide: its own (a note's wide one with `wide`), cut to leave `EDGE_GAP` at each side. */
export const panelWidth = (kind: ExploreLayer['kind'], windowWidth: number, wide = false): number => Math.max(240, Math.min(kind === 'search' ? SEARCH_WIDTH : wide ? WIDE_NOTE_WIDTH : NOTE_WIDTH, windowWidth - 2 * EDGE_GAP))

/**
 * Where layer `index` stands: `left` from the window's left edge, in CSS px, and `top` added to the 10vh margin. The
 * offset is `index × 15` right and `min(index, 1) × 15` down, clamped so the panel keeps 8 px to the window's right
 * edge: a narrow window gets a smaller offset, never a panel off screen.
 */
export function layerPlace(kind: ExploreLayer['kind'], index: number, windowWidth: number, wide = false): { left: number; top: number; width: number } {
  const width = panelWidth(kind, windowWidth, wide)
  const centred = Math.max(0, Math.floor((windowWidth - width) / 2))
  const room = Math.max(0, windowWidth - 8 - width - centred)
  return { left: centred + Math.min(index * LAYER_STEP, room), top: Math.min(index, 1) * LAYER_STEP, width }
}
