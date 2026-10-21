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

/** The placement, kept live against the window and the sidebar's own size. */
export function usePlacement(anchor: RefObject<HTMLElement | null>, shape: PreviewShape): BoardPreviewPlacement | null {
  const [placement, setPlacement] = useState<BoardPreviewPlacement | null>(null)
  useLayoutEffect(() => {
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
