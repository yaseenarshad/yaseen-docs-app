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
}

/** By tab id, the place saved last at the end: never more tabs than the strip holds (`prunePlaces`). */
const places = new Map<string, TabPlace>()

export function savePlace(tab: string, place: TabPlace): void {
  places.delete(tab)
  places.set(tab, place)
}

export const readPlace = (tab: string): TabPlace | undefined => places.get(tab)

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

/** "One place for the window" drops every place. */
export const clearPlaces = (): void => places.clear()
