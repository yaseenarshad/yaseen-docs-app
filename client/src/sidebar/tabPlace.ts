/**
 * A sidebar place for each page tab (YAZ-5701), with Settings › Sidebar › "Sidebar remembers" on "A place for each
 * tab": what the sidebar showed when the tab went off screen. In this window's memory for the session only: a
 * relaunch starts with none. App prunes it to the tab strip and empties it on "One place for the window".
 */
import { rootOfPath, type SidebarLens } from '@shared/types'
import { filesOnlyAfterDelete, filesOnlyAfterRename } from './filesOnly'

export interface TabPlace {
  /** The sidebar tab, never Search: a tab on Search keeps the tab shown before it. */
  lens: SidebarLens
  /** The open folders: Files' paths and the copy keys of Focus and Favorites. */
  expanded: readonly string[]
  /** The stack folders folded shut on Focus and on Favorites (YAZ-5664). */
  shut: { focus: ReadonlySet<string>; favorites: ReadonlySet<string> }
  /** The scroll of `.sidebar__body`. */
  scrollTop: number
  /** The selected rows (YAZ-5769): put back on the same sidebar tab; a row the vault no longer has is dropped. */
  selected: readonly string[]
  /** "Hide all others" in Files (YAZ-5790, YAZ-6064): the folder shown alone for this tab, or null. */
  filesOnly: string | null
  /** "Hide all others" in Focus/Favorites (YAZ-4460, YAZ-6064): the focus folder id for this tab, or null. */
  focusOnly: string | null
  /** Vault rows folded shut in a multi-vault window (YAZ-6064). */
  closedVaults: readonly string[]
}

/** By tab id, the place saved last at the end: never more tabs than the strip holds (`prunePlaces`). */
const places = new Map<string, TabPlace>()
/**
 * The place of the New tab on show (`null`: it has no tab id, YAZ-5757). It lives across a Hide and Show sidebar and
 * goes when the window leaves that tab or switches vaults (`dropBlankPlace`): the next New tab keeps what is on screen.
 */
let blank: TabPlace | undefined

/** Whether the sidebar is collapsed for each tab (YAZ-6064): tracked separately so App can toggle before Sidebar mounts. */
const collapsedByTab = new Map<string, boolean>()
let blankCollapsed: boolean | undefined

/** Per-tab sidebar width in px when "Custom per tab" + "Custom sidebar width per tab" are enabled. */
const widthByTab = new Map<string, number>()
let blankWidth: number | undefined

/**
 * Bumped on every vault switch (`bumpVaultEpoch`), and captured by each `Sidebar` mount so an outgoing vault's
 * unmount cleanup cannot re-populate `blank` for the new vault (YAZ-6064).
 */
let vaultEpoch = 0
export const currentVaultEpoch = (): number => vaultEpoch
export const bumpVaultEpoch = (): void => {
  vaultEpoch += 1
  blank = undefined
  blankCollapsed = undefined
  blankWidth = undefined
}

export function savePlace(tab: string | null, place: TabPlace, epoch?: number): void {
  if (tab === null) {
    if (epoch !== undefined && epoch !== vaultEpoch) return
    blank = place
    return
  }
  places.delete(tab)
  places.set(tab, place)
}

export const readPlace = (tab: string | null): TabPlace | undefined => (tab === null ? blank : places.get(tab))

export function saveCollapsed(tab: string | null, collapsed: boolean): void {
  if (tab === null) {
    blankCollapsed = collapsed
    return
  }
  collapsedByTab.set(tab, collapsed)
}

export const readCollapsed = (tab: string | null): boolean | undefined => (tab === null ? blankCollapsed : collapsedByTab.get(tab))

export function saveWidth(tab: string | null, width: number): void {
  if (tab === null) {
    blankWidth = width
    return
  }
  widthByTab.set(tab, width)
}

export const readWidth = (tab: string | null): number | undefined => (tab === null ? blankWidth : widthByTab.get(tab))

/** Saves outgoing tab's collapsed/width and returns incoming tab's values that differ from current state. */
export function stepTabSidebar(from: string | null, to: string | null, collapsed: boolean, width: number, perTabWidth: boolean): { collapsed?: boolean; width?: number } {
  if (from === null) dropBlankPlace()
  else {
    saveCollapsed(from, collapsed)
    if (perTabWidth) saveWidth(from, width)
  }
  const nextCollapsed = readCollapsed(to)
  const nextWidth = perTabWidth ? readWidth(to) : undefined
  return {
    ...(nextCollapsed !== undefined && nextCollapsed !== collapsed ? { collapsed: nextCollapsed } : {}),
    ...(nextWidth !== undefined && nextWidth !== width ? { width: nextWidth } : {}),
  }
}

export const dropBlankPlace = (): void => {
  blank = undefined
  blankCollapsed = undefined
  blankWidth = undefined
}

