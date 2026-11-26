/**
 * Settings › Appearance › Menus › Menu icons (YAZ-6567):
 * Global-only preference controlling whether right-click context menus display action icons
 * and which glyph variant each customizable action uses.
 *
 * Pure: no React, no DOM, no Electron — shared by Desktop main, Desktop renderer, and tests.
 */
import { isRecord } from './guards'

export const NEW_WINDOW_ICON_VARIANTS = ['box-arrow', 'win-arrow', 'win-plus', 'none'] as const
export type NewWindowIconVariant = (typeof NEW_WINDOW_ICON_VARIANTS)[number]

export const DUPLICATE_TAB_ICON_VARIANTS = ['clone-plus', 'twin-bar', 'two-tabs', 'none'] as const
export type DuplicateTabIconVariant = (typeof DUPLICATE_TAB_ICON_VARIANTS)[number]

export const OPEN_NEW_TAB_ICON_VARIANTS = ['tab-bar-plus', 'tab-strip-plus', 'raised-tab', 'none'] as const
export type OpenNewTabIconVariant = (typeof OPEN_NEW_TAB_ICON_VARIANTS)[number]

export const HIDE_OTHERS_ICON_VARIANTS = ['isolate', 'solo-row', 'funnel', 'none'] as const
export type HideOthersIconVariant = (typeof HIDE_OTHERS_ICON_VARIANTS)[number]

export const SHOW_IN_SIDEBAR_ICON_VARIANTS = ['panel-highlight', 'panel-arrow', 'crosshair', 'none'] as const
export type ShowInSidebarIconVariant = (typeof SHOW_IN_SIDEBAR_ICON_VARIANTS)[number]

export const MENU_ICON_ACTIONS = ['newWindow', 'duplicateTab', 'openNewTab', 'hideOthers', 'showInSidebar'] as const
export type MenuIconAction = (typeof MENU_ICON_ACTIONS)[number]

export interface ResolvedMenuIconPicks {
  newWindow: NewWindowIconVariant
  duplicateTab: DuplicateTabIconVariant
  openNewTab: OpenNewTabIconVariant
  hideOthers: HideOthersIconVariant
  showInSidebar: ShowInSidebarIconVariant
}

export type MenuIconVariantOf<K extends MenuIconAction> = ResolvedMenuIconPicks[K]
export type MenuIconsCustom = Partial<ResolvedMenuIconPicks>
export type MenuIconsSetting = 'on' | 'off' | MenuIconsCustom

export interface ResolvedMenuIcons {
  enabled: boolean
  picks: ResolvedMenuIconPicks
}

/** Approved defaults (YAZ-6567 D1–D4 + YAZ-6535). */
export const DEFAULT_MENU_ICON_PICKS: Readonly<ResolvedMenuIconPicks> = {
  newWindow: 'box-arrow',
  duplicateTab: 'clone-plus',
  openNewTab: 'tab-bar-plus',
  hideOthers: 'isolate',
  showInSidebar: 'panel-highlight',
}

export const DEFAULT_MENU_ICONS: MenuIconsSetting = 'on'

export const MENU_ICON_VARIANTS: { readonly [K in MenuIconAction]: readonly ResolvedMenuIconPicks[K][] } = {
  newWindow: NEW_WINDOW_ICON_VARIANTS,
  duplicateTab: DUPLICATE_TAB_ICON_VARIANTS,
  openNewTab: OPEN_NEW_TAB_ICON_VARIANTS,
  hideOthers: HIDE_OTHERS_ICON_VARIANTS,
  showInSidebar: SHOW_IN_SIDEBAR_ICON_VARIANTS,
}

function isValidVariant<K extends MenuIconAction>(action: K, value: unknown): value is ResolvedMenuIconPicks[K] {
  return typeof value === 'string' && (MENU_ICON_VARIANTS[action] as readonly string[]).includes(value)
}

/** Strict validator for IPC boundaries and settings merge checks. */
export function isMenuIconsSetting(value: unknown): value is MenuIconsSetting {
  if (value === 'on' || value === 'off') return true
  if (!isRecord(value) || Array.isArray(value)) return false
  for (const [key, val] of Object.entries(value)) {
    if (!(MENU_ICON_ACTIONS as readonly string[]).includes(key)) return false
    if (val !== undefined && !isValidVariant(key as MenuIconAction, val)) return false
  }
  return true
}

/** Normalizes any raw stored value into a clean `MenuIconsSetting`, collapsing all-default objects to `'on'`. */
export function sanitizeMenuIcons(raw: unknown): MenuIconsSetting {
  if (raw === 'off') return 'off'
  if (raw === 'on' || !isRecord(raw) || Array.isArray(raw)) return DEFAULT_MENU_ICONS
  const custom: MenuIconsCustom = {}
  let hasOverride = false
  for (const action of MENU_ICON_ACTIONS) {
    const val = raw[action]
    if (isValidVariant(action, val) && val !== DEFAULT_MENU_ICON_PICKS[action]) {
      ;(custom as Record<string, string>)[action] = val
      hasOverride = true
    }
  }
  return hasOverride ? custom : 'on'
}

/** Resolves any `MenuIconsSetting` into concrete `enabled` + all 5 variant picks. */
export function resolveMenuIcons(setting: MenuIconsSetting | undefined): ResolvedMenuIcons {
  if (setting === 'off') {
    return { enabled: false, picks: { ...DEFAULT_MENU_ICON_PICKS } }
  }
  if (setting === undefined || setting === 'on') {
    return { enabled: true, picks: { ...DEFAULT_MENU_ICON_PICKS } }
  }
  return {
    enabled: true,
    picks: {
      newWindow: isValidVariant('newWindow', setting.newWindow) ? setting.newWindow : DEFAULT_MENU_ICON_PICKS.newWindow,
      duplicateTab: isValidVariant('duplicateTab', setting.duplicateTab) ? setting.duplicateTab : DEFAULT_MENU_ICON_PICKS.duplicateTab,
      openNewTab: isValidVariant('openNewTab', setting.openNewTab) ? setting.openNewTab : DEFAULT_MENU_ICON_PICKS.openNewTab,
      hideOthers: isValidVariant('hideOthers', setting.hideOthers) ? setting.hideOthers : DEFAULT_MENU_ICON_PICKS.hideOthers,
      showInSidebar: isValidVariant('showInSidebar', setting.showInSidebar) ? setting.showInSidebar : DEFAULT_MENU_ICON_PICKS.showInSidebar,
    },
  }
}

export function isDefaultMenuIcons(setting: MenuIconsSetting | undefined): boolean {
  if (setting === undefined || setting === 'on') return true
  if (setting === 'off') return false
  const { picks } = resolveMenuIcons(setting)
  return MENU_ICON_ACTIONS.every((action) => picks[action] === DEFAULT_MENU_ICON_PICKS[action])
}

/** Updates one action's pick and returns a normalized `MenuIconsSetting` (`'on'` when back to all defaults). */
export function patchMenuIconPick<K extends MenuIconAction>(
  current: MenuIconsSetting | undefined,
  action: K,
  variant: ResolvedMenuIconPicks[K],
): MenuIconsSetting {
  const { picks } = resolveMenuIcons(current)
  return sanitizeMenuIcons({ ...picks, [action]: variant })
}
