/**
 * The table of contents channel (YAZ-2700): the one object the table of contents and its engine
 * share.
 *
 * `findChannel.ts`'s host-created holder idiom. The host makes ONE per editor mount and hands it
 * to `createCrepe` (the engine in `tocPlugin.ts` binds itself at view creation, unbinds on destroy)
 * and to `TableOfContents.tsx`, which subscribes and calls the commands. The channel owns only
 * what the component draws: the note's rows as (level, text) and whether the table of contents
 * is hidden. Row POSITIONS stay in the engine: they move on every edit above a row, and a
 * snapshot that carried them would re-render the list on every one of those edits.
 *
 * A ROW is a heading of the note, or — in a note with fewer than two headings — a bullet
 * (`tocPlugin.ts` decides). Nothing here says which: a bullet is a `TocRow` like a heading, its
 * level its depth in the list, and the component draws, jumps and spies by index alone.
 *
 * THE SOURCE (YAZ-2700 D14) is the reader's own answer to that question for this note, from the
 * page cog: `headings`, `bullets`, or `null` — Auto, the rule above. The host hands it in, the
 * engine scans by it, and it is NOT part of the snapshot: the component never learns it, and a
 * change of source reaches it only as the new list.
 *
 * 🔒 Subscribers hear a change only when the list of (level, text) changes or the hidden flag
 * flips. The engine publishes after every scan, and most scans find the list it already had.
 */
import type { TocSource } from '@shared/types'

/**
 * Three levels. Of headings, H1-H3: H4-H6 are labels inside a section here, not structure
 * (`headingFolding.ts`). Of bullets, the first three depths of the document's own lists.
 */
export type TocLevel = 1 | 2 | 3

/** The table of contents draws nothing under this many rows, and Auto reads a note by its headings only when it has this many. */
export const ENOUGH_ROWS = 2

export interface TocRow {
  level: TocLevel
  /** The heading's text, trimmed, `Untitled heading` for an empty one; or a bullet's label. */
  text: string
}

export interface TocSnapshot {
  /**
   * The note's rows in document order, by the source: on Auto every H1-H3 outside lists, or the
   * bullets of a note with fewer than two of those; else what the reader chose — every H1-H3 of
   * the note, or its bullets. The component decides which of them it shows.
   */
  rows: readonly TocRow[]
  /** True while a bullet zoom is active: the note shows one bullet's subtree, not its structure. */
  hidden: boolean
}

/** The engine behind the commands: the plugin binds one per editor view. */
export interface TocController {
  /** Go to the row at `index` of `rows`: unfold what hides it and its own fold, caret, scroll, one flash. */
  jump(index: number): void
  /**
   * Which of the shown rows the reader is in. `indices` are the shown rows as indexes into
   * `rows`; the answer is an index into `indices`, −1 when none of them is on screen at all.
   * Reads layout and writes nothing.
   */
  current(indices: readonly number[], scroller: HTMLElement): number
  /** Scan the note NOW and publish: the source changed, and the reader is looking at the list. */
  rescan(): void
}

export interface TocChannel {
  jump(index: number): void
  current(indices: readonly number[], scroller: HTMLElement): number
  getState(): TocSnapshot
  subscribe(listener: () => void): () => void
  /**
   * Host side: what this note's rows are built from; `null` is Auto. Before an engine is bound it
   * only waits for the first scan, so a note saved as Bullets never shows its Auto list first.
   * After, a CHANGE is scanned at once — no 150 ms wait: nothing was typed.
   */
  setSource(source: TocSource | null): void
  /** Engine side: the source to scan by. */
  getSource(): TocSource | null
  /** Engine side: bind at view creation, call the returned unbind on destroy. */
  bind(controller: TocController): () => void
  /** Engine side: the rows of the scan just made. */
  publish(rows: readonly TocRow[]): void
  /** Engine side: a bullet zoom started or ended. */
  setHidden(hidden: boolean): void
}

const sameRows = (a: readonly TocRow[], b: readonly TocRow[]): boolean =>
  a.length === b.length && a.every((row, i) => row.level === b[i].level && row.text === b[i].text)

export function createTocChannel(): TocChannel {
  let controller: TocController | null = null
  let snapshot: TocSnapshot = { rows: [], hidden: false }
  let source: TocSource | null = null
  const listeners = new Set<() => void>()

  const set = (next: TocSnapshot): void => {
    snapshot = next
    listeners.forEach((listener) => listener())
  }

  return {
    // While unbound (no editor yet, or one already destroyed) the commands are no-ops.
    jump: (index) => controller?.jump(index),
    current: (indices, scroller) => controller?.current(indices, scroller) ?? -1,
    publish(rows) {
      if (!sameRows(rows, snapshot.rows)) set({ ...snapshot, rows })
    },
    setHidden(hidden) {
      if (hidden !== snapshot.hidden) set({ ...snapshot, hidden })
    },
    setSource(next) {
      if (next === source) return
      source = next
      controller?.rescan()
    },
    getSource: () => source,
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
  }
}
