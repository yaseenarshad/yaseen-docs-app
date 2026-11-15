/**
 * A VIEW change against a CONTENT change in a folder page's settings write (YAZ-4939 round 3). Read only — the vault's
 * or the folder page's own (D36) — refuses the content changes only: a column's declaration (its name, type, formula,
 * options), a column label (`properties`), a formula (`formulas`). The views — sort, filter, group, the shown columns
 * and their widths, wrap or clip, frozen columns, row height, a calendar's dates, the view tabs, the default view — are
 * how the page looks, not what is in it, so they save while the page is read only. A write that mixes both is refused.
 */
import type { ColumnDecl } from './folderSettings'
import type { ViewSet } from './viewSchema'

/** The content parts a settings write can carry. A part absent on both sides is equal. */
export interface ContentParts {
  columns?: Readonly<Record<string, ColumnDecl>>
  properties?: ViewSet['properties']
  formulas?: ViewSet['formulas']
}

/** Order-insensitive identity; a field that is undefined is one that is absent, as on disk. */
function stamp(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stamp).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stamp(v)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/** True when `before` and `after` hold the same content: the write changes only the views. */
export const isViewOnlyChange = (before: ContentParts, after: ContentParts): boolean =>
  stamp(before.columns) === stamp(after.columns) && stamp(before.properties) === stamp(after.properties) && stamp(before.formulas) === stamp(after.formulas)
