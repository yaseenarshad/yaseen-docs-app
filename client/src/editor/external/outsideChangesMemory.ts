/**
 * The change lists of the pages a tab left (YAZ-3704, demo feedback): a link or Back mounts a new editor in the tab,
 * and the list of the page it left waits here until the tab shows that page again. Only checking a change off,
 * closing the tab, quitting or reloading ends a list. Memory only, for this window: nothing is saved.
 *
 * Keyed by tab and path. The plugin saves its list each time its editor is destroyed (none: the entry goes) and reads it
 * when an editor of the same tab and page starts (`outsideChanges.ts`). The read leaves the entry: React may start an
 * editor twice, and the copy that stays must find the list too; App names the live tabs (`keepOutsideChangesOfTabs`), and the
 * lists of a closed tab go. A tab keeps its last `MAX_KEPT_PAGES` pages' lists. A note that changed while its tab was
 * away gets its list back through the diff from the kept doc, with what changed meanwhile glowing (`keptBack`).
 */

/** A list as the plugin left it: the doc it was drawn on (its shape, to know it is still the same), and the list. */
export interface SavedOutsideChanges {
  shape: string
  /** The doc as JSON: a note that changed while the tab was away is diffed from it. */
  doc: unknown
  changes: readonly unknown[]
  lastNumber: number
}

/** A tab keeps the lists of its last this many pages; an older one goes. */
export const MAX_KEPT_PAGES = 20

/** In the order they were saved: the first of a tab's keys is its oldest. */
const saved = new Map<string, SavedOutsideChanges>()
/** The tabs App says are open; null until it says so. */
let liveTabs: ReadonlySet<string> | null = null

const keyOf = (tabId: string, path: string): string => `${tabId}\n${path}`

/** `list` null: the page left with no change, so nothing waits for it. */
export function saveOutsideChanges(tabId: string, path: string, list: SavedOutsideChanges | null): void {
  const key = keyOf(tabId, path)
  saved.delete(key)
  // An editor destroyed because its tab closed saves nothing.
  if (list === null || (liveTabs !== null && !liveTabs.has(tabId))) return
  saved.set(key, list)
  const ofTab = [...saved.keys()].filter((each) => each.startsWith(`${tabId}\n`))
  for (const old of ofTab.slice(0, Math.max(0, ofTab.length - MAX_KEPT_PAGES))) saved.delete(old)
}

export function readOutsideChanges(tabId: string, path: string): SavedOutsideChanges | null {
  return saved.get(keyOf(tabId, path)) ?? null
}

/** App, on each change of its tabs: the lists of the tabs that closed go. */
export function keepOutsideChangesOfTabs(tabIds: readonly string[]): void {
  liveTabs = new Set(tabIds)
  for (const key of saved.keys()) if (!liveTabs.has(key.slice(0, key.indexOf('\n')))) saved.delete(key)
}
