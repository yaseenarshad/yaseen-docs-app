/**
 * WHERE A HOVER PREVIEW GOES (Draw's YAZ-1800; shared by YAZ-3075 D2): the box beside the sidebar
 * that the board panel (`BoardPreview`) and the note panel (`NotePreview`) both take. Its own file,
 * so a note hover loads neither the board panel nor its picture cache. The placement is measured
 * off the sidebar's own rect and re-measured on resize, scroll and a sidebar resize.
 */
import { useLayoutEffect, useState, type RefObject } from 'react'
import type { FilesPreviewRequest } from '@shared/types'

const GAP = 16
const WIDTH_RATIO = 0.575
const HEIGHT_RATIO = 0.68
const MAX_H_RATIO = 0.7
const MIN_H = 220

export interface BoardPreviewPlacement {
  left: number
  top: number
  width: number
  height: number
}

/** A board's landscape box, or a note's tall one (YAZ-3075 D2): the same place and width. */
export type PreviewShape = 'board' | 'note'

/** A box on screen the panel sits beside (YAZ-3343, the tab board's cards). */
export interface AnchorRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * A Files window's floating preview popup (YAZ-3357 D9): a window of its own, outside the Files window, which the
 * panel is drawn into (`host`) and main places beside the Files window (`show`). Hidden between previews, never closed.
 */
export interface PreviewPopup {
  /** The popup's element the panel portals into; null when it could not be made. */
  host(): HTMLElement | null
  /** Show the popup at `req` (its size, and the row's top and bottom in this window's page). */
  show(req: FilesPreviewRequest): void
  hide(): void
}

/**
 * What a panel sits beside: the sidebar (its element, measured live), a fixed box — a card of the tab board —, a Files
 * window's row in the floating popup (YAZ-3357 D9), or, where that popup cannot be made, the lower part of a Files window (`overlay`).
 */
export type PreviewAnchor = RefObject<HTMLElement | null> | { rect: AnchorRect; below?: true } | { popup: PreviewPopup; rect: AnchorRect } | { overlay: true }

/** The room around a panel in the floating popup (YAZ-3357 D9): the popup has no shadow, the panel draws its own there. */
const POPUP_MARGIN = 16

/** Where the panel's DOM goes: the floating popup's element, else this page's body. */
export function portalTarget(anchor: PreviewAnchor): HTMLElement {
  return ('popup' in anchor ? anchor.popup.host() : null) ?? document.body
}

/** The widest a panel beside a card gets: a glance, not a page. */
const BESIDE_MAX_W = 520

/** A panel's size beside a card, or in the floating popup off the screen's size (YAZ-3357 D9): a glance, not a page. */
function besideSize(roomWidth: number, roomHeight: number, shape: PreviewShape): { width: number; height: number } {
  const width = Math.min(BESIDE_MAX_W, Math.round(roomWidth * 0.4))
  const tallest = Math.round(roomHeight * MAX_H_RATIO)
  return { width, height: shape === 'note' ? tallest : Math.min(tallest, Math.max(MIN_H, Math.round(width * HEIGHT_RATIO))) }
}

/**
 * The fallback of a Files window's preview (YAZ-3357 D9, option 2), where its popup cannot be made: the panel over the
 * lower 60% of the window, which is only the sidebar, with the gap all round.
 */
export function overlayPlacement(innerWidth: number, innerHeight: number): BoardPreviewPlacement | null {
  const top = Math.round(innerHeight * 0.4)
  const width = innerWidth - 2 * GAP
  const height = innerHeight - top - GAP
  return width <= 0 || height <= 0 ? null : { left: GAP, top, width, height }
}

/**
 * Where the panel goes beside a CARD of the tab board (YAZ-3343 D18): right of the card with
 * the sidebar's gap, or left of it when the window has no room there; centred on the card and kept inside the
 * window. The same shapes as beside the sidebar. With no room on either side — a linked mention is as wide as the
 * page (YAZ-3429) — below or above the box, whichever has more room: never over it. Null when the window leaves no room at all.
 */
