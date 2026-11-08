import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { capital, fillSwatch } from '../../editor/table/colours'
import { TABLE_COLORS } from '../../editor/table/tableComment'
import { ColourBox } from '../../editor/highlightColourBox'
import type { Hex } from '../../lib/colour'
import { SWITCH_MS } from '../../sidebar/ContextMenu'

export type FillTarget = 'cell' | 'row'

interface FillMenuProps {
  /** The clicked cell's fill now: the custom box opens at it when it is a custom one. */
  start?: string
  /** One fill write: a colour name, `#rrggbb`, or null for No fill. */
  onFill: (target: FillTarget, fill: string | null) => void
  onClose: () => void
}

const LABEL: Record<FillTarget, string> = { cell: 'Fill cell', row: 'Fill row' }

/**
 * "Fill cell ›" and "Fill row ›" (YAZ-4536 D12), for the folder table's row right-click
 * (`PageContextMenu`'s `extra`). Each flyout is the table block's Fill menu (`tableMenu.ts`): No fill,
 * the ten colours with swatches, and "Custom colour…". The rows are the app's flyout rows
 * (`sidebar/ContextMenu.tsx`: the same classes, the right-or-left place, the hover wait between two
 * parents). A colour closes the menu. "Custom colour…" opens the note's colour box under it, as the
 * cell toolbar does: each finished pick is one write, and the box stays for the next.
 */
export function FillMenu({ start, onFill, onClose }: FillMenuProps) {
  const [open, setOpen] = useState<FillTarget | null>(null)
  const switchTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(switchTimer.current), [])
  const hover = (target: FillTarget) => {
    window.clearTimeout(switchTimer.current)
    if (open === null) setOpen(target)
    else if (target !== open) switchTimer.current = window.setTimeout(() => setOpen(target), SWITCH_MS)
  }
  const openNow = (target: FillTarget | null) => {
    window.clearTimeout(switchTimer.current)
    setOpen(target)
  }
  return (
    <>
      {(['cell', 'row'] as const).map((target) => (
        <FillParent key={target} target={target} open={open === target} start={start} onHover={() => hover(target)} onOpen={() => openNow(target)} onCloseFlyout={() => openNow(null)} onFill={onFill} onClose={onClose} />
      ))}
    </>
  )
}

function FillParent({ target, open, start, onHover, onOpen, onCloseFlyout, onFill, onClose }: { target: FillTarget; open: boolean; start: string | undefined; onHover: () => void; onOpen: () => void; onCloseFlyout: () => void; onFill: FillMenuProps['onFill']; onClose: () => void }) {
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
        {LABEL[target]}
      </button>
      {open && <FillFlyout anchor={buttonRef} start={start} onFill={(fill) => onFill(target, fill)} onCloseFlyout={onCloseFlyout} onClose={onClose} />}
    </div>
  )
}

function FillFlyout({ anchor, start, onFill, onCloseFlyout, onClose }: { anchor: RefObject<HTMLButtonElement | null>; start: string | undefined; onFill: (fill: string | null) => void; onCloseFlyout: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const boxHolder = useRef<HTMLDivElement>(null)
  const box = useRef<ColourBox | null>(null)
  const [custom, setCustom] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const pick = useRef(onFill)
  pick.current = onFill
  // The box opens at the fill there is when it opens; a pick moves the box itself.
  const startAt = useRef(start)
  startAt.current = start

  // The sidebar flyout's place: right of the parent row, top-aligned, else left of it; again when the box opens.
  useLayoutEffect(() => {
    const el = ref.current
    const parent = anchor.current
    if (el === null || parent === null) return
    const r = el.getBoundingClientRect()
    const p = parent.getBoundingClientRect()
    const left = p.right + r.width > window.innerWidth ? Math.max(0, p.left - r.width) : p.right
    setPos({ left, top: Math.max(0, Math.min(p.top, window.innerHeight - r.height)) })
  }, [anchor, custom])

  useEffect(() => {
    if (!custom) return
    if (box.current === null) {
      box.current = new ColourBox(document, { preview: () => {}, pick: (hex) => pick.current(hex), close: () => setCustom(false) })
      boxHolder.current?.append(box.current.el)
    }
    const at = startAt.current
    box.current.show(at?.startsWith('#') === true ? (at as Hex) : '#000000')
    return () => box.current?.hide()
  }, [custom])

  const row = (label: string, fill: string | null, swatch?: string) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      className="ctx-menu__item"
      onClick={() => {
        onFill(fill)
        onClose()
      }}
    >
      {swatch === undefined ? (
        label
      ) : (
        <span className="ctx-menu__label">
          <span className="table-menu-swatch" style={{ background: swatch }} />
          {label}
        </span>
      )}
    </button>
  )

  return (
    <div
      ref={ref}
      className="ctx-menu ctx-menu__sub ctx-menu--glyphs"
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
      <div className="ctx-menu__group" role="group">
        {row('No fill', null)}
      </div>
      <div className="ctx-menu__group" role="group">
        {TABLE_COLORS.map((c) => row(capital(c), c, fillSwatch(c)))}
      </div>
      <div className="ctx-menu__group" role="group">
        <button type="button" role="menuitem" className="ctx-menu__item" aria-expanded={custom} onClick={() => setCustom(!custom)}>
          Custom colour…
        </button>
        <div ref={boxHolder} className="view-fill-menu__box" />
      </div>
    </div>
  )
}
