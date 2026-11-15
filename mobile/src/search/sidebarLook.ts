import type { SettingsState } from '@shared/types'

/** The Mac's sidebar settings that Search's tree reads: Mac APP settings (they stay on each Mac), not the vault's. */
export type SidebarLook = Pick<SettingsState, 'sidebarStickyLevels'>

/**
 * The Mac's defaults (`DEFAULT_SETTINGS`, `shared/types.ts`), copied so the Search chunk does not carry the Mac's whole
 * settings object (`sidebarLook.test.ts` holds them equal): `sidebarStickyLevels` 7 (YAZ-3440 D2).
 */
export const MAC_SIDEBAR_DEFAULTS: SidebarLook = { sidebarStickyLevels: 7 }

/**
 * THE ONE PLACE Search's tree reads the Mac sidebar's look (YAZ-5506). These are Mac app settings, not in the vault
 * (the scoping, YAZ-5481), so the phone uses the Mac's defaults. Should the vault carry them one day, this function
 * reads them there and nothing else changes.
 */
export function sidebarLook(): SidebarLook {
  return MAC_SIDEBAR_DEFAULTS
}
