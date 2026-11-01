import { useSyncExternalStore } from 'react'

/**
 * A tab board card held over the tab strip (YAZ-3808 D1). The strip registers a handle: the slot under a point, and its
 * edge scroll (D5). The board asks the handle on each pointer move and writes the slot here, a tiny store as
 * `boardHighlight` is, so only the strip renders again while a card moves. Null: no card over the strip.
 */
export interface StripHandle {
  /** The slot (0…tabs) a drop at this client point lands in, or null off the strip. */
  slotAt: (x: number, y: number) => number | null
  /** The strip scrolls at its ends while the card is held there. */
  edge: (x: number) => void
  stop: () => void
}

let handle: StripHandle | null = null
let slot: number | null = null
const listeners = new Set<() => void>()

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const stripHandle = (): StripHandle | null => handle

export function setStripHandle(next: StripHandle | null): void {
  handle = next
}

export const stripSlot = (): number | null => slot

export function setStripSlot(next: number | null): void {
  if (next === slot) return
  slot = next
  listeners.forEach((listener) => listener())
}

export const useStripSlot = (): number | null => useSyncExternalStore(subscribe, stripSlot)
