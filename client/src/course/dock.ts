/**
 * THE DOCKABLE PLAYER (YAZ-5365, phase 1 of YAZ-5357): the course's sizes inside the app window, as pure logic.
 *
 * - `full`: the layer covers the window, as before (a modal dialog).
 * - `side`: a panel on the right, about a third of the window (`dockSide`, within `COURSE_SIDE`); the app moves over to
 *   the left part and stays live there.
 * - `corner`: picture in picture in one corner; the app is usable everywhere else.
 *
 * WHO PICKS THE SIZE (Yaseen's decision 2 on YAZ-5357): the course picks a size for each part, and the person can
 * change it. `dockStep` is that rule:
 * - `request` (the course, `requestSize`): the size changes, unless the person chose a size in this part; then the
 *   person's choice wins, and the answer says so (`'kept'`).
 * - `choose` (the person: the size switch): the size changes, and holds until the next part.
 * - `part`: a new part starts (phase 2: a clip that names a size, `CourseClip.dock`). The person's choice of the part
 *   before ends; the part's own size is asked for at once.
 *
 * The geometry (`dockBox`, `cornerAvoiding`) is pure too, so the tour layer and the tests use the same numbers as the
 * layer.
 */
import { createContext, useContext } from 'react'
import { COURSE_SIDE, type CourseCorner, type CourseDock } from '@shared/courseState'
import type { Box } from './tourEngine'

export type DockSize = CourseDock
export type DockCorner = CourseCorner
export { COURSE_SIDE }

/** The answer to a request: the size changed, it was already that size, or the person's choice holds in this part. */
export type SizeAnswer = 'done' | 'same' | 'kept'

/**
 * THE SEAM FOR PHASE 2 (YAZ-5366): what the player and the clips use to ask for a size. Scenes get it as `dock`
 * (`SceneProps`), and any part of the course tree reads it with `useCourseDock()`.
 */
export interface CourseDockApi {
  /** The size now. */
  readonly size: DockSize
  /** Ask for a size, with the reason (kept with the state, for a screen reader's line and for a test). */
  requestSize(size: DockSize, reason: string): SizeAnswer
}

export interface DockState {
  size: DockSize
  /** The person chose the size in this part: a request does not change it until the next part. */
  personChose: boolean
  /** The part now (phase 2: the id of the clip that started it); null before any. */
  part: string | null
  /** Why the size is what it is: 'person', 'saved', or the reason of the last request that took effect. */
  reason: string
}

export type DockAction =
  | { type: 'request'; size: DockSize; reason: string }
  | { type: 'choose'; size: DockSize }
  | { type: 'part'; part: string; size?: DockSize; reason?: string }

export const startDock = (size: DockSize): DockState => ({ size, personChose: false, part: null, reason: 'saved' })

/** Pure: the next dock state, and the answer to a request. The same object when nothing changes. */
export function dockStep(state: DockState, action: DockAction): { state: DockState; answer: SizeAnswer } {
  switch (action.type) {
    case 'choose':
      if (state.size === action.size && state.personChose) return { state, answer: 'same' }
      return { state: { ...state, size: action.size, personChose: true, reason: 'person' }, answer: state.size === action.size ? 'same' : 'done' }
    case 'request':
      if (state.personChose) return { state, answer: state.size === action.size ? 'same' : 'kept' }
      if (state.size === action.size) return { state, answer: 'same' }
      return { state: { ...state, size: action.size, reason: action.reason }, answer: 'done' }
    case 'part': {
      if (state.part === action.part) return { state, answer: 'same' }
      const fresh: DockState = { ...state, part: action.part, personChose: false }
      if (action.size === undefined) return { state: fresh, answer: 'same' }
      return dockStep(fresh, { type: 'request', size: action.size, reason: action.reason ?? `part ${action.part}` })
    }
  }
}

// ---- the geometry ----

export interface View {
  width: number
  height: number
}

