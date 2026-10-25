import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { flushSync } from 'react-dom'
import { DEFAULT_SIDEBAR_TABS, SIDEBAR_BUTTONS, type SidebarButton, type SidebarTab, type SidebarTabsPrefs } from '@shared/types'
import { ChevronsIcon, ClockIcon, DragHandleIcon, EyeIcon, HeartIcon, MoreIcon, SearchIcon, SortIcon, StackIcon } from '../views/view/icons'
import { moveTab, sameTabRow, TAB_LABEL, toggleButton, toggleTab } from './tabRow'

/** A tab's face: Files is a word (YAZ-3273 D6); the others are glyphs (YAZ-2638 D2, YAZ-2619 D4, YAZ-1766 D1, YAZ-3147 D4, YAZ-3235 D4). */
export function TabFace({ tab }: { tab: SidebarTab }) {
  return tab === 'favorites' ? <HeartIcon /> : tab === 'focus' ? <EyeIcon /> : tab === 'search' ? <SearchIcon /> : tab === 'sessions' ? <StackIcon /> : tab === 'recents' ? <ClockIcon /> : <>{TAB_LABEL[tab]}</>
}

/** The buttons at the right, as the panel names them (D9, D10). */
const BUTTON_LABEL: Record<SidebarButton, string> = { sort: 'Sort', fold: 'Collapse all', more: 'More tabs (⋯)' }
const BUTTON_ICON: Record<SidebarButton, () => ReactElement> = { sort: SortIcon, fold: ChevronsIcon, more: MoreIcon }

/** A move of less than this many px is a press, not a drag (D5, S19). */
const LIFT_PX = 3
/** The glide of a released row into its gap (D5), in ms; the slide of the others is CSS's (160 ms). */
const SETTLE_MS = 140

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

interface TabRowPanelProps {
  /** Where the menu was (S17): the panel opens there, pulled back inside the window. */
  x: number
  y: number
  prefs: SidebarTabsPrefs
  /** The tab that was right-clicked: its row is lit (S17). */
  focus: SidebarTab | null
  /** A key opened the menu: the focus goes to the first box. */
  autoFocus: boolean
  /** One write per change (D5: a drag writes once, on release). */
  onChange: (next: SidebarTabsPrefs) => void
  onClose: () => void
}

/**
 * The Tab row panel (YAZ-3273 D4, D5, D9, D10): a popover of its own, not `ContextMenu` — a menu
 * cannot hold rows that drag. "Tabs · drag to reorder": a row for each tab with a grip, a box, the
 * icon and the name; Files' box is off ("always shown", D6). Then "Buttons at the right": Sort,
 * Collapse all and More tabs (⋯), each with a box. Then "Reset tab row".
 *
 * The drag (D5, S19 to S22) is pointer events, not native HTML drag: after 3 px the row lifts and
 * follows the pointer, clamped to the list, and the other rows slide apart to open its gap — CSS
 * `transform` on the panel's rows only, with no React render on the way (S30). On release the row
 * glides into the gap, then the new order is written once and the rows are drawn in it. A press on
 * a box never drags; Esc during a drag puts the row back and writes nothing.
 *
 * It closes on Esc, a press outside it and the window losing focus (S26); it stays open while the
 * boxes tick and the rows move.
 */
