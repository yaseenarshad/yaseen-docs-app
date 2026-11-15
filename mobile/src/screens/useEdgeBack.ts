import { useEffect, useRef, type RefObject } from 'react'
import { overlayCount } from '../app/browserHistory'
import { edgeSwipe, swipeIsOurs } from '../app/edgeSwipe'
import { browserFacts, whereAmI } from '../pwa/homeScreen'

/** The short slide of a back, and of a spring back (ms). */
const SLIDE_MS = 180

/**
 * The left-edge swipe of a screen with Back (`edgeSwipe.ts` has the rules). Every listener is PASSIVE: the
 * swipe never makes a scroll wait. Nothing on the screen moves sideways by itself (the frame does not
 * scroll; a wide table starts past the edge zone), so the swipe needs no `preventDefault`.
 */
export function useEdgeBack(frame: RefObject<HTMLElement | null>, back: (() => void) | undefined): void {
  // The latest Back, so a new render (a new arrow) never resets a swipe under the finger.
  const latest = useRef(back)
  latest.current = back
  const has = back !== undefined
  useEffect(() => {
    const app = frame.current
    if (app === null || !has || !swipeIsOurs(whereAmI(browserFacts()))) return
    const back = () => latest.current?.()
    const width = () => app.clientWidth || window.innerWidth
    const swipe = edgeSwipe(width)
    const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    let timer: ReturnType<typeof setTimeout> | undefined
    // The overlays open when the finger came down: its `pointerdown` (here, before the page's own listeners,
    // which shut a menu on it) or its `touchstart`. A touch that closed one (a tap outside a menu) is that Back.
    let open = 0
    const down = () => void (open = overlayCount())
    const draw = (px: number, ms: number) => {
      app.style.transition = ms > 0 ? `transform ${ms}ms ease-out` : ''
      app.style.transform = px > 0 ? `translateX(${px}px)` : ''
      app.classList.toggle('app--swiping', px > 0)
    }
    const start = (e: TouchEvent) => {
      const t = e.touches[0]
      if (e.touches.length !== 1 || t === undefined) return swipe.cancel()
      // A box that scrolls sideways and is not at its start keeps its own swipe.
      const side = (e.target as Element | null)?.closest?.('.page-table, pre')
      if (side != null && side.scrollLeft > 0) return swipe.cancel()
      open = Math.max(open, overlayCount())
      swipe.start(t.clientX, t.clientY, e.timeStamp)
    }
    const move = (e: TouchEvent) => {
      const t = e.touches[0]
      if (t === undefined) return
      const px = swipe.move(t.clientX, t.clientY, e.timeStamp)
      if (px !== null && !still()) draw(px, 0)
    }
    const end = (e: TouchEvent) => {
      const result = swipe.end(e.timeStamp)
      const had = open
      open = 0
      if (result === 'none') return
      if (result === 'stay' || overlayCount() < had) return draw(0, still() ? 0 : SLIDE_MS)
      // An overlay is open: Back closes it, and the screen stays where it is (it does not slide away).
      if (overlayCount() > 0) {
        draw(0, still() ? 0 : SLIDE_MS)
        return back()
      }
      if (still()) return back()
      draw(width(), SLIDE_MS)
      timer = setTimeout(back, SLIDE_MS)
    }
    const cancel = () => {
      open = 0
      swipe.cancel()
      draw(0, still() ? 0 : SLIDE_MS)
    }
    const passive = { passive: true }
    app.addEventListener('pointerdown', down, { capture: true, passive: true })
    app.addEventListener('touchstart', start, passive)
    app.addEventListener('touchmove', move, passive)
    app.addEventListener('touchend', end, passive)
    app.addEventListener('touchcancel', cancel, passive)
    return () => {
      clearTimeout(timer)
      app.removeEventListener('pointerdown', down, { capture: true })
      app.removeEventListener('touchstart', start)
      app.removeEventListener('touchmove', move)
      app.removeEventListener('touchend', end)
      app.removeEventListener('touchcancel', cancel)
      draw(0, 0)
    }
  }, [frame, has])
}
