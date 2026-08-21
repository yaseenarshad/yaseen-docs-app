import type { CSSProperties } from 'react'
import type { IndexRecord } from '@shared/types'
import type { BaseDefinition, BaseView } from '../baseFile'
import { type Group, propertyKeys, propertyLabel } from '../engine'
import { render } from '../expr'
import { cardWidth } from './cardWidth'
import type { Mutate } from './FilterMenu'
import { canonicalKey } from './filterRows'
import { GroupHeader, cellContent, groupKeyOf } from './GroupHeader'
import { allPropertyKeys } from './properties'

export interface BoardViewProps {
  def: BaseDefinition
  view: BaseView
  viewIndex: number
  records: readonly IndexRecord[]
  /** Post-search groups from BaseView (empty groups dropped); null when the view has no `groupBy`. */
  groups: readonly Group[] | null
  /** Collapsed group keys (`groupKeyOf`) for this base file + view; owned by BaseView, persisted via storage. */
  collapsed: readonly string[]
  onToggleGroup: (key: string) => void
  onUpdate: Mutate
  onOpenFile: (path: string) => void
}

/**
 * Board view (4D, GRO-2138): `type: board` — OUR schema extension — renders the engine's groups
 * as kanban columns on one horizontally scrolling row. Each column is the shared `GroupHeader`
 * content (chevron, typed value, count, per-column summaries over the SHOWN cards) over the
 * group's cards: `file.name` as the title button → `onOpenFile`, then the view's other `order`
 * properties as small label/value rows typed like table cells. Column width follows `cardSize`
 * (shared `cardWidth`: a number = px, presets small 220 / medium 280 / large 340, default
 * medium). Collapsing a column hides its cards and
 * keeps the header — same persisted state as the table's groups, never the `.base` file. Without
 * `groupBy` a centered hint's "Group by…" button writes the first non-file property through the
 * file (opening the Sort popover remotely would mean lifting Toolbar's menu state; one write is
 * simpler and the Sort menu can change it after). Drag between columns is 5C, images 4E.
 */
export function BoardView({ def, view, viewIndex, records, groups, collapsed, onToggleGroup, onUpdate, onOpenFile }: BoardViewProps) {
  if (groups === null) {
    const fallback = allPropertyKeys(def, view, records).find((k) => !canonicalKey(k).startsWith('file.')) ?? 'file.folder'
    return (
      <div className="base-board__hint">
        <p>Board views group notes into columns. Pick a property to group by.</p>
        <button
          type="button"
          className="base-menu__action"
          onClick={() =>
            onUpdate((d) => {
              d.views[viewIndex].groupBy = { property: canonicalKey(fallback), direction: 'ASC' }
            })
          }
        >
          Group by…
        </button>
      </div>
    )
  }

  const keys = propertyKeys(def, view, records)
  const nameKey = keys.find((k) => canonicalKey(k) === 'file.name')
  const rest = keys.filter((k) => k !== nameKey)
  const width = cardWidth(view.cardSize)

  return (
    <div className="base-board" style={{ '--base-board-col-w': `${width}px` } as CSSProperties}>
      {groups.map((g) => {
        const gk = groupKeyOf(g.key)
        const isCollapsed = collapsed.includes(gk)
        return (
          <section key={gk} className="base-board__col">
            <GroupHeader def={def} view={view} columns={keys} groupKey={g.key} rows={g.rows} collapsed={isCollapsed} onToggle={() => onToggleGroup(gk)} />
            {!isCollapsed && (
              <ul className="base-board__cards">
                {g.rows.map((row) => (
                  <li key={row.record.path} className="base-board__card">
                    <button type="button" className="base-board__title" onClick={() => onOpenFile(row.record.path)}>
                      {nameKey === undefined ? row.record.name : render(row.values[nameKey])}
                    </button>
                    {rest.map((key) => (
                      <div key={key} className="base-board__prop">
                        <span className="base-board__prop-name">{propertyLabel(def, key)}</span>
                        <span className="base-board__prop-value">{cellContent(row.values[key])}</span>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
