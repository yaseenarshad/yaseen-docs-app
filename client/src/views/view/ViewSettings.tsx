import { GROUP_INDENTS, type Mutate, type ViewDef, type ViewSet, groupIndentOf, shownGroupLevels } from '../viewSchema'
import { propertyLabel } from '../engine'
import { TextField } from './TextField'
import { MAX_FROZEN_ROWS, UNFROZE_COLUMNS, UNFROZE_ROWS, frozenColumnCount } from './frozenColumns'
import { cardWidth } from './cardWidth'
import { CalendarShowBy } from './CalendarView'
import { hideWeekendsDefault, hidesWeekends } from '../calendar'
import { markerStyleOf } from './ListView'
import { SubfoldersSwitch } from './SubfoldersSwitch'
import { TableLookSettings } from './TableLookSettings'
import { FromSettings, chooseOwn, useViewDefaults } from '../viewDefaults'

export interface ViewSettingsProps {
  def: ViewSet
  /** The view with Settings filled in (`withDefaults`), what the controls show. */
  view: ViewDef
  /** The view as written: whether a value is its own or from Settings (YAZ-4585). */
  own: ViewDef
  viewIndex: number
  /** The view's shown columns, in order: the "Frozen columns" choices. */
  shown: readonly string[]
  onUpdate: Mutate
  /** A calendar's date columns for "Show by" (`dateColumns`, once in `ViewsPane`, YAZ-4544). */
  dateColumns: readonly string[]
}

/** Board's width editor accepts finite numbers, then rounds and clamps only its lower bound. */
export const normalizeBoardWidth = (draft: string): string | null => {
  if (draft.trim() === '') return null
  const width = Number(draft)
  return Number.isFinite(width) ? String(Math.max(180, Math.round(width))) : null
}

/** Small / Medium / Large (YAZ-4532 D10), in View › Groups since YAZ-4607 D60. */
const INDENT_STEPS = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']] as const

/**
 * The View tab of the Properties popover (YAZ-4607, D59): how THIS view looks, by section, and only the sections its
 * type reads. Rows (a table's look and Row numbers, then Subfolders — moved here from the ⇅ popover by D60), Frozen
 * (a table's columns and rows), Groups (Group indent, D60, where the view indents its groups; Show empty groups),
 * the type's own section (Board, Calendar, List), then Folder › Default view. Every Settings › Folder pages default
 * keeps its grey "from Settings" and Reset (D34). Page-level settings stay in the page cog (D35).
 */
