import type { IndexRecord } from '@shared/types'
import { type ViewSet, type ViewDef, type Mutate, type SortSpec, type GroupBySpec, groupByLevels } from '../viewSchema'
import { propertyLabel } from '../engine'
import { canonicalKey } from './keys'
import { allPropertyKeys, withKey } from './properties'

export interface SortMenuProps {
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  onUpdate: Mutate
}

const flip = (d: string | undefined): 'ASC' | 'DESC' => (d === 'DESC' ? 'ASC' : 'DESC')

/** Sort menu (GRO-2135): `view.sort` rows (property, direction, order, remove) and `view.groupBy` beneath. */
export function SortMenu({ def, view, viewIndex, records, onUpdate }: SortMenuProps) {
  const keys = allPropertyKeys(def, view, records)
  const sort = view.sort ?? []
  const [groupBy, thenBy] = groupByLevels(view)

  const writeSort = (next: SortSpec[]) =>
    onUpdate((d) => {
      if (next.length) d.views[viewIndex].sort = next
      else delete d.views[viewIndex].sort
    })
  const setSort = (i: number, patch: Partial<SortSpec>) => writeSort(sort.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const moveSort = (i: number, dir: -1 | 1) => {
    const next = [...sort]
    const [s] = next.splice(i, 1)
    next.splice(i + dir, 0, s)
    writeSort(next)
  }
  // Both levels in one write (YAZ-745): outer alone keeps today's single-object form, a second
  // level makes it the ordered list. The same property twice is not a grouping — the outer wins.
  const writeGroup = (outer: GroupBySpec | null, inner: GroupBySpec | null) =>
    onUpdate((d) => {
      const second = outer !== null && inner !== null && canonicalKey(inner.property) !== canonicalKey(outer.property) ? inner : null
      if (outer === null) delete d.views[viewIndex].groupBy
      else d.views[viewIndex].groupBy = second === null ? outer : [outer, second]
    })

  const options = (current: string | undefined, without?: string) =>
    (current ? withKey(keys, current) : keys)
      .filter((k) => without === undefined || canonicalKey(k) !== without)
      .map((k) => (
        <option key={canonicalKey(k)} value={canonicalKey(k)}>
          {propertyLabel(def, k)}
        </option>
      ))

  return (
    <div className="view-menu">
      {sort.length === 0 ? (
        <p className="view-menu__empty">No sort</p>
      ) : (
        <ul className="view-menu__list">
          {sort.map((s, i) => (
            <li key={i} className="view-rule">
              <div className="view-rule__main">
                <select className="view-select" aria-label="Sort property" value={canonicalKey(s.property)} onChange={(e) => setSort(i, { property: e.target.value })}>
                  {options(s.property)}
                </select>
                <button type="button" className="view-chip" aria-label="Direction" title="Toggle direction" onClick={() => setSort(i, { direction: flip(s.direction) })}>
                  {s.direction === 'DESC' ? 'DESC' : 'ASC'}
                </button>
                <button type="button" className="view-rule__nav" aria-label="Move up" disabled={i === 0} onClick={() => moveSort(i, -1)}>
                  ↑
                </button>
                <button type="button" className="view-rule__nav" aria-label="Move down" disabled={i === sort.length - 1} onClick={() => moveSort(i, 1)}>
                  ↓
                </button>
                <button type="button" className="view-rule__remove" aria-label="Remove sort" title="Remove sort" onClick={() => writeSort(sort.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="view-menu__foot">
        <button type="button" className="view-menu__action" onClick={() => writeSort([...sort, { property: canonicalKey(keys[0] ?? 'file.name'), direction: 'ASC' }])}>
          Add sort
        </button>
      </div>
      <p className="view-menu__label">Group by</p>
      <div className="view-rule__main">
        <select
          className="view-select"
          aria-label="Group by"
          value={groupBy ? canonicalKey(groupBy.property) : ''}
          onChange={(e) => writeGroup(e.target.value ? { property: e.target.value, direction: groupBy?.direction === 'DESC' ? 'DESC' : 'ASC' } : null, thenBy ?? null)}
        >
          <option value="">None</option>
          {options(groupBy?.property)}
        </select>
        {groupBy && (
          <button type="button" className="view-chip" aria-label="Group direction" title="Toggle direction" onClick={() => writeGroup({ property: canonicalKey(groupBy.property), direction: flip(groupBy.direction) }, thenBy ?? null)}>
            {groupBy.direction === 'DESC' ? 'DESC' : 'ASC'}
          </button>
        )}
      </div>
      {groupBy && (
        <div className="view-rule__main">
          <select
            className="view-select"
            aria-label="Then group by"
            value={thenBy ? canonicalKey(thenBy.property) : ''}
            onChange={(e) => writeGroup(groupBy, e.target.value ? { property: e.target.value, direction: thenBy?.direction === 'DESC' ? 'DESC' : 'ASC' } : null)}
          >
            <option value="">None</option>
            {options(thenBy?.property, canonicalKey(groupBy.property))}
          </select>
          {thenBy && (
            <button type="button" className="view-chip" aria-label="Then group direction" title="Toggle direction" onClick={() => writeGroup(groupBy, { property: canonicalKey(thenBy.property), direction: flip(thenBy.direction) })}>
              {thenBy.direction === 'DESC' ? 'DESC' : 'ASC'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
