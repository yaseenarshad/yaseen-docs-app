import { useMemo, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import { type BaseDefinition, type ParsedBase, parseBase, serializeBase, updateBase } from './baseFile'
import { propertyKeys, runView } from './engine'
import { render } from './expr'
import { canonicalKey } from './view/filterRows'
import { Toolbar } from './view/Toolbar'

export interface BaseViewProps {
  parsed: ParsedBase
  /** Every config change arrives here as `updateBase(parsed, …)`; BaseHost turns it into autosave. */
  onChange: (next: ParsedBase) => void
  /** Absolute path of the open `.base`, for `this.file` in filters/formulas; null when unknown. */
  thisFile: string | null
  /** The vault index the views query; `[]` until `indexStatus` is ready (fed by `useIndex`, GRO-2129). */
  records: IndexRecord[]
  indexStatus: 'pending' | 'ready' | 'error'
  /** The fetch failure shown when `indexStatus` is 'error'. */
  indexError?: string
  onOpenFile: (path: string) => void
}

/**
 * One `.base` in the main pane (GRO-2135): the toolbar (view switcher, filter / sort /
 * properties menus, search, count) over a placeholder row list that proves the chain
 * toolbar → `updateBase` → `runView`; 4B replaces the list with the table. Only the active
 * tab and the search text are component state — everything else is the file.
 */
export function BaseView({ parsed, onChange, thisFile, records, indexStatus, indexError, onOpenFile }: BaseViewProps) {
  const [active, setActive] = useState(0)
  const [search, setSearch] = useState<string | null>(null)
  const { def } = parsed
  const views = def.views
  const index = Math.max(0, Math.min(active, views.length - 1))
  const view = views[index]
  // Re-parse after every edit: `doc.setIn` stores plain JS values, so a second edit inside a
  // collection a previous edit created would throw ("Expected YAML collection"). The round trip
  // through text keeps comments and rebuilds proper nodes.
  const update = (mutate: (def: BaseDefinition) => void) => onChange(parseBase(serializeBase(updateBase(parsed, mutate))))

  const result = useMemo(() => (view ? runView(def, view, records, { thisFile }) : null), [def, view, records, thisFile])

  if (view === undefined || result === null) {
    return (
      <div className="base-view">
        <p className="base-view__pending">
          This base has no views.{' '}
          <button type="button" className="base-menu__action" onClick={() => update((d) => d.views.push({ type: 'table', name: 'Table 1' }))}>
            Add view
          </button>
        </p>
      </div>
    )
  }

  const needle = (search ?? '').trim().toLowerCase()
  const rows = needle
    ? result.rows.filter((r) => Object.values(r.values).some((v) => render(v).toLowerCase().includes(needle)))
    : result.rows
  const keys = propertyKeys(def, view, records)
  const nameKey = keys.find((k) => canonicalKey(k) === 'file.name')
  const rest = keys.filter((k) => k !== nameKey)

  const tabs = {
    views,
    active: index,
    onSelect: setActive,
    onAdd: () => {
      update((d) => d.views.push({ type: 'table', name: `Table ${d.views.length + 1}` }))
      setActive(views.length)
    },
    onRename: (i: number, name: string) =>
      update((d) => {
        d.views[i].name = name
      }),
    onDuplicate: (i: number) => {
      update((d) => d.views.splice(i + 1, 0, { ...structuredClone(d.views[i]), name: `${d.views[i].name} copy` }))
      setActive(i + 1)
    },
    onDelete: (i: number) => {
      if (views.length <= 1) return
      update((d) => d.views.splice(i, 1))
      setActive(Math.min(i, views.length - 2))
    },
    onMove: (i: number, dir: -1 | 1) => {
      const j = i + dir
      if (j < 0 || j >= views.length) return
      update((d) => {
        const [v] = d.views.splice(i, 1)
        d.views.splice(j, 0, v)
      })
      setActive(j)
    },
  }

  return (
    <div className="base-view">
      <Toolbar
        def={def}
        view={view}
        viewIndex={index}
        records={records}
        errors={result.errors}
        shown={rows.length}
        total={result.total}
        search={search}
        onSearch={setSearch}
        onUpdate={update}
        tabs={tabs}
      />
      {indexStatus === 'pending' ? (
        <p className="base-view__pending">Loading the vault index…</p>
      ) : indexStatus === 'error' ? (
        <p className="base-view__error" role="alert">
          Could not load the vault index: {indexError}
        </p>
      ) : (
        <ul className="base-rows">
          {rows.map((row) => (
            <li key={row.record.path} className="base-row">
              <button type="button" className="base-row__link" onClick={() => onOpenFile(row.record.path)}>
                {nameKey === undefined ? row.record.name : render(row.values[nameKey])}
              </button>
              {rest.length > 0 && <span className="base-row__values">{rest.map((k) => render(row.values[k])).join(' · ')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
