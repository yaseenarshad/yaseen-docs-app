/**
 * Live 3 quick highlight colour slots for the selection toolbar (`highlightQuick.ts`, YAZ-6729 + YAZ-6731).
 *
 * - `settings.quickHighlightColors` sets the 3 starting defaults for every fresh page (default:
 *   `['yellow', 'green', 'blue']`), mirrored onto `:root` CSS vars `--quick-hl-0/1/2`.
 * - Each open editor (`EditorView`) tracks its own per-page recent 3 highlights in a `WeakMap`
 *   and scopes `--quick-hl-0/1/2` onto that editor's `.milkdown` root element (YAZ-6731).
 *   Picking a new colour from the `▾` Highlight panel slides it into Slot 1 (`[new, old1, old2]`)
 *   for that page only; clicking one of the 3 quick buttons directly applies it without shuffling.
 */
import { DEFAULT_QUICK_HIGHLIGHT_COLORS, isHighlightHex, type QuickHighlightColors, type QuickHighlightSlot } from '@shared/types'
import { isLightSwatch } from '@shared/palette'
import type { HighlightColor, HighlightName } from './marks/highlightColours'

export interface HighlightViewLike {
  readonly dom: HTMLElement
}

let defaultSlots: QuickHighlightColors = [...DEFAULT_QUICK_HIGHLIGHT_COLORS]
const pageSlots = new WeakMap<HighlightViewLike, QuickHighlightColors>()
const listeners = new Set<(next: QuickHighlightColors) => void>()

export const QUICK_HIGHLIGHT_BUTTON_IDS = ['highlight', 'highlight-green', 'highlight-blue'] as const

/** Global starting defaults (from Settings › Editor › Selection toolbar › Quick highlight colours). */
export function getQuickHighlightColors(): QuickHighlightColors {
  return defaultSlots
}

/** Active 3 quick highlight slots for a specific editor page (falls back to global starting defaults). */
export function getQuickHighlightColorsForView(view?: HighlightViewLike | null): QuickHighlightColors {
  if (!view) return defaultSlots
  return pageSlots.get(view) ?? defaultSlots
}

/** Map a stored quick slot (`'yellow'` | named wash | `#rrggbb[aa]`) to the `highlight` mark's `color` attr. */
export function quickSlotToHighlightColor(slot: QuickHighlightSlot): HighlightColor {
  if (slot === 'yellow') return null
  return slot as HighlightName | `#${string}`
}

/** Map a highlight mark's `color` attr back to a `QuickHighlightSlot`. */
export function highlightColorToQuickSlot(color: HighlightColor): QuickHighlightSlot {
  return color === null ? 'yellow' : (color as QuickHighlightSlot)
}

/** CSS background value for rendering a quick highlight slot's button tile. */
export function quickSlotSwatch(slot: QuickHighlightSlot): string {
  if (slot === 'yellow') return 'var(--mark-bg)'
  if (isHighlightHex(slot)) return slot
  return `var(--mark-bg-${slot})`
}

/** Readable ink colour for the "A" glyph inside a quick highlight slot tile (white on dark solid hexes). */
export function quickSlotInk(slot: QuickHighlightSlot): string {
  if (!isHighlightHex(slot)) return 'var(--fg)'
  if (slot.length === 9 && parseInt(slot.slice(7, 9), 16) < 128) return 'var(--fg)'
  return isLightSwatch(slot) ? '#111111' : '#ffffff'
}

/** Human-readable label for a quick highlight slot (`Highlight yellow`, `Highlight #cc0000`). */
export function quickSlotLabel(slot: QuickHighlightSlot): string {
  return `Highlight ${slot}`
}

function writeSlotVars(target: HTMLElement, next: QuickHighlightColors): void {
  next.forEach((slot, i) => {
    target.style.setProperty(`--quick-hl-${i}`, quickSlotSwatch(slot))
    target.style.setProperty(`--quick-hl-ink-${i}`, quickSlotInk(slot))
  })
}

function editorScopeOf(view: HighlightViewLike): HTMLElement {
  return view.dom.closest<HTMLElement>('.milkdown') ?? view.dom.parentElement ?? view.dom
}

/**
 * Record a highlight chosen from the `▾` panel on this page (YAZ-6731):
 * - If already in this page's 3 slots, keep order steady (no jumping under the cursor).
 * - Otherwise slide it into Slot 1 (`[picked, old0, old1]`) and scope CSS vars to this editor only.
 */
export function recordPageHighlight(view: HighlightViewLike, picked: HighlightColor): QuickHighlightColors {
  const slot = highlightColorToQuickSlot(picked)
  const cur = getQuickHighlightColorsForView(view)
  if (cur.includes(slot)) return cur
  const next: QuickHighlightColors = [slot, cur[0], cur[1]]
  pageSlots.set(view, next)
  writeSlotVars(editorScopeOf(view), next)
  return next
}

/** Update the global starting defaults (called by `App.tsx` whenever settings change). */
export function setQuickHighlightColors(next: QuickHighlightColors): void {
  defaultSlots = [next[0], next[1], next[2]]
  if (typeof document !== 'undefined') writeSlotVars(document.documentElement, defaultSlots)
  for (const fn of listeners) fn(defaultSlots)
}

export function subscribeQuickHighlightColors(fn: (next: QuickHighlightColors) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
