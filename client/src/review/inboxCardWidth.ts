/**
 * The Inbox card's width (YAZ-5019, Yaseen: "dragged and remembered for that session"): its edges drag it wider or
 * narrower, centred. The width lives in memory for the app's run — a card change, the Inbox tab closed and opened
 * again keep it; a quit forgets it. Nothing is written to disk.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { cssZoom } from '../lib/cssZoom'

/** The narrowest card (px). The widest is the Inbox tab's width less its side margins. */
export const CARD_MIN_WIDTH = 420
/** The Inbox's side padding (px, `.card-inbox`): the card never goes under it. */
export const CARD_SIDE_MARGIN = 16

let width: number | null = null
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** The width set by a drag in this run, or null: the CSS default. */
export const inboxCardWidth = (): number | null => width
export function setInboxCardWidth(next: number | null): void {
  if (next === width) return
  width = next
  listeners.forEach((l) => l())
}

/** `w` between the minimum and the room (`room`: the Inbox's inner width); a room under the minimum is the minimum (CSS then caps it at 100%). */
export const clampCardWidth = (w: number, room: number): number => Math.round(Math.max(CARD_MIN_WIDTH, Math.min(w, room)))

/**
 * The width and the drag of one edge: `side` -1 the left edge, +1 the right. The card stays centred, so both edges
 * move: the width changes by twice the pointer's move.
 */
export function useInboxCardWidth(column: RefObject<HTMLElement | null>, inbox: RefObject<HTMLElement | null>) {
  const current = useSyncExternalStore(subscribe, inboxCardWidth)
  const drag = useRef<(() => void) | null>(null)
  // A drag that runs when the Inbox goes (its tab closed) ends with it.
  useEffect(() => () => drag.current?.(), [])
  const startDrag = useCallback(
    (side: -1 | 1) => (event: ReactPointerEvent<HTMLElement>) => {
      const col = column.current
      const box = inbox.current
      if (col === null || box === null || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const zoom = cssZoom(col)
      const start = col.getBoundingClientRect().width / zoom
      const x0 = event.clientX
      const room = box.clientWidth - 2 * CARD_SIDE_MARGIN
      const move = (e: PointerEvent | MouseEvent) => setInboxCardWidth(clampCardWidth(start + (side * 2 * (e.clientX - x0)) / zoom, room))
      const end = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        document.body.classList.remove('card-inbox--sizing')
        drag.current = null
      }
      drag.current?.()
      drag.current = end
      // The ew-resize cursor stays on the whole window while the drag runs, also off the edge.
      document.body.classList.add('card-inbox--sizing')
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    },
    [column, inbox],
  )
  return { width: current, startDrag }
}
