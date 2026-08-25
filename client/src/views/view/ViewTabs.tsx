import type { ViewDef } from '../viewSchema'
import { ViewTypeIcon } from './icons'

export interface ViewTabsProps {
  views: ViewDef[]
  active: number
  onSelect: (index: number) => void
}

/**
 * View switcher (GRO-2135; SWITCH-ONLY since YAZ-846): one tab per view. The editable half —
 * "+", rename, duplicate, delete, move — was deleted with its last reachable surface: a folder
 * page's tabs are locked switch-only (🔒 D3, YAZ-818: view CRUD is not this block's gesture), and
 * nothing else mounts a views chrome since the `.base` retirement (YAZ-844). Extra views are
 * hand-written in `folder_page_settings` today; a view-management UI is parked with context on
 * the Future- issue (YAZ-824).
 */
export function ViewTabs({ views, active, onSelect }: ViewTabsProps) {
  return (
    <div className="view-tabs" role="tablist">
      {views.map((v, i) => (
        <div key={i} className={`view-tab${i === active ? ' view-tab--active' : ''}`}>
          <button type="button" role="tab" className="view-tab__btn" aria-selected={i === active} onClick={() => onSelect(i)}>
            <ViewTypeIcon type={v.type} />
            <span>{v.name}</span>
          </button>
        </div>
      ))}
    </div>
  )
}
