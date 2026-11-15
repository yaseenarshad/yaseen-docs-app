/**
 * THE DRAG DOWN OF A SHEET (YAZ-5472): the rules, pure, so they are tested without a phone. `sheetMotion.ts` feeds it
 * the finger and draws what it says.
 *
 *  - From the HEAD the sheet follows the finger 1:1 from where it came down, at any scroll place.
 *  - From the BODY the first move decides, as an iOS sheet does: down while the body is at its top is the drag; up (or
 *    down with the body scrolled) is the body's own scroll, and the drag lets it go.
 *  - THE HAND-OFF: a scroll that brings the body to its top and keeps going down becomes the drag, in the same touch.
 *  - Sideways first: not ours (the left-edge Back, a wide table).
 *  - The release: past `CLOSE_FRACTION` of the sheet's height, or a flick down (`FLICK_SPEED`), closes; else the sheet
 *    springs back. A flick UP always springs back.
 *  - Up past its place, the sheet gives a little (a fifth of the finger), as iOS does; from the body it stops at its place.
 */

/** The part of the sheet's height past which a release closes it. */
export const CLOSE_FRACTION = 0.25
/** A flick: the finger leaves at this speed or more (px per ms), down. */
export const FLICK_SPEED = 0.5
/** A flick must still have moved the sheet this far: a twitch is not a close. */
export const FLICK_MIN_PX = 24
/** How far the finger moves before the first move decides. */
export const DECIDE_PX = 6
/** The speed is of the finger's last this-many ms; a finger still this long before it lifts has no speed. */
export const SPEED_WINDOW_MS = 80
/** Up past its place, the sheet moves this part of the finger's way. */
export const OVER_PULL = 0.2

export type DragFrom = 'head' | 'body'
export type DragEnd = { kind: 'close' | 'stay'; offset: number; speed: number } | { kind: 'none' }

export interface SheetDrag {
  /** The finger comes down at `y` (and `x`), at `t` ms, on the head or the body. `caught`: the sheet was moving, and is here (px). */
  start(x: number, y: number, t: number, from: DragFrom, caught?: number): void
  /**
   * The finger moves; `atTop`: the body is scrolled to its top. `offset`: where to draw the sheet (px down from its place), or null while it is not a drag.
   * `claim`: the touch is the drag's; the body must not scroll (`preventDefault`).
   */
  move(x: number, y: number, t: number, atTop: boolean): { offset: number | null; claim: boolean }
  /** The finger lifts, the sheet `height` px tall. */
  end(t: number, height: number): DragEnd
  /** The system took the touch: the sheet goes back to its place. */
  cancel(): void
  readonly dragging: boolean
}

export function sheetDrag(): SheetDrag {
  let phase: 'idle' | 'deciding' | 'drag' | 'scroll' | 'none' = 'idle'
  let from: DragFrom = 'body'
  let x0 = 0
  let y0 = 0
  /** The finger's y where the sheet is at its place (0). */
  let base = 0
  let lastY = 0
  let offset = 0
  /** The finger's recent points, for its speed at the release. */
  let points: { y: number; t: number }[] = []

  const toOffset = (y: number) => {
    const d = y - base
    if (d >= 0) return d
    return from === 'head' ? d * OVER_PULL : 0
  }
  const drag = (y: number, t: number) => {
    phase = 'drag'
    base = y - offset
    points = [{ y, t }]
  }
  return {
    get dragging() {
      return phase === 'drag'
    },
    start(x, y, t, start, caught = 0) {
      phase = 'deciding'
      from = start
      x0 = x
      y0 = y
      lastY = y
      offset = Math.max(0, caught)
      base = y
      points = [{ y, t }]
      // A sheet caught in its motion is the finger's at once.
      if (offset > 0) drag(y, t)
    },
    move(x, y, t, atTop) {
      const goingDown = y > lastY
      lastY = y
      if (phase === 'idle' || phase === 'none') return { offset: null, claim: false }
      if (phase === 'scroll') {
        // The hand-off: the body reached its top and the finger keeps going down.
        if (from === 'body' && atTop && goingDown) {
          drag(y, t)
          return { offset: 0, claim: true }
        }
        return { offset: null, claim: false }
      }
      if (phase === 'deciding') {
        const dx = x - x0
        const dy = y - y0
        if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return { offset: null, claim: false }
        if (Math.abs(dx) > Math.abs(dy)) {
          phase = 'none'
          return { offset: null, claim: false }
        }
        if (from === 'body' && !(atTop && dy > 0)) {
          phase = 'scroll'
          return { offset: null, claim: false }
        }
        // 1:1 with the finger from where it came down (as iOS's pan: the few px the decision took are in the first frame).
        drag(y, t)
        base = y0
        offset = toOffset(y)
        return { offset, claim: true }
      }
      offset = toOffset(y)
      points.push({ y, t })
      while (points.length > 2 && t - points[0].t > SPEED_WINDOW_MS) points.shift()
      return { offset, claim: true }
    },
    end(t, height) {
      const was = phase
      phase = 'idle'
      if (was !== 'drag') return { kind: 'none' }
      const first = points[0]
      const last = points[points.length - 1]
      const speed = t - last.t > 100 || last.t === first.t ? 0 : (last.y - first.y) / (last.t - first.t)
      const close = speed > -FLICK_SPEED && (offset >= height * CLOSE_FRACTION || (speed >= FLICK_SPEED && offset >= FLICK_MIN_PX))
      return { kind: close ? 'close' : 'stay', offset, speed }
    },
    cancel() {
      phase = 'idle'
      offset = 0
    },
  }
}

/** The ease of every move of a sheet: iOS's sheet curve (fast, then a long soft stop). */
export const SHEET_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
/** The open, and a close or a spring back with no speed (ms). */
export const SHEET_MS = 420
/** The curve starts at 2.25 times its mean speed (0.72 / 0.32): a move of `distance` that leaves at the finger's `speed`. */
export function releaseMs(distance: number, speed: number): number {
  const v = Math.abs(speed)
  if (v < 0.05) return SHEET_MS
  return Math.round(Math.min(SHEET_MS, Math.max(180, (2.25 * Math.abs(distance)) / v)))
}
