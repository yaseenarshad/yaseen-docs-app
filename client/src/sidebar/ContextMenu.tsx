import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { MenuAction, MenuEntry, MenuParent, MenuStrip } from './menuSections'

/** How long a hover waits before it swaps or closes an open flyout (YAZ-3085 D4): the pointer's time to cross a row. */
export const SWITCH_MS = 200

interface ContextMenuProps {
  x: number
  y: number
  /**
   * The items as data (🔒 D8, YAZ-1674) — built by a sections builder, where every gating rule
   * lives: the file tree's `buildMenuSections` (six groups, 🔒 D7), the vault switcher's
   * `buildVaultMenuSections` (five, YAZ-1798 · YAZ-1974) or a tab's `TabMenu` (four, YAZ-2949 D6).
   * This component only draws them: a
   * `role="group"` per NON-EMPTY section (the separator is CSS between adjacent groups), and one
   * button per item whose ONLY text child is the label — the hint is drawn from `data-hint`, so
   * `textContent` and the accessible name stay the bare label. A parent item ("Open in ▸", D7
   * amended) opens a flyout drawn by the SAME group renderer, one level deep.
   */
  sections: readonly (readonly MenuEntry[])[]
  onClose: () => void
}

/** Groups of items (🔒 D7): one `role="group"` per NON-EMPTY section — the root and every flyout share it. */
function Groups<T extends MenuEntry>({ sections, render }: { sections: readonly (readonly T[])[]; render: (item: T) => ReactNode }) {
  return (
    <>
      {sections
        .filter((section) => section.length > 0)
        .map((section) => (
          <div key={section[0].id} className="ctx-menu__group" role="group">
            {section.map(render)}
          </div>
        ))}
    </>
  )
}

/** A leaf: `onSelect()` then `onClose()` — every item closes the WHOLE menu (🔒 D8). */
function ActionButton({ item, onClose, onMouseEnter }: { item: MenuAction; onClose: () => void; onMouseEnter?: () => void }) {
  // The item's preview (YAZ-3091 D8): on while the pointer or the focus is on it, off when both leave or it unmounts.
  const previewing = useRef(false)
  const preview = useRef(item.onPreview)
  preview.current = item.onPreview
  const setPreview = (on: boolean) => {
    if (previewing.current === on) return
    previewing.current = on
    preview.current?.(on)
  }
  useEffect(() => () => {
    if (previewing.current) preview.current?.(false)
  }, [])
  return (
    <button
      type="button"
      role="menuitem"
      className={`ctx-menu__item${item.danger === true ? ' ctx-menu__item--danger' : ''}`}
      disabled={item.disabled}
      data-hint={item.hint}
      onMouseEnter={() => {
        onMouseEnter?.()
        setPreview(true)
      }}
      onMouseLeave={() => setPreview(false)}
      onFocus={() => setPreview(true)}
      onBlur={() => setPreview(false)}
      // An item whose handler already closes the menu (the create group's inline input) just
      // sets the same null twice — harmless.
      onClick={() => {
        item.onSelect()
        onClose()
      }}
    >
      {item.icon === undefined ? (
        item.label
      ) : (
        <span className="ctx-menu__label">
          {item.icon}
          {item.label}
        </span>
      )}
    </button>
  )
}

/** A strip (YAZ-3727 D15): the block menu's icon buttons in one row, the same markup and CSS as there. */
function StripButtons({ item, onClose, onMouseEnter }: { item: MenuStrip; onClose: () => void; onMouseEnter: () => void }) {
  return (
    <div className="ctx-menu__strip" role="group" aria-label={item.label} onMouseEnter={onMouseEnter}>
      {item.buttons.map((button) => (
        <button
          key={button.label}
          type="button"
          role="menuitem"
          className={`ctx-menu__strip-button${button.active ? ' active' : ''}`}
          aria-label={button.label}
          aria-pressed={button.active}
          title={button.label}
          onClick={() => {
            button.onSelect()
            onClose()
          }}
        >
          {button.icon}
        </button>
      ))}
    </div>
  )
}

/**
 * The flyout (D7 amended, YAZ-1674): a second `.ctx-menu`, opened to the RIGHT of its parent row,
 * top-aligned with it, measured after the first paint like the root — and when its right edge
 * would spill off the viewport it opens to the LEFT of the parent instead (Finder's rule), the
 * top clamped exactly as the root clamps. Hidden until measured so it never flashes at 0,0.
 */
function Flyout({ anchor, sections, onClose, onCloseFlyout }: { anchor: RefObject<HTMLButtonElement | null>; sections: readonly (readonly MenuAction[])[]; onClose: () => void; onCloseFlyout: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Once per open: the anchor ref is stable and the flyout mounts only while it is open.
  useLayoutEffect(() => {
    const el = ref.current
    const parent = anchor.current
    if (el === null || parent === null) return
    const r = el.getBoundingClientRect()
    const p = parent.getBoundingClientRect()
    const left = p.right + r.width > window.innerWidth ? Math.max(0, p.left - r.width) : p.right
    setPos({ left, top: Math.max(0, Math.min(p.top, window.innerHeight - r.height)) })
  }, [anchor])

  // A glyph on any row (the Search menu's Type list, YAZ-3511 D13): the rows without one line up after its slot.
  const glyphs = sections.some((section) => section.some((item) => item.icon !== undefined))
  return (
    <div
      ref={ref}
      className={`ctx-menu ctx-menu__sub${glyphs ? ' ctx-menu--glyphs' : ''}`}
      role="menu"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos === null ? 'hidden' : undefined }}
      onMouseDown={(e) => e.stopPropagation()}
      // ArrowLeft steps back out of the flyout alone; Escape does the same through the root's
      // window listener, which asks whether a flyout is open before closing everything.
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft') return
        e.preventDefault()
        e.stopPropagation()
        onCloseFlyout()
      }}
    >
      <Groups sections={sections} render={(item) => <ActionButton key={item.id} item={item} onClose={onClose} />} />
    </div>
  )
}

