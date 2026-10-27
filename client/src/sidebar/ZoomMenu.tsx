/**
 * THE ZOOM MENU in the footer (YAZ-3432): one quiet chip after the cog that shows the sidebar zoom ("100%"). A click
 * opens a small menu upward with two rows, each the same "− 100% +" (`ZoomStepper`): App size on top, the App size of
 * every window (`settings.appZoom`, along `APP_ZOOM_STEPS`), and Sidebar at the bottom, next to the chip, the zoom of
 * the sidebar's lists (YAZ-3389; a Files window's own zoom there, D13). The keys never reach the App size: ⌘+ / ⌘− /
 * ⌘0 zoom a note or the sidebar (`zoomRequest.ts`).
 *
 * The menu goes to `document.body`: a fixed box inside a zoomed one scales and moves (`SessionList`). It is zoomed by
 * 1 / the page's zoom, so it keeps its size on the screen at every App size, and while it is open it keeps its place on
 * the screen too, so two quick clicks on + both land on +. The page's zoom is READ (`devicePixelRatio` against the one
 * at the open), never taken from the setting: main applies a new App size a moment after the setting changes, and a
 * menu that followed the setting would shrink and jump for that moment. Escape, a click outside and the window's blur
 * close it. In a Files window main also holds that window's resize for a new App size until the close
 * (`onOpenChange`, YAZ-3444): a resize keeps the window's right edge, so it would move the menu away from the pointer.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ZoomStepper } from './ZoomStepper'

interface ZoomMenuProps {
  /** The sidebar zoom in percent: the chip's label and the Sidebar row. */
  sidebar: number
  onSidebar: (percent: number) => void
  /** The App size in percent (`settings.appZoom`). */
  app: number
  onApp: (percent: number) => void
  /**
   * A Files window (YAZ-3444): told `true` when the menu opens and `false` when it goes, by any close or an unmount.
   * Main then holds that window's resize for a new App size until the close, so the window does not move under the menu.
   */
  onOpenChange?: (open: boolean) => void
}

/** The room between the chip and the menu, and the least between the menu and the window's right edge, in px. */
const GAP = 4

export const ZoomMenu = memo(function ZoomMenu({ sidebar, onSidebar, app, onApp, onOpenChange }: ZoomMenuProps) {
  // The menu's place while it is open, in SCREEN px (page px × the page's zoom at the open): its left edge and how far
  // its bottom is above the window's bottom. Screen px, so a new App size leaves it where it is. `dpr` is the screen's
  // own `devicePixelRatio` (the page's at 100%), so the page's zoom of any moment is `devicePixelRatio / dpr`.
  const [at, setAt] = useState<{ left: number; bottom: number; dpr: number } | null>(null)
  // How far the menu moves left to stay inside a narrow window (a Files window of 180 px), in page px.
  const [shift, setShift] = useState(0)
  // A page zoom change resizes the page: one render, which reads the new zoom.
  const [, resized] = useReducer((n: number) => n + 1, 0)
  const chipRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const open = at !== null
  const scale = at === null ? app / 100 : window.devicePixelRatio / at.dpr
  const close = useCallback(() => setAt(null), [])
  // The open and the close for main (YAZ-3444): every close path ends `open`, and an unmount runs the cleanup too.
  const openChangeRef = useRef(onOpenChange)
  openChangeRef.current = onOpenChange
  useEffect(() => {
    if (!open) return
    openChangeRef.current?.(true)
    return () => openChangeRef.current?.(false)
  }, [open])

  const toggle = () => {
    if (open) return close()
    const r = chipRef.current?.getBoundingClientRect()
    if (r === undefined) return
    // At rest the page's zoom is the App size.
    const zoom = app / 100
    setShift(0)
    setAt({ left: r.left * zoom, bottom: (window.innerHeight - r.top + GAP) * zoom, dpr: window.devicePixelRatio / zoom })
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
    window.addEventListener('resize', resized)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', resized)
    }
  }, [open, close])

  // Kept inside the window: measured after each place or page zoom, never past its right edge nor its left. The menu
  // is `max-content` wide (app.css), so the move never changes its width.
  const shiftRef = useRef(shift)
  shiftRef.current = shift
  useLayoutEffect(() => {
    const r = menuRef.current?.getBoundingClientRect()
    if (r === undefined) return
    const left = r.left + shiftRef.current
    setShift(Math.max(0, Math.min(left + r.width - (window.innerWidth - GAP), left)))
  }, [at, scale])

  const place: CSSProperties | undefined = at === null ? undefined : { left: at.left / scale - shift, bottom: at.bottom / scale }
  // The chip shows the sidebar zoom alone; its tooltip and its accessible name tell both values (D1).
  const both = `Zoom: sidebar ${Math.round(sidebar)}%, App size ${app}%`
  return (
    <>
      <button
        ref={chipRef}
        type="button"
        className={`zoom-chip${open ? ' zoom-chip--open' : ''}`}
        title={both}
        aria-label={both}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        {Math.round(sidebar)}%
      </button>
      {place !== undefined &&
        createPortal(
          <div ref={menuRef} className="zoom-menu" role="dialog" aria-label="Zoom" style={place}>
            {/* 1 / the page's zoom: the two multiply to 1, so the menu is the same size at every App size. */}
            <div className="zoom-menu__body" style={{ zoom: 1 / scale }}>
              <span className="zoom-menu__label">App size</span>
              <ZoomStepper kind="app" value={app} onChange={onApp} />
              <span className="zoom-menu__label">Sidebar</span>
              <ZoomStepper kind="sidebar" value={sidebar} onChange={onSidebar} />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
})
