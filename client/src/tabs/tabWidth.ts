import type { CSSProperties } from 'react'
import { TAB_WIDTH_MAX, TAB_WIDTH_MIN, type TabWidth } from '@shared/types'
import type { IdsInTabs, TabIdLayout } from '@shared/showIds'

export type { IdsInTabs, TabIdLayout, TabWidth }

/** Active tab ID rendering config for a vault whose `showIds.tabs !== 'off'`. */
export interface TabIdSpec {
  form: Exclude<IdsInTabs, 'off'>
  layout: TabIdLayout
}

export interface TabWidthBounds {
  min: number
  max: number
  isAuto: boolean
}

const AUTO_BOUNDS: TabWidthBounds = { min: 72, max: 200, isAuto: true }
const COMPACT_BOUNDS: TabWidthBounds = { min: 64, max: 150, isAuto: false }
const MEDIUM_BOUNDS: TabWidthBounds = { min: 72, max: 200, isAuto: false }
const WIDE_BOUNDS: TabWidthBounds = { min: 100, max: 270, isAuto: false }

/** Resolves the min/max pixel bounds for the app-global active `tabWidth` setting. */
export function tabWidthBounds(width: TabWidth | undefined): TabWidthBounds {
  if (width === 'compact') return COMPACT_BOUNDS
  if (width === 'medium') return MEDIUM_BOUNDS
  if (width === 'wide') return WIDE_BOUNDS
  if (typeof width === 'number' && Number.isFinite(width)) {
    const max = Math.round(Math.min(TAB_WIDTH_MAX, Math.max(TAB_WIDTH_MIN, width)))
    return {
      min: Math.min(max, Math.max(64, Math.round(max * 0.36))),
      max,
      isAuto: false,
    }
  }
  return AUTO_BOUNDS
}

/** Resolves the fixed max width (in px) for inactive tabs, or `null` when set to `'auto'` (shrink to fit). */
export function inactiveTabMaxWidth(width: TabWidth | undefined): number | null {
  if (width === 'compact') return COMPACT_BOUNDS.max
  if (width === 'medium') return MEDIUM_BOUNDS.max
  if (width === 'wide') return WIDE_BOUNDS.max
  if (typeof width === 'number' && Number.isFinite(width)) {
    return Math.round(Math.min(TAB_WIDTH_MAX, Math.max(TAB_WIDTH_MIN, width)))
  }
  return null
}

/** Inline CSS custom properties for `.tabbar-row` from `tabWidth` (active) and `inactiveTabWidth` (unselected). */
export function tabWidthStyle(width: TabWidth | undefined, inactiveWidth?: TabWidth): CSSProperties {
  const active = tabWidthBounds(width)
  const inactiveMax = inactiveTabMaxWidth(inactiveWidth)
  return {
    '--tab-active-min-w': `${active.min}px`,
    '--tab-active-max-w': `${active.max}px`,
    ...(inactiveMax === null ? {} : { '--tab-inactive-max-w': `${inactiveMax}px` }),
  } as CSSProperties
}
