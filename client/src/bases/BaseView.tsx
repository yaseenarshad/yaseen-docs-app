import { useState } from 'react'
import type { FilterNode, ParsedBase } from './baseFile'

export interface BaseViewProps {
  parsed: ParsedBase
  /** Called with the edited definition; unused until the views become editable (GRO-2136+). */
  onChange: (next: ParsedBase) => void
  /** Absolute path of the open `.base`, for `this.file` in filters/formulas later; null when unknown. */
  thisFile: string | null
}

/** Leaf expressions in a filter tree (each `and`/`or`/`not` branch counts its children). */
function countFilters(node: FilterNode | undefined): number {
  if (node === undefined) return 0
  if (typeof node === 'string') return 1
  const branch = 'and' in node ? node.and : 'or' in node ? node.or : node.not
  return branch.reduce((n, child) => n + countFilters(child), 0)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * 1C placeholder (GRO-2125): the view tabs plus a one-line summary of the active
 * view. View-only state (active tab) — nothing here writes to the file yet.
 */
export function BaseView({ parsed }: BaseViewProps) {
  const [active, setActive] = useState(0)
  const views = parsed.def.views
  const view = views[active] ?? views[0]
  const filters = countFilters(parsed.def.filters) + countFilters(view?.filters)
  const type = view === undefined ? 'Base' : view.type.charAt(0).toUpperCase() + view.type.slice(1)
  return (
    <div className="base-view">
      <div className="base-view__tabs" role="tablist">
        {views.map((v, i) => (
          <button
            key={`${i}-${v.name}`}
            type="button"
            role="tab"
            className="base-view__tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
          >
            {v.name}
          </button>
        ))}
      </div>
      <p className="base-view__placeholder">
        {type} · {plural(views.length, 'view')} · {plural(filters, 'filter')}
        <br />
        Views render in GRO-2136+
      </p>
    </div>
  )
}
