/**
 * Pinch zoom in a scroll pane (YAZ-5440's drawing view, shared with YAZ-5471's table view): two fingers zoom about the
 * point between them, a double tap zooms in (or back out), one finger pans (the pane scrolls). `show(scale)` sizes
 * what the pane holds; the pane keeps the point under the fingers in place. Safari's own pinch would zoom the whole app:
 * the view takes it.
 */
export interface ZoomRange {
  /** The smallest scale (the whole thing in view). */
  min: number
  max: number
  /** The scale it opens at. */
  start: number
  /** A double tap zooms in to this (and out to `min` from a third of the way there). */
  doubleIn: number
}

export interface Zoom {
  scale(): number
  /** To `next`, about `at` (a point in the pane); the centre of the pane when none. */
  size(next: number, at?: { x: number; y: number }): void
  /** New bounds (the phone turned): the scale stays inside them. */
  range(next: ZoomRange): void
}

export function pinchZoom(view: HTMLElement, pane: HTMLElement, show: (scale: number) => void, first: ZoomRange): Zoom {
  let bounds = first
  let scale = first.start
  const size = (next: number, at?: { x: number; y: number }) => {
    const before = scale
    scale = Math.min(bounds.max, Math.max(bounds.min, next))
    // Keeps the point under the fingers in place.
    const px = at ? at.x + pane.scrollLeft : pane.clientWidth / 2 + pane.scrollLeft
    const py = at ? at.y + pane.scrollTop : pane.clientHeight / 2 + pane.scrollTop
    show(scale)
    pane.scrollLeft = (px * scale) / before - (at ? at.x : pane.clientWidth / 2)
    pane.scrollTop = (py * scale) / before - (at ? at.y : pane.clientHeight / 2)
  }
  show(scale)

  const fingers = new Map<number, { x: number; y: number }>()
  let pinch: { dist: number; scale: number } | null = null
  const distance = () => {
    const [a, b] = [...fingers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  pane.addEventListener('pointerdown', (e) => {
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (fingers.size === 2) pinch = { dist: distance(), scale }
  })
  pane.addEventListener('pointermove', (e) => {
    if (!fingers.has(e.pointerId)) return
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch !== null && fingers.size === 2) {
      const [a, b] = [...fingers.values()]
      const r = pane.getBoundingClientRect()
      size((pinch.scale * distance()) / Math.max(1, pinch.dist), { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top })
    }
  })
  const lift = (e: PointerEvent) => {
    fingers.delete(e.pointerId)
    if (fingers.size < 2) pinch = null
  }
  pane.addEventListener('pointerup', lift)
  pane.addEventListener('pointercancel', lift)
  pane.addEventListener('dblclick', (e) => {
    const r = pane.getBoundingClientRect()
    const zoomedIn = scale > bounds.min + (bounds.doubleIn - bounds.min) / 3
    size(zoomedIn ? bounds.min : bounds.doubleIn, { x: e.clientX - r.left, y: e.clientY - r.top })
  })
  const noPageZoom = (e: Event) => e.preventDefault()
  view.addEventListener('gesturestart', noPageZoom)
  view.addEventListener('gesturechange', noPageZoom)
  return {
    scale: () => scale,
    size,
    range(next) {
      bounds = next
      size(scale)
    },
  }
}
