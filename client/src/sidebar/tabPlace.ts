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

export const dropBlankPlace = (): void => {
  blank = undefined
  blankCollapsed = undefined
}

/** The place saved last, of any tab: what the sidebar showed when it last went off screen. */
export function lastPlace(): TabPlace | undefined {
  let last: TabPlace | undefined
  for (const place of places.values()) last = place
  return last
}

/** A closed tab drops its place and collapsed state: only the tabs of the strip keep one. */
export function prunePlaces(tabs: readonly string[]): void {
  if (places.size === 0 && collapsedByTab.size === 0) return
  const live = new Set(tabs)
  for (const tab of [...places.keys()]) if (!live.has(tab)) places.delete(tab)
  for (const tab of [...collapsedByTab.keys()]) if (!live.has(tab)) collapsedByTab.delete(tab)
}

/** A folder renamed or moved (`file:renamed`, kind `dir`): update `filesOnly` in saved background tabs (YAZ-6064). */
export function renamePlacesFilesOnly(oldDir: string, newDir: string): void {
  for (const [tab, place] of places) {
    const next = filesOnlyAfterRename(place.filesOnly, oldDir, newDir)
    if (next !== place.filesOnly) places.set(tab, { ...place, filesOnly: next })
  }
  if (blank !== undefined) {
    const next = filesOnlyAfterRename(blank.filesOnly, oldDir, newDir)
    if (next !== blank.filesOnly) blank = { ...blank, filesOnly: next }
  }
}

/** A folder deleted (`file:deleted`, kind `dir`): clear `filesOnly` in saved background tabs when it is gone (YAZ-6064). */
export function deletePlacesFilesOnly(deleted: string): void {
  for (const [tab, place] of places) {
    const next = filesOnlyAfterDelete(place.filesOnly, deleted)
    if (next !== place.filesOnly) places.set(tab, { ...place, filesOnly: next })
  }
  if (blank !== undefined) {
    const next = filesOnlyAfterDelete(blank.filesOnly, deleted)
    if (next !== blank.filesOnly) blank = { ...blank, filesOnly: next }
  }
}

/** A vault removed from the window: clear `filesOnly` in saved tabs that pointed into a vault no longer present (YAZ-6064). */
export function prunePlacesFilesOnly(roots: readonly string[]): void {
  for (const [tab, place] of places) {
    if (place.filesOnly !== null && rootOfPath(roots, place.filesOnly) === null) places.set(tab, { ...place, filesOnly: null })
  }
  if (blank !== undefined && blank.filesOnly !== null && rootOfPath(roots, blank.filesOnly) === null) blank = { ...blank, filesOnly: null }
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
  changedVaults.clear()
}
