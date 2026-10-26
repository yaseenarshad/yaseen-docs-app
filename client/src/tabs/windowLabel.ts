/**
 * What a window is called where the app names it to the user (YAZ-3343 D14): a "Move to ▸" row (YAZ-3091 D7, D8)
 * and a window's frame on the tab board. ONE spelling for both, eager and small, so App does not pull the board in for it.
 */
import { rootOfPath, type StoredTab, type TabRef } from '@shared/types'
import { pageName, type PathTitles } from '../lib/pageLabel'

/** The longest page title a window's label keeps whole, in characters (YAZ-3104): a long page name cannot widen the "Move to ▸" flyout. The tab count after it is never cut. */
export const MOVE_ROW_TITLE_MAX = 40

/** A window as its label reads it: a `WindowEntry` of the state, or this window's live tabs in the same shape. */
export interface WindowShape {
  file: string | null
  tabs: readonly string[]
  tabStrip?: readonly StoredTab[]
  roots: readonly string[]
  name?: string
}

/**
 * The automatic label (YAZ-3091 D7 revised by D8): what the window SHOWS — the page on show, its tab's display
 * name first — and "+ N more tabs", copies counted (S6). A window with no page is "Empty window".
 */
export function autoWindowLabel(w: WindowShape, titles: PathTitles): string {
  if (w.file === null) return 'Empty window'
  const strip = w.tabStrip?.filter((t) => t.path === w.file) ?? []
  const page = (strip.find((t) => t.active === true) ?? strip[0])?.name ?? pageName(rootOfPath(w.roots, w.file), w.file, titles)
  // By characters, not UTF-16 units, so an emoji is never cut in half (YAZ-3104).
  const chars = Array.from(page)
  const cut = chars.length > MOVE_ROW_TITLE_MAX ? `${chars.slice(0, MOVE_ROW_TITLE_MAX - 1).join('').trimEnd()}…` : page
  const more = (w.tabStrip ?? w.tabs).length - 1
  return more > 0 ? `${cut} + ${more} more tab${more === 1 ? '' : 's'}` : cut
}

/** The window's name when it has one (YAZ-3343 D14), else its automatic label. */
export const windowLabel = (w: WindowShape, titles: PathTitles): string => w.name ?? autoWindowLabel(w, titles)

/** A tab of a window's strip by its path and copy (YAZ-3343 D1): `copy` 0 is the first tab of the path. */
export function tabOfRef<T extends { path: string }>(tabs: readonly T[], ref: TabRef): T | undefined {
  return tabs.filter((t) => t.path === ref.path)[ref.copy]
}
