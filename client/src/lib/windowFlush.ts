import { settleFileWrites } from '../views/writeProperty'

/**
 * The close/quit handshake (GRO-2160) for the writers below App (YAZ-2174). Main destroys the window
 * once its `onFlush` listeners settle, and `destroy()` runs no React unmount, so an edit still in a
 * component's debounce, or a fire-and-forget frontmatter write between its read and its write, dies
 * with the renderer. App hands `flushWindow` to the bridge once; components register here instead
 * of on the bridge, so they need no bridge to mount (every view test mounts them without one).
 */
const flushers = new Set<() => void>()

/** `flusher` hands its pending edit to its writer at once; returns the unregister. */
export function onWindowFlush(flusher: () => void): () => void {
  flushers.add(flusher)
  return () => void flushers.delete(flusher)
}

/** Every flusher first, so each has started its write, then every whole-file write still in flight. */
export async function flushWindow(): Promise<void> {
  for (const flusher of [...flushers]) {
    try {
      flusher()
    } catch (err) {
      console.warn(`[flush] a flusher threw: ${String(err)}`) // the rest still run: none may cost another its edit
    }
  }
  await settleFileWrites()
}
