import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { fitMenu } from '../lib/fitMenu'

interface ContextMenuSurfaceProps {
  x: number
  y: number
  onClose: () => void
  children: ReactNode
  /** A floor in px (YAZ-1767 D5, YAZ-1974): the vault switcher is at least its anchor's width and grows to fit its names; menus keep their content width. */
  minWidth?: number
  /** Extra class beside `ctx-menu` (YAZ-1767 D5): `ctx-menu--panel` restyles the surface as a flush drop-down panel. */
  className?: string
  /** A fixed width in px: a board's Info popover (YAZ-3028 D11). Menus otherwise keep their content width. */
  width?: number
  /** What the surface announces: a `menu` by default; the Info popover is a `dialog` (Draw's 🔒 YAZ-1835 D6). */
  role?: 'menu' | 'dialog'
}

/** Action-free context-menu mechanics shared by menus whose commands stay domain-owned. */
export function ContextMenuSurface({ x, y, onClose, children, minWidth, className, width, role = 'menu' }: ContextMenuSurfaceProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const [position, setPosition] = useState({ left: x, top: y })
  onCloseRef.current = onClose

  useEffect(() => {
    const close = () => onCloseRef.current()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    // A press in a frame — a draw.io diagram — never reaches this page (YAZ-4156 bug 3H). The page sees the keyboard go
    // into the frame: the window blurs, and the frame is the active element. That counts as a press outside. A switch to
    // another app moves no focus here, so the surface stays, with what was typed in it (the add-column form's name, the
    // icon picker's search). The check waits a tick: the frame is the active element only once the blur is done. A frame
    // that has the keyboard as the surface opens lets it go first, or the window, already blurred, could not blur again.
    if (document.activeElement instanceof HTMLIFrameElement) document.activeElement.blur()
    let tick: number | undefined
    const closeOnFrame = () => {
      window.clearTimeout(tick)
      tick = window.setTimeout(() => {
        if (document.activeElement instanceof HTMLIFrameElement) close()
      })
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('blur', closeOnFrame)
    return () => {
      window.clearTimeout(tick)
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', closeOnFrame)
    }
  }, [])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (menu === null) return
    const place = () => {
      // Taller than the window (a long row menu at a high zoom, YAZ-3746 13AO): it fits the window and scrolls; `x`, `y`
      // and the window are screen px, the menu's `left` and `top` its own (YAZ-3746 13AM). The one rule: `lib/fitMenu.ts`.
      const { left, top } = fitMenu(menu, x, y)
      setPosition((at) => (at.left === left && at.top === top ? at : { left, top }))
    }
    place()
    // A menu whose content grows after it opens (the header menu's "Edit column…", YAZ-4544) is placed again, so it
    // stays inside the window. The observer fires only on a change of the menu's own size.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(place)
    observer.observe(menu)
    return () => observer.disconnect()
  }, [x, y])

  return (
    <div
      ref={menuRef}
      className={['ctx-menu', className].filter(Boolean).join(' ')}
      role={role}
      style={{ left: position.left, top: position.top, width, minWidth }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  )
}
