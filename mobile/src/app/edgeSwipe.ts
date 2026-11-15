/**
 * YAZ-5435: a swipe from the LEFT EDGE goes back, as iPhone apps do. Pure, so it is tested without a phone.
 *
 *  - It starts only within `EDGE_PX` of the left edge: a wide table or a code block keeps its own sideways scroll, and a
 *    tap anywhere else is never touched.
 *  - The first move decides: to the right (more than up or down) is the swipe; up or down is a scroll, and the swipe
 *    lets it go.
 *  - The screen follows the finger. A release past a third of the screen's width, or a fast flick to the right, goes
 *    back; else the screen springs back.
 *  - Only in the Home Screen app: a Safari TAB has its own back swipe, and the two must never both fire.
 */

export const EDGE_PX = 20
/** The part of the screen's width past which a release goes back. */
export const BACK_FRACTION = 1 / 3
/** A flick: the finger leaves at this speed or more (px per ms) to the right. */
export const FLICK_SPEED = 0.5
/** A flick must still move this far, so a short twitch at the edge is not a back. */
export const FLICK_MIN_PX = 24
/** How far the finger moves before the swipe decides between "back" and "scroll". */
export const DECIDE_PX = 8

export type SwipeEnd = 'back' | 'stay' | 'none'

export interface EdgeSwipe {
  /** The finger comes down. False: not in the edge zone; the swipe does nothing with this touch. */
  start(x: number, y: number, t: number): boolean
  /** The finger moves. The screen's offset to draw (px, 0 or more), or null while it is not a swipe. */
  move(x: number, y: number, t: number): number | null
  /** The finger lifts: 'back', 'stay' (spring back), or 'none' (it was never a swipe). */
  end(t: number): SwipeEnd
  /** The system took the touch. */
  cancel(): void
}

export function edgeSwipe(width: () => number): EdgeSwipe {
  let phase: 'idle' | 'deciding' | 'dragging' | 'scroll' = 'idle'
  let x0 = 0
  let y0 = 0
  let offset = 0
  // The last two points, for the speed at the release.
  let prev = { x: 0, t: 0 }
  let last = { x: 0, t: 0 }
  return {
    start(x, y, t) {
      phase = x <= EDGE_PX ? 'deciding' : 'idle'
      x0 = x
      y0 = y
      offset = 0
      prev = last = { x, t }
      return phase === 'deciding'
    },
    move(x, y, t) {
      if (phase === 'idle' || phase === 'scroll') return null
      const dx = x - x0
      const dy = y - y0
      if (phase === 'deciding') {
        if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return null
        if (dx <= Math.abs(dy)) {
          phase = 'scroll'
          return null
        }
        phase = 'dragging'
      }
      offset = Math.max(0, dx)
      prev = last
      last = { x, t }
      return offset
    },
    end(t) {
      const was = phase
      phase = 'idle'
      if (was !== 'dragging') return 'none'
      // The speed of the last move; a finger that stopped before it lifted is not a flick.
      const dt = Math.max(1, last.t - prev.t)
      const speed = t - last.t > 100 ? 0 : (last.x - prev.x) / dt
      if (offset >= width() * BACK_FRACTION) return 'back'
      if (speed >= FLICK_SPEED && offset >= FLICK_MIN_PX) return 'back'
      return 'stay'
    },
    cancel() {
      phase = 'idle'
      offset = 0
    },
  }
}

/** The swipe is the app's only in the Home Screen app; a Safari tab keeps Safari's own back swipe. */
export const swipeIsOurs = (where: 'standalone' | 'ios-safari' | 'ios-other' | 'not-ios'): boolean => where === 'standalone'
