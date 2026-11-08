import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { DragHandleIcon } from './icons'
import { ColumnPicker } from './ColumnPicker'
import { DirectionPicker, withOrder } from './DirectionPicker'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import { type ViewSet, type ViewDef, type Mutate, type SortSpec, type GroupBySpec, groupByLevels, groupIndentOf, GROUP_INDENTS } from '../viewSchema'
import { propertyLabel } from '../engine'
import { columnTyping } from '../editorType'
import type { FolderSettings } from '../folderSettings'
import { canonicalKey } from './keys'
import { allPropertyKeys, propertyOptions } from './properties'

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

/** Folder (YAZ-2541): a place to sort and group by, never a column — and the one property that may group twice, the second level being the next folder down. */
const FOLDER = 'file.folder'

/** At most three group levels (YAZ-3741 D2). */
const MAX_GROUP_LEVELS = 3
/** Each group level's picker and order-menu names, outer first (YAZ-4532). */
const GROUP_LABELS = ['Group by', 'Then group by', 'Then group by (level 3)'] as const
const GROUP_DIRECTION_LABELS = ['Group direction', 'Then group direction', 'Then group direction (level 3)'] as const
const INDENT_STEPS = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] as const

type Drag = { id: number; to: number; signature: string }

/**
 * Stable row identities and the drag state of one reorderable rule list: the sorts (GRO-2135) and
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
  const [drag, setDrag] = useState<Drag | null>(null)
  return {
    ids: ids.current,
    signature,
    dragging: drag?.signature === signature ? drag : null,
    setDrag,
    newId: () => nextId.current++,
    /** Call before a write: the rows that write makes keep these identities. */
    expect: (next: readonly T[], nextIds: number[]) => { pending.current = { signature: JSON.stringify(next), ids: nextIds } },
  }
}
type RuleRows = Pick<ReturnType<typeof useRuleRows>, 'ids' | 'signature' | 'dragging' | 'setDrag'>

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

const insertionAt = (event: DragEvent<HTMLElement>, index: number) => {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? index : index + 1
}

/** One reorderable rule row: the drop target, its ⋮⋮ handle (drag, or ↑/↓ when focused) and `body`. */
function ruleRow(rows: RuleRows, i: number, count: number, move: (from: number, insertion: number) => void, gripLabel: string, body: ReactNode, mainClass?: string) {
  const { ids, dragging, setDrag, signature } = rows
  return (
    <li key={ids[i]} className={[
      'view-rule',
      dragging?.id === ids[i] ? 'view-prop--dragging' : '',
      dragging?.to === i ? 'view-prop--insert-before' : '',
      dragging?.to === count && i === count - 1 ? 'view-prop--insert-after' : '',
    ].filter(Boolean).join(' ')}
      onDragOver={event => {
        if (!dragging) return
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        const to = insertionAt(event, i)
        if (to !== dragging.to) setDrag({ ...dragging, to })
      }}
      onDrop={event => {
        if (!dragging) return
        event.preventDefault()
        const from = ids.indexOf(dragging.id)
        if (from >= 0) move(from, insertionAt(event, i))
        setDrag(null)
      }}
    >
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
            setDrag({ id: ids[i], to: i, signature })
          }}
          onDragEnd={() => setDrag(null)}
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

