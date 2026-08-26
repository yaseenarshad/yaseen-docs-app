import { type ReactNode, useCallback, useState } from 'react'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import type { ViewSet, ViewDef, Mutate } from '../viewSchema'
import type { FolderPageMode } from '../ViewsPane'
import { ChevronsIcon, PlusIcon, PropertiesIcon, SearchIcon, SortIcon } from './icons'
import { Popover } from './Popover'
import { PropertiesMenu } from './PropertiesMenu'
import { SortMenu } from './SortMenu'
import { ViewTabs, type ViewTabsProps } from './ViewTabs'

type Menu = 'sort' | 'properties'

export interface ToolbarProps {
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
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
  /** Relation columns (5E, GRO-2217): the vault root and the vault-wide declarations, for the Properties menu. */
  root?: string | null
  properties?: PropertiesResponse | null
  /**
   * The folder page's OUTLINE is showing (YAZ-820): that view's `order` is the [D5] member
   * sequence, not a column list, and every Properties gesture rewrites `view.order` — so the menu
   * is not offered rather than being allowed to overwrite the locked ordering. An outline has no
   * columns to configure either way.
   */
  noProperties?: boolean
  /** The folder page bundle, for the Properties menu: its declarations, and the door they are written back through (YAZ-895). */
  folderPage: FolderPageMode
}

/** `8 items`, or `1 / 8 items` when search or limit reduce what the body shows. */
export const countLabel = (shown: number, total: number): string =>
  shown === total ? `${total} item${total === 1 ? '' : 's'}` : `${shown} / ${total} items`

/**
 * View chrome (GRO-2135): tabs on the left; Sort / Properties / Search buttons and the count on
 * the right. TOMBSTONE (YAZ-846): there was a **Filter** button first among them, opening
 * `view/FilterMenu.tsx`. The only surface that mounts these views is a folder page's contents
 * block, whose set IS the lookup and stores no filters (🔒 Q3) — so the button was never
 * rendered, and it and its menu are gone rather than permanently hidden.
 */
export function Toolbar({ def, view, viewIndex, records, shown, total, search, onSearch, onUpdate, onNew, allGroupKeys, collapsed, onSetAllGroups, tabs, root = null, properties = null, noProperties = false, folderPage }: ToolbarProps) {
  const [open, setOpen] = useState<Menu | null>(null)
  const close = useCallback(() => setOpen(null), [])
  const sorts = (view.sort?.length ?? 0) + (view.groupBy ? 1 : 0)
  const allCollapsed = allGroupKeys.every((k) => collapsed.includes(k))
  const groupsLabel = allCollapsed ? 'Expand all groups' : 'Collapse all groups'

  const button = (menu: Menu, label: string, icon: ReactNode, badge: number, body: ReactNode) => (
    <div className="view-toolbar__menu">
      <button
        type="button"
        className={`view-toolbar__btn${badge ? ' view-toolbar__btn--on' : ''}`}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open === menu}
        onClick={() => setOpen(open === menu ? null : menu)}
      >
        {icon}
        {badge > 0 && <span className="view-toolbar__badge">{badge}</span>}
      </button>
      {open === menu && (
        <Popover label={label} onClose={close}>
          {body}
        </Popover>
      )}
    </div>
  )

  return (
    <div className="view-toolbar">
      <ViewTabs {...tabs} />
      <div className="view-toolbar__actions">
        <button type="button" className="view-toolbar__btn view-toolbar__new" aria-label="New note" title="New note" onClick={onNew}>
          <PlusIcon />
          New
        </button>
        {button('sort', 'Sort', <SortIcon />, sorts, <SortMenu def={def} view={view} viewIndex={viewIndex} records={records} onUpdate={onUpdate} />)}
        {allGroupKeys.length > 0 && (
          <button
            type="button"
            className="view-toolbar__btn"
            aria-label={groupsLabel}
            title={groupsLabel}
            onClick={() => onSetAllGroups(allCollapsed ? [] : allGroupKeys)}
          >
            <ChevronsIcon />
          </button>
        )}
        {!noProperties &&
          button(
            'properties',
            'Properties',
            <PropertiesIcon />,
            0,
            <PropertiesMenu def={def} view={view} viewIndex={viewIndex} records={records} onUpdate={onUpdate} root={root} properties={properties} folderPage={folderPage} />,
          )}
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
        <span className="view-toolbar__count" aria-live="polite">
          {countLabel(shown, total)}
        </span>
      </div>
    </div>
  )
}