/**
 * A parent ("Open in ▸"): a `menuitem` with `aria-haspopup`, its chevron drawn by CSS so the text
 * stays the bare label. Opens on hover AND on click (and ArrowRight / Enter). A parent WITH a
 * default (YAZ-3085 D1, "New note ▸") runs it on a click or Enter and closes the menu, as a leaf
 * does; only hover and ArrowRight open its flyout. The flyout stays while the pointer is inside the
 * row or the flyout — there is no leave rule — and closes when the pointer enters a DIFFERENT
 * top-level item, after the root's hover wait (D4).
 * Keyboard: Tab already reaches every item (they are buttons), so Tab + Enter + Escape is the
 * complete path; ArrowRight to open (and Enter, on a parent with no default) and ArrowLeft to close
 * are sugar on top of it.
 */
function ParentItem({ item, open, onHover, onOpen, onCloseFlyout, onClose }: { item: MenuParent; open: boolean; onHover: () => void; onOpen: () => void; onCloseFlyout: () => void; onClose: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const choose = () => {
    if (item.onSelect === undefined) return onOpen()
    item.onSelect()
    onClose()
  }
  return (
    <div className="ctx-menu__parent" onMouseEnter={onHover}>
      <button
        ref={buttonRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className="ctx-menu__item ctx-menu__item--parent"
        data-hint={item.hint}
        onClick={choose}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'Enter') return
          e.preventDefault()
          e.stopPropagation()
          if (e.key === 'Enter') choose()
          else onOpen()
        }}
      >
        {item.label}
      </button>
      {open && <Flyout anchor={buttonRef} sections={item.children} onClose={onClose} onCloseFlyout={onCloseFlyout} />}
    </div>
  )
}

/** The sidebar's right-click menu — the file tree's (GRO-2022) and the vault switcher's (YAZ-1798) — and a tab's (YAZ-2949 D6). The overlay catches click-away and stray right-clicks. */
export function ContextMenu({ x, y, sections, onClose }: ContextMenuProps) {
  // A glyph on any row (YAZ-3264 D6) leaves an empty slot on the rows without one, so every label
  // starts at the same place, as in a Finder menu. A flyout is its own menu and keeps its own rule.
  const glyphs = sections.some((section) => section.some((item) => item.kind !== 'strip' && item.children === undefined && item.icon !== undefined))
  // The ONE open flyout (D7 amended): at most one parent is expanded at a time.
  const [openId, setOpenId] = useState<string | null>(null)
  // Hover intent (YAZ-3085 D4): three parents stand in a column, so a pointer on its way into a
  // flyout crosses the next one. A SWITCH away from an open flyout waits SWITCH_MS; the pointer that
  // reaches the flyout re-enters its own parent (the flyout is its child) and cancels it. The first
  // flyout opens at once, and a click or a key never waits.
  const switchTimer = useRef<number | undefined>(undefined)
  const hover = (id: string | null) => {
    window.clearTimeout(switchTimer.current)
    if (openId === null) setOpenId(id)
    else if (id !== openId) switchTimer.current = window.setTimeout(() => setOpenId(id), SWITCH_MS)
  }
  // A click or a key opens (or, with null, closes) at once, and drops any switch the pointer left pending.
  const openNow = (id: string | null) => {
    window.clearTimeout(switchTimer.current)
    setOpenId(id)
  }
  useEffect(() => () => window.clearTimeout(switchTimer.current), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      window.clearTimeout(switchTimer.current)
      // A flyout owns its own Escape: the first press closes it alone, the next closes the menu.
      if (openId !== null) setOpenId(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, openId])

  // Viewport clamping (GRO-2204): render at the cursor, then measure and pull the menu back
  // inside the window instead of spilling off an edge.
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    setPos({ left: Math.max(0, Math.min(x, window.innerWidth - r.width)), top: Math.max(0, Math.min(y, window.innerHeight - r.height)) })
  }, [x, y])

  return (
    <div
      className="ctx-overlay"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div ref={menuRef} className={`ctx-menu${glyphs ? ' ctx-menu--glyphs' : ''}`} style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => e.stopPropagation()} role="menu">
        <Groups
          sections={sections}
          render={(item) =>
            item.kind === 'strip' ? (
              <StripButtons key={item.id} item={item} onClose={onClose} onMouseEnter={() => hover(null)} />
            ) : item.children === undefined ? (
              // Entering a DIFFERENT top-level item is what closes an open flyout — after the hover wait (D4).
              <ActionButton key={item.id} item={item} onClose={onClose} onMouseEnter={() => hover(null)} />
            ) : (
              <ParentItem key={item.id} item={item} open={openId === item.id} onHover={() => hover(item.id)} onOpen={() => openNow(item.id)} onCloseFlyout={() => openNow(null)} onClose={onClose} />
            )
          }
        />
      </div>
    </div>
  )
}
