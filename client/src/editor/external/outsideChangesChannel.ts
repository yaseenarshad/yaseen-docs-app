/**
 * The outside-changes channel (YAZ-3704 D6): the one object the one-line note and the change list share.
 *
 * `findChannel.ts`'s terms: the host makes ONE per editor mount and hands it to `createCrepe` (the plugin
 * binds itself at view creation, unbinds on destroy) and to `OutsideChangesBar`, which subscribes and calls
 * the commands. The channel owns what the bar reads (the count and whole-note mode, nothing else, so a Next re-renders no bar) and the
 * Glow setting (D5), which it keeps while unbound so a rebuilt state starts with it; every command goes to the
 * bound plugin, and while unbound the commands are no-ops.
 */
import type { OutsideChangeGlow } from '@shared/types'

export interface OutsideChangesSnapshot {
  /** Changes in the list, one per changed textblock (D4). */
  count: number
  /** The note changed as a whole (a rebuild, or more than the limit): no glow, the bar says so. */
  wholeNote: boolean
}

/** The engine behind the commands: the plugin binds one per editor view. */
export interface OutsideChangesController {
  /** The ring on the next change in document order (wraps), its folds opened, scrolled into view (D9). */
  next(): void
  /** Mark all checked, and Dismiss in whole-note mode: the list empties. */
  clear(): void
  /** The host rebuilt the note from an outside save: whole-note mode. */
  markWholeNote(): void
  setGlow(glow: OutsideChangeGlow): void
}

export interface OutsideChangesChannel {
  next(): void
  clear(): void
  markWholeNote(): void
  /** Settings › Editor › Outside changes › Glow, pushed by the host: it never rebuilds the editor. */
  setGlow(glow: OutsideChangeGlow): void
  getGlow(): OutsideChangeGlow
  getState(): OutsideChangesSnapshot
  subscribe(listener: () => void): () => void
  /** Engine side: bind at view creation, call the returned unbind on destroy. */
  bind(controller: OutsideChangesController): () => void
  /** Engine side: the list after each transaction. Listeners hear only a real change. */
  sync(snapshot: OutsideChangesSnapshot): void
  /** Engine side: Next zoomed the page out (D9), so the host tells the tab. */
  zoomedOut(): void
}

const EMPTY: OutsideChangesSnapshot = { count: 0, wholeNote: false }

export function createOutsideChangesChannel(onZoomOut: () => void = () => undefined): OutsideChangesChannel {
  let controller: OutsideChangesController | null = null
  let snapshot = EMPTY
  let glow: OutsideChangeGlow = 'until-checked'
  const listeners = new Set<() => void>()

  return {
    next: () => controller?.next(),
    clear: () => controller?.clear(),
    markWholeNote: () => controller?.markWholeNote(),
    setGlow(next) {
      if (next === glow) return
      glow = next
      controller?.setGlow(next)
    },
    getGlow: () => glow,
    getState: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    bind(next) {
      controller = next
      return () => {
        if (controller === next) controller = null
      }
    },
    sync(next) {
      if (next.count === snapshot.count && next.wholeNote === snapshot.wholeNote) return
      snapshot = next
      listeners.forEach((listener) => listener())
    },
    zoomedOut: () => onZoomOut(),
  }
}
