/**
 * The Inbox card's width (YAZ-5019, Yaseen: "dragged and remembered for that session"): its edges drag it wider or
 * narrower, centred. The width lives in memory for the app's run — a card change, the Inbox tab closed and opened
 * again keep it; a quit forgets it. Nothing is written to disk.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
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
 * The card column's width set by a drag (`width`, px at 100%), or the CSS default (null). The Inbox zoom (YAZ-5372) widens
 * it as page zoom does (`--document-zoom`), capped by the tab.
 */
export const cardColumnStyle = (width: number | null): CSSProperties | undefined => (width === null ? undefined : { width: `min(calc(${width}px * var(--document-zoom, 1)), 100%)` })

/**
 * The width and the drag of one edge: `side` -1 the left edge, +1 the right. The card stays centred, so both edges
 * move: the width changes by twice the pointer's move. The width is kept at 100%: under the Inbox zoom `cardZoom`
 * (YAZ-5372), the pointer's move and the room are divided by it.
 */
export function useInboxCardWidth(column: RefObject<HTMLElement | null>, inbox: RefObject<HTMLElement | null>, cardZoom = 1) {
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
      const zoom = cssZoom(col) * cardZoom
      const start = col.getBoundingClientRect().width / zoom
      const x0 = event.clientX
      const room = (box.clientWidth - 2 * CARD_SIDE_MARGIN) / cardZoom
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
    [column, inbox, cardZoom],
  )
  return { width: current, startDrag }
}

/**
 * One-time in-memory card width drag for Card Pages and Explore Cards (YAZ-6054): mirrors Inbox's left/right edge
 * handles, but lives only in component state (never saved to disk, resets to default when closed and reopened).
 * `resetKey` clears the override if the same mounted view switches to another card/path.
 */
export function useTransientCardWidth(
  cardHost: RefObject<HTMLElement | null>,
  scroller: RefObject<HTMLElement | null>,
  resetKey: string,
  centered = true,
  sideMargin = 32,
) {
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    setWidth(null)
  }, [resetKey])
  const drag = useRef<(() => void) | null>(null)
  useEffect(() => () => drag.current?.(), [])
  const startDrag = useCallback(
    (side: -1 | 1) => (event: ReactPointerEvent<HTMLElement>) => {
      const card = cardHost.current?.querySelector<HTMLElement>('.card:not(.card-pane__incoming)') ?? cardHost.current
      const box = scroller.current
      if (card === null || box === null || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const zoom = cssZoom(card)
      // `--card-text-width` is card width minus 34px frame sides (`card.css:43`).
      const startText = card.getBoundingClientRect().width / zoom - 34
      const x0 = event.clientX
      const room = Math.max(CARD_MIN_WIDTH, box.clientWidth / zoom - 2 * sideMargin - 34)
      const factor = centered ? 2 : 1
      const move = (e: PointerEvent | MouseEvent) => {
        const next = clampCardWidth(startText + (side * factor * (e.clientX - x0)) / zoom, room)
        setWidth(next)
      }
      const end = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        document.body.classList.remove('card-inbox--sizing')
        drag.current = null
      }
      drag.current?.()
      drag.current = end
      document.body.classList.add('card-inbox--sizing')
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    },
    [cardHost, scroller, centered, sideMargin],
  )
  const reset = useCallback(() => setWidth(null), [])
  return { width, startDrag, reset }
}
