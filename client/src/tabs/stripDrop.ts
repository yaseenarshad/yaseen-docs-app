/**
 * A tab board card held over the tab strip (YAZ-3808 D1). The strip registers itself here; the board calls `hold` on
 * each pointer move of a card, and `release` when the card is let go or the drag ends. The strip draws the drop line
 * and scrolls at its ends (D5) on its own; `release` answers the slot (0…tabs) under the point, or null off the strip.
 */
export interface StripTarget {
  /** `own`: the held card's tab, when it is this window's — a drop either side of it moves nothing, and shows no line. */
  hold: (x: number, y: number, own?: string) => void
  release: (x?: number, y?: number) => number | null
}

let target: StripTarget | null = null

export function setStripTarget(next: StripTarget | null): void {
  target = next
}

export const holdOverStrip = (x: number, y: number, own?: string): void => target?.hold(x, y, own)

/** Ends a hold: the line goes out and the scroll stops. With a point, the slot a drop there lands in. */
export const releaseOverStrip = (x?: number, y?: number): number | null => target?.release(x, y) ?? null
