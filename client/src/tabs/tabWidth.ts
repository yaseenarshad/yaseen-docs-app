import type { CSSProperties } from 'react'

/** App-global tab strip width setting (YAZ-6474). Re-pointed to `@shared/types` on merge. */
export type TabWidth = 'compact' | 'default' | 'wide' | number

/** Per-vault tab strip ID display mode (YAZ-6474). Re-pointed to `@shared/showIds` on merge. */
export type IdsInTabs = 'off' | 'number' | 'full'

/** Per-vault tab strip ID layout (YAZ-6474). Re-pointed to `@shared/showIds` on merge. */
export type TabIdLayout = 'inline' | 'stacked'

/** Active tab ID rendering config for a vault whose `showIds.tabs !== 'off'`. */
export interface TabIdSpec {
  form: Exclude<IdsInTabs, 'off'>
  layout: TabIdLayout
}

export interface TabWidthBounds {
  min: number
  max: number
  isDefault: boolean
}

const DEFAULT_BOUNDS: TabWidthBounds = { min: 72, max: 200, isDefault: true }
const COMPACT_BOUNDS: TabWidthBounds = { min: 64, max: 150, isDefault: false }
const WIDE_BOUNDS: TabWidthBounds = { min: 100, max: 270, isDefault: false }

/** Resolves the min/max pixel bounds for the app-global `tabWidth` setting. */
export function tabWidthBounds(width: TabWidth | undefined): TabWidthBounds {
  if (width === 'compact') return COMPACT_BOUNDS
  if (width === 'wide') return WIDE_BOUNDS
  if (typeof width === 'number' && Number.isFinite(width)) {
    const clamped = Math.min(400, Math.max(120, width))
    return {
      min: Math.max(72, Math.round(clamped * 0.36)),
      max: Math.round(clamped),
      isDefault: false,
    }
  }
  return DEFAULT_BOUNDS
}

/** Inline CSS custom properties for `.tabbar-row` from `tabWidth`. */
export function tabWidthStyle(width: TabWidth | undefined): CSSProperties {
  const { min, max } = tabWidthBounds(width)
  return {
    '--tab-min-w': `${min}px`,
    '--tab-max-w': `${max}px`,
  } as CSSProperties
}
