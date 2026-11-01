import type { DragEvent } from 'react'

/**
 * The insertion-slot arithmetic BOTH horizontal tab strips reorder by — the window's tab bar
 * (GRO-2235) and a folder's view tabs (YAZ-1471). One spelling, so the two strips cannot
 * drift apart: a slot is an index in the WITH-dragged-item list and runs 0…length.
 */

/** The slot a pointer at `clientX` over the item at `i` means: BEFORE it (`i`) or AFTER it (`i + 1`), by the target's own horizontal midpoint. */
export function insertionSlot(e: DragEvent, i: number): number {
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientX < r.left + r.width / 2 ? i : i + 1
}

/** The FINAL index the item grabbed at `from` lands on when dropped at `slot` — past the grab point the slot shifts one left, because the dragged item leaves the list before it re-enters it. */
export function dropIndex(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot
}

/** How far past a strip's left end a point still counts as on it (YAZ-3808 D1): over ‹ ›, the grid and the sidebar button. */
const LEFT_SLACK = 160

/**
 * The slot under a client point of a strip (YAZ-3808 D1, D5), as `slotAt` reads it; null off the strip. The strip's tabs
 * carry `data-tab`. Past the strip's right end, up to the end of its row (the "+" and the tail), is the end slot, as for a tab drag;
 * past its left end (‹ ›) is the first slot on show, since the strip may be scrolled.
 */
export function slotUnder(strip: HTMLElement | null, x: number, y: number): number | null {
  if (strip === null) return null
  const r = strip.getBoundingClientRect()
  // The row ends where the right panel starts: a point over the panel is off the strip.
  const rowEnd = strip.parentElement?.getBoundingClientRect().right ?? r.right
  if (y < r.top || y > r.bottom || x < r.left - LEFT_SLACK || x > Math.max(r.right, rowEnd)) return null
  if (x > r.right) return strip.querySelectorAll('[data-tab]').length
  return slotAt(strip, Math.max(x, r.left + 1))
}

/**
 * The slot at a client x of a strip (0…tabs), by each tab's midpoint WHERE THE LAYOUT PUTS IT (YAZ-3808 6A). The live
 * gap draws the tabs aside with `transform`, which `offsetLeft` does not see: the slot under a pointer stays put while
 * the tabs part around it, so the gap cannot flicker. The strip is its tabs' offset parent.
 */
export function slotAt(strip: HTMLElement, x: number): number {
  const origin = strip.getBoundingClientRect().left + strip.clientLeft - strip.scrollLeft
  const tabs = strip.querySelectorAll<HTMLElement>('[data-tab]')
  for (let i = 0; i < tabs.length; i++) {
    if (x < origin + tabs[i].offsetLeft + tabs[i].offsetWidth / 2) return i
  }
  return tabs.length
}
