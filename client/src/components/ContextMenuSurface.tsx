import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

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
    // A click in a frame — a draw.io diagram — never reaches this page: the window's blur says it (YAZ-4156 bug 3H),
    // as the zoom menu and the tab row panel do. A frame that has the keyboard as the menu opens lets it go first, or
    // the window, already blurred, could not blur again. A menu only: a dialog on the surface (the icon picker's search,
    // a board's Info) keeps what was typed when the user switches apps.
    const onBlur = role === 'menu'
    if (onBlur && document.activeElement instanceof HTMLIFrameElement) document.activeElement.blur()
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', closeOnEscape)
    if (onBlur) window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('blur', close)
    }
  }, [role])

  useLayoutEffect(() => {
    const bounds = menuRef.current?.getBoundingClientRect()
    if (bounds === undefined) return
    setPosition({
      left: Math.max(0, Math.min(x, window.innerWidth - bounds.width)),
      top: Math.max(0, Math.min(y, window.innerHeight - bounds.height)),
    })
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
