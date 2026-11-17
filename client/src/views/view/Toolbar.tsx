import { type ReactNode, useCallback, useContext, useState, useSyncExternalStore } from 'react'
import { useUnit } from '../../vault/unitWord'
import { ContextMenuSurface } from '../../components/ContextMenuSurface'
import { GroupLevelStepsContext } from '../groupLevelSteps'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import { type ViewSet, type ViewDef, type Mutate, shownGroupLevels } from '../viewSchema'
import { type EngineError, propertyKeys, propertyLabel } from '../engine'
import { pageColumnKeys } from '../folderSettings'
import type { FolderHost } from '../ViewsPane'
import { countRules } from './filterRows'
import { ColumnDetail } from './ColumnDetail'
import { canHideColumn, setViewOrder } from './columnOrder'
import { cardRowsOf } from '../cardRows'
import { canonicalKey } from './keys'
import { CollapseAllIcon, ExpandAllIcon, FilterIcon, PlusIcon, PropertiesIcon, SearchIcon, SortIcon } from './icons'
import { FilterMenu } from './FilterMenu'
import { Popover } from './Popover'
import { PropertiesMenu, rememberPropertiesTab } from './PropertiesMenu'
import { SortMenu } from './SortMenu'
import { ViewTabs, type ViewTabsProps } from './ViewTabs'
import { FolderPageChips } from '../FolderToolbar'
import { PageSettings } from '../../editor/PageSettings'

type Menu = 'filter' | 'sort' | 'properties'

/** No date columns: a view that is not a calendar. */
const NO_COLUMNS: readonly string[] = []

/** The Page tab's settings button (YAZ-3746 13BM PS1): the other views' sliders, with their look, over the text switches. */
const PAGE_TAB_TRIGGER = { icon: <PropertiesIcon />, className: 'view-toolbar__btn', label: 'Page settings', heading: 'Page' }
const NO_SUBSCRIBE = () => () => {}

export interface ToolbarProps {
  /** A status at the start of the actions: Confirm changes' "Not asking · 4:32 · Resume" (YAZ-3746 13AN). */
  notice?: ReactNode
  /** A calendar's date columns for the View tab's "Show by" (`dateColumns`, once in `ViewsPane`, YAZ-4544). */
  dateColumns?: readonly string[]
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  /** The engine's `*.filters` errors, shown inside the Filter menu (YAZ-1229). */
  filterErrors: readonly EngineError[]
  /** Rows in the body after search / limit, and the pre-limit total. */
  shown: number
  total: number
  /** The subfolder rows among `shown` and `total` (YAZ-4595 S36), while the view shows folder rows; absent = none show. */
  folders?: { shown: number; total: number }
  /** null while the search box is closed. */
  search: string | null
  onSearch: (next: string | null) => void
  onUpdate: Mutate
  /** Create a page satisfying this view and open it (5D, GRO-2144). Absent: no + New (13BL, "Show New buttons" off). */
  onNew?: () => void
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
  /** The app tab that shows this folder page: the key of the Properties popover's remembered tab (YAZ-4607 D59). Absent in the right panel. */
  tabId?: string
  /** The column menu's "Open the filter panel…" asks (YAZ-4919): each count up opens the Filter popover. */
  filterAsks?: number
}

/** `8 items`, or `1 / 8 items` when search or limit reduce what the body shows. */
export const countLabel = (shown: number, total: number, noun = 'item'): string =>
  shown === total ? `${total} ${noun}${total === 1 ? '' : 's'}` : `${shown} / ${total} ${noun}s`

/** The toolbar count: with folder rows (YAZ-4595 S36) the pages as items, then the folders, as `3 items · 2 folders`. */
export const rowsLabel = (shown: number, total: number, folders?: { shown: number; total: number }): string =>
  folders === undefined
    ? countLabel(shown, total)
    : `${countLabel(shown - folders.shown, total - folders.total)} · ${countLabel(folders.shown, folders.total, 'folder')}`

