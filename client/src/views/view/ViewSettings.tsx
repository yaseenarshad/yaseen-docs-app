import { GROUP_INDENTS, type Mutate, type ViewDef, type ViewSet, groupIndentOf, shownGroupLevels } from '../viewSchema'
import { TextField } from './TextField'
import { cardWidth } from './cardWidth'
import { hideWeekendsDefault, hidesWeekends } from '../calendar'
import { markerStyleOf } from './ListView'
import { SubfoldersSwitch } from './SubfoldersSwitch'
import { GroupGuideSettings, HeaderRowSettings, TableLookSettings } from './TableLookSettings'
import { FromSettings, chooseOwn, useViewDefaults } from '../viewDefaults'
import { ChoiceSeg, RowLabel } from './settingRow'
import { CalendarShowBy } from './CalendarView'

export interface ViewSettingsProps {
  def: ViewSet
  /** The view with Settings filled in (`withDefaults`), what the controls show. */
  view: ViewDef
  /** The view as written: whether a value is its own or from Settings (YAZ-4585). */
  own: ViewDef
  viewIndex: number
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
 * type reads. Rows (a table's look and Row numbers, then Subfolders — moved here from the ⇅ popover by D60), Groups
 * (Group indent, D60, where the view indents its groups; Show empty groups), the type's own section (Board, Calendar,
 * List), then Folder › Default view. Frozen columns and rows live only on the header and row right-clicks, and a
 * calendar's Show by only here, first in Calendar (YAZ-3746 13AD: off the toolbar, over C3 and D11). Each row: an icon and label, then a segmented choice, a switch or a quiet select; a Settings ›
 * Folder pages default shows the ↺ reset only once this view has its own value (D34). Page-level settings stay in the
 * page cog (D35).
 */
export function ViewSettings({ def, view, own, viewIndex, onUpdate, dateColumns }: ViewSettingsProps) {
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
            <RowLabel icon="rowNumbers">Row numbers</RowLabel>
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
          {/* YAZ-4779: each header's type icon before its name. */}
          <label className="view-settings-row">
            <RowLabel icon="columnTypeIcons">Column type icons</RowLabel>
            <input
              type="checkbox"
              aria-label="Column type icons"
              checked={view.columnTypeIcons === true}
              onChange={(e) => onUpdate((d) => chooseOwn(d.views[viewIndex], 'columnTypeIcons', e.target.checked, defaults))}
            />
            <FromSettings own={own} viewKey="columnTypeIcons" viewIndex={viewIndex} onUpdate={onUpdate} />
          </label>
          {/* YAZ-4774: the header row's look, as a note table's "Header row ›". */}
          <HeaderRowSettings own={own} viewIndex={viewIndex} onUpdate={onUpdate} />
        </>
      )}
      {/* Every view type (YAZ-4579 D30): the one Subfolders switch, in View › Rows since D60. */}
      <SubfoldersSwitch view={view} own={own} viewIndex={viewIndex} onUpdate={onUpdate} />
      {(indents || emptyGroups) && <p className="view-menu__label">Groups</p>}
      {indents && (
        <div className="view-settings-row">
          <RowLabel icon="groupIndent">Group indent</RowLabel>
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
      {/* YAZ-4798: a grouped table's sticky group headers and group lines; an ungrouped table draws neither. */}
      {table && indents && <GroupGuideSettings view={view} own={own} viewIndex={viewIndex} onUpdate={onUpdate} />}
      {/* A Table shows its empty option groups too (YAZ-3940 S11), under the name "Show empty groups". */}
      {emptyGroups && <div className="property-board-setting">
        <label className="view-settings-row"><RowLabel icon="emptyGroups">{view.type === 'board' ? 'Show empty columns' : 'Show empty groups'}</RowLabel><input type="checkbox" role="switch" checked={view.showEmptyColumns === true} onChange={e => onUpdate(d => chooseOwn(d.views[viewIndex], 'showEmptyColumns', e.target.checked, defaults))} /><FromSettings own={own} viewKey="showEmptyColumns" viewIndex={viewIndex} onUpdate={onUpdate} /></label>
        <small>Include unused options from the grouping property.</small>
      </div>}
      {view.type === 'board' && (
        <>
          <p className="view-menu__label">Board</p>
          <label className="view-settings-row">
            <RowLabel icon="columnWidth">Column width</RowLabel>
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
          {/* Show by (YAZ-3746 13AD): the date column the calendar places notes on; only here, no longer on the toolbar. */}
          {(dateColumns.length > 0 || typeof view.dateProperty === 'string') && (
            <label className="view-settings-row">
              <RowLabel icon="showBy">Show by</RowLabel>
              <CalendarShowBy def={def} view={view} viewIndex={viewIndex} columns={dateColumns} onUpdate={onUpdate} />
            </label>
          )}
          {/* The toolbar's Month / Week switch as a setting (D59): the same write as `ViewsPane`'s `onScale`. */}
          <div className="view-settings-row">
            <RowLabel icon="opensIn">Opens in</RowLabel>
            <ChoiceSeg
              label="Opens in"
              value={view.calendarScale === 'week' ? 'week' : 'month'}
              options={[['month', 'Month'], ['week', 'Week']] as const}
              // Settings' scale removes the key (YAZ-4558 D22, YAZ-4585): Month, unless Settings › Folder pages says Week.
              onChange={(next) => onUpdate((d) => chooseOwn(d.views[viewIndex], 'calendarScale', next, defaults))}
            />
            <FromSettings own={own} viewKey="calendarScale" viewIndex={viewIndex} onUpdate={onUpdate} />
          </div>
          <div className="view-settings-row">
            <RowLabel icon="cardTitles">Card titles</RowLabel>
            <ChoiceSeg
              label="Card titles"
              value={view.cardTitles === 'wrap' ? 'wrap' : 'clip'}
              options={[['clip', 'Clip'], ['wrap', 'Wrap']] as const}
              // Settings' choice removes the key (YAZ-4558 D23: Clip, unless Settings › Folder pages says Wrap, YAZ-4585).
              onChange={(next) => onUpdate((d) => chooseOwn(d.views[viewIndex], 'cardTitles', next, defaults))}
            />
            <FromSettings own={own} viewKey="cardTitles" viewIndex={viewIndex} onUpdate={onUpdate} />
          </div>
          <label className="view-settings-row">
            <RowLabel icon="hideWeekends">Hide weekends</RowLabel>
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
          <div className="view-settings-row">
            <RowLabel icon="markerStyle">Marker style</RowLabel>
            <ChoiceSeg
              label="Marker style"
              value={markerStyleOf(view) as 'bullet' | 'number' | 'none'}
              options={[['bullet', 'Bullet'], ['number', 'Number'], ['none', 'None']] as const}
              onChange={(next) =>
                onUpdate((d) => {
                  if (next === 'bullet') delete d.views[viewIndex].markerStyle
                  else d.views[viewIndex].markerStyle = next
                })
              }
            />
          </div>
          <label className="view-settings-row">
            <RowLabel icon="indentProperties">Indent properties</RowLabel>
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
            <RowLabel icon="separator">Property separator</RowLabel>
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
        <RowLabel icon="defaultView">Default view</RowLabel>
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
      <p className="view-settings__foot">Defaults come from Settings › Folder pages. A ↺ marks a value changed for this view.</p>
    </div>
  )
}
