import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FlyoutParent, useFlyout } from '../components/Flyout'
import { fitMenu } from '../lib/fitMenu'
import type { MenuAction, MenuEntry, MenuParent, MenuStrip } from './menuSections'

export { SWITCH_MS } from '../components/Flyout'

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
/** The pick of each radio set of an open menu (YAZ-4460 demo): a row's id, once a click made one. */
const RadioPicks = createContext<{ picked: Readonly<Record<string, string>>; pick: (group: string, id: string) => void }>({ picked: {}, pick: () => undefined })

function Groups<T extends MenuEntry>({ sections, render }: { sections: readonly (readonly T[])[]; render: (item: T) => ReactNode }) {
  const [picked, setPicked] = useState<Readonly<Record<string, string>>>({})
  const radios = useMemo(() => ({ picked, pick: (group: string, id: string) => setPicked((was) => ({ ...was, [group]: id })) }), [picked])
  return (
    <RadioPicks.Provider value={radios}>
      {sections
        .filter((section) => section.length > 0)
        .map((section) => (
          <div key={section[0].id} className="ctx-menu__group" role="group">
            {section.map(render)}
          </div>
        ))}
    </RadioPicks.Provider>
  )
}

/** A leaf: `onSelect()` then `onClose()` — every item closes the WHOLE menu (🔒 D8). */
function ActionButton({ item, onClose, onMouseEnter }: { item: MenuAction; onClose: () => void; onMouseEnter?: () => void }) {
  if (item.heading) return <MenuHeading label={item.label} tip={item.tip} />
  return <ActionRow item={item} onClose={onClose} onMouseEnter={onMouseEnter} />
}

/** A group's heading (YAZ-4460 demo): small grey words over the rows, no button, so a key or a click passes it by. */
const MenuHeading = ({ label, tip }: { label: string; tip?: string }) => (
  <div className="ctx-menu__heading" role="presentation" title={tip}>
    {label}
  </div>
)

