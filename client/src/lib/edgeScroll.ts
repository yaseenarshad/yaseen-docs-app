/**
 * A strip that scrolls by itself while a drag is held at its ends (YAZ-3808 D5): within EDGE_PX of an end, or past it
 * (over ‹ › or the "+"), it scrolls that way, faster nearer the end. One frame loop, and only while a drag is at an end;
 * `stop` ends it on the drop, on the drag's end, and when the drag leaves the row. `onScroll` runs after each step, for a
 * drop line that must follow the tabs passing under a pointer that stays still.
 */
export const EDGE_PX = 48
/** px per frame at the very end: about 800 px a second at 60 frames a second (tuned in the demo). */
export const EDGE_SPEED = 14

export interface EdgeScroller {
  at: (x: number) => void
  stop: () => void
}

export function edgeScroller(strip: () => HTMLElement | null, onScroll?: () => void): EdgeScroller {
  let speed = 0
  let frame = 0
  const tick = (): void => {
    const el = strip()
    if (el === null || speed === 0) {
      frame = 0
      return
    }
    el.scrollLeft += speed
    onScroll?.()
    frame = requestAnimationFrame(tick)
  }
  const at = (x: number): void => {
    const r = strip()?.getBoundingClientRect()
    if (r === undefined) return
    // How far into an end zone the pointer is, in px: negative at the left, positive at the right, 0 between.
    const depth = x < r.left + EDGE_PX ? x - (r.left + EDGE_PX) : x > r.right - EDGE_PX ? x - (r.right - EDGE_PX) : 0
    speed = Math.round(Math.max(-1, Math.min(1, depth / EDGE_PX)) * EDGE_SPEED)
    if (speed !== 0 && frame === 0) frame = requestAnimationFrame(tick)
  }
  const stop = (): void => {
    speed = 0
    if (frame !== 0) cancelAnimationFrame(frame)
    frame = 0
  }
  return { at, stop }
}
