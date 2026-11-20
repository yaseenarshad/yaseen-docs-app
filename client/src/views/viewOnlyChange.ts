/**
 * A VIEW change against a CONTENT change in a folder page's settings write (YAZ-4939 round 3). Read only — the vault's
 * or the folder page's own (D36) — refuses the content changes only: a column's declaration (its name, type, formula,
 * options), a column label (`properties`), a formula (`formulas`). The views — sort, filter, group, the shown columns
 * and their widths, wrap or clip, frozen columns, row height, a calendar's dates, the view tabs, the default view — are
 * how the page looks, not what is in it, so they save while the page is read only. A write that mixes both is refused.
 */
import type { ColumnDecl } from './folderSettings'
import type { ViewDef, ViewSet } from './viewSchema'

/** The content parts a settings write can carry. A part absent on both sides is equal. */
export interface ContentParts {
  columns?: Readonly<Record<string, ColumnDecl>>
  properties?: ViewSet['properties']
  formulas?: ViewSet['formulas']
  /** Each view's Cards table declarations (`cardView.columns` and `cardView.properties`, YAZ-5989). */
  views?: readonly ViewDef[]
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

const nonEmpty = <T extends Record<string, unknown>>(value: T | undefined): T | undefined =>
  value !== undefined && Object.keys(value).length > 0 ? value : undefined

/**
 * Each view's Cards table content (`cardView.columns` and `cardView.properties`, YAZ-5989): views without either are
 * omitted and the list is sorted, so adding, deleting or reordering view tabs without card columns stays view-only.
 */
function cardContent(views: readonly ViewDef[] | undefined): string {
  if (views === undefined) return '[]'
  const items: string[] = []
  for (const view of views) {
    const columns = nonEmpty(view.cardView?.columns)
    const properties = nonEmpty(view.cardView?.properties)
    if (columns === undefined && properties === undefined) continue
    items.push(stamp({ columns, properties }))
  }
  items.sort()
  return `[${items.join(',')}]`
}

/** True when `before` and `after` hold the same content: the write changes only the views. */
export const isViewOnlyChange = (before: ContentParts, after: ContentParts): boolean =>
  stamp(before.columns) === stamp(after.columns) &&
  stamp(before.properties) === stamp(after.properties) &&
  stamp(before.formulas) === stamp(after.formulas) &&
  cardContent(before.views) === cardContent(after.views)
