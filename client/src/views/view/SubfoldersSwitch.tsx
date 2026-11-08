import { type Mutate, type SubfoldersMode, type ViewDef, showsFolderRows, subfoldersOf } from '../viewSchema'

/** The switch's choices, in its order (YAZ-4579 D30). */
const MODES: readonly (readonly [SubfoldersMode, string])[] = [
  ['notes', 'Their notes'],
  ['rows', 'As rows'],
  ['both', 'Both'],
  ['hide', 'Hide'],
]

interface SubfoldersSwitchProps {
  view: ViewDef
  viewIndex: number
  onUpdate: Mutate
  className?: string
  /** The text beside the select: the Sort and group menu heads its section "Subfolders", so its row says "Show". */
  text?: string
}

/**
 * "Subfolders" (YAZ-4579 D30): one switch, in Properties and in the Sort and group menu, so it changes where the user
 * works. Their notes is the default: it removes the key. Every view type has it.
 */
export function SubfoldersSwitch({ view, viewIndex, onUpdate, className = 'view-settings-row', text = 'Subfolders' }: SubfoldersSwitchProps) {
  return (
    <label className={className}>
      <span>{text}</span>
      <select
        className="view-select"
        aria-label="Subfolders"
        value={subfoldersOf(view)}
        onChange={(e) => {
          const mode = e.target.value as SubfoldersMode
          onUpdate((d) => {
            if (mode === 'notes') delete d.views[viewIndex].subfolders
            else d.views[viewIndex].subfolders = mode
          })
        }}
      >
        {MODES.map(([mode, label]) => (
          <option key={mode} value={mode}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * "Folders first" (YAZ-4579 D33), beside the switch in the Sort and group menu: on, the default, removes the key; off
 * writes `foldersFirst: false`. Only while the view shows subfolder rows, the one time it changes anything.
 */
export function FoldersFirstToggle({ view, viewIndex, onUpdate, className = 'view-menu__toggle' }: SubfoldersSwitchProps) {
  if (!showsFolderRows(view)) return null
  return (
    <label className={className}>
      <input
        type="checkbox"
        aria-label="Folders first"
        checked={view.foldersFirst !== false}
        onChange={(e) =>
          onUpdate((d) => {
            if (e.target.checked) delete d.views[viewIndex].foldersFirst
            else d.views[viewIndex].foldersFirst = false
          })
        }
      />
      Folders first
    </label>
  )
}
