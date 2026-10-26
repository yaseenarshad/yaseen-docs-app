import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { isBoard } from '@shared/fileKind'
import { BOARD, type CanvasPlan, type Rect, type Where } from './board'

/** How long after the last pan or zoom step the board looks again at which cards are on screen (YAZ-3343 D6): never on every frame. */
export const SETTLE_MS = 120
/** The bottom of the board the toolbar stands in (tabs.css: 14 px + a 34 px row + room): the fit keeps every card above it (D24). */
export const TOOLBAR_INSET = 56
/** The fit's room round the board (D24): the board takes 1 / FIT_MARGIN of the viewport. */
const FIT_MARGIN = 1.1
/** The least zoom the fit goes to: below it, it centres on the active card's frame (or group) instead. */
const FIT_MIN_ZOOM = 0.25
const NONE: ReadonlySet<string> = new Set()
const clampZoom = (zoom: number): number => Math.min(BOARD.maxZoom, Math.max(BOARD.minZoom, zoom))

/** What the camera reads of the board when it runs: the plan, the active card, and where a card stands now. */
export interface CameraInputs {
  plan: CanvasPlan
  active: string | null
  where: Where
}

/**
 * THE CAMERA of the tab board (YAZ-3343 D4, D7, D24): one world layer in the board's viewport, moved by ONE CSS
 * transform written straight onto it from a ref — a pan, a pinch, ⌘-scroll and the zoom buttons render nothing.
 * It measures the viewport (`view`), FITS the board once the viewport is known, and only when it rests looks again at
 * which drawings are on screen at a zoom that shows detail (`pictured`, D6). Never stored (D1).
 */
