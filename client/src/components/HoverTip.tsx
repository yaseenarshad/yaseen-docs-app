import { type HTMLAttributes, type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** The wait before the box shows: a pointer passing over does not flash it. */
const SHOW_MS = 350

/**
 * The app's own hover box (YAZ-4772): a native `title` shows nothing in the app. It wraps its child in a span; after a
 * short wait on hover, a small box shows under it. The box is in a portal on the page, so a cell that clips its text
 * (a column header) can not cut it, and it never takes the pointer.
 */
export function HoverTip({ text, children, ...rest }: { text: ReactNode; children: ReactNode } & Omit<HTMLAttributes<HTMLSpanElement>, 'onMouseEnter' | 'onMouseLeave'>) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const hide = () => {
    window.clearTimeout(timer.current)
    setAt(null)
  }
  // A press, a right-click or a scroll anywhere ends the hover (YAZ-4772 demo): a menu opened from the same header
  // never shows the box over it, and a box never stays where the header no longer is.
  useEffect(() => {
    if (at === null) return
    window.addEventListener('pointerdown', hide, true)
    window.addEventListener('contextmenu', hide, true)
    window.addEventListener('scroll', hide, true)
    return () => {
      window.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('contextmenu', hide, true)
      window.removeEventListener('scroll', hide, true)
    }
  }, [at])
  return (
    <span
      {...rest}
      onMouseEnter={(e) => {
        const el = e.currentTarget
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
          const r = el.getBoundingClientRect()
          setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - 268)), top: r.bottom + 6 })
        }, SHOW_MS)
      }}
      onMouseLeave={hide}
      onPointerDown={hide}
      onContextMenu={hide}
    >
      {children}
      {at !== null &&
        createPortal(
          <span className="hover-tip" role="tooltip" style={{ left: at.left, top: at.top }}>
            {text}
          </span>,
          document.body,
        )}
    </span>
  )
}
