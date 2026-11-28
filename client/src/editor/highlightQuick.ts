/**
 * Live 3 quick highlight colour slots for the selection toolbar (`highlightQuick.ts`, YAZ-6729).
 *
 * Synced from `settings.quickHighlightColors` in `App.tsx`. Defaults to `['yellow', 'green', 'blue']`
 * so `==yellow==`, `<mark class="highlight-green">`, and `<mark class="highlight-blue">` work out of the box,
 * while letting users replace any slot with any named soft wash or custom Google Docs / `#rrggbb[aa]` colour.
 */
import { DEFAULT_QUICK_HIGHLIGHT_COLORS, isHighlightHex, type QuickHighlightColors, type QuickHighlightSlot } from '@shared/types'
import { isLightSwatch } from '@shared/palette'
import type { HighlightColor, HighlightName } from './marks/highlightColours'

let slots: QuickHighlightColors = [...DEFAULT_QUICK_HIGHLIGHT_COLORS]
const listeners = new Set<(next: QuickHighlightColors) => void>()

export const QUICK_HIGHLIGHT_BUTTON_IDS = ['highlight', 'highlight-green', 'highlight-blue'] as const

export function getQuickHighlightColors(): QuickHighlightColors {
  return slots
}

/** Map a stored quick slot (`'yellow'` | named wash | `#rrggbb[aa]`) to the `highlight` mark's `color` attr. */
export function quickSlotToHighlightColor(slot: QuickHighlightSlot): HighlightColor {
  if (slot === 'yellow') return null
  return slot as HighlightName | `#${string}`
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

function applyCssVars(next: QuickHighlightColors): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  next.forEach((slot, i) => {
    root.style.setProperty(`--quick-hl-${i}`, quickSlotSwatch(slot))
    root.style.setProperty(`--quick-hl-ink-${i}`, quickSlotInk(slot))
  })
}

/** Update the live 3 quick highlight slots (called by `App.tsx` whenever settings change). */
export function setQuickHighlightColors(next: QuickHighlightColors): void {
  slots = [next[0], next[1], next[2]]
  applyCssVars(slots)
  for (const fn of listeners) fn(slots)
}

export function subscribeQuickHighlightColors(fn: (next: QuickHighlightColors) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
