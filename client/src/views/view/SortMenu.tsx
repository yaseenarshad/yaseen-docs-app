import { useRef, type ReactNode } from 'react'
import { useLiveGapReorder } from '../../lib/useLiveGapReorder'
import { DragHandleIcon } from './icons'
import { ColumnPicker } from './ColumnPicker'
import { DirectionPicker, withOrder } from './DirectionPicker'
import { GroupStylePicker } from './GroupStylePicker'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import { type ViewSet, type ViewDef, type Mutate, type SortSpec, type GroupBySpec, groupByLevels, MAX_GROUP_LEVELS } from '../viewSchema'
import { propertyLabel } from '../engine'
import { columnTyping } from '../editorType'
import type { FolderSettings } from '../folderSettings'
import { canonicalKey } from './keys'
import { allPropertyKeys, propertyOptions } from './properties'
import { FoldersFirstToggle } from './SubfoldersSwitch'

export interface SortMenuProps {
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  onUpdate: Mutate
  settings: FolderSettings
  properties?: PropertiesResponse | null
  /** Opens the column editor on one column, for "Edit option order…" (YAZ-3940). Absent: the item is hidden. */
  onEditColumn?: (key: string) => void
}

const EMPTY_SORT: SortSpec[] = []

/** A `groupBy` entry that names a column (YAZ-4544): the engine's own test (`shownGroupLevels`). */
const isLevel = (level: GroupBySpec | undefined): level is GroupBySpec => typeof level?.property === 'string'

/** Folder (YAZ-2541): a place to sort and group by — a column too since YAZ-4564 D26 — and the one property that may group twice, the second level being the next folder down. */
const FOLDER = 'file.folder'

/** Each group level's picker and order-menu names, outer first (YAZ-4532). */
const GROUP_LABELS = ['Group by', 'Then group by', 'Then group by (level 3)'] as const
const GROUP_DIRECTION_LABELS = ['Group direction', 'Then group direction', 'Then group direction (level 3)'] as const

/**
 * Stable row identities of one reorderable rule list: the sorts (GRO-2135) and
 * the group levels (YAZ-4532). ViewsPane reparses YAML after each write. Keep local rule identities
 * through our own edits, including duplicate properties; an external replacement gets fresh identities.
 */
function useRuleRows<T>(list: readonly T[]) {
  const nextId = useRef(list.length)
  const source = useRef(list)
  const ids = useRef(list.map((_, i) => i))
  const pending = useRef<{ signature: string; ids: number[] } | null>(null)
  const signature = JSON.stringify(list)
  if (source.current !== list) {
    if (pending.current?.signature === signature) ids.current = pending.current.ids
    else if (JSON.stringify(source.current) !== signature) ids.current = list.map(() => nextId.current++)
    source.current = list
    pending.current = null
  }
  return {
    ids: ids.current,
    newId: () => nextId.current++,
    /** Call before a write: the rows that write makes keep these identities. */
    expect: (next: readonly T[], nextIds: number[]) => { pending.current = { signature: JSON.stringify(next), ids: nextIds } },
  }
}
/** A rule list's drag (YAZ-4606 D58): the tab bar's live gap, down the list. A list replaced under a drag drops it. */
type RuleDrag = ReturnType<typeof useLiveGapReorder<HTMLUListElement>>
/** The live gap's final index, as `moved`'s insertion point: past the grab point one more. */
const insertionOf = (from: number, to: number): number => (to > from ? to + 1 : to)

/** Reorder `list` (and its `ids` beside it): the item at `from` goes to the insertion point `insertion`. Null = no move. */
function moved<T>(list: readonly T[], ids: readonly number[], from: number, insertion: number): [T[], number[]] | null {
  const to = insertion > from ? insertion - 1 : insertion
  if (to === from || to < 0 || to >= list.length) return null
  const next = [...list]
  const nextIds = [...ids]
  const [item] = next.splice(from, 1)
  const [id] = nextIds.splice(from, 1)
  next.splice(to, 0, item)
  nextIds.splice(to, 0, id)
  return [next, nextIds]
}

/** One reorderable rule row: an item of its list's live gap, its ⋮⋮ handle (drag, or ↑/↓ when focused) and `body`. */
function ruleRow(ids: readonly number[], live: RuleDrag, i: number, count: number, move: (from: number, insertion: number) => void, gripLabel: string, body: ReactNode, mainClass?: string) {
  return (
    <li key={ids[i]} {...live.itemProps(i)} className="view-rule">
      <div className={mainClass ? `view-rule__main ${mainClass}` : 'view-rule__main'}>
        <button type="button" className="view-rule__nav view-prop__handle"
          aria-label={gripLabel}
          title="Drag to reorder · Arrow keys when focused"
          disabled={count < 2} draggable={count > 1}
          onDragStart={event => {
            event.dataTransfer?.setData('text/plain', String(ids[i]))
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
            const row = event.currentTarget.closest('li')
            if (row) event.dataTransfer?.setDragImage?.(row, 12, 16)
            live.start(event, i)
          }}
          onDragEnd={live.end}
          onKeyDown={event => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            move(i, event.key === 'ArrowUp' ? i - 1 : i + 2)
          }}
        ><DragHandleIcon /></button>
        {body}
      </div>
    </li>
  )
}

