/**
 * The outside-changes channel (YAZ-3704 D6): the one object the one-line note and the change list share.
 *
 * `findChannel.ts`'s terms: the host makes ONE per editor mount and hands it to `createCrepe` (the plugin
 * binds itself at view creation, unbinds on destroy) and to `OutsideChangesBar`, which subscribes and calls
 * the commands. The channel owns what the bar reads (the count and whole-note mode, nothing else, so a Next re-renders no bar),
 * what the numbered list reads (a version that moves only when the list, a change's text or the ring changes, never on a
 * keystroke; YAZ-3998), and the
 * Glow setting (D5), which it keeps while unbound so a rebuilt state starts with it; every command goes to the
 * bound plugin, and while unbound the commands are no-ops.
 */
import type { OutsideChangeGlow } from '@shared/types'
import type { SavedOutsideChanges } from './outsideChangesMemory'

export interface OutsideChangesSnapshot {
  /** Changes in the list, one per changed textblock (D4). */
  count: number
  /** The note changed as a whole (a rebuild, or more than the limit): no glow, the bar says so. */
  wholeNote: boolean
}

/** One row of the numbered list (YAZ-3998): what a change is, word by word, as the mouse-over box says it. */
export interface OutsideChangeRow {
  id: number
  /** In the order the changes happened: one save's changes top to bottom, the next save's after them. */
  number: number
  /** The change Next or a click put the ring on. */
  active: boolean
  parts: readonly { kind: 'same' | 'del' | 'ins'; text: string }[]
}

/** The engine behind the commands: the plugin binds one per editor view. */
export interface OutsideChangesController {
  /** The ring on the next change in number order (wraps), its folds opened, scrolled into view (D9, YAZ-3998). */
  next(): void
  /** The same, for one change: a click on its row (YAZ-3998). */
  go(id: number): void
  /** The rows of the numbered list, in number order, built when asked. */
  rows(): OutsideChangeRow[]
  /** Mark all checked, and Dismiss in whole-note mode: the list empties. */
  clear(): void
  /** The host rebuilt the note from an outside save: whole-note mode. */
  markWholeNote(): void
  setGlow(glow: OutsideChangeGlow): void
}

export interface OutsideChangesChannel {
  next(): void
  go(id: number): void
  rows(): OutsideChangeRow[]
  clear(): void
  markWholeNote(): void
  /** Settings › Editor › Outside changes › Glow, pushed by the host: it never rebuilds the editor. */
  setGlow(glow: OutsideChangeGlow): void
  getGlow(): OutsideChangeGlow
  getState(): OutsideChangesSnapshot
  subscribe(listener: () => void): () => void
  /** The numbered list (YAZ-3998): `getVersion` moves when its rows change; it then reads `rows()` again. */
  getVersion(): number
  subscribeRows(listener: () => void): () => void
  /** Engine side: bind at view creation, call the returned unbind on destroy. */
  bind(controller: OutsideChangesController): () => void
  /** Engine side: the list after each transaction, and its version. Listeners hear only a real change. */
  sync(snapshot: OutsideChangesSnapshot, version?: number): void
  /** Engine side: Next zoomed the page out (D9), so the host tells the tab. */
  zoomedOut(): void
  /** Engine side: the list of this tab's page, kept while the tab shows another page (`outsideChangesMemory.ts`); null: none. */
  save(list: SavedOutsideChanges | null): void
  /** Engine side: the list this tab kept for the page; null when there is none. */
  readSaved(): SavedOutsideChanges | null
}

/** Where a list waits while its tab shows another page; none for an editor outside a tab. */
export interface OutsideChangesMemory {
  save(list: SavedOutsideChanges | null): void
  read(): SavedOutsideChanges | null
}

const EMPTY: OutsideChangesSnapshot = { count: 0, wholeNote: false }

export function createOutsideChangesChannel(onZoomOut: () => void = () => undefined, memory: OutsideChangesMemory | null = null): OutsideChangesChannel {
  let controller: OutsideChangesController | null = null
  let snapshot = EMPTY
  let glow: OutsideChangeGlow = 'until-checked'
  const listeners = new Set<() => void>()
  /** The list's own count: it only goes up. Each editor's plugin counts from 0 again, so the list must not read the plugin's. */
  let version = 0
  /** The bound plugin's count as last synced: a change of it moves `version`. */
  let seen = 0
  const rowListeners = new Set<() => void>()
  const rowsChanged = (): void => {
    version += 1
    rowListeners.forEach((listener) => listener())
  }

  return {
    next: () => controller?.next(),
    go: (id) => controller?.go(id),
    rows: () => controller?.rows() ?? [],
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
    getVersion: () => version,
    subscribeRows(listener) {
      rowListeners.add(listener)
      return () => {
        rowListeners.delete(listener)
      }
    },
    bind(next) {
      controller = next
      // A new editor: its rows, whatever its plugin's count.
      seen = 0
      rowsChanged()
      return () => {
        if (controller === next) controller = null
      }
    },
    sync(next, nextVersion = seen) {
      if (nextVersion !== seen) {
        seen = nextVersion
        rowsChanged()
      }
      if (next.count === snapshot.count && next.wholeNote === snapshot.wholeNote) return
      snapshot = next
      listeners.forEach((listener) => listener())
    },
    zoomedOut: () => onZoomOut(),
    save: (list) => memory?.save(list),
    readSaved: () => memory?.read() ?? null,
  }
}
