import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * The app's ONE menu flyout (YAZ-4544 4F): the sidebar's right-click (`sidebar/ContextMenu.tsx`, YAZ-1674 D7), the
 * folder table's column menu (YAZ-4588 D42), its row and selection menus and their Fill › (`views/view/FillMenu.tsx`,
 * YAZ-4536 D12) all draw their flyouts here, so they open, place and close the same way.
 */

/** How long a hover waits before it swaps or closes an open flyout (YAZ-3085 D4): the pointer's time to cross a row. */
export const SWITCH_MS = 200

/**
 * A menu's ONE open flyout, with the hover wait (YAZ-3085 D4): the first flyout opens at once; a switch to another row
 * waits `SWITCH_MS`, so a pointer on its way into a flyout may cross the next row. `hover(null)` is a plain row: it
 * closes the flyout after the same wait. A click or a key never waits.
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
  /** The row's text (and glyph); its chevron is CSS, so `textContent` stays the bare label. */
  label: ReactNode
  open: boolean
  onHover: () => void
  onOpen: () => void
  onCloseFlyout: () => void
  /** A parent WITH a default (YAZ-3085 D1, "New note ›"): a click or Enter runs it; hover and ArrowRight open the flyout. Absent → they open it too. */
  onChoose?: () => void
  /** Drawn from `data-hint`, as on a leaf. */
  hint?: string
  /** More classes on the flyout, as `ctx-menu--glyphs`. */
  menuClassName?: string
  /** A change of it places the flyout again: its content grew (Fill's colour box). */
  measureKey?: unknown
  /** The flyout's content. */
  children: ReactNode
}

/**
 * A parent row ("Sort ›", "Open in ›"): a `menuitem` with `aria-haspopup`. It opens on hover, on a click and on
 * ArrowRight or Enter. The flyout stays while the pointer is in the row or the flyout (the flyout is its child).
 */
export function FlyoutParent({ label, open, onHover, onOpen, onCloseFlyout, onChoose, hint, menuClassName, measureKey, children }: FlyoutParentProps) {
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
        data-hint={hint}
        onClick={onChoose ?? onOpen}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'Enter') return
          e.preventDefault()
          e.stopPropagation()
          if (e.key === 'Enter' && onChoose !== undefined) onChoose()
          else onOpen()
        }}
      >
        {label}
      </button>
      {open && (
        <FlyoutMenu anchor={buttonRef} className={menuClassName} measureKey={measureKey} onCloseFlyout={onCloseFlyout}>
          {children}
        </FlyoutMenu>
      )}
    </div>
  )
}

/**
 * The flyout: a second `.ctx-menu`, right of its row and top-aligned, else left of it when it would spill (Finder's
 * rule), the top clamped inside the window. Hidden until measured, so it never flashes at 0,0. ArrowLeft (outside a
 * text field) and the first Esc close it alone and give the keyboard back to its row; the next Esc reaches the menu,
 * which closes.
 */
function FlyoutMenu({ anchor, className, measureKey, onCloseFlyout, children }: { anchor: RefObject<HTMLButtonElement | null>; className?: string; measureKey?: unknown; onCloseFlyout: () => void; children: ReactNode }) {
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
  }, [anchor, measureKey])

  // A flyout that closes with the keyboard in it gives the keyboard back to its row.
  useLayoutEffect(() => {
    const el = ref.current
    const parent = anchor.current
    return () => {
      if (el?.contains(document.activeElement)) parent?.focus()
    }
  }, [anchor])

  // Capture, before the menu's own window listener: this press closes the flyout only.
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
      className={`ctx-menu ctx-menu__sub${className === undefined ? '' : ` ${className}`}`}
      role="menu"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos === null ? 'hidden' : undefined }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' || e.target instanceof HTMLInputElement) return
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
