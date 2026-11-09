import { PROPERTY_LABELS, PropertyTypeIcon } from './PropertyDefinitionEditor'
import { ColumnSearch, matchesColumn } from './ColumnSearch'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveGapReorder } from '../../lib/useLiveGapReorder'
import type { IndexRecord, PropertiesResponse, PropertyKind } from '@shared/types'
import type { ViewSet, ViewDef, Mutate } from '../viewSchema'
import type { FolderHost } from '../ViewsPane'
import { propertyKeys, propertyLabel } from '../engine'
import { canonicalKey } from './keys'
import { AddColumn } from './AddColumn'
import { canHideColumn, setViewOrder, withOrder } from './columnOrder'
import { reservedKeys } from '../../links/reservedKeys'
import { ColumnDetail, columnKind } from './ColumnDetail'
import { DragHandleIcon, FileFieldIcon, FormulaIcon } from './icons'
import { allPropertyKeys } from './properties'
import { ViewSettings } from './ViewSettings'

export { normalizeBoardWidth } from './ViewSettings'

/** The popover's two tabs (YAZ-4607, D59). */
export type PropertiesTab = 'columns' | 'view'
const TABS: readonly (readonly [PropertiesTab, string])[] = [
  ['columns', 'Columns'],
  ['view', 'View'],
]

/**
 * The tab each APP tab's popover opens on (D59: "the tab used last"): the module's memory, keyed by the app tab, so a
 * tab that slept and woke (a new React tree) keeps it. Capped: past `MAX_REMEMBERED_TABS` the oldest entry goes.
 * No app tab (the right panel): nothing is remembered, and the popover opens on Columns.
 */
const lastTabs = new Map<string, PropertiesTab>()
const MAX_REMEMBERED_TABS = 200
export function rememberPropertiesTab(tabId: string | undefined, tab: PropertiesTab): void {
  if (tabId === undefined) return
  lastTabs.delete(tabId)
  lastTabs.set(tabId, tab)
  if (lastTabs.size > MAX_REMEMBERED_TABS) lastTabs.delete(lastTabs.keys().next().value as string)
}
const lastPropertiesTab = (tabId: string | undefined): PropertiesTab => (tabId === undefined ? undefined : lastTabs.get(tabId)) ?? 'columns'

export interface PropertiesMenuProps {
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  onUpdate: Mutate
  /** Legacy vault declarations, used only as read fallbacks. */
  properties?: PropertiesResponse | null
  /** The folder's own declarations (the ladder's TOP rung) and `setColumns`, the door they go back through (YAZ-895). */
  folder: FolderHost
  /** The app tab that shows this folder page: the key of the remembered tab (D59). Absent in the right panel. */
  tabId?: string
  /** The tab to open on, over the remembered one: "View settings…" asks for View (YAZ-4585 D34, D59). */
  startTab?: PropertiesTab
  /** A calendar's date columns for the View tab's "Show by" (`dateColumns`, once in `ViewsPane`, YAZ-4544). */
  dateColumns?: readonly string[]
}

/**
 * Properties menu (GRO-2135), TWO TABS since YAZ-4607 (D59) over the two levels of YAZ-1513 (Notion's shape):
 *
 *  COLUMNS — two sections, Shown and Hidden, each with its count and (Table, Board) Hide all / Show all. One line per
 *  column: grip (YAZ-1207, shown rows only, on hover) · the column's KIND glyph · its label · its type in grey · a `›`
 *  on hover — the whole label area opens the column — then the show switch (writes `view.order`; Table and Board may
 *  hide `file.name`, Cards and List keep it). "New column" closes the list (YAZ-3746 demo polish).
 *
 *  VIEW — how this view looks (`ViewSettings`): the settings that sat below the list, by section, only those the
 *  view's type reads, each Settings default with "from Settings" and Reset (D34). Group indent and Subfolders moved
 *  here from the ⇅ popover (D60).
 *
 *  The popover opens on the tab used last in this app tab (`rememberPropertiesTab`), or on View for "View settings…".
 *
 *  DETAIL — ONE panel, ONE exit (3D, Yasin's ruling): `ColumnDetail` (YAZ-4533), the same editor
 *  the table header's "Edit column…" opens, in place of both tabs. Hide in this view (= unchecking) and Delete
 *  column… return to Columns; there is no third level and no Save/Cancel; Esc or `‹` returns to the list.
 */
const NO_DATE_COLUMNS: readonly string[] = []