/**
 * The ⇅ popover (GRO-2135), sorting and grouping ONLY since YAZ-4607 D60: two sections, Sort and Group, one row shape
 * (⋮⋮, the column, the order, ×; a group row keeps its Aa, D5). "Add sort" and "Add group level" add a row on the
 * first free column; the latter is hidden at `MAX_GROUP_LEVELS`. "Folders first" sits under Sort, a sort rule, only
 * while the view shows folder rows (D33). Group indent and Subfolders moved to Properties › View (D60).
 */
export function SortMenu({ def, view, viewIndex, records, onUpdate, settings, properties, onEditColumn }: SortMenuProps) {
  const own = def.views[viewIndex] ?? view
  const listed = allPropertyKeys(def, view, records, settings.columns)
  const keys = listed.includes(FOLDER) ? listed : [...listed, FOLDER]
  const sort = view.sort ?? EMPTY_SORT
  // A `groupBy` entry with no column (hand-written YAML) is no level (YAZ-4544): the menu shows the usable levels,
  // and each write puts the other entries back after them, as they were.
  const allLevels = groupByLevels(view)
  const levels = allLevels.filter(isLevel)
  const unusable = allLevels.filter((l) => !isLevel(l))
  const sortRows = useRuleRows(sort)
  const groupRows = useRuleRows(levels)

  const writeSort = (next: SortSpec[], nextIds = sortRows.ids) => {
    sortRows.expect(next, nextIds)
    onUpdate((d) => {
      if (next.length) d.views[viewIndex].sort = next
      else delete d.views[viewIndex].sort
    })
  }
  const setSort = (i: number, patch: Partial<SortSpec>) => writeSort(sort.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const moveSort = (from: number, insertion: number) => {
    const next = moved(sort, sortRows.ids, from, insertion)
    if (next) writeSort(...next)
  }
  const sortLive = useLiveGapReorder<HTMLUListElement>({ axis: 'y', keys: sortRows.ids.map(String), onMove: (from, to) => moveSort(from, insertionOf(from, to)) })
  // Every level in one write (YAZ-745, YAZ-4532): one level keeps today's single-object form, more
  // make the ordered list. The same property twice is not a grouping — the earlier level wins —
  // except Folder (YAZ-2541): Folder then Folder IS one, the second being the next folder down.
  // Callers spread each level, so its `by`, `highlight` and `large` survive every edit.
  const writeGroup = (next: readonly GroupBySpec[], nextIds: readonly number[] = groupRows.ids, undo?: string) => {
    const kept: GroupBySpec[] = []
    const keptIds: number[] = []
    const seen = new Set<string>()
    next.forEach((level, i) => {
      const key = canonicalKey(level.property)
      if (kept.length === MAX_GROUP_LEVELS || (key !== FOLDER && seen.has(key))) return
      seen.add(key)
      kept.push(level)
      keptIds.push(nextIds[i])
    })
    groupRows.expect(kept, keptIds)
    const written = [...kept, ...unusable]
    onUpdate((d) => {
      if (written.length === 0) delete d.views[viewIndex].groupBy
      else d.views[viewIndex].groupBy = written.length === 1 && unusable.length === 0 ? kept[0] : written
    }, undo)
  }
  const setLevel = (i: number, level: GroupBySpec) => writeGroup(levels.map((l, j) => (j === i ? level : l)))
  const moveLevel = (from: number, insertion: number) => {
    const next = moved(levels, groupRows.ids, from, insertion)
    if (next) writeGroup(...next)
  }
  const groupLive = useLiveGapReorder<HTMLUListElement>({ axis: 'y', keys: groupRows.ids.map(String), onMove: (from, to) => moveLevel(from, insertionOf(from, to)) })
  /** The properties the levels above `i` group by: level `i` may not repeat one, Folder aside. */
  const above = (i: number) => new Set(levels.slice(0, i).map((l) => canonicalKey(l.property)).filter((k) => k !== FOLDER))

  /** A Select or Multi-select column has an option order, in every view type (YAZ-3940). */
  const hasOptions = (property: string) => {
    const typing = columnTyping(property, records, properties, settings)
    return typing?.assigned === 'select' || typing?.assigned === 'multi-select'
  }
  const editOptions = (property: string) => (onEditColumn ? () => onEditColumn(canonicalKey(property)) : undefined)

  const options = (current: string | undefined, without?: ReadonlySet<string>) =>
    propertyOptions(def, keys, current).filter((o) => !without?.has(o.value))
  /** A calendar's days are its groups (YAZ-4540 D4): it ignores `groupBy`, so the menu offers only Sort. */
  const grouping = view.type !== 'calendar'

  /** The column a new group level starts on: the first one the levels above do not use (Folder aside). */
  const nextLevel = grouping && levels.length < MAX_GROUP_LEVELS ? options(undefined, above(levels.length))[0] : undefined

  return (
    <div className="view-menu sort-menu">
      <p className="view-menu__label">Sort</p>
      {sort.length > 0 && (
        <ul className="view-menu__list" {...sortLive.listProps}>
          {sort.map((s, i) => ruleRow(sortRows.ids, sortLive, i, sort.length, moveSort, `Reorder sort ${i + 1}: ${propertyLabel(def, s.property)}`, <>
            <ColumnPicker label="Sort property" value={canonicalKey(s.property)} onChange={(value) => setSort(i, { property: value })} options={options(s.property)} />
            <DirectionPicker label="Direction" spec={s} hasOptions={hasOptions(s.property)} onChange={(patch) => writeSort(sort.map((r, j) => (j === i ? withOrder(r, patch) : r)))} onEditOptions={editOptions(s.property)} />
            <button type="button" className="view-rule__remove" aria-label="Remove sort" title="Remove sort" onClick={() => writeSort(sort.filter((_, j) => j !== i), sortRows.ids.filter((_, j) => j !== i))}>
              ×
            </button>
          </>, 'sort-menu__level'))}
        </ul>
      )}
      <div className="view-menu__foot">
        <button type="button" className="view-menu__action" onClick={() => writeSort([...sort, { property: canonicalKey(keys[0] ?? 'file.name'), direction: 'ASC' }], [...sortRows.ids, sortRows.newId()])}>
          Add sort
        </button>
      </div>
      {/* A sort rule (YAZ-4579 D33, D60): whether folder rows lead; only while the view shows them. */}
      <FoldersFirstToggle view={view} own={own} viewIndex={viewIndex} onUpdate={onUpdate} className="view-menu__toggle sort-menu__folders-first" />
      {grouping && <p className="view-menu__label">Group</p>}
      {grouping && levels.length > 0 && (
        <ul className="view-menu__list" {...groupLive.listProps}>
          {levels.map((level, i) => ruleRow(groupRows.ids, groupLive, i, levels.length, moveLevel, `Reorder group level ${i + 1}: ${propertyLabel(def, level.property)}`, <>
            <ColumnPicker
              label={GROUP_LABELS[i]}
              value={canonicalKey(level.property)}
              // None ends the grouping at this level, as it did for the outer and inner (YAZ-745).
              onChange={(value) => (value ? setLevel(i, { ...level, property: value, direction: level.direction === 'DESC' ? 'DESC' : 'ASC' }) : writeGroup(levels.slice(0, i), groupRows.ids.slice(0, i)))}
              options={[{ value: '', label: 'None' }, ...options(level.property, above(i))]} />
            <DirectionPicker label={GROUP_DIRECTION_LABELS[i]} spec={level} hasOptions={hasOptions(level.property)} onChange={(patch) => setLevel(i, withOrder({ ...level, property: canonicalKey(level.property) }, patch))} onEditOptions={editOptions(level.property)} />
            <GroupStylePicker label={`Style of group level ${i + 1}`} spec={level} onChange={(next) => setLevel(i, next)} />
            <button type="button" className="view-rule__remove" aria-label={`Remove group level ${i + 1}: ${propertyLabel(def, level.property)}`} title="Remove group level"
              onClick={() => writeGroup(levels.filter((_, j) => j !== i), groupRows.ids.filter((_, j) => j !== i), `Removed group level ${propertyLabel(def, level.property)}`)}>
              ×
            </button>
          </>, 'sort-menu__level'))}
        </ul>
      )}
      {/* "Add group level" (D60) replaces the empty "None" picker: a row on the first free column, gone at three levels. */}
      {nextLevel !== undefined && (
        <div className="view-menu__foot">
          <button type="button" className="view-menu__action" onClick={() => writeGroup([...levels, { property: nextLevel.value, direction: 'ASC' }], [...groupRows.ids, groupRows.newId()])}>
            Add group level
          </button>
        </div>
      )}
    </div>
  )
}
