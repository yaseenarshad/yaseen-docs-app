import type { IndexRecord } from '@shared/types'
import type { ViewSet, ViewDef, Mutate, SortSpec } from '../viewSchema'
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
  const groupBy = view.groupBy

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
  const writeGroup = (property: string, direction: 'ASC' | 'DESC') =>
    onUpdate((d) => {
      if (property) d.views[viewIndex].groupBy = { property, direction }
      else delete d.views[viewIndex].groupBy
    })

  const options = (current: string | undefined) =>
    (current ? withKey(keys, current) : keys).map((k) => (
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
        <select className="view-select" aria-label="Group by" value={groupBy ? canonicalKey(groupBy.property) : ''} onChange={(e) => writeGroup(e.target.value, groupBy?.direction === 'DESC' ? 'DESC' : 'ASC')}>
          <option value="">None</option>
          {options(groupBy?.property)}
        </select>
        {groupBy && (
          <button type="button" className="view-chip" aria-label="Group direction" title="Toggle direction" onClick={() => writeGroup(canonicalKey(groupBy.property), flip(groupBy.direction))}>
            {groupBy.direction === 'DESC' ? 'DESC' : 'ASC'}
          </button>
        )}
      </div>
    </div>
  )
}
