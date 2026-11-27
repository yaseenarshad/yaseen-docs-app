import { DEFAULT_SIDEBAR_TABS, type SidebarTabsPrefs } from '@shared/types'
import { SidebarTabsEditor } from '../sidebar/SidebarTabsEditor'
import { sameTabRow } from '../sidebar/tabRow'

export interface SidebarTabsControlProps {
  value: SidebarTabsPrefs
  onChange: (next: SidebarTabsPrefs) => void
  scopeLabel?: string
  isGlobal?: boolean
  activeTargetLabel?: string
  onJumpToActive?: () => void
}

/**
 * Settings › Sidebar › Tab row control (YAZ-6593).
 *
 * `sidebarTabs` is owned per vault or per workspace — never globally. In Global scope this control
 * renders a concise 1-line redirect with a 1-click jump to the active vault or workspace.
 */
export function SidebarTabsControl({ value, onChange, scopeLabel, isGlobal = false, activeTargetLabel, onJumpToActive }: SidebarTabsControlProps) {
  if (isGlobal) {
    return (
      <div className="sidebar-tabs-redirect">
        <span>Tab row is set per vault or per workspace — never globally.</span>
        {onJumpToActive !== undefined && (
          <button type="button" className="setting__scope-jump" onClick={onJumpToActive}>
            Edit {activeTargetLabel ?? 'this vault'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="sidebar-tabs-control">
      {scopeLabel !== undefined && (
        <div className="sidebar-tabs-control__scope">
          Tabs for: <strong>{scopeLabel}</strong>
        </div>
      )}
      <SidebarTabsEditor prefs={value} onChange={onChange} variant="settings" />
      {!sameTabRow(value, DEFAULT_SIDEBAR_TABS) && (
        <div className="sidebar-tabs-control__footer">
          <button type="button" className="settings__option" onClick={() => onChange(DEFAULT_SIDEBAR_TABS)}>
            Reset to default
          </button>
        </div>
      )}
    </div>
  )
}

export default SidebarTabsControl
