/**
 * The drawing refresh feed (YAZ-878, third build unit of the Excalidraw embed YAZ-852).
 *
 * The `WikilinkResolveSource` subscribe/poke idiom (`editor/wikilink/wikilinkPlugin.ts`) cut down
 * to its smallest honest shape: a holder App owns, carrying no state at all — only the poke. A
 * preview plugin subscribes once and, on a poke naming its target, drops that target's cached
 * scene and re-reads it. Nothing else moves: no remount, no document change, no transaction the
 * autosave can see.
 *
 * Nothing pokes it yet — YAZ-879's modal save is the first caller. Absent from `createCrepe`,
 * previews still render; they just never live-refresh (a full editor remount is the only reload).
 */

/** How a poke reaches the previews; see `createDrawingFeed`. */
export interface DrawingFeed {
  /** Wakes on every poke, with the poked target exactly as the embed spells it. */
  subscribe(listener: (target: string) => void): () => void
}

export interface MutableDrawingFeed extends DrawingFeed {
  /** "This drawing changed on disk" — `target` is the embed's raw ref (path or basename). */
  poke(target: string): void
}

export function createDrawingFeed(): MutableDrawingFeed {
  const listeners = new Set<(target: string) => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    poke(target) {
      listeners.forEach((l) => l(target))
    },
  }
}
