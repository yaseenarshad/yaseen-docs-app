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
}

/** Action-free context-menu mechanics shared by menus whose commands stay domain-owned. */
export function ContextMenuSurface({ x, y, onClose, children, minWidth, className }: ContextMenuSurfaceProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const [position, setPosition] = useState({ left: x, top: y })
  onCloseRef.current = onClose

  useEffect(() => {
    const close = () => onCloseRef.current()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

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
      role="menu"
      style={{ left: position.left, top: position.top, minWidth }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  )
}