/** Shared view actions: Sort, Properties, Filter, group collapse, New, Search, count. */
export function Toolbar({ def, view, viewIndex, records, filterErrors, shown, total, folders, search, onSearch, onUpdate, onNew, allGroupKeys, collapsed, onSetAllGroups, tabs, properties = null, documentView = false, folder, dateColumns = NO_COLUMNS, tabId, notice, filterAsks = 0 }: ToolbarProps) {
  const unit = useUnit()
  const [open, setOpen] = useState<Menu | null>(null)
  // A new ask from the column menu (YAZ-4919) opens the Filter popover: state set from a prop in render, no effect.
  const [seenFilterAsks, setSeenFilterAsks] = useState(filterAsks)
  if (filterAsks !== seenFilterAsks) {
    setSeenFilterAsks(filterAsks)
    setOpen('filter')
  }
  /** The Page tab's text switches, which it hands the folder page while it shows (YAZ-4584 D38); null on every other view. */
  const chips = useContext(FolderPageChips)
  const pageCog = useSyncExternalStore(chips?.subscribe ?? NO_SUBSCRIBE, () => (documentView ? chips?.getState().page?.cog ?? null : null))
  /** The ⌃'s right-click (YAZ-3746 13AT): one level at a time, beside all; its click still collapses or expands all. */
  const levels = useContext(GroupLevelStepsContext)
  const [foldMenu, setFoldMenu] = useState<{ x: number; y: number } | null>(null)
  /** "Edit option order…" (YAZ-3940): the column the Sort popover shows its column editor on, or null for the menu. */
  const [editing, setEditing] = useState<string | null>(null)
  /**
   * "View settings…" asks (YAZ-4585 D34, YAZ-4607 D59): how many times since the Properties popover last opened or
   * closed by its button. Above 0 the menu starts on View, and each ask remounts it (its `key`), so an ask while the
   * popover is open on Columns switches it too. The toolbar's own state: the table does not re-render.
   */
  const [viewAsks, setViewAsks] = useState(0)
  const close = useCallback(() => {
    setOpen(null)
    setEditing(null)
    setViewAsks(0)
  }, [])
  // Each grouping LEVEL that shows is one rule in the badge (YAZ-745, S2 YAZ-4531): an empty
  // `groupBy: []`, a level with no property and a level past the third count none.
  // A calendar ignores `groupBy` (YAZ-4540): its levels show nowhere, so they count none.
  const sorts = (view.sort?.length ?? 0) + (view.type === 'calendar' ? 0 : shownGroupLevels(view).length)
  const allCollapsed = allGroupKeys.every((k) => collapsed.includes(k))
  const foldItem = (label: string, icon: ReactNode, run: (() => void) | undefined) => (
    <button
      type="button"
      className="ctx-menu__item"
      role="menuitem"
      disabled={run === undefined}
      onClick={() => {
        setFoldMenu(null)
        run?.()
      }}
    >
      <span className="ctx-menu__label">
        {icon}
        {label}
      </span>
    </button>
  )
  const groupsLabel = allCollapsed ? 'Expand all groups' : 'Collapse all groups'
  /** The view's shown columns, for the column editor's "Hide in this view" (the Properties menu's rule). */
  const shownKeys = () => propertyKeys(def, view, records, pageColumnKeys(folder.settings))

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
          setViewAsks(0)
        }}
      >
        {icon}
        {badge > 0 && <span className="view-toolbar__badge">{badge}</span>}
      </button>
      {open === menu && (
        <Popover constrainToViewport focusOn="field" label={label} onClose={close} className={`view-popover--${menu}`}>
          {body}
        </Popover>
      )}
    </div>
  )

  return (
    <div className="view-toolbar">
      {/* "View settings…" (YAZ-4585): that view becomes active, and its Properties menu opens on View (D59), which is then the remembered tab. */}
      <ViewTabs
        {...tabs}
        onSettings={(i) => {
          tabs.onSelect(i)
          rememberPropertiesTab(tabId, 'view')
          setViewAsks((n) => n + 1)
          setOpen('properties')
          setEditing(null)
        }}
      />
      <div className="view-toolbar__actions">
        {notice}
        {/* The Page tab's own settings (YAZ-3746 13BM PS1): its text switches, which the folder ⚙ held before. */}
        {pageCog !== null && <PageSettings {...pageCog} trigger={PAGE_TAB_TRIGGER} />}
        {button('sort', 'Sort', <SortIcon />, sorts, editing === null ? (
          <SortMenu settings={folder.settings} properties={properties} def={def} view={view} viewIndex={viewIndex} records={records} onUpdate={onUpdate} onEditColumn={setEditing} />
        ) : (
          // The Properties menu's column editor, in this popover: ‹ and Esc go back to the menu (YAZ-3940).
          <ColumnDetail key={editing} columnKey={editing} def={def} view={view} viewIndex={viewIndex} records={records} onUpdate={onUpdate} properties={properties} folder={folder}
            shown={shownKeys().some((k) => canonicalKey(k) === editing)}
            canHide={canHideColumn(view, editing)}
            onHide={() => onUpdate((d) => setViewOrder(d, viewIndex, shownKeys().filter((k) => canonicalKey(k) !== editing)), `Hid ${propertyLabel(def, editing)}`)}
            onBack={() => setEditing(null)} onLeave={() => setEditing(null)} />
        ))}
        {!documentView &&
          button(
            'properties',
            // "Columns and view" (YAZ-4608 C1): the popover's two tabs, not "Properties".
            'Columns and view',
            <PropertiesIcon />,
            0,
            <PropertiesMenu key={viewAsks} def={def} view={view} viewIndex={viewIndex} records={records} onUpdate={onUpdate} properties={properties} folder={folder} tabId={tabId} startTab={viewAsks > 0 ? 'view' : undefined} dateColumns={dateColumns} />,
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
            title={levels === null ? groupsLabel : `${groupsLabel} · right-click: one level at a time`}
            onClick={() => onSetAllGroups(allCollapsed ? [] : allGroupKeys)}
            onContextMenu={(e) => {
              e.preventDefault()
              setFoldMenu({ x: e.clientX, y: e.clientY })
            }}
          >
            {allCollapsed ? <ExpandAllIcon /> : <CollapseAllIcon />}
          </button>
        )}
        {foldMenu !== null && (
          <ContextMenuSurface x={foldMenu.x} y={foldMenu.y} onClose={() => setFoldMenu(null)}>
            {levels !== null && (
              <div className="ctx-menu__group" role="group">
                {foldItem('Collapse one level', <CollapseAllIcon />, levels.collapseOne)}
                {foldItem('Expand one level', <ExpandAllIcon />, levels.expandOne)}
              </div>
            )}
            <div className="ctx-menu__group" role="group">
              {foldItem('Collapse all groups', <CollapseAllIcon />, allCollapsed ? undefined : () => onSetAllGroups(allGroupKeys))}
              {foldItem('Expand all groups', <ExpandAllIcon />, collapsed.length === 0 ? undefined : () => onSetAllGroups([]))}
            </div>
          </ContextMenuSurface>
        )}
        {onNew !== undefined && (
          <button type="button" className="view-toolbar__btn view-toolbar__new" aria-label={unit('New page')} title={unit('New page')} onClick={onNew}>
            <PlusIcon />
            New
          </button>
        )}
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
          {/* A view listing cards (YAZ-5319) counts cards. */}
          {cardRowsOf(view) ? countLabel(shown, total, 'card') : rowsLabel(shown, total, folders)}
        </span>
      </div>
    </div>
  )
}
