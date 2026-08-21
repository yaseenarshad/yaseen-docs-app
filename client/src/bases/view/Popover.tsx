import { type ReactNode, useEffect, useRef } from 'react'

interface PopoverProps {
  label: string
  onClose: () => void
  className?: string
  children: ReactNode
}

/**
 * Popover anchored under its trigger (GRO-2135): rendered inside the trigger's
 * `position: relative` wrapper, so click-away is any mousedown outside that wrapper
 * (the trigger itself then toggles normally); Esc closes; focus moves in on open.
 */
export function Popover({ label, onClose, className, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el === null) return
    ;(el.querySelector<HTMLElement>('input, select, button:not(:disabled)') ?? el).focus()
  }, [])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const anchor = ref.current?.parentElement
      if (anchor && !anchor.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div ref={ref} className={`base-popover${className ? ` ${className}` : ''}`} role="dialog" aria-label={label} tabIndex={-1}>
      {children}
    </div>
  )
}
