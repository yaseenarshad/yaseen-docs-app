import { edgeSwipe } from '../app/edgeSwipe'
import { SHEET_EASE, SHEET_MS, releaseMs, sheetDrag, type DragFrom } from './sheetDrag'

/**
 * THE TOP SHEET'S MOTION (YAZ-5472): the finger in, the sheet drawn. "Butter smooth" is the test, so:
 *
 *  - NO REACT STATE PER FRAME. A finger's move only notes where the sheet should be; ONE requestAnimationFrame callback
 *    draws the latest place: the sheet's `transform` and its dim's `opacity`, both drawn by the compositor (no layout,
 *    no paint). Ten moves in one frame draw once.
 *  - NO LAYOUT READ IN THE LOOP. The sheet's height comes from a ResizeObserver, and whether the body is at its top from
 *    an IntersectionObserver on a 1 px mark at its top: both are told by the browser, never asked in a move.
 *  - THE HEAD: Pointer Events, `touch-action: none` (CSS): the sheet follows the finger at once, at any scroll place.
 *  - THE BODY keeps the browser's own scroll (`touch-action: pan-y`), with its momentum. A pointer stream is cancelled
 *    by the browser the moment its scroll starts (`pointercancel`), so the body's hand-off between scroll and drag is a
 *    touch listener: its first move at the top, going down, calls `preventDefault` (the drag); any other first move is
 *    the scroll, which the drag never waits on again (a scroll's later moves cannot be cancelled, and need not be).
 *  - THE LEFT EDGE (YAZ-5435's `edgeSwipe`, in the Home Screen app): the sheet follows sideways, and Back closes it.
 *  - The open, the close and the spring back are Web Animations of `transform` and `opacity`: the compositor runs them,
 *    so a page drawing its slices under them never makes them stutter. `prefers-reduced-motion`: no slide; the sheet
 *    still follows a finger (the person moves it), and a close is at once.
 */

export interface SheetParts {
  /** The sheet's box, which moves. */
  box: HTMLElement
  /** Its head row: a drag from it at any time. */
  head: HTMLElement
  /** Its body, which scrolls. */
  body: HTMLElement
  /** A 1 px mark at the top of the body's content: seen means the body is at its top. */
  top: HTMLElement
  /** The dim under this sheet. */
  dim: HTMLElement
}

export interface MotionOptions {
  /** The close's end (or a close with no motion): the sheet leaves the stack. */
  onClosed(): void
  /** The left edge's swipe is the app's (the Home Screen app: `swipeIsOurs`). */
  edge: boolean
  /** `prefers-reduced-motion: reduce`. */
  still?: () => boolean
  /** The frame scheduler (tests pass their own). */
  frame?: (draw: () => void) => number
  cancelFrame?: (id: number) => void
}

export interface SheetMotion {
  /** The sheet slides up (the dim fades in). */
  open(): void
  /** The sheet slides down and leaves; false when it is already closing. */
  close(speed?: number): boolean
  destroy(): void
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const at = (x: number, y: number) => (x === 0 && y === 0 ? 'none' : `translate3d(${x}px, ${y}px, 0)`)

export function sheetMotion(parts: SheetParts, options: MotionOptions): SheetMotion {
  const { box, head, body, top, dim } = parts
  const still = options.still ?? reducedMotion
  const frame = options.frame ?? ((draw) => requestAnimationFrame(draw))
  const cancelFrame = options.cancelFrame ?? ((id) => cancelAnimationFrame(id))
  const drag = sheetDrag()
  const swipe = edgeSwipe(() => window.innerWidth)
  const listeners: (() => void)[] = []
  const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, passive = true) => {
    el.addEventListener(type, fn, { passive })
    listeners.push(() => el.removeEventListener(type, fn))
  }

