import { PropertyTypeIcon } from './PropertyDefinitionEditor'
import { ColumnSearch, matchesColumn } from './ColumnSearch'
import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
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
import { markerStyleOf } from './ListView'
import { allPropertyKeys } from './properties'
import { TextField } from './TextField'
import { frozenColumnCount } from './frozenColumns'
import { cardWidth } from './cardWidth'
import { CalendarShowBy } from './CalendarView'
import { SubfoldersSwitch } from './SubfoldersSwitch'
import { FromSettings, chooseOwn, useViewDefaults } from '../viewDefaults'

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
  /** A calendar's date columns for "Show by" (`dateColumns`, once in `ViewsPane`, YAZ-4544). */
  dateColumns: readonly string[]
}

/** Board's width editor accepts finite numbers, then rounds and clamps only its lower bound. */
export const normalizeBoardWidth = (draft: string): string | null => {
  if (draft.trim() === '') return null
  const width = Number(draft)
  return Number.isFinite(width) ? String(Math.max(180, Math.round(width))) : null
}

/**
 * Properties menu (GRO-2135), TWO levels inside the one popover since YAZ-1513 (Notion's shape):
 *
 *  LIST — one clean line per column: grip (YAZ-1207, shown rows only) · shown checkbox (writes
 *  `view.order`; Table and Board may hide `file.name`, Cards and List keep it) · the column's KIND
 *  glyph · its label · a `›` — the whole label area opens the column. Nothing else rides the row.
 *  "Select all / Unselect all", the count, "+ Add column" and the per-view sections below
 *  (Table: frozen columns, row numbers; Board; List) are as they were.
 *
 *  DETAIL — ONE panel, ONE exit (3D, Yasin's ruling): `ColumnDetail` (YAZ-4533), the same editor
 *  the table header's "Edit column…" opens. Hide in this view (= unchecking) and Delete column…
 *  return here; there is no third level and no Save/Cancel; Esc or `‹` returns to the list.
 */