export function useCamera({ rootRef, bodyRef, worldRef, read, onMove }: { rootRef: RefObject<HTMLElement | null>; bodyRef: RefObject<HTMLElement | null>; worldRef: RefObject<HTMLElement | null>; read: () => CameraInputs; onMove: () => void }) {
  /** The viewport's box, measured when the board mounts and when the window resizes it. Null until then. */
  const [view, setView] = useState<{ w: number; h: number } | null>(null)
  /** The drawings on screen while the zoom shows detail (D6), recomputed when the camera rests. */
  const [pictured, setPictured] = useState<ReadonlySet<string>>(NONE)
  const picturedRef = useRef(pictured)
  const cam = useRef<{ x: number; y: number; zoom: number }>({ x: BOARD.padX, y: BOARD.padTop, zoom: 1 })
  /** The zoom pill's percent, written by the camera (D24: Excalidraw's "− 100% +"). */
  const percentRef = useRef<HTMLButtonElement>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  /** The camera onto the world: one transform, no render (D4). */
  const apply = (glide = false): void => {
    const world = worldRef.current
    if (world === null) return
    const { x, y, zoom } = cam.current
    if (glide && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === false) {
      world.dataset.glide = ''
      window.setTimeout(() => delete world.dataset.glide, 220)
    }
    world.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`
    // Far out, the cards show their titles alone (D15): one attribute, no render.
    rootRef.current?.toggleAttribute('data-far', zoom < 0.6)
    // The pill's percent, written straight into its text: the camera renders nothing.
    if (percentRef.current !== null) percentRef.current.textContent = `${Math.round(zoom * 100)}%`
  }

  /** Which drawings are on screen at a zoom that shows detail (D6). Arithmetic on the plan; it renders only when the answer changed. */
  const recount = (): void => {
    const box = viewRef.current
    const { x, y, zoom } = cam.current
    const next = new Set<string>()
    if (zoom >= BOARD.detailZoom && box !== null && box.w > 0) {
      for (const [id, pos] of read().plan.cards) {
        if (!isBoard(pos.path)) continue
        const left = x + pos.x * zoom
        const top = y + pos.y * zoom
        if (left < box.w && top < box.h && left + BOARD.pageW * zoom > 0 && top + BOARD.pageH * zoom > 0) next.add(id)
      }
    }
    // Compared here, not in an updater: a set that did not change must not even schedule a render.
    const held = picturedRef.current
    if (held.size === next.size && [...next].every((id) => held.has(id))) return
    picturedRef.current = next
    setPictured(next)
  }
  const settleTimer = useRef(0)
  const settle = (): void => {
    window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(recount, SETTLE_MS)
  }
  useEffect(() => () => window.clearTimeout(settleTimer.current), [])

  /** Zoom by `factor` about the viewport point (px, py): the world point under it holds still (D7). */
  const zoomAt = (px: number, py: number, factor: number, glide = false): void => {
    const c = cam.current
    const zoom = clampZoom(c.zoom * factor)
    c.x = px - ((px - c.x) * zoom) / c.zoom
    c.y = py - ((py - c.y) * zoom) / c.zoom
    c.zoom = zoom
    apply(glide)
    settle()
  }
  /** The zoom pill (D24): about the middle of the viewport. */
  const zoomBy = (factor: number): void => {
    onMove()
    const box = viewRef.current
    zoomAt((box?.w ?? 0) / 2, (box?.h ?? 0) / 2, factor, true)
  }
  /**
   * THE FIT (D24): everything the board shows, centred above the toolbar's row, with `FIT_MARGIN` of room round it, at
   * 100% at most. A board that would need less than `FIT_MIN_ZOOM` gets that zoom, centred on the frame (or group) of
   * the active card. Null with no viewport.
   */
  const fitCamera = (): { x: number; y: number; zoom: number } | null => {
    const box = viewRef.current
    const { plan, active } = read()
    const b = plan.bounds
    if (box === null || box.w <= 0 || box.h <= 0 || b.w <= 0 || b.h <= 0) return null
    const h = Math.max(1, box.h - TOOLBAR_INSET)
    const fit = Math.min(1, box.w / (b.w * FIT_MARGIN), h / (b.h * FIT_MARGIN))
    const centreOn = (r: Rect, zoom: number) => ({ zoom, x: box.w / 2 - (r.x + r.w / 2) * zoom, y: h / 2 - (r.y + r.h / 2) * zoom })
    if (fit >= FIT_MIN_ZOOM) return centreOn(b, fit)
    const owner = active === null ? undefined : plan.cards.get(active)?.owner
    return centreOn(plan.frames.find((f) => f.win === owner) ?? plan.groups.find((g) => g.key === owner) ?? b, FIT_MIN_ZOOM)
  }
  /** "Fit all tabs" (D24): the same fit as the board's open. */
  const fitAll = (): void => {
    onMove()
    const fit = fitCamera()
    if (fit === null) return
    cam.current = fit
    apply(true)
    settle()
  }
  /** Pan just enough that the card `id` is on screen (D7): the arrows' move, the filter's first match. */
  const reveal = (id: string): void => {
    const box = viewRef.current
    const pos = read().where(id)
    if (box === null || box.w <= 0 || pos === undefined) return
    const c = cam.current
    const w = BOARD.pageW * c.zoom
    const h = BOARD.pageH * c.zoom
    const left = c.x + pos.x * c.zoom
    const top = c.y + pos.y * c.zoom
    const margin = 24
    if (left >= 0 && top >= 0 && left + w <= box.w && top + h <= box.h) return
    if (left < margin) c.x += margin - left
    else if (left + w > box.w - margin) c.x -= Math.min(left - margin, left + w - (box.w - margin))
    if (top < margin) c.y += margin - top
    else if (top + h > box.h - margin) c.y -= Math.min(top - margin, top + h - (box.h - margin))
    apply(true)
    settle()
  }
  /** World coordinates of a point of the screen. */
  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = bodyRef.current?.getBoundingClientRect()
    const c = cam.current
    return { x: (clientX - (rect?.left ?? 0) - c.x) / c.zoom, y: (clientY - (rect?.top ?? 0) - c.y) / c.zoom }
  }

  // The viewport's box, read when the board mounts and when its box changes — never on a keystroke, a pan or a hover.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (body === null) return
    const measure = (): void => {
      const w = body.clientWidth
      const h = body.clientHeight
      setView((now) => (now !== null && now.w === w && now.h === h ? now : { w, h }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    return () => observer.disconnect()
  }, [])
  // The camera's first place, once the viewport is known: THE FIT — every window on screen, a little room round them.
  // With no viewport to fit (none measured yet), zoom 1 from the top-left padding.
  const placed = useRef(false)
  useLayoutEffect(() => {
    if (placed.current || view === null) return
    placed.current = true
    cam.current = fitCamera() ?? { x: BOARD.padX, y: BOARD.padTop, zoom: 1 }
    apply()
    recount()
  }, [view])
  // Pinch and ⌘-scroll zoom about the pointer; two-finger scroll pans (D7). Not passive: the page itself must not scroll.
  const latest = useRef({ zoomAt, apply, settle, onMove })
  latest.current = { zoomAt, apply, settle, onMove }
  useEffect(() => {
    const body = bodyRef.current
    if (body === null) return
    const wheel = (e: WheelEvent): void => {
      e.preventDefault()
      const now = latest.current
      now.onMove()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (viewRef.current?.h ?? 800) : 1
      const rect = body.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) return now.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * unit * 0.01))
      cam.current.x -= e.deltaX * unit
      cam.current.y -= e.deltaY * unit
      now.apply()
      now.settle()
    }
    body.addEventListener('wheel', wheel, { passive: false })
    return () => body.removeEventListener('wheel', wheel)
  }, [])

  /** The pictures follow the plan too (a card that moved, a filter that brought a drawing on screen): after the first fit only. */
  const recountIfPlaced = (): void => {
    if (placed.current) recount()
  }
  return { view, pictured, cam, percentRef, apply, settle, zoomBy, fitAll, reveal, toWorld, recountIfPlaced }
}