  // What the browser tells: the sheet's height, and whether the body is at its top.
  let height = 0
  let atTop = true
  const sized = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => (height = entries[entries.length - 1].contentRect.height)) : null
  sized?.observe(box)
  const seen =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => (atTop = entries[entries.length - 1].isIntersecting), { root: body, threshold: 0 })
      : null
  seen?.observe(top)
  /** Read at a touch's start only, where no observer runs (jsdom). */
  const topNow = () => (seen === null ? body.scrollTop <= 0 : atTop)
  /** The height a drag uses: the observer's, else the window's, taken when the finger comes down (never in a move). */
  let dragHeight = 0
  const tall = () => height || window.innerHeight

  // The drawing: the latest place, once a frame.
  let x = 0
  let y = 0
  let wanted: { x: number; y: number } | null = null
  let pending = 0
  let closing = false
  let width = 0
  const fade = (px: number, py: number) => Math.max(0, Math.min(1, 1 - Math.max(py / (dragHeight || tall()), width > 0 ? px / width : 0)))
  const paint = () => {
    pending = 0
    if (wanted === null) return
    x = wanted.x
    y = wanted.y
    wanted = null
    box.style.transform = at(x, y)
    dim.style.opacity = String(fade(x, y))
  }
  const draw = (px: number, py: number) => {
    wanted = { x: px, y: py }
    if (pending === 0) pending = frame(paint)
  }
  const stopFrame = () => {
    if (pending !== 0) cancelFrame(pending)
    pending = 0
    wanted = null
  }

  /** A moving sheet that the finger catches: it stops where it is (one read, at the touch's start). */
  const catchIt = () => {
    const moving = box.getAnimations?.() ?? []
    if (moving.length === 0) return
    const m = new DOMMatrixReadOnly(getComputedStyle(box).transform === 'none' ? undefined : getComputedStyle(box).transform)
    for (const a of [...moving, ...(dim.getAnimations?.() ?? [])]) a.cancel()
    x = m.m41
    y = m.m42
    box.style.transform = at(x, y)
  }

  const glide = (toX: number, toY: number | string, fadeTo: number, ms: number, done?: () => void) => {
    stopFrame()
    const from = at(x, y)
    const to = typeof toY === 'string' ? toY : at(toX, toY)
    const fromOpacity = String(fade(x, y))
    box.style.transform = to
    dim.style.opacity = String(fadeTo)
    if (typeof toY === 'number') {
      x = toX
      y = toY
    }
    if (ms <= 0 || typeof box.animate !== 'function') return done?.()
    const motion = box.animate([{ transform: from }, { transform: to }], { duration: ms, easing: SHEET_EASE })
    dim.animate([{ opacity: fromOpacity }, { opacity: String(fadeTo) }], { duration: ms, easing: SHEET_EASE })
    if (done !== undefined) motion.finished.then(done, () => undefined)
  }

  const close = (speed = 0): boolean => {
    if (closing) return false
    closing = true
    const ms = still() ? 0 : releaseMs(tall() - y, speed)
    if (x > 0) glide(window.innerWidth, 0, 0, ms, options.onClosed)
    else glide(0, 'translate3d(0, 100%, 0)', 0, ms, options.onClosed)
    return true
  }
  const springBack = (speed: number) => glide(0, 0, 1, still() ? 0 : releaseMs(Math.max(x, y), speed))

  // A drag (head or body).
  const begin = (px: number, py: number, t: number, from: DragFrom) => {
    if (closing) return
    dragHeight = tall()
    catchIt()
    // A sheet caught while it moved goes on from where it is.
    drag.start(px, py, t, from, y)
  }
  const step = (px: number, py: number, t: number, top: boolean): boolean => {
    const r = drag.move(px, py, t, top)
    if (r.offset !== null) draw(0, r.offset)
    return r.claim
  }
  const finish = (t: number) => {
    const r = drag.end(t, dragHeight || tall())
    if (r.kind === 'none') return
    if (r.kind === 'close') close(r.speed)
    else springBack(r.speed)
  }
  const lost = () => {
    if (!drag.dragging) return drag.cancel()
    drag.cancel()
    springBack(0)
  }

  // THE HEAD: Pointer Events. The pointer is captured only once it is a drag, so a tap on ⋯ stays a tap.
  let pointer: number | null = null
  on(head, 'pointerdown', (e) => {
    if (e.button !== 0 || pointer !== null) return
    pointer = e.pointerId
    begin(e.clientX, e.clientY, e.timeStamp, 'head')
  })
  on(head, 'pointermove', (e) => {
    if (e.pointerId !== pointer) return
    const was = drag.dragging
    step(e.clientX, e.clientY, e.timeStamp, true)
    if (!was && drag.dragging) head.setPointerCapture?.(e.pointerId)
  })
  on(head, 'pointerup', (e) => {
    if (e.pointerId !== pointer) return
    pointer = null
    finish(e.timeStamp)
  })
  on(head, 'pointercancel', (e) => {
    if (e.pointerId !== pointer) return
    pointer = null
    lost()
  })

  // THE BODY: its own scroll, and the drag at its top.
  on(body, 'touchstart', (e) => {
    const t = e.touches[0]
    if (e.touches.length !== 1 || t === undefined) return lost()
    begin(t.clientX, t.clientY, e.timeStamp, 'body')
    // The first move reads it again (the observer has had a frame); the start only needs it where none runs.
    if (seen === null) atTop = topNow()
  })
  on(
    body,
    'touchmove',
    (e) => {
      const t = e.touches[0]
      if (t === undefined) return
      if (step(t.clientX, t.clientY, e.timeStamp, atTop) && e.cancelable) e.preventDefault()
    },
    false,
  )
  on(body, 'touchend', (e) => finish(e.timeStamp))
  on(body, 'touchcancel', lost)
  if (seen === null) on(body, 'scroll', () => (atTop = body.scrollTop <= 0))

  // THE LEFT EDGE: Back closes the sheet (passive, as YAZ-5435's).
  let sideways = false
  if (options.edge) {
    on(box, 'touchstart', (e) => {
      const t = e.touches[0]
      sideways = false
      if (e.touches.length !== 1 || t === undefined || closing) return swipe.cancel()
      width = window.innerWidth
      swipe.start(t.clientX, t.clientY, e.timeStamp)
    })
    on(box, 'touchmove', (e) => {
      const t = e.touches[0]
      if (t === undefined) return
      const px = swipe.move(t.clientX, t.clientY, e.timeStamp)
      if (px === null) return
      sideways = true
      draw(px, 0)
    })
    on(box, 'touchend', (e) => {
      const result = swipe.end(e.timeStamp)
      if (!sideways) return
      sideways = false
      if (result === 'back') close()
      else glide(0, 0, 1, still() ? 0 : SHEET_MS / 2)
    })
    on(box, 'touchcancel', () => {
      swipe.cancel()
      if (sideways) glide(0, 0, 1, 0)
      sideways = false
    })
  }

  return {
    open() {
      if (still() || typeof box.animate !== 'function') return
      box.animate([{ transform: 'translate3d(0, 100%, 0)' }, { transform: 'none' }], { duration: SHEET_MS, easing: SHEET_EASE })
      dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SHEET_MS, easing: SHEET_EASE })
    },
    close,
    destroy() {
      stopFrame()
      for (const off of listeners) off()
      sized?.disconnect()
      seen?.disconnect()
    },
  }
}
