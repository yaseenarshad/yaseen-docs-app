/**
 * The notes the explore stack lists with no query (YAZ-2571): the ones opened most recently in this window, newest
 * first. The stack writes each note it opens; App writes the active tab's note. In memory only, 20 at most, gone
 * when the window closes. Tiny and eager: App feeds it while the stack's own chunk stays lazy.
 */
export const MAX_EXPLORE_RECENTS = 20

let recents: string[] = []

export function rememberExploreRecent(path: string): void {
  recents = [path, ...recents.filter((p) => p !== path)].slice(0, MAX_EXPLORE_RECENTS)
}

/** Newest first. The same list while nothing was remembered: a render that reads it twice reads one object. */
export const exploreRecents = (): readonly string[] => recents

/** The open stack hears each move too (check 21 of YAZ-2571): a layer on the note follows a rename, and says so after a delete. */
const movers = new Set<(from: string, to: string | null) => void>()
export function onExploreMove(listener: (from: string, to: string | null) => void): () => void {
  movers.add(listener)
  return () => void movers.delete(listener)
}

/** A note that is gone (App's `file:deleted`) or moved (`file:renamed`, `to` its new path): the list follows, and the stack. */
export function moveExploreRecent(from: string, to: string | null): void {
  const at = (path: string) => path === from || path.startsWith(`${from}/`)
  if (to === null) recents = recents.filter((p) => !at(p))
  else recents = recents.map((p) => (at(p) ? to + p.slice(from.length) : p))
  for (const tell of [...movers]) tell(from, to)
}

/** For tests. */
export const resetExploreRecents = (): void => {
  recents = []
}
