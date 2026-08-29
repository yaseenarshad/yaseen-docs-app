import { type CSSProperties, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import type { ViewSet, ViewDef, Mutate } from '../viewSchema'
import { type Group, type Row, propertyKeys, propertyLabel } from '../engine'
import { render } from '../expr'
import { cardWidth } from './cardWidth'
import { canonicalKey } from './keys'
import { GroupHeader, cellContent, groupKeyOf, nestedGroupKeyOf } from './GroupHeader'
import { useFlip } from './flip'
import { type GroupDrop, type GroupSpot, type GroupSwap, groupByKey, useGroupDrag } from './groupDrag'
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
  /** A drop on another section, including nested level metadata, via ViewsPane's existing optimistic write path. */
  onMoveToGroup: (path: string, value: unknown, swap?: GroupSwap, drop?: GroupDrop) => void
  /** The last failed move, flagged inline on its card. */
  moveError: { path: string; message: string } | null
  /** Create a note seeded at one group level; nested spots let ViewsPane seed the outer too. A `name` is the inline add's typed one. */
  onNewInGroup?: (group: Group, name?: string, at?: GroupSpot) => void
}

/**
 * Board view (4D, GRO-2138): `type: board` — OUR schema extension — renders the engine's groups
 * as kanban columns on one horizontally scrolling row. With two group levels, each outer remains
 * one column: merge-rule `direct` cards come first, then compact inner sections stack vertically.
 * Every level uses the shared `GroupHeader` (chevron, typed value, count, per-section summaries)
 * over its cards: `file.name`, when present in `order`, as the title button → `onOpenFile`, then
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
 * card carries an inline error chip. Nested targets are siblings of the outer target rather than
 * descendants, so one bubbled drop cannot dispatch at both levels. Images are 4E. A single-level
 * column — or each writable inner section in a nested Board — ends in the Notion inline add
 * (YAZ-943): Enter births the named page into that exact section without opening it. Per-property
 * `cardStyle` (YAZ-1206) bolds/underlines a value, hides its label, or lifts it onto the title row.
 */
/** The `cardStyle` flags that read the same on a stacked row and an inline value (YAZ-1206). */
const styleClasses = (style: NonNullable<ViewDef['cardStyle']>[string]) =>
  `${style.bold === true ? ' view-board__prop--bold' : ''}${style.underline === true ? ' view-board__prop--underline' : ''}`

