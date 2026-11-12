import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cssZoom } from '../../lib/cssZoom'

interface PopoverProps {
  label: string
  onClose: () => void
  className?: string
  /** Keep toolbar menus on screen as their searchable content changes size. */
  constrainToViewport?: boolean
  /** Trigger to hang off with `position: fixed` (YAZ-743), for triggers inside a scrolling ancestor. */
  anchor?: HTMLElement | null
  /** What takes the keyboard on open: the first control (default), or only a text field, else the popover itself. */
  focusOn?: 'control' | 'field'
  /**
   * On the body, not in the trigger's tree (YAZ-4878 demo, a dropdown inside the View tab): a popover that fits itself
   * with a `translate` (`constrainToViewport`) is a containing block for a `position: fixed` child, which was placed
   * off the window and cut by the tab's scroll. Needs `anchor`. A mousedown in it never reaches the outer popover's
   * click-away, and its Escape closes it alone.
   */
  portal?: boolean
  children: ReactNode
}

/**
 * Popover anchored under its trigger (GRO-2135): rendered inside the trigger's
 * `position: relative` wrapper, so click-away is any mousedown outside that wrapper
 * (the trigger itself then toggles normally); Esc closes; focus moves in on open.
 * With `anchor` it is placed fixed under that element instead, measured and clamped
 * to the viewport like `ContextMenu`, so a clipping ancestor cannot cut it off — and
 * outside scrolling or window resizing closes it. Content resizing refits it in place.
 */
/** The least room an anchored popover keeps from the window's edges. */
const EDGE = 8

export function Popover({ label, onClose, className, anchor, children, constrainToViewport = false, focusOn = 'control', portal = false }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties>()

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    // `field`: a text field takes the keyboard (the Columns tab's search), else the popover itself, so no button opens
    // with a focus ring (the toolbar's menus, YAZ-3746 demo). Otherwise the first control, as before.
    const first = focusOn === 'field' ? 'input[type="text"], input[type="search"]' : 'input, select, button:not(:disabled)'
    ;(el.querySelector<HTMLElement>(first) ?? el).focus()
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!anchor || el === null) return
    const fit = () => {
      const a = anchor.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      // Measured on screen; written in the popover's own px (YAZ-3746 13AM): inside a zoomed folder page a fixed box's
      // `top` and `left` are scaled by the zoom, so the menu drifted right and down as the page zoomed in.
      const z = cssZoom(el)
      // Never against the window's edge: an 8 px margin on every side (the checker of YAZ-4820: the Style panel touched it).
      const top = Math.max(EDGE, Math.min(a.bottom + 6, window.innerHeight - r.height - EDGE)) / z
      const left = Math.max(EDGE, Math.min(a.left, window.innerWidth - r.width - EDGE)) / z
      setPos(previous => previous?.top === top && previous.left === left ? previous : { position: 'fixed', top, left })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [anchor])

  useLayoutEffect(() => {
    const el = ref.current
    if (!constrainToViewport || anchor || !el) return
    const fit = () => {
      el.style.translate = ''
      el.style.maxWidth = ''
      const cssMaxWidth = parseFloat(getComputedStyle(el).maxWidth) || Infinity
      let left = 0, top = 0, right = window.innerWidth, bottom = window.innerHeight
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        const bounds = parent.getBoundingClientRect()
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX || style.overflow)) {
          left = Math.max(left, bounds.left)
          right = Math.min(right, bounds.right)
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY || style.overflow)) {
          top = Math.max(top, bounds.top)
          bottom = Math.min(bottom, bounds.bottom)
        }
      }
      // The room is measured on screen; sizes and the shift are written in the popover's own px, so in a zoomed folder
      // page they are divided by its zoom (YAZ-3746 13AP: at 200% the popover was twice too tall and moved twice too
      // far, which grew the page, and each scroll fitted it again: the page slid down).
      const z = cssZoom(el)
      el.style.maxWidth = `${Math.min(cssMaxWidth, Math.max(0, right - left - 24) / z)}px`
      el.style.minWidth = `${Math.min(260, Math.max(0, right - left - 24) / z)}px`
      el.style.maxHeight = `${Math.max(0, Math.min(window.innerHeight * .6, bottom - top - 24)) / z}px`
      const rect = el.getBoundingClientRect()
      const x = Math.max(left + 12 - rect.left, Math.min(0, right - 12 - rect.right))
      const y = Math.max(top + 12 - rect.top, Math.min(0, bottom - 12 - rect.bottom))
      el.style.translate = `${x / z}px ${y / z}px`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    for (let parent = el.parentElement; parent; parent = parent.parentElement) observer.observe(parent)
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !el.contains(event.target)) fit()
    }
    window.addEventListener('resize', fit)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [anchor, constrainToViewport])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      const trigger = anchor ?? ref.current?.parentElement
      if (trigger && !trigger.contains(target) && ref.current?.contains(target) !== true) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onReflow = (event: Event) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    if (anchor) {
      window.addEventListener('scroll', onReflow, true)
      window.addEventListener('resize', onReflow)
    }
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    }
  }, [anchor, onClose])

  // The outer popover's click-away and Escape listen on the window: a portal's events stop before them (React stops the
  // native event at its root), so the outer stays while this one closes.
  const keep = portal
    ? {
        onMouseDown: (e: ReactMouseEvent) => e.stopPropagation(),
        onKeyDown: (e: ReactKeyboardEvent) => {
          if (e.key !== 'Escape') return
          e.stopPropagation()
          onClose()
        },
      }
    : {}
  const node = (
    <div
      ref={ref}
      className={`view-popover${className ? ` ${className}` : ''}${anchor ? ' view-popover--fixed' : ''}`}
      style={pos}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      {...keep}
    >
      {children}
    </div>
  )
  return portal ? createPortal(node, document.body) : node
}