/** The side panel never gets narrower than this (px), unless the window is narrower. */
export const SIDE_MIN_PX = 340
/** The corner's gap to the window's edges. */
export const CORNER_MARGIN = 16
/** The corner's width: a part of the window, within these px. */
export const CORNER_WIDTH = { part: 0.26, min: 300, max: 400 } as const
/** Under the stage (head, caption, bar, controls) in the corner, px. */
const CORNER_CHROME = 178

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Pure: the side panel's width in px for a part of the window. */
export function sideWidth(part: number, view: View): number {
  const want = clamp(part, COURSE_SIDE.min, COURSE_SIDE.max) * view.width
  return Math.round(Math.min(view.width, Math.max(SIDE_MIN_PX, Math.min(want, view.width * COURSE_SIDE.max))))
}

/** Pure: the corner's size in px. */
export function cornerSize(view: View): View {
  const width = Math.round(Math.min(view.width - 2 * CORNER_MARGIN, clamp(view.width * CORNER_WIDTH.part, CORNER_WIDTH.min, CORNER_WIDTH.max)))
  const height = Math.round(Math.min(view.height - 2 * CORNER_MARGIN, Math.round(width * 0.56) + CORNER_CHROME))
  return { width: Math.max(0, width), height: Math.max(0, height) }
}

/** Pure: where the corner sits in a corner. */
export function cornerBox(corner: DockCorner, view: View): Box {
  const { width, height } = cornerSize(view)
  const left = corner.endsWith('left') ? CORNER_MARGIN : view.width - width - CORNER_MARGIN
  const top = corner.startsWith('top') ? CORNER_MARGIN : view.height - height - CORNER_MARGIN
  return { left: Math.max(0, left), top: Math.max(0, top), width, height }
}

/** Pure: the player's box in the window; null for `full` (the whole window). */
export function dockBox(size: DockSize, corner: DockCorner, side: number, view: View): Box | null {
  if (size === 'full') return null
  if (size === 'side') {
    const width = sideWidth(side, view)
    return { left: view.width - width, top: 0, width, height: view.height }
  }
  return cornerBox(corner, view)
}

const overlaps = (a: Box, b: Box): boolean => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height

/** The other corners, nearest first: the same row, the same column, then across. */
const NEAREST: Record<DockCorner, DockCorner[]> = {
  'bottom-right': ['bottom-left', 'top-right', 'top-left'],
  'bottom-left': ['bottom-right', 'top-left', 'top-right'],
  'top-right': ['top-left', 'bottom-right', 'bottom-left'],
  'top-left': ['top-right', 'bottom-left', 'bottom-right'],
}

/**
 * Pure: the corner the player shows in. The person's corner, unless it would sit over the control the tour lights
 * (`lit`); then the nearest corner that does not. When every corner covers it (a tiny window), the person's corner.
 */
export function cornerAvoiding(corner: DockCorner, lit: Box | null, view: View): DockCorner {
  if (lit === null || !overlaps(cornerBox(corner, view), lit)) return corner
  return NEAREST[corner].find((c) => !overlaps(cornerBox(c, view), lit)) ?? corner
}

/** Pure: the corner nearest a point (the middle of a dragged corner, at the drop). */
export function nearestCorner(x: number, y: number, view: View): DockCorner {
  return `${y < view.height / 2 ? 'top' : 'bottom'}-${x < view.width / 2 ? 'left' : 'right'}` as DockCorner
}

/** Pure: the corner an arrow key moves to (the move handle's keys). */
export function cornerToward(corner: DockCorner, key: string): DockCorner {
  const [row, col] = corner.split('-') as ['top' | 'bottom', 'left' | 'right']
  if (key === 'ArrowUp') return `top-${col}`
  if (key === 'ArrowDown') return `bottom-${col}`
  if (key === 'ArrowLeft') return `${row}-left`
  if (key === 'ArrowRight') return `${row}-right`
  return corner
}

/** Pure: the side part for a pointer at x (the panel's left edge follows it), within the limits. */
export function sideAt(x: number, view: View): number {
  if (view.width <= 0) return COURSE_SIDE.start
  return Math.round(clamp((view.width - x) / view.width, COURSE_SIDE.min, COURSE_SIDE.max) * 1000) / 1000
}

/** The course's dock, for the clips (phase 2). Outside a course: full, and every request is refused as 'kept'. */
export const CourseDockContext = createContext<CourseDockApi>({ size: 'full', requestSize: () => 'kept' })
export const useCourseDock = (): CourseDockApi => useContext(CourseDockContext)