export function TabRowPanel({ x, y, prefs, focus, autoFocus, onChange, onClose }: TabRowPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  // The drag that is on, so Esc can put it back: its own cancel.
  const dragging = useRef<(() => void) | null>(null)
  // The glide of the last release, not yet written (YAZ-3301): its own commit, so a new press can finish it at once.
  const settling = useRef<(() => void) | null>(null)
  const latest = useRef({ prefs, onChange, onClose })
  latest.current = { prefs, onChange, onClose }

  // Viewport clamping, as `ContextMenu` does (GRO-2204): draw at the point, then measure and pull it back inside the window.
  useLayoutEffect(() => {
    const el = panelRef.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    setPos({ left: Math.max(0, Math.min(x, window.innerWidth - r.width)), top: Math.max(0, Math.min(y, window.innerHeight - r.height)) })
  }, [x, y])

  useEffect(() => {
    if (autoFocus) panelRef.current?.querySelector<HTMLButtonElement>('.tab-row-panel__check:not(:disabled)')?.focus()
  }, [autoFocus])

  // Esc, a press outside and a window blur (S21, S26). Esc is the panel's while it stands, ahead of every
  // other key listener: the first press during a drag puts the row back, the next closes the panel. The
  // arrows on its boxes are taken too, so the window's arrows-from-nowhere (YAZ-2663 D10) stay in the sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const inside = e.target instanceof Node && panelRef.current?.contains(e.target) === true
      if (e.key === 'Escape') {
        if (dragging.current !== null) dragging.current()
        else latest.current.onClose()
      } else if (!(inside && e.key.startsWith('Arrow'))) return
      e.preventDefault()
      e.stopPropagation()
    }
    const onDown = (e: PointerEvent | MouseEvent): void => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target) === true) return
      latest.current.onClose()
    }
    const onBlur = (): void => latest.current.onClose()
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const write = (next: SidebarTabsPrefs) => {
    if (!sameTabRow(next, latest.current.prefs)) latest.current.onChange(next)
  }

  // The drag (D5): the lab's `openPanel` pointerdown / move / up, on the panel's own rows.
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target instanceof Element ? e.target : null
    const row = target?.closest<HTMLElement>('.tab-row-panel__row')
    const list = listRef.current
    if (row == null || list === null || e.button !== 0 || target?.closest('.tab-row-panel__check') != null || dragging.current !== null) return
    e.preventDefault()
    // A press during the last drag's glide (YAZ-3301): that drop is written and drawn first, so this drag
    // reads the rows in their new order and places, and the glide's end does not wipe this drag's offsets.
    settling.current?.()
    const rows = [...list.querySelectorAll<HTMLElement>('.tab-row-panel__row')]
    const from = rows.indexOf(row)
    // The tab, by its name: the drop moves THIS tab, even if the rows were drawn again under the drag.
    const tab = row.dataset.tab as SidebarTab
    const tops = rows.map((r) => r.offsetTop)
    const h = row.offsetHeight
    const y0 = e.clientY
    const pointer = e.pointerId
    let to = from
    let lifted = false
    row.setPointerCapture?.(pointer)
    const clear = () => {
      list.classList.remove('tab-row-panel__list--sorting')
      for (const r of rows) {
        r.classList.remove('tab-row-panel__row--lifted', 'tab-row-panel__row--settling')
        r.style.transform = ''
      }
    }
    const end = () => {
      row.removeEventListener('pointermove', move)
      row.removeEventListener('pointerup', up)
      row.removeEventListener('pointercancel', cancel)
      if (row.hasPointerCapture?.(pointer) === true) row.releasePointerCapture(pointer)
      dragging.current = null
    }
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y0
      if (!lifted) {
        if (Math.abs(dy) < LIFT_PX) return
        lifted = true
        row.classList.add('tab-row-panel__row--lifted')
        list.classList.add('tab-row-panel__list--sorting')
      }
      // Clamped to the list: a third of a row past either end, no further.
      const d = Math.max(tops[0] - tops[from] - h / 3, Math.min(tops[rows.length - 1] - tops[from] + h / 3, dy))
      row.style.transform = `translateY(${d}px)`
      const mid = tops[from] + d + h / 2
      to = rows.reduce((n, r, i) => (i !== from && mid > tops[i] + h / 2 ? n + 1 : n), 0)
      // The others slide apart (160 ms, CSS) to open the gap where it lands: the gap is the drop sign.
      rows.forEach((r, i) => {
        if (i === from) return
        const shift = from < to && i > from && i <= to ? -h : from > to && i < from && i >= to ? h : 0
        r.style.transform = shift === 0 ? '' : `translateY(${shift}px)`
      })
    }
    const up = () => {
      end()
      if (!lifted) return
      // The settle: the row glides into its gap, then the order is written once and drawn.
      row.classList.remove('tab-row-panel__row--lifted')
      row.classList.add('tab-row-panel__row--settling')
      row.style.transform = `translateY(${tops[to] - tops[from]}px)`
      const landed = to
      const commit = () => {
        window.clearTimeout(timer)
        if (settling.current === commit) settling.current = null
        const { order } = latest.current.prefs
        // One frame: the rows are drawn in their new order and lose their offsets together, so nothing jumps.
        flushSync(() => write({ ...latest.current.prefs, order: moveTab(order, order.indexOf(tab), landed) }))
        clear()
      }
      settling.current = commit
      const timer = window.setTimeout(commit, reducedMotion() ? 0 : SETTLE_MS)
    }
    // Esc during the drag (S21), or the system took the pointer: the row goes back, nothing is written.
    const cancel = () => {
      end()
      clear()
    }
    row.addEventListener('pointermove', move)
    row.addEventListener('pointerup', up)
    row.addEventListener('pointercancel', cancel)
    dragging.current = () => {
      if (lifted) cancel()
      else end()
    }
  }

  const shown = (tab: SidebarTab) => !prefs.hidden.includes(tab)
  return (
    <div ref={panelRef} className="ctx-menu tab-row-panel" role="dialog" aria-label="Edit tab row" style={{ left: pos.left, top: pos.top }}>
      <div className="tab-row-panel__head">Tabs · drag to reorder</div>
      <div ref={listRef} className="tab-row-panel__list" onPointerDown={startDrag}>
        {prefs.order.map((tab) => (
          <div key={tab} className={`tab-row-panel__row${focus === tab ? ' tab-row-panel__row--focus' : ''}`} data-tab={tab} title={`Drag to move ${TAB_LABEL[tab]}`}>
            <span className="tab-row-panel__grip" aria-hidden="true">
              <DragHandleIcon />
            </span>
            <button
              type="button"
              role="checkbox"
              className="tab-row-panel__check"
              aria-checked={shown(tab)}
              aria-label={`Show ${TAB_LABEL[tab]}`}
              disabled={tab === 'files'}
              onClick={() => write(toggleTab(prefs, tab))}
            >
              {shown(tab) ? '✓' : ''}
            </button>
            <span className="tab-row-panel__icon" aria-hidden="true">
              {tab === 'files' ? null : <TabFace tab={tab} />}
            </span>
            <span className="tab-row-panel__name">{TAB_LABEL[tab]}</span>
            {tab === 'files' && <span className="tab-row-panel__note">always shown</span>}
          </div>
        ))}
      </div>
      <div className="tab-row-panel__sep" />
      <div className="tab-row-panel__head">Buttons at the right</div>
      {SIDEBAR_BUTTONS.map((button) => {
        const on = !prefs.hiddenButtons.includes(button)
        const Icon = BUTTON_ICON[button]
        return (
          <div key={button} className="tab-row-panel__button-row" data-button={button}>
            <span className="tab-row-panel__grip" aria-hidden="true" />
            <button type="button" role="checkbox" className="tab-row-panel__check" aria-checked={on} aria-label={`Show ${BUTTON_LABEL[button]}`} onClick={() => write(toggleButton(prefs, button))}>
              {on ? '✓' : ''}
            </button>
            <span className="tab-row-panel__icon" aria-hidden="true">
              <Icon />
            </span>
            <span className="tab-row-panel__name">{BUTTON_LABEL[button]}</span>
          </div>
        )
      })}
      <div className="tab-row-panel__sep" />
      <button type="button" className="tab-row-panel__reset" onClick={() => write(DEFAULT_SIDEBAR_TABS)}>
        Reset tab row
      </button>
    </div>
  )
}