export function BoardView({ def, view, viewIndex, records, groups, collapsed, onToggleGroup, onUpdate, onOpenFile, onMoveToGroup, moveError, onNewInGroup }: BoardViewProps) {
  const levelKeys = [groupByKey(view), groupByKey(view, 1)]
  const dnd = useGroupDrag(levelKeys, onMoveToGroup)
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
  const styleOf = (key: string) => view.cardStyle?.[canonicalKey(key)] ?? {}
  const inlineLeft = rest.filter((k) => styleOf(k).inline === 'left')
  const inlineRight = rest.filter((k) => styleOf(k).inline === 'right')
  const stacked = rest.filter((k) => styleOf(k).inline === undefined)
  const width = cardWidth(view.cardSize)
  /** `side` only when a title is there to separate from: no title, no dash (YAZ-1175 amendment). */
  const inlineValue = (key: string, row: Row, side: string) => (
    <span key={key} className={`view-board__prop-value${nameKey === undefined ? '' : side}${styleClasses(styleOf(key))}`}>
      {cellContent(row.values[key])}
    </span>
  )
  const cardList = (rows: readonly Row[], group: Group, at: GroupSpot, isOver = false) => (
    <ul className="view-board__cards">
      {rows.map((row) => (
        <li
          key={row.record.path}
          data-flip-key={row.record.path}
          className={`view-board__card${dnd.drag?.path === row.record.path ? ' view-board__card--drag' : ''}`}
          {...dnd.source(row.record.path, group, at)}
        >
          {(nameKey !== undefined || inlineLeft.length + inlineRight.length > 0) && (
            <div className="view-board__title-row">
              {inlineLeft.map((key) => inlineValue(key, row, ' view-board__inline--left'))}
              {nameKey !== undefined && (
                <button type="button" className="view-board__title" onClick={() => onOpenFile(row.record.path)}>
                  {render(row.values[nameKey])}
                </button>
              )}
              {inlineRight.map((key) => inlineValue(key, row, ' view-board__inline--right'))}
            </div>
          )}
          {moveError?.path === row.record.path && (
            <span className="view-table__chip view-table__chip--error view-drag__error" role="alert" title={moveError.message}>
              Move failed
            </span>
          )}
          {stacked.map((key) => (
            <div key={key} className={`view-board__prop${styleClasses(styleOf(key))}`}>
              {styleOf(key).hideLabel !== true && <span className="view-board__prop-name">{propertyLabel(def, key)}</span>}
              <span className="view-board__prop-value">{cellContent(row.values[key])}</span>
            </div>
          ))}
        </li>
      ))}
      {isOver && <li className="view-board__placeholder" aria-hidden />}
    </ul>
  )
  const inlineAdd = (group: Group, key: string, at?: GroupSpot) => {
    if (onNewInGroup === undefined) return null
    return adding?.key === key ? (
      <input
        className="view-board__add-input"
        aria-label="New card name"
        placeholder="New card"
        autoFocus
        value={adding.name}
        onChange={(e) => setAdding({ key, name: e.target.value })}
        onBlur={() => setAdding(null)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setAdding(null)
          if (e.key !== 'Enter') return
          const name = adding.name.trim()
          // An empty Enter is a no-op, not an `Untitled` card: the row is asking for a name.
          if (name === '') return
          onNewInGroup(group, name, at)
          setAdding({ key, name: '' })
        }}
      />
    ) : (
      <button type="button" className="view-board__add" aria-label="New card" onClick={() => setAdding({ key, name: '' })}>
        + New card
      </button>
    )
  }

  return (
    <div className="view-board" ref={flipRoot} style={{ '--view-board-col-w': `${width}px` } as CSSProperties}>
      {groups.map((g) => {
        const gk = groupKeyOf(g.key)
        const isCollapsed = collapsed.includes(gk)
        const isOver = dnd.over === gk
        const outerAt: GroupSpot = { level: 0, outer: g }
        const header = (
          <GroupHeader
            def={def}
            view={view}
            columns={keys}
            groupKey={g.key}
            rows={g.rows}
            collapsed={isCollapsed}
            onToggle={() => onToggleGroup(gk)}
            onNew={onNewInGroup === undefined || levelKeys[0] === null ? undefined : () => onNewInGroup(g)}
          />
        )
        return (
          <section
            key={gk}
            className={`view-board__col${g.children === undefined ? '' : ' view-board__col--nested'}${isOver ? ' view-board__col--drop' : ''}`}
            {...(g.children === undefined ? dnd.target(g, outerAt) : {})}
          >
            {g.children === undefined ? (
              header
            ) : (
              <div className="view-board__col-header" {...dnd.target(g, outerAt)}>
                {header}
              </div>
            )}
            {!isCollapsed && (
              <>
                {g.children === undefined ? (
                  cardList(g.rows, g, outerAt, isOver)
                ) : (
                  <>
                    {(g.direct?.length ?? 0) > 0 && cardList(g.direct ?? [], g, outerAt, isOver)}
                    {g.children.length > 0 && (
                      <div className="view-board__subgroups">
                        {g.children.map((child) => {
                          const ck = nestedGroupKeyOf(g.key, child.key)
                          const childCollapsed = collapsed.includes(ck)
                          const childOver = dnd.over === ck
                          const innerAt: GroupSpot = { level: 1, outer: g }
                          return (
                            <section
                              key={ck}
                              className={`view-board__subgroup${childOver ? ' view-board__subgroup--drop' : ''}`}
                              {...dnd.target(child, innerAt)}
                            >
                              <GroupHeader
                                def={def}
                                view={view}
                                columns={keys}
                                groupKey={child.key}
                                rows={child.rows}
                                collapsed={childCollapsed}
                                onToggle={() => onToggleGroup(ck)}
                                onNew={
                                  onNewInGroup === undefined || levelKeys[1] === null
                                    ? undefined
                                    : () => onNewInGroup(child, undefined, innerAt)
                                }
                              />
                              {!childCollapsed && cardList(child.rows, child, innerAt, childOver)}
                              {!childCollapsed && levelKeys[1] !== null && inlineAdd(child, ck, innerAt)}
                            </section>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            {!isCollapsed && g.children === undefined && levelKeys[0] !== null && inlineAdd(g, gk)}
          </section>
        )
      })}
    </div>
  )
}
