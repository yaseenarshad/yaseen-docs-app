import { useUnit } from '../../vault/unitWord'
import { type Mutate, type SubfoldersMode, type ViewDef, showsFolderRows, subfoldersOf } from '../viewSchema'
import { FromSettings, chooseOwn, useViewDefaults } from '../viewDefaults'
import { RowLabel } from './settingRow'

/** The switch's choices, in its order (YAZ-4579 D30). */
const MODES: readonly (readonly [SubfoldersMode, string])[] = [
  ['notes', 'Their notes'],
  ['rows', 'As rows'],
  ['both', 'Both'],
  ['hide', 'Hide'],
]

interface SubfoldersSwitchProps {
  /** The view with Settings filled in (`withDefaults`), what the switch shows. */
  view: ViewDef
  /** The view as written: whether its value is its own or from Settings (YAZ-4585). */
  own: ViewDef
  viewIndex: number
  onUpdate: Mutate
  className?: string
}

/**
 * "Subfolders" (YAZ-4579 D30): one switch, in the sliders popover's View › Rows (YAZ-4607 D60; before that in
 * Properties and in the ⇅ popover too). Settings' choice removes the key (Their notes unless Settings › Folder pages
 * says otherwise, YAZ-4585). Every view type has it.
 */
export function SubfoldersSwitch({ view, own, viewIndex, onUpdate, className = 'view-settings-row' }: SubfoldersSwitchProps) {
  const unit = useUnit()
  const defaults = useViewDefaults()
  return (
    <label className={className}>
      <RowLabel icon="subfolders">Subfolders</RowLabel>
      <select
        className="view-select"
        aria-label="Subfolders"
        value={subfoldersOf(view)}
        onChange={(e) => {
          const mode = e.target.value as SubfoldersMode
          onUpdate((d) => chooseOwn(d.views[viewIndex], 'subfolders', mode, defaults))
        }}
      >
        {MODES.map(([mode, label]) => (
          <option key={mode} value={mode}>
            {unit(label)}
          </option>
        ))}
      </select>
      <FromSettings own={own} viewKey="subfolders" viewIndex={viewIndex} onUpdate={onUpdate} />
    </label>
  )
}

/**
 * "Folders first" (YAZ-4579 D33), under Sort in the ⇅ popover — a sort rule (YAZ-4607 D60): Settings' value (on,
 * unless Settings › Folder pages says off, YAZ-4585) removes the key; the other writes `foldersFirst`. Only while the
 * view shows subfolder rows, the one time it changes anything.
 */
export function FoldersFirstToggle({ view, own, viewIndex, onUpdate, className = 'view-menu__toggle' }: SubfoldersSwitchProps) {
  const defaults = useViewDefaults()
  if (!showsFolderRows(view)) return null
  return (
    <label className={className}>
      <input
        type="checkbox"
        aria-label="Folders first"
        checked={view.foldersFirst !== false}
        onChange={(e) =>
          onUpdate((d) => chooseOwn(d.views[viewIndex], 'foldersFirst', e.target.checked, defaults))
        }
      />
      Folders first
      <FromSettings own={own} viewKey="foldersFirst" viewIndex={viewIndex} onUpdate={onUpdate} />
    </label>
  )
}
