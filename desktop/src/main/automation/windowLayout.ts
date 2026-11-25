import { AutomationFailure } from '@shared/automation'
import type { DisplayInfo, DisplaySelector, TilePreset } from '@shared/automationNavigation'
import type { ScreenPoint, WindowBounds } from '@shared/types'

/** Minimum custom window dimensions enforced by `clampCustomBounds` (YAZ-6539). */
export const MIN_WINDOW_WIDTH = 480
export const MIN_WINDOW_HEIGHT = 360

const overlapArea = (a: WindowBounds, b: WindowBounds): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const centerDistanceSq = (ax: number, ay: number, b: WindowBounds): number => {
  const dx = ax - (b.x + b.width / 2)
  const dy = ay - (b.y + b.height / 2)
  return dx * dx + dy * dy
}

const containsPoint = (b: WindowBounds, p: ScreenPoint): boolean =>
  p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height

const primaryDisplay = (displays: readonly DisplayInfo[]): DisplayInfo =>
  displays.find((d) => d.primary) ?? displays[0]!

function displayForPoint(displays: readonly DisplayInfo[], point: ScreenPoint): DisplayInfo {
  const direct = displays.find((d) => containsPoint(d.bounds, point))
  if (direct) return direct
  return displays.reduce((best, d) =>
    centerDistanceSq(point.x, point.y, d.bounds) < centerDistanceSq(point.x, point.y, best.bounds) ? d : best,
  )
}

function displayForBounds(displays: readonly DisplayInfo[], bounds: WindowBounds): DisplayInfo {
  let best = displays[0]!
  let bestArea = overlapArea(bounds, best.bounds)
  for (let i = 1; i < displays.length; i++) {
    const candidate = displays[i]!
    const area = overlapArea(bounds, candidate.bounds)
    if (area > bestArea) {
      best = candidate
      bestArea = area
    }
  }
  if (bestArea > 0) return best
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  return displays.reduce((nearest, d) =>
    centerDistanceSq(cx, cy, d.bounds) < centerDistanceSq(cx, cy, nearest.bounds) ? d : nearest,
  )
}

/** Display ID containing `bounds` (by largest overlap, else nearest center); 0 when `displays` is empty. */
export function displayIdForBounds(displays: readonly DisplayInfo[], bounds: WindowBounds): number {
  if (displays.length === 0) return 0
  return displayForBounds(displays, bounds).id
}

/**
 * Resolves a target display from the connected display list (YAZ-6539).
 * Supports `'primary'`, `'cursor'`, `'next'` (cycling from the display containing `currentBounds`),
 * or an explicit numeric display `id`. Defaults to `currentBounds`'s display when provided, else primary.
 */
export function resolveDisplay(
  displays: readonly DisplayInfo[],
  selector?: DisplaySelector,
  currentBounds?: WindowBounds,
  cursorPoint?: ScreenPoint,
): DisplayInfo {
  if (displays.length === 0) {
    throw new AutomationFailure('DISPLAY_NOT_FOUND', 'No displays are available.')
  }
  if (selector === undefined) {
    return currentBounds ? displayForBounds(displays, currentBounds) : primaryDisplay(displays)
  }
  if (selector === 'primary') {
    return primaryDisplay(displays)
  }
  if (selector === 'cursor') {
    return cursorPoint ? displayForPoint(displays, cursorPoint) : primaryDisplay(displays)
  }
  if (selector === 'next') {
    const current = currentBounds
      ? displayForBounds(displays, currentBounds)
      : cursorPoint
        ? displayForPoint(displays, cursorPoint)
        : primaryDisplay(displays)
    const idx = displays.findIndex((d) => d.id === current.id)
    return displays[(idx + 1) % displays.length]!
  }
  if (typeof selector === 'number') {
    const match = displays.find((d) => d.id === selector)
    if (!match) {
      throw new AutomationFailure('DISPLAY_NOT_FOUND', `Display ${selector} was not found.`, {
        display: selector,
        displays: displays.map((d) => d.id),
      })
    }
    return match
  }
  throw new AutomationFailure(
    'INVALID_INPUT',
    `Invalid display selector: ${String(selector)}. Use primary, cursor, next, or a display ID.`,
  )
}

