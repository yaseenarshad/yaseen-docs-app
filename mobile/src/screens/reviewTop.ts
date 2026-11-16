import { useSyncExternalStore } from 'react'

/**
 * The Review tab's place in the top bar (the Mochi look): the shell's top bar draws an empty box in its
 * middle while the Review tab shows; the Review screen (a lazy chunk, kept mounted behind other screens) draws its
 * "▣ All cards ▾ 3 / 12" into it with a portal. With no box (the screen alone, in a test) the screen draws it itself.
 */
let box: HTMLElement | null = null
const listeners = new Set<() => void>()

/** The top bar's ref callback: the box, or null when it goes. */
export function setReviewTop(el: HTMLElement | null): void {
  if (el === box) return
  box = el
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** The box in the top bar, or null. */
export const useReviewTop = (): HTMLElement | null => useSyncExternalStore(subscribe, () => box)
