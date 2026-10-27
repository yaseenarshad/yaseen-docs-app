/**
 * THE ZOOM MENU in the footer (YAZ-3432): one quiet chip after the cog that shows the sidebar zoom ("100%"). A click
 * opens a small menu upward with two rows: Sidebar, the "− 100% +" of the sidebar's lists (`SidebarZoom`, YAZ-3389;
 * a Files window's own zoom there, D13), and App, the App size of every window (`settings.appZoom`, one button for each
 * of `APP_ZOOM_STEPS`). The keys never reach the App size: ⌘+ / ⌘− / ⌘0 zoom a note or the sidebar (`zoomRequest.ts`).
 *
 * The menu goes to `document.body`: a fixed box inside a zoomed one scales and moves (`SessionList`). It is zoomed by
 * 1 / the App size, so it keeps its size on the screen at every App size, and while it is open it keeps its place on
 * the screen too: a click on 125% leaves the buttons under the pointer. Escape, a click outside and the window's blur
 * close it.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { APP_ZOOM_STEPS } from '@shared/types'
import { SidebarZoom } from './SidebarZoom'

interface ZoomMenuProps {
  /** The sidebar zoom in percent: the chip's label and the Sidebar row. */
  sidebar: number
  onSidebar: (percent: number) => void
  /** The App size in percent (`settings.appZoom`). */
  app: number
  onApp: (percent: number) => void
}

/** The room between the chip and the menu, and the least between the menu and the window's right edge, in px. */
const GAP = 4

export const ZoomMenu = memo(function ZoomMenu({ sidebar, onSidebar, app, onApp }: ZoomMenuProps) {
  // The menu's place while it is open, in SCREEN px (page px × the App size at the open): its left edge and how far its
  // bottom is above the window's bottom. Screen px, so a new App size leaves it where it is.
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null)
  // How far the menu moves left to stay inside a narrow window (a Files window of 180 px), in page px.
  const [shift, setShift] = useState(0)
  const chipRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const scale = app / 100
  const open = at !== null
  const close = useCallback(() => setAt(null), [])

  const toggle = () => {
    if (open) return close()
    const r = chipRef.current?.getBoundingClientRect()
    if (r === undefined) return
    setShift(0)
    setAt({ left: r.left * scale, bottom: (window.innerHeight - r.top + GAP) * scale })
  }

  useEffect(() => {
    if (!open) return
    // Escape is the menu's alone while it is up; the focus goes back to the chip.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      close()
      chipRef.current?.focus()
    }
    // In the capture phase: a row that swallows its mousedown still closes the menu. The chip toggles by its click.
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && (menuRef.current?.contains(e.target) === true || chipRef.current?.contains(e.target) === true)) return
      close()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', close)
    }
  }, [open, close])

  // Kept inside the window: measured after each place or App size, never past its right edge nor its left. The menu is
  // `max-content` wide (app.css), so the move never changes its width.
  const shiftRef = useRef(shift)
  shiftRef.current = shift
  useLayoutEffect(() => {
    const r = menuRef.current?.getBoundingClientRect()
    if (r === undefined) return
    const left = r.left + shiftRef.current
    setShift(Math.max(0, Math.min(left + r.width - (window.innerWidth - GAP), left)))
  }, [at, scale])

  const place: CSSProperties | undefined = at === null ? undefined : { left: at.left / scale - shift, bottom: at.bottom / scale }
  return (
    <>
      <button
        ref={chipRef}
        type="button"
        className={`zoom-chip${open ? ' zoom-chip--open' : ''}`}
        title="Sidebar zoom and App size"
        aria-label={`Zoom: sidebar ${Math.round(sidebar)}%, App size ${app}%`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        {Math.round(sidebar)}%
      </button>
      {place !== undefined &&
        createPortal(
          <div ref={menuRef} className="zoom-menu" role="dialog" aria-label="Zoom" style={place}>
            {/* 1 / the App size: the page's zoom times this is 1, so the menu is the same size at every App size. */}
            <div className="zoom-menu__body" style={{ zoom: 1 / scale }}>
              <div className="zoom-menu__label">Sidebar</div>
              <SidebarZoom value={sidebar} onChange={onSidebar} />
              <div className="zoom-menu__label">App size</div>
              <div className="zoom-menu__sizes" role="group" aria-label="App size">
                {APP_ZOOM_STEPS.map((p) => (
                  <button key={p} type="button" className="zoom-menu__size" aria-pressed={p === app} title={`Every window at ${p}%`} onClick={() => onApp(p)}>
                    {p}%
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
})
