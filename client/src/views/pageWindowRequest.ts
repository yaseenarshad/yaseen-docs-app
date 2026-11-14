/**
 * "Open in mini window" from outside a folder page (YAZ-2571 round 1, the explore stack's page menu): the folder page
 * ON SCREEN takes the page into its card (`ViewsPane`'s `openWindow`), as its own row menu does. A page in a hidden
 * tab declines. With no folder page on screen nobody takes it, and the asker says so.
 */
const takers = new Set<(path: string) => boolean>()

/** A folder page offers to take requests; it answers true when it opened its card on the path. */
export function onPageWindowRequest(take: (path: string) => boolean): () => void {
  takers.add(take)
  return () => void takers.delete(take)
}

/** Ask the folder page on screen to open its mini window on `path`: true when one did. */
export function requestPageWindow(path: string): boolean {
  for (const take of [...takers]) if (take(path)) return true
  return false
}
