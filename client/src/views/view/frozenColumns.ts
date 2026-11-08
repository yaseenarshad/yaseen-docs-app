/** Effective number of leading visible columns frozen for a Table view. */
export function frozenColumnCount(value: unknown, visibleColumns: number): number {
  const visible = Math.max(0, Math.trunc(visibleColumns))
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(visible, Math.max(0, Math.trunc(value)))
}

/** The Undo toasts of an unfreeze (YAZ-4594 S29): the column menu's and Properties' columns, the row menu's rows. */
export const UNFROZE_COLUMNS = 'Unfroze columns'
export const UNFROZE_ROWS = 'Unfroze rows'
/** Row freeze (YAZ-4537): at most this many data rows, the row menu's and Properties › View › Frozen rows' ceiling (YAZ-4607). */
export const MAX_FROZEN_ROWS = 10

/** Where a frozen cell paints the cover of the live gap (YAZ-4643 S2): the cell at `col` (-1: the `#` gutter), on which side, how wide. */
export interface FrozenGapCover {
  col: number
  side: 'left' | 'right'
  room: number
}

/**
 * The cover of the live gap in the frozen part (YAZ-4643 S2). The frozen cells are sticky over the columns the table
 * has scrolled under them; a drag that parts them, or lifts one, leaves an empty place where those columns would show.
 * The frozen cell beside that place paints the grabbed column's room of background on its gap side: the first parted
 * cell's left for a gap left of the grab, the last parted cell's right for a gap right of it, and the left neighbour's
 * right for a lifted frozen column with no gap. Null: the place is right of the freeze line, where nothing is under it.
 */
export function frozenGapCover(gap: number | null, from: number, frozen: number, room: number): FrozenGapCover | null {
  if (frozen === 0) return null
  if (gap === null) return from < frozen ? { col: from - 1, side: 'right', room } : null
  if (gap < from) return gap < frozen ? { col: gap, side: 'left', room } : null
  return gap - 1 < frozen ? { col: gap - 1, side: 'right', room } : null
}

/**
 * The cover's `box-shadow` (YAZ-4643 S2): a cell's `overflow: hidden` clips a pseudo-element, a shadow it does not clip.
 * Each shadow is the cell's own shape moved along its gap side; a cell narrower than the room lays them end to end, the
 * last one ending exactly at the room's end, so the cover reaches no further than the empty place (a wider cell's one
 * shadow starts under the cell itself).
 */
export function frozenGapShadow({ side, room }: FrozenGapCover, width: number): string {
  const offsets: number[] = []
  for (let o = width; width > 0 && o < room; o += width) offsets.push(o)
  offsets.push(room)
  const sign = side === 'left' ? -1 : 1
  return offsets.map((o) => `${sign * o}px 0 0 var(--bg)`).join(',')
}
