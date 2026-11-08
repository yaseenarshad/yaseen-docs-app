import { type ReactNode, useCallback, useState } from 'react'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import { type ViewSet, type ViewDef, type Mutate, shownGroupLevels } from '../viewSchema'
import { type EngineError, propertyKeys } from '../engine'
import type { FolderHost } from '../ViewsPane'
import { countRules } from './filterRows'
import { CalendarShowBy } from './CalendarView'
import { ColumnDetail } from './ColumnDetail'
import { canHideColumn, setViewOrder } from './columnOrder'
import { canonicalKey } from './keys'
import { CollapseAllIcon, ExpandAllIcon, FilterIcon, PlusIcon, PropertiesIcon, SearchIcon, SortIcon } from './icons'
import { FilterMenu } from './FilterMenu'
import { Popover } from './Popover'
import { PropertiesMenu } from './PropertiesMenu'
import { SortMenu } from './SortMenu'
import { ViewTabs, type ViewTabsProps } from './ViewTabs'

type Menu = 'filter' | 'sort' | 'properties'

export interface ToolbarProps {
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  /** The engine's `*.filters` errors, shown inside the Filter menu (YAZ-1229). */
  filterErrors: readonly EngineError[]
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
  /** The vault-wide declarations, for the menus' typing ladder. */
  properties?: PropertiesResponse | null
  /**
   * The folder's OUTLINE is showing (YAZ-820, amended YAZ-903): the outline is a free-form
   * DOCUMENT, not rows — it has no columns for the Properties menu to configure and no row values
   * for search to filter, so neither is offered.
   */
  documentView?: boolean
  /** The folder's bundle, for the Properties menu: its declarations, and the door they are written back through (YAZ-895). */
  folder: FolderHost
}

/** `8 items`, or `1 / 8 items` when search or limit reduce what the body shows. */
export const countLabel = (shown: number, total: number): string =>
  shown === total ? `${total} item${total === 1 ? '' : 's'}` : `${shown} / ${total} items`

/** Shared view actions: Sort, Properties, Filter, group collapse, New, Search, count. */
export function Toolbar({ def, view, viewIndex, records, filterErrors, shown, total, search, onSearch, onUpdate, onNew, allGroupKeys, collapsed, onSetAllGroups, tabs, properties = null, documentView = false, folder }: ToolbarProps) {
  const [open, setOpen] = useState<Menu | null>(null)
  /** "Edit option order…" (YAZ-3940): the column the Sort popover shows its column editor on, or null for the menu. */
  const [editing, setEditing] = useState<string | null>(null)
  const close = useCallback(() => {
    setOpen(null)
    setEditing(null)
  }, [])
  // Each grouping LEVEL that shows is one rule in the badge (YAZ-745, S2 YAZ-4531): an empty
  // `groupBy: []`, a level with no property and a level past the third count none.
  // A calendar ignores `groupBy` (YAZ-4540): its levels show nowhere, so they count none.
  const sorts = (view.sort?.length ?? 0) + (view.type === 'calendar' ? 0 : shownGroupLevels(view).length)
  const allCollapsed = allGroupKeys.every((k) => collapsed.includes(k))
  const groupsLabel = allCollapsed ? 'Expand all groups' : 'Collapse all groups'
  /** The view's shown columns, for the column editor's "Hide in this view" (the Properties menu's rule). */
  const shownKeys = () => propertyKeys(def, view, records, Object.keys(folder.settings.columns))

  const button = (menu: Menu, label: string, icon: ReactNode, badge: number, body: ReactNode, extraClass?: string) => (
    <div className="view-toolbar__menu">
      <button
        type="button"
        className={`view-toolbar__btn${badge ? ' view-toolbar__btn--on' : ''}${extraClass ? ` ${extraClass}` : ''}`}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open === menu}
        onClick={() => {
          setOpen(open === menu ? null : menu)
          setEditing(null)
        }}
      >
        {icon}
        {badge > 0 && <span className="view-toolbar__badge">{badge}</span>}
      </button>
      {open === menu && (
        <Popover constrainToViewport label={label} onClose={close} className={`view-popover--${menu}`}>
          {body}
        </Popover>
      )}
    </div>
  )

  return (
    <div className="view-toolbar">
      <ViewTabs {...tabs} />
      <div className="view-toolbar__actions">
        {/* A calendar's "Show by" sits on the toolbar (YAZ-4540 D11), and again in Properties › Calendar. */}
        {view.type === 'calendar' && (
          <label className="view-cal__show-by">
            <span>Show by</span>
            <CalendarShowBy def={def} view={view} viewIndex={viewIndex} records={records} properties={properties} settings={folder.settings} onUpdate={onUpdate} />
          </label>
        )}
        {button('sort', 'Sort', <SortIcon />, sorts, editing === null ? (
          <SortMenu settings={folder.settings} properties={properties} def={def} view={view} viewIndex={viewIndex} records={records} onUpdate={onUpdate} onEditColumn={setEditing} />
        ) : (
          // The Properties menu's column editor, in this popover: ‹ and Esc go back to the menu (YAZ-3940).
          <ColumnDetail key={editing} columnKey={editing} def={def} view={view} viewIndex={viewIndex} records={records} onUpdate={onUpdate} properties={properties} folder={folder}
            shown={shownKeys().some((k) => canonicalKey(k) === editing)}
            canHide={canHideColumn(view, editing)}
            onHide={() => onUpdate((d) => setViewOrder(d, viewIndex, shownKeys().filter((k) => canonicalKey(k) !== editing)))}
            onBack={() => setEditing(null)} onLeave={() => setEditing(null)} />
        ))}
        {!documentView &&
          button(
            'properties',
            'Properties',
            <PropertiesIcon />,
            0,
            <PropertiesMenu def={def} view={view} viewIndex={viewIndex} records={records} onUpdate={onUpdate} properties={properties} folder={folder} />,
          )}
        {/* An outline is a DOCUMENT, not rows (YAZ-903): there is nothing there to filter. */}
        {!documentView &&
          button(
            'filter',
            'Filter',
            <FilterIcon />,
            countRules(view.filters),
            <FilterMenu def={def} view={view} viewIndex={viewIndex} records={records} errors={filterErrors} properties={properties} folder={folder} onUpdate={onUpdate} />,
            filterErrors.length > 0 ? 'view-toolbar__btn--error' : undefined,
          )}
        {allGroupKeys.length > 0 && (
          <button
            type="button"
            className="view-toolbar__btn"
            aria-label={groupsLabel}
            title={groupsLabel}
            onClick={() => onSetAllGroups(allCollapsed ? [] : allGroupKeys)}
          >
            {allCollapsed ? <ExpandAllIcon /> : <CollapseAllIcon />}
          </button>
        )}
        <button type="button" className="view-toolbar__btn view-toolbar__new" aria-label="New note" title="New note" onClick={onNew}>
          <PlusIcon />
          New
        </button>
        {/* An outline is a DOCUMENT, not rows (YAZ-903): search has nothing to filter there. */}
        {!documentView && (
        <div className="view-toolbar__search">
          <button
            type="button"
            className={`view-toolbar__btn${search !== null ? ' view-toolbar__btn--on' : ''}`}
            aria-label="Search"
            title="Search"
            aria-expanded={search !== null}
            onClick={() => onSearch(search === null ? '' : null)}
          >
            <SearchIcon />
          </button>
          {search !== null && (
            <input
              className="view-input view-toolbar__search-input"
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
        )}
        <span className="view-toolbar__count" aria-live="polite">
          {countLabel(shown, total)}
        </span>
      </div>
    </div>
  )
}
