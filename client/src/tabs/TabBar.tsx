import { fileKind } from '@shared/fileKind'
import { basename, stripExt } from '../lib/paths'
import './tabs.css'

export interface TabBarProps {
  /** Open tabs, absolute paths, left→right. */
  tabs: readonly string[]
  /** The active tab (the window's `file`); null with no tabs open. */
  active: string | null
  onActivate: (path: string) => void
  onClose: (path: string) => void
}

/** The sidebar Tree's 2×2 `.base` glyph, mirrored here (Tree.tsx keeps it private; touching Tree is I3 territory). */
function BaseGlyph() {
  return (
    <svg className="tabbar__glyph" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
      <line x1="6" y1="1.5" x2="6" y2="10.5" />
      <line x1="1.5" y1="6" x2="10.5" y2="6" />
    </svg>
  )
}

/**
 * The window tab strip (Tabs I2, GRO-2234): one tab per open file, ViewTabs' tablist
 * semantics (role=tab, aria-selected, active underline). Labels are basenames without the
 * vault extension; the full path lives in the title tooltip. Presentational only — all
 * state changes go through the `useTabs` callbacks.
 */
export function TabBar({ tabs, active, onActivate, onClose }: TabBarProps) {
  return (
    <div className="tabbar" role="tablist" aria-label="Open files">
      {tabs.map((path) => {
        const isActive = path === active
        const label = stripExt(basename(path))
        return (
          <div key={path} className={isActive ? 'tabbar__tab tabbar__tab--active' : 'tabbar__tab'}>
            <button
              type="button"
              role="tab"
              className="tabbar__btn"
              aria-selected={isActive}
              title={path}
              onClick={() => onActivate(path)}
              onAuxClick={(e) => {
                // Middle-click closes — the browser-tab convention.
                if (e.button === 1) onClose(path)
              }}
            >
              {fileKind(path) === 'base' && <BaseGlyph />}
              <span className="tabbar__label">{label}</span>
            </button>
            <button type="button" className="tabbar__close" aria-label={`Close ${label}`} title={`Close ${label}`} onClick={() => onClose(path)}>
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
