/**
 * THE SIDEBAR ZOOM in the footer (YAZ-3389): a quiet "− 100% +" after the cog. It zooms the sidebar's
 * lists only (`settings.sidebarZoom`, one value for every window) — never the frame, never a note,
 * which has its own zoom (`editor/DocumentZoom.tsx`). − and + walk `SIDEBAR_ZOOM_STEPS` and stop at
 * the walls; a click on the percent goes back to 100%.
 */
import { memo } from 'react'
import { SIDEBAR_ZOOM_MAX, SIDEBAR_ZOOM_MIN, stepSidebarZoom } from '@shared/types'

interface SidebarZoomProps {
  value: number
  onChange: (percent: number) => void
}

export const SidebarZoom = memo(function SidebarZoom({ value, onChange }: SidebarZoomProps) {
  return (
    <div className="sidebar-zoom" role="group" aria-label="Sidebar zoom">
      <button type="button" className="sidebar-zoom__step" aria-label="Zoom the sidebar out" title="Zoom the sidebar out (⌘−)" disabled={value <= SIDEBAR_ZOOM_MIN} onClick={() => onChange(stepSidebarZoom(value, -1))}>
        −
      </button>
      <button type="button" className="sidebar-zoom__value" title="Sidebar zoom. Click for 100%" onClick={() => onChange(100)}>
        {Math.round(value)}%
      </button>
      <button type="button" className="sidebar-zoom__step" aria-label="Zoom the sidebar in" title="Zoom the sidebar in (⌘+)" disabled={value >= SIDEBAR_ZOOM_MAX} onClick={() => onChange(stepSidebarZoom(value, 1))}>
        +
      </button>
    </div>
  )
})
