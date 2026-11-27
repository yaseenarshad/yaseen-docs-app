/**
 * Multi-toggle control for per-tab "Show last updated" dates in the sidebar (YAZ-6593).
 *
 * Uses the existing `.settings__options` / `.settings__option` / `.settings__option--active` button
 * classes. `recents` defaults to `true` when omitted from `RowDates` (`rowDates.recents !== false`),
 * and toggling preserves the exact `RowDates` shape.
 */
import type { RowDateTab, RowDates } from '@shared/types'

const ROW_DATE_TABS: readonly { id: RowDateTab; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'focus', label: 'Focus' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'search', label: 'Search' },
  { id: 'recents', label: 'Recents' },
]

export interface RowDatesControlProps {
  value: RowDates
  onChange: (next: RowDates) => void
}

export function RowDatesControl({ value, onChange }: RowDatesControlProps) {
  const isOn = (tab: RowDateTab): boolean => (tab === 'recents' ? value.recents !== false : value[tab])
  const toggle = (tab: RowDateTab): void => {
    onChange({ ...value, [tab]: !isOn(tab) })
  }

  return (
    <div className="settings__options row-dates-control" role="group" aria-label="Show last updated">
      {ROW_DATE_TABS.map(({ id, label }) => {
        const on = isOn(id)
        return (
          <button
            key={id}
            type="button"
            className={`settings__option${on ? ' settings__option--active' : ''}`}
            aria-pressed={on}
            onClick={() => toggle(id)}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