export function besidePlacement(rect: AnchorRect, innerWidth: number, innerHeight: number, shape: PreviewShape = 'board'): BoardPreviewPlacement | null {
  const { width, height } = besideSize(innerWidth, innerHeight, shape)
  if (width <= 0 || height <= 0) return null
  const top = Math.min(Math.max(GAP, Math.round((rect.top + rect.bottom) / 2 - height / 2)), Math.max(GAP, innerHeight - GAP - height))
  if (rect.right + GAP + width <= innerWidth - GAP) return { left: rect.right + GAP, top, width, height }
  if (rect.left - GAP - width >= GAP) return { left: rect.left - GAP - width, top, width, height }
  const above = rect.top - GAP / 2 - GAP
  if (innerHeight - GAP - (rect.bottom + GAP / 2) >= above) return belowPlacement(rect, innerWidth, innerHeight, shape)
  const tall = Math.min(height, above)
  return tall <= 0 ? null : { left: Math.max(GAP, Math.min(rect.left, innerWidth - GAP - width)), top: rect.top - GAP / 2 - tall, width, height: tall }
}

/**
 * Where the panel goes BELOW a box (YAZ-3403, a tab of the tab strip): the size it takes beside a card, 8 px under
 * the box, from the box's left edge and kept inside the window; no taller than the room below.
 * Null when the window leaves no room at all.
 */
export function belowPlacement(rect: AnchorRect, innerWidth: number, innerHeight: number, shape: PreviewShape = 'board'): BoardPreviewPlacement | null {
  const size = besideSize(innerWidth, innerHeight, shape)
  const top = rect.bottom + GAP / 2
  const height = Math.min(size.height, innerHeight - GAP - top)
  if (size.width <= 0 || height <= 0) return null
  const left = Math.max(GAP, Math.min(rect.left, innerWidth - GAP - size.width))
  return { left, top, width: size.width, height }
}

/**
 * Where the panel goes (YAZ-1800): right of the sidebar with a gap, a little over half of the
 * room left, landscape-ish, vertically centred. A note is 70% of the window tall (YAZ-3075 D2), so
 * it shows some 25 lines. Null when the window leaves no room at all.
 */
export function boardPreviewPlacement(sidebarRight: number, innerWidth: number, innerHeight: number, shape: PreviewShape = 'board'): BoardPreviewPlacement | null {
  const usable = innerWidth - sidebarRight - GAP
  const width = Math.min(Math.round(usable * WIDTH_RATIO), usable - GAP)
  const tallest = Math.round(innerHeight * MAX_H_RATIO)
  const height = shape === 'note' ? tallest : Math.min(tallest, Math.max(MIN_H, Math.round(width * HEIGHT_RATIO)))
  if (width <= 0 || height <= 0) return null
  return { left: sidebarRight + GAP, top: Math.max(GAP, Math.round((innerHeight - height) / 2)), width, height }
}

/** The placement, kept live against the window and the sidebar's own size (or beside a card's fixed box). */
export function usePlacement(anchor: PreviewAnchor, shape: PreviewShape): BoardPreviewPlacement | null {
  const [placement, setPlacement] = useState<BoardPreviewPlacement | null>(null)
  useLayoutEffect(() => {
    if ('popup' in anchor) {
      // The floating popup (YAZ-3357 D9): the panel fills it but for the shadow's margin; main puts it beside the row.
      const { width, height } = besideSize(window.screen.availWidth, window.screen.availHeight, shape)
      setPlacement({ left: POPUP_MARGIN, top: POPUP_MARGIN, width, height })
      anchor.popup.show({ width: width + 2 * POPUP_MARGIN, height: height + 2 * POPUP_MARGIN, top: anchor.rect.top, bottom: anchor.rect.bottom })
      return () => anchor.popup.hide()
    }
    if ('overlay' in anchor) {
      const place = () => setPlacement(overlayPlacement(window.innerWidth, window.innerHeight))
      place()
      window.addEventListener('resize', place)
      return () => window.removeEventListener('resize', place)
    }
    if ('rect' in anchor) {
      const at = 'below' in anchor && anchor.below === true ? belowPlacement : besidePlacement
      const place = () => setPlacement(at(anchor.rect, window.innerWidth, window.innerHeight, shape))
      place()
      window.addEventListener('resize', place)
      return () => window.removeEventListener('resize', place)
    }
    const place = () => {
      const el = anchor.current
      setPlacement(el === null ? null : boardPreviewPlacement(el.getBoundingClientRect().right, window.innerWidth, window.innerHeight, shape))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const observer = typeof ResizeObserver === 'undefined' || anchor.current === null ? null : new ResizeObserver(place)
    if (observer !== null && anchor.current !== null) observer.observe(anchor.current)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      observer?.disconnect()
    }
  }, [anchor, shape])
  return placement
}
