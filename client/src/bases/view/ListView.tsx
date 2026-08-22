import type { IndexRecord } from '@shared/types'
import type { BaseDefinition, BaseView } from '../baseFile'
import { type Group, type Row, propertyKeys, propertyLabel } from '../engine'
import { render } from '../expr'
import { cellEditor, columnTyping } from '../editorType'
import { EditableCell } from './EditableCell'
import { canonicalKey } from './filterRows'
import { GroupHeader, cellContent, groupKeyOf } from './GroupHeader'

export interface ListViewProps {
  def: BaseDefinition
  view: BaseView
  records: readonly IndexRecord[]
  /** The post-search rows — the one flat list when the view has no `groupBy`. */
  rows: readonly Row[]
  /** Post-search groups from BaseView (empty groups dropped); null when the view has no `groupBy`. */
  groups: readonly Group[] | null
  /** Collapsed group keys (`groupKeyOf`) for this base file + view; owned by BaseView, persisted via storage. */
  collapsed: readonly string[]
  onToggleGroup: (key: string) => void
  onOpenFile: (path: string) => void
  /** Create a note seeded with a section's group value (5D, GRO-2144); absent → no "+" on headers. */
  onNewInGroup?: (group: Group) => void
  /** Embed chrome (6A, GRO-2145): no inline property editing. */
  readOnly?: boolean
  /** Assigned property types from `.obsidian/types.json`, for editor inference (5B, GRO-2142). */
  types?: Record<string, string>
}

export type MarkerStyle = 'bullet' | 'number' | 'none'

/** `view.markerStyle`, defaulted: bullet unless the file says number or none (the menu deletes the key for bullet). */
export const markerStyleOf = (view: BaseView): MarkerStyle =>
  view.markerStyle === 'number' || view.markerStyle === 'none' ? view.markerStyle : 'bullet'

/** `view.propertySeparator` when it is a string, else Obsidian's documented default `, `. */
const separatorOf = (view: BaseView): string => (typeof view.propertySeparator === 'string' ? view.propertySeparator : ', ')

/**
 * List view (4F, GRO-2140): `type: list` — Obsidian's schema — renders one item per record. The
 * FIRST property in `order` is the primary line (Obsidian: the primary list item is whatever
 * sits on top of the Properties menu): `file.name` renders as a link → `onOpenFile` — the
 * default when `order` is empty or absent — while any other first property renders its typed
 * value and file.name is NOT implicitly added. The remaining `order` properties render either
 * as indented label/value rows beneath the primary line (`indentProperties: true`) or inline
 * after it, `render()`ed, empties skipped, joined by `propertySeparator` (default `, `).
 * `markerStyle` bullet | number | none draws the item marker (default bullet; number is the
 * ordinal within its list — restarting per group). Grouped results render 4C sections (the
 * shared `GroupHeader` over each group's own list) with the SAME persisted collapse state as
 * the table/board/cards (never the `.base` file); search narrows items and drops empty groups.
 * The three config keys are edited in the Properties menu (list views only). The primary line
 * (when not file.name) and the indented property rows edit inline through `EditableCell`
 * (5B, GRO-2142); the joined inline string stays read-only.
 */
export function ListView({ def, view, records, rows, groups, collapsed, onToggleGroup, onOpenFile, onNewInGroup, types, readOnly = false }: ListViewProps) {
  const keys = propertyKeys(def, view, records)
  const primary: string | undefined = keys[0]
  const rest = keys.slice(1)
  const nameIsPrimary = primary === undefined || canonicalKey(primary) === 'file.name'
  const marker = markerStyleOf(view)
  const indent = view.indentProperties === true
  const separator = separatorOf(view)
  // per-column halves of the editor inference (5B, GRO-2142), over the view's shown rows
  const rowRecords = rows.map((r) => r.record)
  const bareOf = (key: string) => (canonicalKey(key).startsWith('note.') ? canonicalKey(key).slice(5) : null)
  const typings = new Map(keys.map((k) => [k, columnTyping(k, rowRecords, types)]))
  const basenames = records.map((r) => r.basename)
  const editable = (row: Row, key: string) => {
    const bare = bareOf(key)
    if (bare === null || readOnly) return cellContent(row.values[key])
    return (
      <EditableCell
        path={row.record.path}
        propKey={bare}
        raw={row.record.properties[bare]}
        value={row.values[key]}
        editor={cellEditor(row.record.properties[bare], typings.get(key) ?? null)}
        basenames={basenames}
      />
    )
  }

  const items = (shown: readonly Row[]) => (
    <ul className="base-list__items">
      {shown.map((row, i) => {
        const inline = indent ? '' : rest.map((k) => render(row.values[k])).filter((s) => s !== '').join(separator)
        return (
          <li key={row.record.path} className="base-list__item">
            {marker !== 'none' && (
              <span className="base-list__marker" aria-hidden>
                {marker === 'number' ? `${i + 1}.` : '•'}
              </span>
            )}
            <div className="base-list__body">
              <div className="base-list__line">
                {nameIsPrimary ? (
                  <button type="button" className="base-list__title" onClick={() => onOpenFile(row.record.path)}>
                    {primary === undefined ? row.record.name : render(row.values[primary])}
                  </button>
                ) : (
                  <span className="base-list__primary">{editable(row, primary)}</span>
                )}
                {inline !== '' && <span className="base-list__inline">{inline}</span>}
              </div>
              {indent && rest.length > 0 && (
                <div className="base-list__props">
                  {rest.map((key) => (
                    <div key={key} className="base-list__prop">
                      <span className="base-list__prop-name">{propertyLabel(def, key)}</span>
                      <span className="base-list__prop-value">{editable(row, key)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="base-list">
      {groups === null
        ? items(rows)
        : groups.map((g) => {
            const gk = groupKeyOf(g.key)
            const isCollapsed = collapsed.includes(gk)
            return (
              <section key={gk} className="base-list__group">
                <GroupHeader
                  def={def}
                  view={view}
                  columns={keys}
                  groupKey={g.key}
                  rows={g.rows}
                  collapsed={isCollapsed}
                  onToggle={() => onToggleGroup(gk)}
                  onNew={onNewInGroup === undefined ? undefined : () => onNewInGroup(g)}
                />
                {!isCollapsed && items(g.rows)}
              </section>
            )
          })}
    </div>
  )
}
