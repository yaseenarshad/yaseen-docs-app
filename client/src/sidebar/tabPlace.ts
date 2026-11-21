/**
 * A sidebar place for each page tab (YAZ-5701), with Settings › Sidebar › "Sidebar remembers" on "A place for each
 * tab": what the sidebar showed when the tab went off screen. In this window's memory for the session only: a
 * relaunch starts with none. App prunes it to the tab strip and empties it on "One place for the window".
 */
import type { SidebarLens } from '@shared/types'

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
}

/** By tab id, the place saved last at the end: never more tabs than the strip holds (`prunePlaces`). */
const places = new Map<string, TabPlace>()
/**
 * The place of the New tab on show (`null`: it has no tab id, YAZ-5757). It lives across a Hide and Show sidebar and
 * a vault switch, and goes when the window leaves that tab (`dropBlankPlace`): the next New tab keeps what is on screen.
 */
let blank: TabPlace | undefined

export function savePlace(tab: string | null, place: TabPlace): void {
  if (tab === null) {
    blank = place
    return
  }
  places.delete(tab)
  places.set(tab, place)
}

export const readPlace = (tab: string | null): TabPlace | undefined => (tab === null ? blank : places.get(tab))

export const dropBlankPlace = (): void => {
  blank = undefined
}

/** The place saved last, of any tab: what the sidebar showed when it last went off screen. */
export function lastPlace(): TabPlace | undefined {
  let last: TabPlace | undefined
  for (const place of places.values()) last = place
  return last
}

/** A closed tab drops its place: only the tabs of the strip keep one. */
export function prunePlaces(tabs: readonly string[]): void {
  if (places.size === 0) return
  const live = new Set(tabs)
  for (const tab of [...places.keys()]) if (!live.has(tab)) places.delete(tab)
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

/** "One place for the window" drops every place, and the marks above with them. */
export function clearPlaces(): void {
  places.clear()
  blank = undefined
  changedVaults.clear()
}