/** The place saved last, of any tab: what the sidebar showed when it last went off screen. */
export function lastPlace(): TabPlace | undefined {
  let last: TabPlace | undefined
  for (const place of places.values()) last = place
  return last
}

/** A closed tab drops its place, collapsed state, and width: only the tabs of the strip keep one. */
export function prunePlaces(tabs: readonly string[]): void {
  if (places.size === 0 && collapsedByTab.size === 0 && widthByTab.size === 0) return
  const live = new Set(tabs)
  for (const tab of [...places.keys()]) if (!live.has(tab)) places.delete(tab)
  for (const tab of [...collapsedByTab.keys()]) if (!live.has(tab)) collapsedByTab.delete(tab)
  for (const tab of [...widthByTab.keys()]) if (!live.has(tab)) widthByTab.delete(tab)
}

/** A folder renamed or moved (`file:renamed`, kind `dir`): update `filesOnly` and disk-path `focusOnly` in saved background tabs (YAZ-6064, YAZ-6574). */
export function renamePlacesFilesOnly(oldDir: string, newDir: string): void {
  for (const [tab, place] of places) {
    const nextFiles = filesOnlyAfterRename(place.filesOnly, oldDir, newDir)
    const nextFocus = filesOnlyAfterRename(place.focusOnly, oldDir, newDir)
    if (nextFiles !== place.filesOnly || nextFocus !== place.focusOnly) places.set(tab, { ...place, filesOnly: nextFiles, focusOnly: nextFocus })
  }
  if (blank !== undefined) {
    const nextFiles = filesOnlyAfterRename(blank.filesOnly, oldDir, newDir)
    const nextFocus = filesOnlyAfterRename(blank.focusOnly, oldDir, newDir)
    if (nextFiles !== blank.filesOnly || nextFocus !== blank.focusOnly) blank = { ...blank, filesOnly: nextFiles, focusOnly: nextFocus }
  }
}

/** A folder deleted (`file:deleted`, kind `dir`): clear `filesOnly` and disk-path `focusOnly` in saved background tabs when it is gone (YAZ-6064, YAZ-6574). */
export function deletePlacesFilesOnly(deleted: string): void {
  for (const [tab, place] of places) {
    const nextFiles = filesOnlyAfterDelete(place.filesOnly, deleted)
    const nextFocus = filesOnlyAfterDelete(place.focusOnly, deleted)
    if (nextFiles !== place.filesOnly || nextFocus !== place.focusOnly) places.set(tab, { ...place, filesOnly: nextFiles, focusOnly: nextFocus })
  }
  if (blank !== undefined) {
    const nextFiles = filesOnlyAfterDelete(blank.filesOnly, deleted)
    const nextFocus = filesOnlyAfterDelete(blank.focusOnly, deleted)
    if (nextFiles !== blank.filesOnly || nextFocus !== blank.focusOnly) blank = { ...blank, filesOnly: nextFiles, focusOnly: nextFocus }
  }
}

/** A vault removed from the window: clear `filesOnly` and disk-path `focusOnly` in saved tabs that pointed into a vault no longer present (YAZ-6064, YAZ-6574). */
export function prunePlacesFilesOnly(roots: readonly string[]): void {
  const gonePath = (value: string | null) => value !== null && value.startsWith('/') && rootOfPath(roots, value) === null
  for (const [tab, place] of places) {
    const dropFiles = place.filesOnly !== null && rootOfPath(roots, place.filesOnly) === null
    const dropFocus = gonePath(place.focusOnly)
    if (dropFiles || dropFocus) places.set(tab, { ...place, ...(dropFiles ? { filesOnly: null } : {}), ...(dropFocus ? { focusOnly: null } : {}) })
  }
  if (blank !== undefined) {
    const dropFiles = blank.filesOnly !== null && rootOfPath(roots, blank.filesOnly) === null
    const dropFocus = gonePath(blank.focusOnly)
    if (dropFiles || dropFocus) blank = { ...blank, ...(dropFiles ? { filesOnly: null } : {}), ...(dropFocus ? { focusOnly: null } : {}) }
  }
}

/**
 * The vaults of this window with a folder opened or closed while "A place for each tab" was on (YAZ-5750, YAZ-5751):
 * only their open folders go over the list the windows share at the switch back to one place. By vault (YAZ-5756):
 * a vault switch brings a vault the user did not touch. Per window, outside the Sidebar's mount, so a Hide and Show
 * sidebar or a vault switch keeps it.
 */
const changedVaults = new Set<string>()
export const markFoldersChanged = (vaults: readonly string[]): void => {
  for (const vault of vaults) changedVaults.add(vault)
}
export const foldersChangedHere = (vault: string): boolean => changedVaults.has(vault)

/** "One place for the window" drops every place, collapsed state, and the marks above with them. */
export function clearPlaces(): void {
  places.clear()
  blank = undefined
  collapsedByTab.clear()
  blankCollapsed = undefined
  widthByTab.clear()
  blankWidth = undefined
  changedVaults.clear()
}
