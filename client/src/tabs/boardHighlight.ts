import { useSyncExternalStore } from 'react'

/**
 * The page the tab board highlights (YAZ-2648), for the strip: the tab of that page wears the lit
 * look, so the eye finds on the strip what the pointer is on in the board. A store of its own and
 * not App's state, because the highlight moves with every page the pointer crosses: this way the
 * strip is the only thing that renders again, never App and never an editor. Null with no board.
 */
let path: string | null = null
const listeners = new Set<() => void>()

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const boardHighlight = (): string | null => path

export function setBoardHighlight(next: string | null): void {
  if (next === path) return
  path = next
  listeners.forEach((listener) => listener())
}

export const useBoardHighlight = (): string | null => useSyncExternalStore(subscribe, boardHighlight)
