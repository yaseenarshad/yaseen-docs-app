import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface PopoverProps {
  label: string
  onClose: () => void
  className?: string
  /** Trigger to hang off with `position: fixed` (YAZ-743), for triggers inside a scrolling ancestor. */
  anchor?: HTMLElement | null
  children: ReactNode
}

/**
 * Popover anchored under its trigger (GRO-2135): rendered inside the trigger's
 * `position: relative` wrapper, so click-away is any mousedown outside that wrapper
 * (the trigger itself then toggles normally); Esc closes; focus moves in on open.
 * With `anchor` it is placed fixed under that element instead, measured and clamped
 * to the viewport like `ContextMenu`, so a clipping ancestor cannot cut it off — and
 * a scroll or resize closes it, since the fixed placement is measured once.
 */
export function Popover({ label, onClose, className, anchor, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties>()

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    ;(el.querySelector<HTMLElement>('input, select, button:not(:disabled)') ?? el).focus()
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!anchor || el === null) return
    const a = anchor.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    setPos({
      position: 'fixed',
      top: Math.max(0, Math.min(a.bottom + 6, window.innerHeight - r.height)),
      left: Math.max(0, Math.min(a.left, window.innerWidth - r.width)),
    })
  }, [anchor])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      const trigger = anchor ?? ref.current?.parentElement
      if (trigger && !trigger.contains(target) && ref.current?.contains(target) !== true) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onReflow = () => {
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

  return (
    <div
      ref={ref}
      className={`view-popover${className ? ` ${className}` : ''}${anchor ? ' view-popover--fixed' : ''}`}
      style={pos}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
    >
      {children}
    </div>
  )
}
