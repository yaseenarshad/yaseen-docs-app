import { type ReactNode, useCallback, useState } from 'react'
import type { IndexRecord, RegistryResponse } from '@shared/types'
import type { BaseDefinition, BaseView } from '../baseFile'
import type { EngineError } from '../engine'
import { FilterMenu, type Mutate } from './FilterMenu'
import { countRules } from './filterRows'
import { ChevronsIcon, FilterIcon, PlusIcon, PropertiesIcon, SearchIcon, SortIcon } from './icons'
import { Popover } from './Popover'
import { PropertiesMenu } from './PropertiesMenu'
import { SortMenu } from './SortMenu'
import { ViewTabs, type ViewTabsProps } from './ViewTabs'

type Menu = 'filter' | 'sort' | 'properties'

export interface ToolbarProps {
  def: BaseDefinition
  view: BaseView
  viewIndex: number
  records: readonly IndexRecord[]
  errors: readonly EngineError[]
  /** Rows in the body after search / limit, and the pre-limit total. */
  shown: number
  total: number
  /** null while the search box is closed. */
  search: string | null
  onSearch: (next: string | null) => void
  onUpdate: Mutate
  /** Create a note satisfying this view and open it (5D, GRO-2144). */
  onNew: () => void
  /** Every group key of the view, and the collapsed subset — the collapse / expand all toggle (YAZ-744); empty when the view is not grouped. */
  allGroupKeys: readonly string[]
  collapsed: readonly string[]
  onSetAllGroups: (next: readonly string[]) => void
  tabs: ViewTabsProps
  /** Relation columns (5E, GRO-2217): the vault root and the registry, for the Properties menu. */
  root?: string | null
  registry?: RegistryResponse | null
}

/** `8 items`, or `1 / 8 items` when search or limit reduce what the body shows. */
export const countLabel = (shown: number, total: number): string =>
  shown === total ? `${total} item${total === 1 ? '' : 's'}` : `${shown} / ${total} items`

/** View chrome (GRO-2135): tabs on the left; Filter / Sort / Properties / Search buttons and the count on the right. */
export function Toolbar({ def, view, viewIndex, records, errors, shown, total, search, onSearch, onUpdate, onNew, allGroupKeys, collapsed, onSetAllGroups, tabs, root = null, registry = null }: ToolbarProps) {
  const [open, setOpen] = useState<Menu | null>(null)
  const close = useCallback(() => setOpen(null), [])
  const filters = countRules(def.filters) + countRules(view.filters)
  const sorts = (view.sort?.length ?? 0) + (view.groupBy ? 1 : 0)
  const allCollapsed = allGroupKeys.every((k) => collapsed.includes(k))
  const groupsLabel = allCollapsed ? 'Expand all groups' : 'Collapse all groups'

  const button = (menu: Menu, label: string, icon: ReactNode, badge: number, body: ReactNode, error = 0) => (
    <div className="base-toolbar__menu">
      <button
        type="button"
        className={`base-toolbar__btn${badge || error ? ' base-toolbar__btn--on' : ''}`}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open === menu}
        onClick={() => setOpen(open === menu ? null : menu)}
      >
        {icon}
        {badge > 0 && <span className="base-toolbar__badge">{badge}</span>}
        {error > 0 && <span className="base-toolbar__badge base-toolbar__badge--error">{error}</span>}
      </button>
      {open === menu && (
        <Popover label={label} onClose={close}>
          {body}
        </Popover>
      )}
    </div>
  )

  return (
    <div className="base-toolbar">
      <ViewTabs {...tabs} />
      <div className="base-toolbar__actions">
        <button type="button" className="base-toolbar__btn base-toolbar__new" aria-label="New note" title="New note" onClick={onNew}>
          <PlusIcon />
          New
        </button>
        {button(
          'filter',
          'Filter',
          <FilterIcon />,
          filters,
          <FilterMenu def={def} view={view} viewIndex={viewIndex} records={records} errors={errors} onUpdate={onUpdate} />,
          errors.length,
        )}
        {button('sort', 'Sort', <SortIcon />, sorts, <SortMenu def={def} view={view} viewIndex={viewIndex} records={records} onUpdate={onUpdate} />)}
        {allGroupKeys.length > 0 && (
          <button
            type="button"
            className="base-toolbar__btn"
            aria-label={groupsLabel}
            title={groupsLabel}
            onClick={() => onSetAllGroups(allCollapsed ? [] : allGroupKeys)}
          >
            <ChevronsIcon />
          </button>
        )}
        {button(
          'properties',
          'Properties',
          <PropertiesIcon />,
          0,
          <PropertiesMenu def={def} view={view} viewIndex={viewIndex} records={records} onUpdate={onUpdate} root={root} registry={registry} />,
        )}
        <div className="base-toolbar__search">
          <button
            type="button"
            className={`base-toolbar__btn${search !== null ? ' base-toolbar__btn--on' : ''}`}
            aria-label="Search"
            title="Search"
            aria-expanded={search !== null}
            onClick={() => onSearch(search === null ? '' : null)}
          >
            <SearchIcon />
          </button>
          {search !== null && (
            <input
              className="base-input base-toolbar__search-input"
              type="search"
              aria-label="Search rows"
              placeholder="Search…"
              autoFocus
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  onSearch(null)
                }
              }}
            />
          )}
        </div>
        <span className="base-toolbar__count" aria-live="polite">
          {countLabel(shown, total)}
        </span>
      </div>
    </div>
  )
}