function ActionRow({ item, onClose, onMouseEnter }: { item: MenuAction; onClose: () => void; onMouseEnter?: () => void }) {
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
  // A two-click row (`confirm`, YAZ-4460 demo): armed after the first click, until the pointer or the focus leaves.
  const [armed, setArmed] = useState(false)
  const label = armed && item.confirm !== undefined ? item.confirm : item.label
  // A check row (`onToggle`, YAZ-4460 demo): its ✓ is held here, so it flips at the click while the menu stays open.
  const [checked, setChecked] = useState(item.checked === true)
  const radios = useContext(RadioPicks)
  const radioOn = item.radio === undefined ? false : radios.picked[item.radio.group] !== undefined ? radios.picked[item.radio.group] === item.id : item.radio.on
  const hint = item.onToggle !== undefined ? (checked ? '✓' : undefined) : item.radio !== undefined ? (radioOn ? '✓' : undefined) : item.hint
  // A two-click check row (`twoClick`): armed, it says what the second click does — add (accent) or remove (red).
  const shown = armed && item.twoClick === true ? (checked ? 'Click again to remove' : 'Click again to add') : label
  const armedClass = !armed ? '' : item.twoClick === true && !checked ? ' ctx-menu__item--armed-add' : ' ctx-menu__item--armed'
  return (
    <button
      type="button"
      role="menuitem"
      className={`ctx-menu__item${item.danger === true ? ' ctx-menu__item--danger' : ''}${armedClass}`}
      disabled={item.disabled}
      data-hint={armed ? undefined : hint}
      title={item.tip}
      onMouseEnter={() => {
        onMouseEnter?.()
        setPreview(true)
      }}
      onMouseLeave={() => {
        setPreview(false)
        setArmed(false)
      }}
      onFocus={() => setPreview(true)}
      onBlur={() => {
        setPreview(false)
        setArmed(false)
      }}
      // An item whose handler already closes the menu (the create group's inline input) just
      // sets the same null twice — harmless.
      onClick={() => {
        if (item.confirm !== undefined && !armed) return setArmed(true)
        if (item.onToggle !== undefined) {
          if (item.twoClick === true && !armed) return setArmed(true)
          setArmed(false)
          setChecked(!checked)
          return item.onToggle(!checked)
        }
        if (item.radio !== undefined) {
          // A radio row keeps the menu open, and its ✓ moves here.
          if (!radioOn) item.onSelect()
          return radios.pick(item.radio.group, item.id)
        }
        item.onSelect()
        onClose()
      }}
    >
      {item.icon === undefined ? (
        shown
      ) : (
        <span className="ctx-menu__label">
          {item.icon}
          {shown}
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
 * A parent ("Open in ▸", D7 amended, YAZ-1674): the app's one flyout row (`components/Flyout.tsx`, YAZ-4544 4F), its
 * flyout drawn by the SAME group renderer, one level deep. A parent WITH a default (YAZ-3085 D1, "New note ▸") runs
 * it on a click or Enter and closes the menu, as a leaf does; only hover and ArrowRight open its flyout. The flyout
 * stays while the pointer is inside the row or the flyout — there is no leave rule — and closes when the pointer
 * enters a DIFFERENT top-level item, after the root's hover wait (D4).
 * Keyboard: Tab already reaches every item (they are buttons), so Tab + Enter + Escape is the
 * complete path; ArrowRight to open (and Enter, on a parent with no default) and ArrowLeft to close
 * are sugar on top of it.
 */
function ParentItem({ item, open, onHover, onOpen, onCloseFlyout, onClose }: { item: MenuParent; open: boolean; onHover: () => void; onOpen: () => void; onCloseFlyout: () => void; onClose: () => void }) {
  const onSelect = item.onSelect
  // A glyph on any row (the Search menu's Type list, YAZ-3511 D13): the rows without one line up after its slot.
  const glyphs = item.children.some((section) => section.some((child) => child.icon !== undefined))
  const panel = item.panel
  return (
    <FlyoutParent
      label={item.icon === undefined ? item.label : <span className="ctx-menu__label">{item.icon}{item.label}</span>}
      open={open}
      hint={item.hint}
      // A DOM panel (YAZ-4899) is the editor's own: its classes dress the tabs as the six-dot menu's.
      menuClassName={panel !== undefined ? 'ctx-menu--editor' : glyphs ? 'ctx-menu--glyphs' : undefined}
      onHover={onHover}
      onOpen={onOpen}
      onCloseFlyout={onCloseFlyout}
      onChoose={onSelect === undefined ? undefined : () => {
        onSelect()
        onClose()
      }}
    >
      {panel !== undefined ? <DomPanel panel={panel} onClose={onClose} /> : <Groups sections={item.children} render={(child) => <ActionButton key={child.id} item={child} onClose={onClose} />} />}
    </FlyoutParent>
  )
}

/**
 * A parent's `panel` (YAZ-4899): DOM code fills the flyout's box once, when it mounts, before the flyout is measured.
 * Opened with the keyboard (the parent row has the focus), its first row takes the focus, as the six-dot menu's does.
 */
function DomPanel({ panel, onClose }: { panel: NonNullable<MenuParent['panel']>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef({ panel, onClose })
  latest.current = { panel, onClose }
  useLayoutEffect(() => {
    const host = ref.current
    if (host === null) return
    latest.current.panel(host, () => latest.current.onClose())
    const row = host.closest('.ctx-menu__parent')?.querySelector('.ctx-menu__item--parent')
    if (row !== undefined && row === document.activeElement) host.querySelector<HTMLButtonElement>('.ctx-menu__item:not(:disabled)')?.focus({ preventScroll: true })
    return () => host.replaceChildren()
  }, [])
  return <div ref={ref} className="ctx-menu__panel" />
}

/** The sidebar's right-click menu — the file tree's (GRO-2022) and the vault switcher's (YAZ-1798) — and a tab's (YAZ-2949 D6). The overlay catches click-away and stray right-clicks. */
export function ContextMenu({ x, y, sections, onClose }: ContextMenuProps) {
  // A glyph on any row (YAZ-3264 D6) leaves an empty slot on the rows without one, so every label
  // starts at the same place, as in a Finder menu. A flyout is its own menu and keeps its own rule.
  const glyphs = sections.some((section) => section.some((item) => item.kind !== 'strip' && item.icon !== undefined))
  // The ONE open flyout (D7 amended), with the hover wait (YAZ-3085 D4): three parents stand in a column, so a
  // pointer on its way into a flyout crosses the next one; the pointer that reaches the flyout re-enters its own
  // parent (the flyout is its child) and cancels the switch.
  const { open: openId, hover, openNow } = useFlyout<string>()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // A flyout owns its own Escape (`components/Flyout.tsx`): the first press closes it alone, the next closes the menu.
      if (openId !== null) openNow(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, openId, openNow])

  // Viewport clamping (GRO-2204): render at the cursor, then measure and pull the menu back
  // inside the window instead of spilling off an edge. YAZ-4970: a menu taller than the window (the table's row menu)
  // was only moved to the top, its last rows below the window and out of reach; now it fits the window and scrolls,
  // as `ContextMenuSurface` does (`lib/fitMenu.ts`).
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (el === null) return
    const place = () => {
      const at = fitMenu(el, x, y)
      setPos((was) => (was.left === at.left && was.top === at.top ? was : at))
    }
    place()
    // A menu whose rows change while it is open is placed again; the observer fires only on a change of its own size.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(place)
    observer.observe(el)
    return () => observer.disconnect()
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
      <div
        ref={menuRef}
        className={`ctx-menu${glyphs ? ' ctx-menu--glyphs' : ''}`}
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={(e) => e.stopPropagation()}
        // A flyout stands beside the row it opened from; the menu scrolled under it (YAZ-4970) would leave it astray.
        onScroll={(e) => {
          if (e.target === e.currentTarget && openId !== null) openNow(null)
        }}
        role="menu"
      >
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