/**
 * Exact integer pixel bounds for all 15 OS window tiling presets within `workArea` (YAZ-6539).
 * Handles negative multi-monitor coordinates and guarantees zero gaps or overlaps between complementary tiles.
 */
export function tileBounds(preset: TilePreset, workArea: WindowBounds): WindowBounds {
  const x = Math.round(workArea.x)
  const y = Math.round(workArea.y)
  const w = Math.max(1, Math.round(workArea.width))
  const h = Math.max(1, Math.round(workArea.height))

  const halfW = Math.floor(w / 2)
  const rightW = w - halfW
  const halfH = Math.floor(h / 2)
  const bottomH = h - halfH

  const third1 = Math.floor(w / 3)
  const third2 = Math.floor((w * 2) / 3)

  switch (preset) {
    case 'left':
      return { x, y, width: halfW, height: h }
    case 'right':
      return { x: x + halfW, y, width: rightW, height: h }
    case 'top':
      return { x, y, width: w, height: halfH }
    case 'bottom':
      return { x, y: y + halfH, width: w, height: bottomH }
    case 'top-left':
      return { x, y, width: halfW, height: halfH }
    case 'top-right':
      return { x: x + halfW, y, width: rightW, height: halfH }
    case 'bottom-left':
      return { x, y: y + halfH, width: halfW, height: bottomH }
    case 'bottom-right':
      return { x: x + halfW, y: y + halfH, width: rightW, height: bottomH }
    case 'left-third':
      return { x, y, width: third1, height: h }
    case 'center-third':
      return { x: x + third1, y, width: third2 - third1, height: h }
    case 'right-third':
      return { x: x + third2, y, width: w - third2, height: h }
    case 'left-two-thirds':
      return { x, y, width: third2, height: h }
    case 'right-two-thirds':
      return { x: x + third1, y, width: w - third1, height: h }
    case 'center': {
      const cw = Math.min(w, Math.max(1, Math.round(w * 0.8)))
      const ch = Math.min(h, Math.max(1, Math.round(h * 0.8)))
      return {
        x: x + Math.floor((w - cw) / 2),
        y: y + Math.floor((h - ch) / 2),
        width: cw,
        height: ch,
      }
    }
    case 'maximize':
      return { x, y, width: w, height: h }
  }
}

/**
 * Merges partial custom bounds onto `current` and clamps cleanly inside `workArea` (YAZ-6539).
 * Enforces minimum size (`min(480, workArea.width)` × `min(360, workArea.height)`), caps dimensions to `workArea`,
 * and keeps the window and title bar visible inside `workArea` (including negative multi-monitor coordinates).
 */
export function clampCustomBounds(
  partial: Partial<WindowBounds>,
  current: WindowBounds,
  workArea: WindowBounds,
): WindowBounds {
  const waX = Math.round(workArea.x)
  const waY = Math.round(workArea.y)
  const waW = Math.max(1, Math.round(workArea.width))
  const waH = Math.max(1, Math.round(workArea.height))

  const minW = Math.min(MIN_WINDOW_WIDTH, waW)
  const minH = Math.min(MIN_WINDOW_HEIGHT, waH)

  const rawW = Math.round(partial.width ?? current.width)
  const rawH = Math.round(partial.height ?? current.height)
  const width = Math.min(Math.max(rawW, minW), waW)
  const height = Math.min(Math.max(rawH, minH), waH)

  const rawX = Math.round(partial.x ?? current.x)
  const rawY = Math.round(partial.y ?? current.y)
  const x = Math.min(Math.max(rawX, waX), waX + waW - width)
  const y = Math.min(Math.max(rawY, waY), waY + waH - height)

  return { x, y, width, height }
}
