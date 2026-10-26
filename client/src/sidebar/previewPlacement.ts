/**
 * WHERE A HOVER PREVIEW GOES (Draw's YAZ-1800; shared by YAZ-3075 D2): the box beside the sidebar
 * that the board panel (`BoardPreview`) and the note panel (`NotePreview`) both take. Its own file,
 * so a note hover loads neither the board panel nor its picture cache. The placement is measured
 * off the sidebar's own rect and re-measured on resize, scroll and a sidebar resize.
 */
import { useLayoutEffect, useState, type RefObject } from 'react'

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

/** What a panel sits beside: the sidebar (its element, measured live), or a fixed box — a card of the tab board. */
export type PreviewAnchor = RefObject<HTMLElement | null> | { rect: AnchorRect }

/** The widest a panel beside a card gets: a glance, not a page. */
const BESIDE_MAX_W = 520

/**
 * Where the panel goes beside a CARD of the tab board (YAZ-3343, Yaseen's demo feedback): right of the card with
 * the sidebar's gap, or left of it when the window has no room there; centred on the card and kept inside the
 * window. The same shapes as beside the sidebar. Null when the window leaves no room at all.
 */
export function besidePlacement(rect: AnchorRect, innerWidth: number, innerHeight: number, shape: PreviewShape = 'board'): BoardPreviewPlacement | null {
  const width = Math.min(BESIDE_MAX_W, Math.round(innerWidth * 0.4))
  const tallest = Math.round(innerHeight * MAX_H_RATIO)
  const height = shape === 'note' ? tallest : Math.min(tallest, Math.max(MIN_H, Math.round(width * HEIGHT_RATIO)))
  if (width <= 0 || height <= 0) return null
  const left = rect.right + GAP + width <= innerWidth - GAP ? rect.right + GAP : Math.max(GAP, rect.left - GAP - width)
  const top = Math.min(Math.max(GAP, Math.round((rect.top + rect.bottom) / 2 - height / 2)), Math.max(GAP, innerHeight - GAP - height))
  return { left, top, width, height }
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
    if ('rect' in anchor) {
      const place = () => setPlacement(besidePlacement(anchor.rect, window.innerWidth, window.innerHeight, shape))
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
