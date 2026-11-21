import { type ReactNode, useRef, useState } from 'react'
import { Popover } from './Popover'

/**
 * A quiet select-looking button with a popover under it (YAZ-4878, YAZ-4864, YAZ-4909): the panel is on the body,
 * fixed under the trigger (`Popover`'s `portal`), so a scrolling or translated host (the View tab, the folder ⚙, the
 * Settings dialog) never places or cuts it. `children` draws the panel and gets `close`.
 */
export function Dropdown({ label, className, trigger, onOpen, panelClassName, children }: { label: string; className?: string; trigger: ReactNode; onOpen?: () => void; panelClassName?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <span className="view-dropdown__wrap">
      <button
        ref={ref}
        type="button"
        className={`view-select view-dropdown${className === undefined ? '' : ` ${className}`}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) onOpen?.()
          setOpen(!open)
        }}
      >
        {trigger}
      </button>
      {open && (
        <Popover label={label} anchor={ref.current} portal onClose={() => setOpen(false)} className={`view-dropdown__panel${panelClassName === undefined ? '' : ` ${panelClassName}`}`}>
          {children(() => setOpen(false))}
        </Popover>
      )}
    </span>
  )
}
