/**
 * "Open on the Page tab" (YAZ-4587, D37): the sidebar's folder page row asks for its folder, then opens the folder
 * page through the "Open folder page" door. The folder page of an app tab takes the ask — when it mounts, or at once
 * when it is already mounted — and shows its Page tab, else its start view. ONE ask at a time: a new ask replaces
 * the old, and the ask goes when a page takes it.
 */
let asked: string | null = null
const listeners = new Set<(folder: string) => void>()

/** Ask that the next folder page of `folder` (its absolute path) shows its Page tab. */
export function askPageTab(folder: string): void {
  asked = folder
  for (const listener of [...listeners]) listener(folder)
}

/** Whether `folder` was asked for; a yes takes the ask, so one page alone answers it. */
export function takePageTab(folder: string): boolean {
  if (asked !== folder) return false
  asked = null
  return true
}

/** Each ask, for a folder page that is mounted already; returns the unsubscribe. */
export function onPageTabAsk(listener: (folder: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
