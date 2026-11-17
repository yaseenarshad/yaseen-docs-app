/**
 * "Go to now" for a note the app opens (YAZ-4164, YAZ-4159 D11): the daily-page button, ⌘D and File › Open Today's
 * Daily Note open today's note, then ask its editor for the now row. The editor may not exist yet (the tab opens, the
 * file loads, then the editor starts), so the request waits here, as `zoomRequest.ts` is the door for a step to the
 * editor in front. The editor of the path takes it when it is ready (`Editor.tsx`); one that is open already hears
 * it at once. A request is taken one time and ends after 10 seconds, so a later open of the note does not jump.
 */

const LIFE_MS = 10_000

let pending: { path: string; at: number } | null = null
const listeners = new Set<() => void>()

/** Ask the editor of `path` to go to now (`goToNow`). */
export function requestGoToNow(path: string): void {
  pending = { path, at: Date.now() }
  for (const listener of [...listeners]) listener()
}

/** True, one time, when a live request names `path`. */
export function takeGoToNow(path: string): boolean {
  if (pending === null || pending.path !== path) return false
  const live = Date.now() - pending.at <= LIFE_MS
  pending = null
  return live
}

/** An open editor hears each request; it then takes it when the path is its own. */
export function onGoToNowRequest(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
