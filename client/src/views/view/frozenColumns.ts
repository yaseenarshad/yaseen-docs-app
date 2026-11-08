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
