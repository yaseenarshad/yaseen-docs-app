import { type CSSProperties, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import type { ViewSet, ViewDef, Mutate } from '../viewSchema'
import { type Group, propertyKeys, propertyLabel } from '../engine'
import { render } from '../expr'
import { cardWidth } from './cardWidth'
import { canonicalKey } from './keys'
import { GroupHeader, cellContent, groupKeyOf } from './GroupHeader'
import { useFlip } from './flip'
import { groupByKey, useGroupDrag } from './groupDrag'
import { allPropertyKeys } from './properties'

export interface BoardViewProps {
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  /** Post-search groups from ViewsPane (empty groups dropped); null when the view has no `groupBy`. */
  groups: readonly Group[] | null
  /** Collapsed group keys (`groupKeyOf`) for this page + view; owned by ViewsPane, persisted via storage. */
  collapsed: readonly string[]
  onToggleGroup: (key: string) => void
  onUpdate: Mutate
  onOpenFile: (path: string) => void
  /** A drop on another column: `groupBy.property = value` (undefined deletes) via ViewsPane (5C, GRO-2143). */
  onMoveToGroup: (path: string, value: unknown) => void
  /** The last failed move, flagged inline on its card. */
  moveError: { path: string; message: string } | null
  /** Create a note seeded with a column's group value (5D, GRO-2144); absent → no "+" on headers and no add row. A `name` is the inline add's typed one (YAZ-943). */
  onNewInGroup?: (group: Group, name?: string) => void
}

/**
 * Board view (4D, GRO-2138): `type: board` — OUR schema extension — renders the engine's groups
 * as kanban columns on one horizontally scrolling row. Each column is the shared `GroupHeader`
 * content (chevron, typed value, count, per-column summaries over the SHOWN cards) over the
 * group's cards: `file.name`, when present in `order`, as the title button → `onOpenFile`, then
 * the view's other `order` properties as small label/value rows typed like table cells. Column
 * width follows `cardSize`
 * (shared `cardWidth`: a number = px, presets small 220 / medium 280 / large 340, default
 * medium). Collapsing a column hides its cards and
 * keeps the header — same persisted state as the table's groups, never the page's card. Without
 * `groupBy` a centered hint's "Group by…" button writes the first non-file property through the
 * file (opening the Sort popover remotely would mean lifting Toolbar's menu state; one write is
 * simpler and the Sort menu can change it after). Dragging a card to another column (5C,
 * GRO-2143) writes the group property through `onMoveToGroup` — the hovered column shows a
 * dashed placeholder, the own column is never a target, Esc cancels — and a failed move's
 * card carries an inline error chip. Images are 4E. Every column ends in the Notion inline add
 * (YAZ-943): a quiet "New card" row that swaps in a name input, and Enter births that page into
 * THAT column's group without opening it — one input at a time, cleared and left open for the next.
 */
export function BoardView({ def, view, viewIndex, records, groups, collapsed, onToggleGroup, onUpdate, onOpenFile, onMoveToGroup, moveError, onNewInGroup }: BoardViewProps) {
  const dnd = useGroupDrag([groupByKey(view)], onMoveToGroup)
  /** One FLIP instance for the whole board (YAZ-944), so a card crossing columns MOVES. */
  const flipRoot = useFlip()
  /** The one open add row (YAZ-943) and what has been typed into it; null = every column shows its button. */
  const [adding, setAdding] = useState<{ key: string; name: string } | null>(null)
  if (groups === null) {
    const fallback = allPropertyKeys(def, view, records).find((k) => !canonicalKey(k).startsWith('file.')) ?? 'file.folder'
    return (
      <div className="view-board__hint">
        <p>Board views group notes into columns. Pick a property to group by.</p>
        <button
          type="button"
          className="view-menu__action"
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
    <div className="view-board" ref={flipRoot} style={{ '--view-board-col-w': `${width}px` } as CSSProperties}>
      {groups.map((g) => {
        const gk = groupKeyOf(g.key)
        const isCollapsed = collapsed.includes(gk)
        const isOver = dnd.over === gk
        return (
          <section key={gk} className={`view-board__col${isOver ? ' view-board__col--drop' : ''}`} {...dnd.target(g)}>
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
            {!isCollapsed && (
              <ul className="view-board__cards">
                {g.rows.map((row) => (
                  <li
                    key={row.record.path}
                    data-flip-key={row.record.path}
                    className={`view-board__card${dnd.drag?.path === row.record.path ? ' view-board__card--drag' : ''}`}
                    {...dnd.source(row.record.path, g)}
                  >
                    {nameKey !== undefined && (
                      <button type="button" className="view-board__title" onClick={() => onOpenFile(row.record.path)}>
                        {render(row.values[nameKey])}
                      </button>
                    )}
                    {moveError?.path === row.record.path && (
                      <span className="view-table__chip view-table__chip--error view-drag__error" role="alert" title={moveError.message}>
                        Move failed
                      </span>
                    )}
                    {rest.map((key) => (
                      <div key={key} className="view-board__prop">
                        <span className="view-board__prop-name">{propertyLabel(def, key)}</span>
                        <span className="view-board__prop-value">{cellContent(row.values[key])}</span>
                      </div>
                    ))}
                  </li>
                ))}
                {isOver && <li className="view-board__placeholder" aria-hidden />}
              </ul>
            )}
            {!isCollapsed &&
              onNewInGroup !== undefined &&
              (adding?.key === gk ? (
                <input
                  className="view-board__add-input"
                  aria-label="New card name"
                  placeholder="New card"
                  autoFocus
                  value={adding.name}
                  onChange={(e) => setAdding({ key: gk, name: e.target.value })}
                  onBlur={() => setAdding(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setAdding(null)
                    if (e.key !== 'Enter') return
                    const name = adding.name.trim()
                    // An empty Enter is a no-op, not an `Untitled` card: the row is asking for a name.
                    if (name === '') return
                    onNewInGroup(g, name)
                    setAdding({ key: gk, name: '' })
                  }}
                />
              ) : (
                <button type="button" className="view-board__add" aria-label="New card" onClick={() => setAdding({ key: gk, name: '' })}>
                  + New card
                </button>
              ))}
          </section>
        )
      })}
    </div>
  )
}