export function PropertiesMenu({ def, view, viewIndex, records, onUpdate, properties = null, folder, dateColumns }: PropertiesMenuProps) {
  const [query, setQuery] = useState('')
  /** The DETAIL level (YAZ-1513): the open column's key, or null for the list. Its editor is `ColumnDetail` (YAZ-4533). */
  const [detail, setDetail] = useState<string | null>(null)
  /** The drag in flight (YAZ-1207): `from` is an index in `shown`, `to` the insertion slot it would land in. */
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)
  /** Settings › Folder pages (YAZ-4585): `view` has them filled in; `own` is the view as written, for "from Settings". */
  const defaults = useViewDefaults()
  const own = def.views[viewIndex] ?? view
  const shown = propertyKeys(def, view, records, Object.keys(folder.settings.columns))
  const keys = allPropertyKeys(def, view, records, folder.settings.columns)
  const filtering = query.trim() !== ''
  const matches = keys.filter(key => matchesColumn(query, propertyLabel(def, key), key))
  const matchingKeys = new Set(matches.map(canonicalKey))
  const isShown = (key: string) => shown.some((k) => canonicalKey(k) === canonicalKey(key))
  const canToggle = (key: string) => canHideColumn(view, key)

  const openDetail = (key: string) => setDetail(key)
  /** ONE order write, `frozenColumns` following positionally — the shared rule (`columnOrder.ts`). */
  const writeOrder = (order: string[]) => onUpdate((d) => setViewOrder(d, viewIndex, order))
  const toggle = (key: string) => writeOrder(isShown(key) ? shown.filter((k) => canonicalKey(k) !== canonicalKey(key)) : [...shown, key])
  /** The slot a pointer at `clientY` over shown row `i` means: before (i) or after (i+1) it. */
  const insertionAt = (e: DragEvent<HTMLElement>, i: number): number => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY < r.top + r.height / 2 ? i : i + 1
  }
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

  // ---------- LIST level ----------
  return (
    <div className="view-menu">
      <div className="column-menu-head">
        <ColumnSearch value={query} onChange={setQuery} label="Search columns" />
        <div className="column-menu-summary">
          <span aria-live="polite">{filtering ? `${matches.length} of ${keys.length}` : keys.length} columns</span>
          {(view.type === 'table' || view.type === 'board') && <div className="view-menu__actions">
            <button type="button" className="view-menu__action" disabled={matches.every(isShown)} onClick={() => writeOrder(filtering ? [...shown, ...matches.filter(key => !isShown(key))] : keys)}>
              {filtering ? 'Select results' : 'Select all'}
            </button>
            <button type="button" className="view-menu__action" disabled={!matches.some(isShown)} onClick={() => writeOrder(filtering ? shown.filter(key => !matchingKeys.has(canonicalKey(key))) : [])}>
              {filtering ? 'Unselect results' : 'Unselect all'}
            </button>
          </div>}
        </div>
        {filtering && matches.length > 0 && <p className="column-reorder-hint">Clear search to reorder columns.</p>}
      </div>
      {matches.length === 0 && <p className="column-search__empty">No columns found. Try another name.</p>}
      <ul className="view-menu__list">
        {matches.map((key) => {
          const on = isShown(key)
          const i = shown.indexOf(key)
          const label = propertyLabel(def, key)
          const cls = ['view-prop']
          if (drag !== null && i >= 0) {
            if (drag.from === i) cls.push('view-prop--dragging')
            // The insertion indicator: an accent edge on the row the drop would land before — or
            // after the LAST row for the end slot.
            if (drag.to === i) cls.push('view-prop--insert-before')
            if (drag.to === shown.length && i === shown.length - 1) cls.push('view-prop--insert-after')
          }
          return (
            <li
              key={key}
              className={cls.join(' ')}
              onDragOver={(e) => {
                if (drag === null || i < 0) return
                e.preventDefault()
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                const to = insertionAt(e, i)
                if (drag.to !== to) setDrag({ ...drag, to })
              }}
              onDrop={(e) => {
                if (drag === null || i < 0) return
                e.preventDefault()
                setDrag(null)
                move(drag.from, insertionAt(e, i))
              }}
            >
              <div className="view-prop__identity">
                {on && !filtering && (
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
                      setDrag({ from: i, to: i })
                    }}
                    onDragEnd={() => setDrag(null)}
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
                )}
                <input type="checkbox" aria-label={`Show ${label}`} checked={on} disabled={!canToggle(key)} onChange={() => toggle(key)} />
                <button type="button" className="view-prop__open" aria-label={`Open ${label}`} onClick={() => openDetail(key)}>
                  <span className="view-prop__kind">{glyphOf(key)}</span>
                  <span className="view-prop__name">
                    {label}
                    {(labelCounts.get(label) ?? 0) > 1 && <small>{canonicalKey(key)}</small>}
                  </span>
                  <span className="view-prop__chevron" aria-hidden="true">›</span>
                </button>
              </div>
            </li>
          )
        })}
      </ul>
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
      {/* Every view type (YAZ-4579 D30, replacing YAZ-4564 D25's Show / Hide): the same switch the Sort and group menu has. */}
      <SubfoldersSwitch view={view} own={own} viewIndex={viewIndex} onUpdate={onUpdate} />
      {view.type === 'table' && (
        <>
          <p className="view-menu__label">Table</p>
          <label className="view-settings-row">
            <span>Frozen columns</span>
            <select
              className="view-select"
              aria-label="Frozen columns"
              value={frozenColumnCount(view.frozenColumns, shown.length)}
              onChange={(e) =>
                onUpdate((d) => {
                  const count = Number(e.target.value)
                  if (count === 0) delete d.views[viewIndex].frozenColumns
                  else d.views[viewIndex].frozenColumns = count
                })
              }
            >
              <option value={0}>None</option>
              {shown.map((key, index) => (
                <option key={key} value={index + 1}>
                  {index + 1} — through {propertyLabel(def, key)}
                </option>
              ))}
            </select>
          </label>
          <label className="view-menu__toggle">
            <input
              type="checkbox"
              aria-label="Row numbers"
              checked={view.rowNumbers !== false}
              onChange={(e) =>
                onUpdate((d) => {
                  // Settings' choice leaves no key behind (YAZ-1513: shown, unless Settings › Folder pages says hidden, YAZ-4585).
                  chooseOwn(d.views[viewIndex], 'rowNumbers', e.target.checked, defaults)
                })
              }
            />
            Row numbers
            <FromSettings own={own} viewKey="rowNumbers" viewIndex={viewIndex} onUpdate={onUpdate} />
          </label>
        </>
      )}
      {/* A Table shows its empty option groups too (YAZ-3940 S11), under the name "Show empty groups". */}
      {(view.type === 'board' || view.type === 'table') && <div className="property-board-setting">
        <label><span>{view.type === 'board' ? 'Show empty columns' : 'Show empty groups'}</span><FromSettings own={own} viewKey="showEmptyColumns" viewIndex={viewIndex} onUpdate={onUpdate} /><input type="checkbox" role="switch" checked={view.showEmptyColumns === true} onChange={e => onUpdate(d => chooseOwn(d.views[viewIndex], 'showEmptyColumns', e.target.checked, defaults))} /></label>
        <small>Include unused options from the grouping property.</small>
      </div>}
      {view.type === 'board' && (
        <>
          <p className="view-menu__label">Board</p>
          <label className="view-settings-row">
            <span>Column width</span>
            <span className="view-width-setting">
              <TextField
                className="view-input"
                aria-label="Column width in pixels"
                type="number"
                inputMode="decimal"
                min={180}
                step={1}
                value={String(cardWidth(view.cardSize))}
                normalize={normalizeBoardWidth}
                onCommit={(next) =>
                  onUpdate((d) => {
                    const active = d.views[viewIndex]
                    if (Number(next) === 280) delete active.cardSize
                    else active.cardSize = Number(next)
                  })
                }
              />
              <span>px</span>
            </span>
          </label>
        </>
      )}
      {view.type === 'calendar' && (
        <>
          <p className="view-menu__label">Calendar</p>
          <label className="view-settings-row">
            <span>Show by</span>
            <CalendarShowBy def={def} view={view} viewIndex={viewIndex} columns={dateColumns} onUpdate={onUpdate} />
          </label>
          <label className="view-settings-row">
            <span>Card titles</span>
            <select
              className="view-select"
              aria-label="Card titles"
              value={view.cardTitles === 'wrap' ? 'wrap' : 'clip'}
              onChange={(e) =>
                onUpdate((d) => {
                  // Settings' choice removes the key (YAZ-4558 D23: Clip, unless Settings › Folder pages says Wrap, YAZ-4585).
                  chooseOwn(d.views[viewIndex], 'cardTitles', e.target.value === 'wrap' ? 'wrap' : 'clip', defaults)
                })
              }
            >
              <option value="clip">Clip …</option>
              <option value="wrap">Wrap</option>
            </select>
            <FromSettings own={own} viewKey="cardTitles" viewIndex={viewIndex} onUpdate={onUpdate} />
          </label>
        </>
      )}
      {view.type === 'list' && (
        <>
          <p className="view-menu__label">List</p>
          <div className="view-list-settings">
            <select
              className="view-select"
              aria-label="Marker style"
              value={markerStyleOf(view)}
              onChange={(e) =>
                onUpdate((d) => {
                  if (e.target.value === 'bullet') delete d.views[viewIndex].markerStyle
                  else d.views[viewIndex].markerStyle = e.target.value
                })
              }
            >
              <option value="bullet">Bullet</option>
              <option value="number">Number</option>
              <option value="none">None</option>
            </select>
            <label className="view-menu__toggle">
              <input
                type="checkbox"
                aria-label="Indent properties"
                checked={view.indentProperties === true}
                onChange={(e) =>
                  onUpdate((d) => {
                    if (e.target.checked) d.views[viewIndex].indentProperties = true
                    else delete d.views[viewIndex].indentProperties
                  })
                }
              />
              Indent properties
            </label>
            <TextField
              className="view-input"
              aria-label="Property separator"
              placeholder=", "
              value={typeof view.propertySeparator === 'string' ? view.propertySeparator : ''}
              onCommit={(sep) =>
                onUpdate((d) => {
                  if (sep === '' || sep === ', ') delete d.views[viewIndex].propertySeparator
                  else d.views[viewIndex].propertySeparator = sep
                })
              }
            />
          </div>
        </>
      )}
      {/* The folder-level setting (YAZ-1104) — the saved START, in the def since YAZ-1471: ONE door. */}
      <p className="view-menu__label">Folder</p>
      <label className="view-settings-row">
        <span>Default view</span>
        <select
          className="view-select"
          aria-label="Default view"
          value={def.defaultView ?? ''}
          onChange={(e) =>
            onUpdate((d) => {
              if (e.target.value === '') delete d.defaultView
              else d.defaultView = e.target.value
            })
          }
        >
          <option value="">First view</option>
          {def.views.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
