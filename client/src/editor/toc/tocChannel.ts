/**
 * The table of contents channel (YAZ-2700): the one object the table of contents and its engine
 * share.
 *
 * `findChannel.ts`'s host-created holder idiom. The host makes ONE per editor mount and hands it
 * to `createCrepe` (the engine in `tocPlugin.ts` binds itself at view creation, unbinds on destroy)
 * and to `TableOfContents.tsx`, which subscribes and calls the commands. The channel owns only
 * what the component draws: the page's rows as (level, text) and whether a bullet zoom is
 * active. Row POSITIONS stay in the engine: they move on every edit above a row, and a
 * snapshot that carried them would re-render the list on every one of those edits.
 *
 * A ROW is a heading of the page, or — in a page with fewer than two headings — a bullet
 * (`tocPlugin.ts` decides). Nothing here says which: a bullet is a `TocRow` like a heading, its
 * level its depth in the list, and the component draws, jumps and spies by index alone.
 *
 * THE SOURCE (YAZ-2700 D14) is the reader's own answer to that question for this page, from the
 * page cog: `headings`, `bullets`, or `null` — Auto, the rule above. The host hands it in, the
 * engine scans by it, and it is NOT part of the snapshot: the component never learns it, and a
 * change of source reaches it only as the new list.
 *
 * 🔒 Subscribers hear a change only when the list of (level, text) changes or the zoomed flag
 * flips. The engine publishes after every scan, and most scans find the list it already had.
 */
import type { TocSource } from '@shared/types'

/**
 * Up to five levels. Of headings, H1-H5 (YAZ-3051): H6 is never a row. Of bullets, the first
 * three depths of the document's own lists, so a bullet row is level 1, 2 or 3.
 */
export type TocLevel = 1 | 2 | 3 | 4 | 5

/**
 * The deepest heading that is a row (YAZ-3051 D3). It is NOT `DEEPEST_FOLDABLE_LEVEL`
 * (`headingFolding.ts`, still 3): H4 and H5 are rows of the table of contents, but they do not
 * fold and make no section line to click. H6 is never a row.
 */
export const DEEPEST_TOC_LEVEL = 5

/** The table of contents draws nothing under this many rows, and Auto reads a page by its headings only when it has this many. */
export const ENOUGH_ROWS = 2

export interface TocRow {
  level: TocLevel
  /** The heading's text, trimmed, `Untitled heading` for an empty one; or a bullet's label. */
  text: string
}

export interface TocSnapshot {
  /**
   * The page's rows in document order, by the source: on Auto every H1-H5 of a page with two or
   * more outside lists, the ones inside its bullets too (YAZ-4094 4E), or the bullets of a page
   * with fewer; else what the reader chose — every H1-H5 of the page, or its bullets. In a bullet
   * zoom, the zoom's own rows when it has two or more (4D). The component decides which it shows.
   */
  rows: readonly TocRow[]
  /** True while a bullet zoom is active. The component still draws (YAZ-4094 4C): its scroll spy reads again. */
  zoomed: boolean
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
  /** Scan the page NOW and publish: the source changed, and the reader is looking at the list. */
  rescan(): void
}

export interface TocChannel {
  jump(index: number): void
  current(indices: readonly number[], scroller: HTMLElement): number
  getState(): TocSnapshot
  subscribe(listener: () => void): () => void
  /**
   * Host side: what this page's rows are built from; `null` is Auto. Before an engine is bound it
   * only waits for the first scan, so a page saved as Bullets never shows its Auto list first.
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
  setZoomed(zoomed: boolean): void
}

const sameRows = (a: readonly TocRow[], b: readonly TocRow[]): boolean =>
  a.length === b.length && a.every((row, i) => row.level === b[i].level && row.text === b[i].text)

export function createTocChannel(): TocChannel {
  let controller: TocController | null = null
  let snapshot: TocSnapshot = { rows: [], zoomed: false }
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
    setZoomed(zoomed) {
      if (zoomed !== snapshot.zoomed) set({ ...snapshot, zoomed })
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