export function ViewSettings({ def, view, own, viewIndex, shown, onUpdate, dateColumns }: ViewSettingsProps) {
  const defaults = useViewDefaults()
  const table = view.type === 'table'
  // A calendar's days are its groups (YAZ-4540 D4) and a Board does not indent its groups (YAZ-4544): Table, List
  // and Cards read the indent, once the view is grouped.
  const indents = view.type !== 'calendar' && view.type !== 'board' && shownGroupLevels(view).length > 0
  const emptyGroups = table || view.type === 'board'
  return (
    <div className="view-settings">
      <p className="view-menu__label">Rows</p>
      {table && (
        <>
          <TableLookSettings view={view} own={own} viewIndex={viewIndex} onUpdate={onUpdate} />
          <label className="view-settings-row">
            <span>Row numbers</span>
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
            <FromSettings own={own} viewKey="rowNumbers" viewIndex={viewIndex} onUpdate={onUpdate} />
          </label>
        </>
      )}
      {/* Every view type (YAZ-4579 D30): the one Subfolders switch, in View › Rows since D60. */}
      <SubfoldersSwitch view={view} own={own} viewIndex={viewIndex} onUpdate={onUpdate} />
      {table && (
        <>
          <p className="view-menu__label">Frozen</p>
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
                }, Number(e.target.value) === 0 ? UNFROZE_COLUMNS : undefined)
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
          {/* The row menu's "Freeze up to this row" (YAZ-4537) as a count, the same write (D59). */}
          <label className="view-settings-row">
            <span>Frozen rows</span>
            <select
              className="view-select"
              aria-label="Frozen rows"
              value={frozenColumnCount(view.frozenRows, MAX_FROZEN_ROWS)}
              onChange={(e) =>
                onUpdate((d) => {
                  const count = Number(e.target.value)
                  if (count === 0) delete d.views[viewIndex].frozenRows
                  else d.views[viewIndex].frozenRows = count
                }, Number(e.target.value) === 0 ? UNFROZE_ROWS : undefined)
              }
            >
              <option value={0}>None</option>
              {Array.from({ length: MAX_FROZEN_ROWS }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1} {i === 0 ? 'row' : 'rows'}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {(indents || emptyGroups) && <p className="view-menu__label">Groups</p>}
      {indents && (
        <div className="view-settings-row">
          <span>Group indent</span>
          <div className="view-seg" role="group" aria-label="Group indent">
            {INDENT_STEPS.map(([step, text]) => (
              <button key={step} type="button" className="view-seg__opt" data-indent={step} aria-pressed={GROUP_INDENTS[step] === groupIndentOf(view)}
                onClick={() => onUpdate((d) => {
                  // Settings' indent removes the key (YAZ-4532 D10, YAZ-4585): Medium unless Settings › Folder pages says otherwise.
                  chooseOwn(d.views[viewIndex], 'groupIndent', step, defaults)
                })}>
                {text}
              </button>
            ))}
          </div>
          <FromSettings own={own} viewKey="groupIndent" viewIndex={viewIndex} onUpdate={onUpdate} />
        </div>
      )}
      {/* A Table shows its empty option groups too (YAZ-3940 S11), under the name "Show empty groups". */}
      {emptyGroups && <div className="property-board-setting">
        <label className="view-settings-row"><span>{view.type === 'board' ? 'Show empty columns' : 'Show empty groups'}</span><input type="checkbox" role="switch" checked={view.showEmptyColumns === true} onChange={e => onUpdate(d => chooseOwn(d.views[viewIndex], 'showEmptyColumns', e.target.checked, defaults))} /><FromSettings own={own} viewKey="showEmptyColumns" viewIndex={viewIndex} onUpdate={onUpdate} /></label>
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
          {/* The toolbar's Month / Week switch as a setting (D59): the same write as `ViewsPane`'s `onScale`. */}
          <label className="view-settings-row">
            <span>Opens in</span>
            <select
              className="view-select"
              aria-label="Opens in"
              value={view.calendarScale === 'week' ? 'week' : 'month'}
              onChange={(e) =>
                onUpdate((d) => {
                  // Settings' scale removes the key (YAZ-4558 D22, YAZ-4585): Month, unless Settings › Folder pages says Week.
                  chooseOwn(d.views[viewIndex], 'calendarScale', e.target.value === 'week' ? 'week' : 'month', defaults)
                })
              }
            >
              <option value="month">Month</option>
              <option value="week">Week</option>
            </select>
            <FromSettings own={own} viewKey="calendarScale" viewIndex={viewIndex} onUpdate={onUpdate} />
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
          <label className="view-settings-row">
            <span>Hide weekends</span>
            <input
              type="checkbox"
              aria-label="Hide weekends"
              checked={hidesWeekends(view, hideWeekendsDefault(defaults))}
              onChange={(e) =>
                onUpdate((d) => {
                  // The Settings › Folder pages default leaves no key (YAZ-4595 S33, YAZ-4585): only a choice that differs from it is written.
                  chooseOwn(d.views[viewIndex], 'hideWeekends', e.target.checked, defaults)
                })
              }
            />
            <FromSettings own={own} viewKey="hideWeekends" viewIndex={viewIndex} onUpdate={onUpdate} />
          </label>
        </>
      )}
      {view.type === 'list' && (
        <>
          <p className="view-menu__label">List</p>
          <label className="view-settings-row">
            <span>Marker style</span>
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
          </label>
          <label className="view-settings-row">
            <span>Indent properties</span>
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
          </label>
          <label className="view-settings-row">
            <span>Property separator</span>
            <TextField
              className="view-input view-settings-row__text"
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
          </label>
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
