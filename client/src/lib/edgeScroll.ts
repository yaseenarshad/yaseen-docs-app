/**
 * A strip that scrolls by itself while a drag is held at its ends (YAZ-3808 D5): within EDGE_PX of an end, or past it
 * (over ‹ › or the "+"), it scrolls that way, faster nearer the end. One frame loop, and only while a drag is at an end;
 * `stop` ends it on the drop, on the drag's end, and when the drag leaves the row. `onScroll` runs after each step, for a
 * drop line that must follow the tabs passing under a pointer that stays still. The speed is per second, not per
 * frame, so a 120 Hz display scrolls as fast as a 60 Hz one.
 */
export const EDGE_PX = 48
/** px a second at the very end (tuned in the demo). */
export const EDGE_SPEED = 800
/** The longest step one frame may take, in ms: a frame late after a stall does not jump the strip. */
const MAX_STEP_MS = 50

export interface EdgeScroller {
  at: (x: number) => void
  stop: () => void
}

/** `axis` 'y' scrolls up and down, for the folder table's drag select (YAZ-4612 S47); `at` then takes the pointer's y. */
export function edgeScroller(strip: () => HTMLElement | null, onScroll?: () => void, axis: 'x' | 'y' = 'x'): EdgeScroller {
  const horizontal = axis === 'x'
  const get = (el: HTMLElement) => (horizontal ? el.scrollLeft : el.scrollTop)
  const set = (el: HTMLElement, to: number) => {
    if (horizontal) el.scrollLeft = to
    else el.scrollTop = to
  }
  /** -1…1: the way and how deep into an end zone the pointer is. */
  let pull = 0
  let frame = 0
  let last: number | null = null
  /** The position, fractional: a step under 1 px is kept, not lost to a `scrollLeft` that rounds. */
  let pos: number | null = null
  const tick = (now: number): void => {
    const el = strip()
    if (el === null || pull === 0) {
      frame = 0
      last = null
      pos = null
      return
    }
    const ms = last === null ? 1000 / 60 : Math.min(MAX_STEP_MS, now - last)
    last = now
    const before = get(el)
    const end = horizontal ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight
    pos = (pos ?? before) + (pull * EDGE_SPEED * ms) / 1000
    if (Number.isFinite(end)) pos = Math.max(0, Math.min(end, pos))
    set(el, pos)
    // At an end nothing moves, and the line under the pointer has nothing to follow.
    if (get(el) !== before) onScroll?.()
    frame = requestAnimationFrame(tick)
  }
  const at = (x: number): void => {
    const box = strip()?.getBoundingClientRect()
    // No box, or one not laid out (a zero size): no end zone.
    if (box === undefined || (horizontal ? box.width : box.height) === 0) return
    const [start, end] = horizontal ? [box.left, box.right] : [box.top, box.bottom]
    // How far into an end zone the pointer is, in px: negative at the start, positive at the end, 0 between.
    const depth = x < start + EDGE_PX ? x - (start + EDGE_PX) : x > end - EDGE_PX ? x - (end - EDGE_PX) : 0
    pull = Math.max(-1, Math.min(1, depth / EDGE_PX))
    if (pull !== 0 && frame === 0) frame = requestAnimationFrame(tick)
  }
  const stop = (): void => {
    pull = 0
    last = null
    pos = null
    if (frame !== 0) cancelAnimationFrame(frame)
    frame = 0
  }
  return { at, stop }
}
