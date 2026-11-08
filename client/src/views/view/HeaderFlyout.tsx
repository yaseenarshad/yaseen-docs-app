import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SWITCH_MS } from '../../sidebar/ContextMenu'

/**
 * The column menu's ONE open flyout (YAZ-4588 D42), with the sidebar menu's hover wait (YAZ-3085 D4): the first
 * flyout opens at once; a switch to another row waits `SWITCH_MS`, so a pointer on its way into a flyout may
 * cross the next row. `hover(null)` is a plain row: it closes the flyout after the same wait. A click or a key never waits.
 */
export function useFlyout<T extends string>() {
  const [open, setOpen] = useState<T | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const hover = (id: T | null) => {
    window.clearTimeout(timer.current)
    if (open === null) setOpen(id)
    else if (id !== open) timer.current = window.setTimeout(() => setOpen(id), SWITCH_MS)
  }
  const openNow = (id: T | null) => {
    window.clearTimeout(timer.current)
    setOpen(id)
  }
  return { open, hover, openNow }
}

interface FlyoutParentProps {
  label: string
  open: boolean
  onHover: () => void
  onOpen: () => void
  onCloseFlyout: () => void
  /** The flyout's groups. */
  children: ReactNode
}

/**
 * A parent row ("Sort ›"), the sidebar menu's (`sidebar/ContextMenu.tsx`): its chevron is CSS, so the text stays
 * the bare label. It opens on hover, on a click, and on ArrowRight or Enter.
 */
export function FlyoutParent({ label, open, onHover, onOpen, onCloseFlyout, children }: FlyoutParentProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  return (
    <div className="ctx-menu__parent" onMouseEnter={onHover}>
      <button
        ref={buttonRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className="ctx-menu__item ctx-menu__item--parent"
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'Enter') return
          e.preventDefault()
          e.stopPropagation()
          onOpen()
        }}
      >
        {label}
      </button>
      {open && (
        <Flyout anchor={buttonRef} onCloseFlyout={onCloseFlyout}>
          {children}
        </Flyout>
      )}
    </div>
  )
}

/**
 * The flyout: right of its row, top-aligned, else left of it, inside the window (the sidebar flyout's place).
 * ArrowLeft and the first Esc close it alone and give the keyboard back to its row; the next Esc reaches
 * `ContextMenuSurface`, which closes the menu (the sidebar menu's rule).
 */
function Flyout({ anchor, onCloseFlyout, children }: { anchor: RefObject<HTMLButtonElement | null>; onCloseFlyout: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const close = useRef(onCloseFlyout)
  close.current = onCloseFlyout

  useLayoutEffect(() => {
    const el = ref.current
    const parent = anchor.current
    if (el === null || parent === null) return
    const r = el.getBoundingClientRect()
    const p = parent.getBoundingClientRect()
    const left = p.right + r.width > window.innerWidth ? Math.max(0, p.left - r.width) : p.right
    setPos({ left, top: Math.max(0, Math.min(p.top, window.innerHeight - r.height)) })
    // A flyout that closes with the keyboard in it gives the keyboard back to its row.
    return () => {
      if (el.contains(document.activeElement)) parent.focus()
    }
  }, [anchor])

  // Capture, before the surface's own window listener: this press closes the flyout only.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div
      ref={ref}
      className="ctx-menu ctx-menu__sub"
      role="menu"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos === null ? 'hidden' : undefined }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft') return
        e.preventDefault()
        e.stopPropagation()
        onCloseFlyout()
      }}
    >
      {children}
    </div>
  )
}

/** A flyout row: the ✓ is drawn from `data-hint`, as on the sidebar menu's choice rows, so the text stays the bare label. */
export function FlyoutItem({ label, checked = false, disabled, tip, onSelect }: { label: string; checked?: boolean; disabled?: boolean; tip?: string; onSelect: () => void }) {
  return (
    <button type="button" role="menuitem" className="ctx-menu__item" data-hint={checked ? '✓' : undefined} disabled={disabled} title={tip} onClick={onSelect}>
      {label}
    </button>
  )
}
