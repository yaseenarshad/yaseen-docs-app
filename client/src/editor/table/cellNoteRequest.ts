/**
 * "Open this cell note" for a note the app opens (YAZ-3818, round 3 of the demo): a click on a Linked mentions line
 * that is in a cell note opens the linking note, then asks its editor to open that note's card. The editor may not
 * exist yet, so the request waits here, as `goToNowRequest.ts` does. The editor of the path takes it when it is ready
 * and shows (`Editor.tsx`). A request is taken one time and ends after 10 seconds.
 */

const LIFE_MS = 10_000

let pending: { path: string; label: string; at: number } | null = null
const listeners = new Set<() => void>()

/** Ask the editor of `path` to open the card of its cell note `label`. */
export function requestCellNote(path: string, label: string): void {
  pending = { path, label, at: Date.now() }
  for (const listener of [...listeners]) listener()
}

/** The label, one time, when a live request names `path`; else null. */
export function takeCellNoteRequest(path: string): string | null {
  if (pending === null || pending.path !== path) return null
  const { label, at } = pending
  pending = null
  return Date.now() - at <= LIFE_MS ? label : null
}

/** An open editor hears each request; it then takes it when the path is its own. */
export function onCellNoteRequest(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
