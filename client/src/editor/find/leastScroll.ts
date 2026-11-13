/**
 * ⌘F's scroll rule, in ONE place (YAZ-3746 13BA, `views/view/viewFind.ts`; YAZ-5049, the Inbox's hidden words): a
 * thing that shows whole does not move; one that does not comes in with the LEAST scroll, at the nearest edge, a small
 * gap kept; never centred. A thing taller than the room comes in by its top.
 */
import { cssZoom } from '../../lib/cssZoom'

/** A span on one axis, in screen px: a box's top and bottom (or left and right). */
export interface Span {
  start: number
  end: number
}

/** The scroll (screen px, + is down or right) that shows `thing` in `room` with `gap` px kept; 0 when it shows. */
export function leastScroll(thing: Span, room: Span, gap = 0): number {
  if (thing.start < room.start + gap) return thing.start - room.start - gap
  if (thing.end > room.end - gap) return Math.min(thing.end - room.end + gap, thing.start - room.start - gap)
  return 0
}

/** The gap kept between a shown thing and its scroller's edge (px on screen), as ⌘F keeps it. */
export const SHOW_GAP = 6

/**
 * Shows `el` in `scroller` (up and down) by ⌘F's rule; `smooth` glides there (the Inbox, unless the system asks for
 * less motion). The target is absolute, read at this instant, so a call during a glide still lands right. True when
 * it scrolled.
 */
export function revealInScroller(el: Element, scroller: HTMLElement, { smooth = false, gap = SHOW_GAP }: { smooth?: boolean; gap?: number } = {}): boolean {
  const r = el.getBoundingClientRect()
  const box = scroller.getBoundingClientRect()
  const dy = leastScroll({ start: r.top, end: r.bottom }, { start: box.top, end: box.bottom }, gap)
  if (dy === 0) return false
  const top = scroller.scrollTop + dy / cssZoom(scroller)
  if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
  else scroller.scrollTop = top
  return true
}
