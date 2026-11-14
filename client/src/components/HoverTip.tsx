import { type HTMLAttributes, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** The wait before the box shows: a pointer passing over does not flash it. */
const SHOW_MS = 350
/** The box's least room from the window's edge. */
const EDGE = 8

/**
 * The app's own hover box (YAZ-4772): a native `title` shows nothing in the app. It wraps its child in a span; after a
 * short wait on hover, a small box shows under it. The box is in a portal on the page, so a cell that clips its text
 * (a column header) can not cut it, and it never takes the pointer.
 *
 * PLACE (YAZ-5130 round 2, Yaseen: "why is the tool tip so far away?"): the box starts at its mark's left edge. It
 * moves left only as far as its REAL width needs to stay in the window. It once moved by a fixed 260 px, so a short
 * box near the right edge stood far to the left of its mark.
 * `focus` (YAZ-5130 round 2): a keyboard focus on the mark shows the box at once, and the blur hides it. Off by
 * default: the other boxes stay hover-only, so a focus a menu gives back shows nothing.
 */
export function HoverTip({ text, children, focus = false, ...rest }: { text: ReactNode; children: ReactNode; focus?: boolean } & Omit<HTMLAttributes<HTMLSpanElement>, 'onMouseEnter' | 'onMouseLeave' | 'onFocus' | 'onBlur'>) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const box = useRef<HTMLSpanElement>(null)
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
  // The box's real width, before it paints: it moves left only as far as it must.
  useLayoutEffect(() => {
    const el = box.current
    if (at === null || el === null) return
    el.style.left = `${Math.max(EDGE, Math.min(at.left, window.innerWidth - el.offsetWidth - EDGE))}px`
  }, [at])
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setAt({ left: r.left, top: r.bottom + 6 })
  }
  return (
    <span
      {...rest}
      onMouseEnter={(e) => {
        const el = e.currentTarget
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => show(el), SHOW_MS)
      }}
      onMouseLeave={hide}
      onFocus={focus ? (e) => show(e.currentTarget) : undefined}
      onBlur={focus ? hide : undefined}
      onPointerDown={hide}
      onContextMenu={hide}
    >
      {children}
      {at !== null &&
        createPortal(
          <span ref={box} className="hover-tip" role="tooltip" style={{ left: at.left, top: at.top }}>
            {text}
          </span>,
          document.body,
        )}
    </span>
  )
}
