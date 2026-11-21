import type { SettingsState } from '@shared/types'

/** The Mac's sidebar settings that Search's tree reads: Mac APP settings (they stay on each Mac), not the vault's. */
export type SidebarLook = Pick<SettingsState, 'sidebarStickyLevels' | 'sidebarLines' | 'sidebarLineStyle' | 'sidebarThreadColor'>

/**
 * The Mac's defaults (`DEFAULT_SETTINGS`, `shared/types.ts`), copied so the Search chunk does not carry the Mac's whole
 * settings object (`stickyFolders.test.ts` holds them equal): `sidebarStickyLevels` 7; the guide lines
 * `sidebarLines` "hover" (they show while the list is in use), `sidebarLineStyle` "plain" (thin
 * grey lines), `sidebarThreadColor` null (the thread's colour, for the "thread" style only).
 */
export const MAC_SIDEBAR_DEFAULTS: SidebarLook = { sidebarStickyLevels: 7, sidebarLines: 'hover', sidebarLineStyle: 'plain', sidebarThreadColor: null }

/**
 * THE ONE PLACE Search's tree reads the Mac sidebar's look. These are Mac app settings, not in the vault
 * (the scoping), so the phone uses the Mac's defaults. Should the vault carry them one day, this function
 * reads them there and nothing else changes.
 */
export function sidebarLook(): SidebarLook {
  return MAC_SIDEBAR_DEFAULTS
}
