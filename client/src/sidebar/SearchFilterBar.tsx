/**
 * The bar under the search box while a filter is on (YAZ-3511 D24): a funnel, then each filter that is on as a chip whose
 * ✕ takes it off, and with two on, "Clear". The lit sort button alone was too quiet (Yaseen, demo). With no filter it is
 * not drawn, so a search with none takes no more height. A press takes no focus: the caret stays in the search box.
 */
import { filterChips, NO_FILTER, type SearchFilter } from '../search/searchFilter'

const FunnelIcon = () => (
  <svg className="sidebar__filters-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
    <path d="M2 3h12l-4.5 5.5V13l-3 1.5v-6z" />
  </svg>
)

export function SearchFilterBar({ filter, onFilter }: { filter: SearchFilter; onFilter: (next: SearchFilter) => void }) {
  const chips = filterChips(filter)
  if (chips.length === 0) return null
  const keepCaret = (e: { preventDefault: () => void }) => e.preventDefault()
  return (
    <div className="sidebar__filters" role="group" aria-label="Filters on">
      <FunnelIcon />
      {chips.map((chip) => (
        <button key={chip.key} type="button" className="sidebar__filter-chip" title={`Remove the ${chip.label} filter`} aria-label={`Remove the ${chip.label} filter`} onMouseDown={keepCaret} onClick={() => onFilter({ ...filter, [chip.key]: NO_FILTER[chip.key] })}>
          {chip.icon}
          {chip.label}
          <span className="sidebar__filter-x" aria-hidden />
        </button>
      ))}
      {chips.length > 1 && (
        <button type="button" className="sidebar__filter-clear" onMouseDown={keepCaret} onClick={() => onFilter(NO_FILTER)}>
          Clear
        </button>
      )}
    </div>
  )
}
