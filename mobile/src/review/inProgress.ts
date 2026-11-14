/**
 * ONE small fact from the Review tab for the rest of the app (YAZ-5269): "a review is in progress". True while a
 * Review session has a card on show, or an Undo it can still give, wherever the tab is (since YAZ-5224 it lives on
 * behind Friends, Search and a page). The update logic (`pwa/safeMoment.ts`) reads it: a new version never reloads
 * the page in the middle of a review. A tiny file with no imports, so the first load can read it.
 */
let inProgress = false
const listeners = new Set<() => void>()

export const reviewInProgress = (): boolean => inProgress

export function setReviewInProgress(next: boolean): void {
  if (next === inProgress) return
  inProgress = next
  for (const l of [...listeners]) l()
}

export function subscribeReviewInProgress(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
