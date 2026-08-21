/**
 * Stable, position-independent key for a foldable list item (GRO-2011): FNV-1a hash of
 * the item's first-block text plus its occurrence index among same-labelled items, so
 * fold state survives edits elsewhere in the document and is safe to persist.
 * Ported from yaseen-excalidraw `docs/outlineFoldKeys.ts`.
 * Zoom history (zoom.ts, GRO-2091) reuses the scheme with the occurrence counted over ALL list
 * items (fold keys count parents only) — same function, separate key space; never mix the two.
 */
const hashLabel = (label: string): string => {
  let hash = 2166136261
  for (let index = 0; index < label.length; index++) {
    hash ^= label.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export const getOutlineFoldKey = (label: string, occurrence: number): string => `${hashLabel(label)}:${occurrence}`