export function PropertiesMenu({ def, view, viewIndex, records, onUpdate, properties = null, folder, tabId, startTab, dateColumns = NO_DATE_COLUMNS }: PropertiesMenuProps) {
  const [tab, setTab] = useState<PropertiesTab>(() => startTab ?? lastPropertiesTab(tabId))
  const [query, setQuery] = useState('')
  /** The DETAIL level (YAZ-1513): the open column's key, or null for the list. Its editor is `ColumnDetail` (YAZ-4533). */
  const [detail, setDetail] = useState<string | null>(null)
  /** Settings › Folder pages (YAZ-4585): `view` has them filled in; `own` is the view as written, for "from Settings". */
  const own = def.views[viewIndex] ?? view
  const shown = propertyKeys(def, view, records, Object.keys(folder.settings.columns))
  const keys = allPropertyKeys(def, view, records, folder.settings.columns)
  const filtering = query.trim() !== ''
  const matches = keys.filter(key => matchesColumn(query, propertyLabel(def, key), key))
  const matchingKeys = new Set(matches.map(canonicalKey))
  const isShown = (key: string) => shown.some((k) => canonicalKey(k) === canonicalKey(key))
  const canToggle = (key: string) => canHideColumn(view, key)

  const pickTab = (next: PropertiesTab) => {
    setTab(next)
    rememberPropertiesTab(tabId, next)
  }
  const openDetail = (key: string) => setDetail(key)
  /** ONE order write, `frozenColumns` following positionally — the shared rule (`columnOrder.ts`). */
  const writeOrder = (order: string[], undo?: string) => onUpdate((d) => setViewOrder(d, viewIndex, order), undo)
  // A hide offers Undo (YAZ-4594 S29); a show does not.
  const toggle = (key: string) =>
    isShown(key) ? writeOrder(shown.filter((k) => canonicalKey(k) !== canonicalKey(key)), `Hid ${propertyLabel(def, key)}`) : writeOrder([...shown, key])
  /**
   * Reorder (YAZ-1207), TabBar's move rule (GRO-2235): the slot is an index in the WITH-dragged-row
   * list, so past the grab point it shifts one left. ONE `writeOrder` — never a bypass, it is what
   * keeps `frozenColumns` following positionally.
   */
  const move = (from: number, insertion: number) => {
    const to = insertion > from ? insertion - 1 : insertion
    if (to === from) return
    const next = [...shown]
    const [key] = next.splice(from, 1)
    next.splice(to, 0, key)
    writeOrder(next)
  }
  // The tab bar's drag, down the list (YAZ-4606 D58): the shown rows part live; the slot is read from their layout places.
  // The hidden rows below them are no items, so a drag over them is the end slot.
  const live = useLiveGapReorder<HTMLUListElement>({ axis: 'y', keys: shown, onMove: (from, to) => move(from, to > from ? to + 1 : to) })
  /** The kinds the list glyphs show, remembered per canonical key for as long as their inputs stand (YAZ-1549) — no row rescan per render. */
  const kinds = useMemo(() => new Map<string, PropertyKind>(), [records, properties, folder.settings])
  /** The kind a list row's glyph shows: the declaration, else the inferred editor kind, else text. */
  const kindOf = (key: string): PropertyKind => {
    const c = canonicalKey(key)
    const known = kinds.get(c)
    if (known !== undefined) return known
    const kind = columnKind(key, records, properties, folder.settings)
    kinds.set(c, kind)
    return kind
  }
  /** Labels shared by two rows (`file.name` and a `name` property both read "Name"): those rows also show their key (YAZ-1549). */
  const labelCounts = new Map<string, number>()
  for (const key of keys) {
    const label = propertyLabel(def, key)
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1)
  }
  const glyphOf = (key: string): ReactNode => {
    const c = canonicalKey(key)
    if (c.startsWith('file.')) return <FileFieldIcon />
    if (c.startsWith('formula.')) return <FormulaIcon />
    return <PropertyTypeIcon kind={kindOf(key)} />
  }

  const shownMatches = matches.filter(isShown)
  const hiddenMatches = matches.filter((key) => !isShown(key))
  /** Hide all / Show all: Table and Board may hide every column; Cards and List keep the name (as before). */
  const hideable = view.type === 'table' || view.type === 'board'
  /** The column's type in words, grey at the row's end (YAZ-3746 demo): the empty middle of the row says what it holds. */
  const typeOf = (key: string): string => {
    const c = canonicalKey(key)
    if (c.startsWith('file.')) return 'File'
    if (c.startsWith('formula.')) return 'Formula'
    return PROPERTY_LABELS[kindOf(key)]
  }
  /** One column row: the grip (shown rows, no search), the kind glyph, the label, its type, a › on hover, then the switch. */
  const row = (key: string) => {
    const on = isShown(key)
    const i = shown.indexOf(key)
    const label = propertyLabel(def, key)
    // The gap is the marker (YAZ-4606): the live gap's own attributes and transforms say where it opens, no class does.
    return (
      <li key={key} {...(i >= 0 && !filtering ? live.itemProps(i) : {})} className="view-prop">
        <div className="view-prop__identity">
          {on && !filtering ? (
            <button
              type="button"
              className="view-rule__nav view-prop__handle"
              aria-label={`Reorder ${label}`}
              title="Reorder"
              draggable
              onDragStart={(e) => {
                // The groupDrag idiom: `dataTransfer` guarded — jsdom's synthetic drags have none.
                e.dataTransfer?.setData('text/plain', key)
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                live.start(e, i)
              }}
              onDragEnd={live.end}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
                e.preventDefault()
                if (e.key === 'ArrowUp') {
                  if (i > 0) move(i, i - 1)
                } else if (i < shown.length - 1) move(i, i + 2)
              }}
            >
              <DragHandleIcon />
            </button>
          ) : (
            <span className="view-prop__handle-slot" aria-hidden="true" />
          )}
          <button type="button" className="view-prop__open" aria-label={`Open ${label}`} onClick={() => openDetail(key)}>
            <span className="view-prop__kind">{glyphOf(key)}</span>
            <span className="view-prop__name">
              {label}
              {(labelCounts.get(label) ?? 0) > 1 && <small>{canonicalKey(key)}</small>}
            </span>
            <span className="view-prop__type">{typeOf(key)}</span>
            <span className="view-prop__chevron" aria-hidden="true">›</span>
          </button>
          <input type="checkbox" className="view-switch" aria-label={`Show ${label}`} checked={on} disabled={!canToggle(key)} onChange={() => toggle(key)} />
        </div>
      </li>
    )
  }

  /**
   * The names' column (YAZ-3746 13K): as wide as the longest shown name, so every type sits one gap after the names,
   * not at the far right. Measured after each render of the list (a name's own text width is its `scrollWidth`).
   */
  const menuRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = menuRef.current
    if (root === null) return
    const names = [...root.querySelectorAll<HTMLElement>('.view-prop__name')]
    const widest = names.reduce((max, name) => Math.max(max, name.scrollWidth), 0)
    root.style.setProperty('--prop-name-w', `${Math.ceil(widest)}px`)
  })

  // ---------- DETAIL level (YAZ-1513): the shared column editor (YAZ-4533) ----------
  if (detail !== null)
    return (
      <ColumnDetail
        key={detail}
        columnKey={detail}
        def={def}
        view={view}
        viewIndex={viewIndex}
        records={records}
        onUpdate={onUpdate}
        properties={properties}
        folder={folder}
        shown={isShown(detail)}
        canHide={canToggle(detail)}
        onHide={() => toggle(detail)}
        onBack={() => setDetail(null)}
        onLeave={() => setDetail(null)}
      />
    )

  // ---------- the two tabs (D59) ----------
  return (
    <div ref={menuRef} className="view-menu view-menu--tabbed">
      <div className="view-menu__tabs" role="group" aria-label="Columns and view tabs">
        {TABS.map(([id, text]) => (
          <button key={id} type="button" className="view-menu__tab" data-tab={id} aria-pressed={tab === id} onClick={() => pickTab(id)}>
            {text}
          </button>
        ))}
      </div>
      {tab === 'view' ? (
        <ViewSettings def={def} view={view} own={own} viewIndex={viewIndex} onUpdate={onUpdate} dateColumns={dateColumns} />
      ) : (
        <>
          <div className="column-menu-head">
            <ColumnSearch value={query} onChange={setQuery} label="Search columns" />
            {filtering && (
              <p className="column-menu-summary" aria-live="polite">
                {matches.length} of {keys.length} columns{matches.length > 0 ? ' · Clear search to reorder' : ''}
              </p>
            )}
          </div>
          {matches.length === 0 && <p className="column-search__empty">No columns found. Try another name.</p>}
          {shownMatches.length > 0 && (
            <div className="column-section__head">
              <span>Shown · {shownMatches.length}</span>
              {hideable && (
                <button type="button" className="view-menu__action" onClick={() => writeOrder(filtering ? shown.filter(key => !matchingKeys.has(canonicalKey(key))) : [])}>
                  {filtering ? 'Hide results' : 'Hide all'}
                </button>
              )}
            </div>
          )}
          <ul className="view-menu__list" {...live.listProps}>
            {shownMatches.map(row)}
          </ul>
          {hiddenMatches.length > 0 && (
            <>
              <div className="column-section__head">
                <span>Hidden · {hiddenMatches.length}</span>
                {hideable && (
                  <button type="button" className="view-menu__action" onClick={() => writeOrder(filtering ? [...shown, ...hiddenMatches] : keys)}>
                    {filtering ? 'Show results' : 'Show all'}
                  </button>
                )}
              </div>
              <ul className="view-menu__list column-section--hidden">{hiddenMatches.map(row)}</ul>
            </>
          )}
          <AddColumn
            taken={keys}
            shown={shown}
            reserved={reservedKeys(folder.wikilinks.ids)}
            onShow={(existing) => writeOrder([...shown, existing])}
            onSave={(name, column) =>
              folder.setColumns(
                { ...folder.settings.columns, [name]: column },
                // The new column shown TOO, in that same one write (🔒 D3): `shown` is what `writeOrder`
                // writes — the view's own `order`, or the derived keys when it has none.
                def.views.map((v, i) => (i === viewIndex ? withOrder(v, [...shown, `note.${name}`]) : v)),
              )
            }
          />
        </>
      )}
    </div>
  )
}