/** Sort menu (GRO-2135): `view.sort` rows (property, direction, order, remove) and `view.groupBy` beneath. */
export function SortMenu({ def, view, viewIndex, records, onUpdate, settings, properties, onEditColumn }: SortMenuProps) {
  const listed = allPropertyKeys(def, view, records, settings.columns)
  const keys = listed.includes(FOLDER) ? listed : [...listed, FOLDER]
  const sort = view.sort ?? EMPTY_SORT
  const levels = groupByLevels(view)
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
  // Every level in one write (YAZ-745, YAZ-4532): one level keeps today's single-object form, more
  // make the ordered list. The same property twice is not a grouping — the earlier level wins —
  // except Folder (YAZ-2541): Folder then Folder IS one, the second being the next folder down.
  // Callers spread each level, so its `by`, `highlight` and `large` survive every edit.
  const writeGroup = (next: readonly GroupBySpec[], nextIds: readonly number[] = groupRows.ids) => {
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
    onUpdate((d) => {
      if (kept.length === 0) delete d.views[viewIndex].groupBy
      else d.views[viewIndex].groupBy = kept.length === 1 ? kept[0] : kept
    })
  }
  const setLevel = (i: number, level: GroupBySpec) => writeGroup(levels.map((l, j) => (j === i ? level : l)))
  const moveLevel = (from: number, insertion: number) => {
    const next = moved(levels, groupRows.ids, from, insertion)
    if (next) writeGroup(...next)
  }
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

  return (
    <div className="view-menu sort-menu">
      {sort.length === 0 ? (
        <p className="view-menu__empty">No sort</p>
      ) : (
        <ul className="view-menu__list">
          {sort.map((s, i) => ruleRow(sortRows, i, sort.length, moveSort, `Reorder sort ${i + 1}: ${propertyLabel(def, s.property)}`, <>
            <ColumnPicker label="Sort property" value={canonicalKey(s.property)} onChange={(value) => setSort(i, { property: value })} options={options(s.property)} />
            <DirectionPicker label="Direction" spec={s} hasOptions={hasOptions(s.property)} onChange={(patch) => writeSort(sort.map((r, j) => (j === i ? withOrder(r, patch) : r)))} onEditOptions={editOptions(s.property)} />
            <button type="button" className="view-rule__remove" aria-label="Remove sort" title="Remove sort" onClick={() => writeSort(sort.filter((_, j) => j !== i), sortRows.ids.filter((_, j) => j !== i))}>
              ×
            </button>
          </>))}
        </ul>
      )}
      <div className="view-menu__foot">
        <button type="button" className="view-menu__action" onClick={() => writeSort([...sort, { property: canonicalKey(keys[0] ?? 'file.name'), direction: 'ASC' }], [...sortRows.ids, sortRows.newId()])}>
          Add sort
        </button>
      </div>
      <p className="view-menu__label">Group by</p>
      {levels.length > 0 && (
        <ul className="view-menu__list">
          {levels.map((level, i) => ruleRow(groupRows, i, levels.length, moveLevel, `Reorder group level ${i + 1}: ${propertyLabel(def, level.property)}`, <>
            <ColumnPicker
              label={GROUP_LABELS[i]}
              value={canonicalKey(level.property)}
              // None ends the grouping at this level, as it did for the outer and inner (YAZ-745).
              onChange={(value) => (value ? setLevel(i, { ...level, property: value, direction: level.direction === 'DESC' ? 'DESC' : 'ASC' }) : writeGroup(levels.slice(0, i), groupRows.ids.slice(0, i)))}
              options={[{ value: '', label: 'None' }, ...options(level.property, above(i))]} />
            <DirectionPicker label={GROUP_DIRECTION_LABELS[i]} spec={level} hasOptions={hasOptions(level.property)} onChange={(patch) => setLevel(i, withOrder({ ...level, property: canonicalKey(level.property) }, patch))} onEditOptions={editOptions(level.property)} />
            <button type="button" className="view-rule__remove" aria-label={`Remove group level ${i + 1}: ${propertyLabel(def, level.property)}`} title="Remove group level"
              onClick={() => writeGroup(levels.filter((_, j) => j !== i), groupRows.ids.filter((_, j) => j !== i))}>
              ×
            </button>
          </>))}
        </ul>
      )}
      {levels.length < MAX_GROUP_LEVELS && (
        <div className="view-rule__main">
          <ColumnPicker
            label={GROUP_LABELS[levels.length]}
            value=""
            onChange={(value) => { if (value) writeGroup([...levels, { property: value, direction: 'ASC' }], [...groupRows.ids, groupRows.newId()]) }}
            options={[{ value: '', label: 'None' }, ...options(undefined, above(levels.length))]} />
        </div>
      )}
      {levels.length > 0 && (
        <div className="sort-menu__indent">
          <span>Indent</span>
          <div className="view-seg" role="group" aria-label="Group indent">
            {INDENT_STEPS.map(([step, text]) => (
              <button key={step} type="button" className="view-seg__opt" data-indent={step} aria-pressed={GROUP_INDENTS[step] === groupIndentOf(view)}
                onClick={() => onUpdate((d) => {
                  // Medium is the default: it removes the key (YAZ-4532 D10).
                  if (step === 'medium') delete d.views[viewIndex].groupIndent
                  else d.views[viewIndex].groupIndent = step
                })}>
                {text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
