import { useLayoutEffect, useRef } from 'react'
import { layoutOrigin, type Axis } from './dragSlot'

/**
 * THE LIVE GAP, shared (YAZ-4606 D58): the tab bar's drag (YAZ-3808 6A, D6, 6G) in parts that any list can use. The
 * grabbed item leaves the list, the others slide aside to keep an empty place where the drop would land, and after a
 * reorder each item glides from where it was drawn to its new place. One spelling for the tab bar and the folder pages.
 */

/** How long the items take to slide aside, in ms (YAZ-3808 6A; tuned in the demo). */
export const PART_MS = 150
/** How long an item glides to its new place after a reorder, in ms (YAZ-3808 D6; tuned in the demo). */
export const GLIDE_MS = 200
/** The one easing of the part and the glide. */
export const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/** With no motion asked for, and where there is no `matchMedia` to ask, nothing glides. */
export const motionOff = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches !== false

/** The container's gap between items on the axis, in px: `column-gap` along x, `row-gap` along y. */
export const gapOf = (strip: HTMLElement | null, axis: Axis = 'x'): number =>
  strip === null ? 0 : parseFloat(axis === 'x' ? getComputedStyle(strip).columnGap : getComputedStyle(strip).rowGap) || 0

/** The room an item takes in its list: its size on the axis and the list's gap, in px (YAZ-3808 6A). */
export const roomOf = (item: HTMLElement, strip: HTMLElement | null, axis: Axis = 'x'): number =>
  (axis === 'x' ? item.offsetWidth : item.offsetHeight) + gapOf(strip, axis)

/** The slot the gap opens at, or null: none where a drop would leave the grabbed item in its place, on either side of it. `from` -1: an item from elsewhere. */
export const partGap = (over: number | null, from: number): number | null =>
  over === null || (from !== -1 && (over === from || over === from + 1)) ? null : over

/**
 * How far the item at `i` slides for the gap, in px (YAZ-3808 6A): the grabbed item's room moves to the slot, so the
 * items between the two slide toward the grab point by one room. An item from elsewhere (`from` -1) has no room in the
 * list, so the items after the slot slide into room opened at the end.
 */
export function partShift(i: number, from: number, gap: number | null, room: number): number {
  if (gap === null) return 0
  if (from === -1) return i >= gap ? room : 0
  return from < i && i < gap ? -room : gap <= i && i < from ? room : 0
}

/** The transform that draws an item `shift` px along the axis. */
export const partTransform = (shift: number, axis: Axis = 'x'): string => `translate${axis === 'x' ? 'X' : 'Y'}(${shift}px)`

/** Where each item is DRAWN now, by key, from the container's layout start (YAZ-3808 D6): a parted item where the gap draws it. */
export function drawnPlaces(strip: HTMLElement | null, items: Iterable<HTMLElement>, keyOf: (el: HTMLElement) => string, axis: Axis = 'x'): Map<string, number> {
  const origin = strip === null ? 0 : layoutOrigin(strip, axis)
  return new Map([...items].map((el) => [keyOf(el), (axis === 'x' ? el.getBoundingClientRect().left : el.getBoundingClientRect().top) - origin]))
}

/**
 * THE GLIDE (YAZ-3808 D6): each item slides from where it was drawn (`from`) to where the layout puts it now. An item
 * not in `from` stood nowhere, and does not move. The animation is the compositor's. `now`: the places after, by key, where
 * the offset parent is not the list's own (a table's sticky cells, YAZ-4606); without it, each item's offset.
 */
export function glide(items: Iterable<HTMLElement>, keyOf: (el: HTMLElement) => string, from: ReadonlyMap<string, number>, axis: Axis = 'x', now?: ReadonlyMap<string, number>): void {
  for (const el of items) {
    const key = keyOf(el)
    const at = now?.get(key) ?? (axis === 'x' ? el.offsetLeft : el.offsetTop)
    const d = (from.get(key) ?? at) - at
    // Under a pixel is rounding, not a move.
    if (Math.abs(d) >= 1) el.animate?.([{ transform: partTransform(d, axis) }, { transform: 'none' }], { duration: GLIDE_MS, easing: EASING })
  }
}

/** The part's slides still running on these items, ended (YAZ-3808 6G). */
export function cancelSlides(items: Iterable<HTMLElement>): void {
  for (const el of items) {
    for (const slide of el.getAnimations?.() ?? []) if ('transitionProperty' in slide) slide.cancel()
  }
}

/**
 * The drag's slides end with it (YAZ-3808 6G): a slide still running when the drag ends kept an item drawn one room
 * off its new place, and it slid back (a jump, in the demo). The glide starts each item from where it was drawn.
 */
export function useEndSlides(parting: boolean, items: () => Iterable<HTMLElement>): void {
  const wasParting = useRef(false)
  useLayoutEffect(() => {
    if (wasParting.current && !parting) cancelSlides(items())
    wasParting.current = parting
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `items` reads the list as it is when the part ends
  }, [parting])
}
