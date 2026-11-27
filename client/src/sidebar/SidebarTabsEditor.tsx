import { useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { flushSync } from 'react-dom'
import { SIDEBAR_BUTTONS, type SidebarButton, type SidebarTab, type SidebarTabsPrefs } from '@shared/types'
import { ClockIcon, CollapseAllIcon, DragHandleIcon, EyeIcon, FolderIcon, HeartIcon, MoreIcon, RefreshIcon, SearchIcon, SortIcon, StackIcon } from '../views/view/icons'
import { moveTab, sameTabRow, TAB_LABEL, toggleButton, toggleTab } from './tabRow'

/** A tab's face: Files is a word (YAZ-3273 D6); the others are glyphs (YAZ-2638 D2, YAZ-2619 D4, YAZ-1766 D1, YAZ-3147 D4, YAZ-3235 D4). */
export function TabFace({ tab }: { tab: SidebarTab }) {
  return tab === 'favorites' ? <HeartIcon /> : tab === 'focus' ? <EyeIcon /> : tab === 'search' ? <SearchIcon /> : tab === 'sessions' ? <StackIcon /> : tab === 'recents' ? <ClockIcon /> : <>{TAB_LABEL[tab]}</>
}

/**
 * The glyph of a row in the row's menu and in this editor (YAZ-3279): a tab's face, a folder for Files
 * (its tab is a word, D6), or a button's own glyph. One map, so the menu and the editor agree.
 */
export function rowGlyph(key: SidebarTab | SidebarButton | 'refresh'): ReactElement {
  if (key === 'files') return <FolderIcon size={15} />
  if (key === 'sort') return <SortIcon />
  if (key === 'fold') return <CollapseAllIcon />
  if (key === 'more') return <MoreIcon />
  if (key === 'refresh') return <RefreshIcon />
  return <TabFace tab={key} />
}

/** The buttons at the right, as the editor names them (D9, D10). */
export const BUTTON_LABEL: Record<SidebarButton, string> = { sort: 'Sort', fold: 'Collapse all', more: 'More tabs (⋯)' }

/** A move of less than this many px is a press, not a drag (D5, S19). */
const LIFT_PX = 3
/** The glide of a released row into its gap (D5), in ms; the slide of the others is CSS's (160 ms). */
const SETTLE_MS = 140

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

export interface SidebarTabsEditorProps {
  prefs: SidebarTabsPrefs
  /** One write per change (D5: a drag writes once, on release). */
  onChange: (next: SidebarTabsPrefs) => void
  /** The tab that was right-clicked: its row is lit (S17). */
  focus?: SidebarTab | null
  /** Popover mode keeps compact rows; Settings mode adds accessible ↑/↓ move buttons. */
  variant?: 'popover' | 'settings'
  /** Exposes drag cancellation to an enclosing dialog so Esc cancels a drag before closing. */
  cancelDragRef?: MutableRefObject<(() => boolean) | null>
}

/**
 * Shared interactive sidebar tab-row editor (YAZ-3273, YAZ-6593): used by both the `TabRowPanel`
 * popover and Settings › Sidebar › Tab row. Supports pointer-drag reordering with settle animation,
 * tab/button visibility checkboxes, and accessible ↑/↓ move buttons in Settings mode.
 */
export function SidebarTabsEditor({ prefs, onChange, focus = null, variant = 'popover', cancelDragRef }: SidebarTabsEditorProps) {
  const listRef = useRef<HTMLDivElement>(null)
  // The drag that is on, so Esc can put it back: its own cancel.
  const dragging = useRef<(() => void) | null>(null)
  // The glide of the last release, not yet written (YAZ-3301): its own commit, so a new press can finish it at once.
  // `flush` draws the new order in the same frame; an unmount writes with no flush (React warns of a flushSync there).
  const settling = useRef<((flush: boolean) => void) | null>(null)
  const latest = useRef({ prefs, onChange })
  latest.current = { prefs, onChange }

  useEffect(() => {
    if (cancelDragRef !== undefined) {
      cancelDragRef.current = () => {
        if (dragging.current === null) return false
        dragging.current()
        return true
      }
    }
    return () => {
      dragging.current?.()
      settling.current?.(false)
      if (cancelDragRef !== undefined) cancelDragRef.current = null
    }
  }, [cancelDragRef])

  const write = (next: SidebarTabsPrefs) => {
    if (!sameTabRow(next, latest.current.prefs)) latest.current.onChange(next)
  }

  // The drag (D5, S19): pointerdown, move and up on the editor's own rows.
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.target instanceof Element ? e.target : null
    const row = target?.closest<HTMLElement>('.tab-row-panel__row')
    const list = listRef.current
    if (row == null || list === null || e.button !== 0 || target?.closest('.tab-row-panel__check, .tab-row-panel__move') != null || dragging.current !== null) return
    e.preventDefault()
    // A press during the last drag's glide (YAZ-3301): that drop is written and drawn first, so this drag
    // reads the rows in their new order and places, and the glide's end does not wipe this drag's offsets.
    settling.current?.(true)
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
    const onEsc = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      if (lifted) cancel()
      else end()
    }
    const end = () => {
      row.removeEventListener('pointermove', move)
      row.removeEventListener('pointerup', up)
      row.removeEventListener('pointercancel', cancel)
      if (cancelDragRef === undefined) window.removeEventListener('keydown', onEsc, true)
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
      const commit = (flush: boolean) => {
        window.clearTimeout(timer)
        if (settling.current === commit) settling.current = null
        const { order } = latest.current.prefs
        const drop = () => write({ ...latest.current.prefs, order: moveTab(order, order.indexOf(tab), landed) })
        // One frame: the rows are drawn in their new order and lose their offsets together, so nothing jumps.
        if (flush) flushSync(drop)
        else drop()
        clear()
      }
      settling.current = commit
      const timer = window.setTimeout(() => commit(true), reducedMotion() ? 0 : SETTLE_MS)
    }
    // Esc during the drag (S21), or the system took the pointer: the row goes back, nothing is written.
    const cancel = () => {
      end()
      clear()
    }
    row.addEventListener('pointermove', move)
    row.addEventListener('pointerup', up)
    row.addEventListener('pointercancel', cancel)
    if (cancelDragRef === undefined) window.addEventListener('keydown', onEsc, true)
    dragging.current = () => {
      if (lifted) cancel()
      else end()
    }
  }

  const shown = (tab: SidebarTab) => !prefs.hidden.includes(tab)
  const isSettings = variant === 'settings'
  return (
    <div className={isSettings ? 'sidebar-tabs-editor sidebar-tabs-editor--settings' : 'sidebar-tabs-editor'}>
      <div className="tab-row-panel__head">Tabs · drag to reorder</div>
      <div ref={listRef} className="tab-row-panel__list" onPointerDown={startDrag}>
        {prefs.order.map((tab, index) => (
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
              {rowGlyph(tab)}
            </span>
            <span className="tab-row-panel__name">{TAB_LABEL[tab]}</span>
            {tab === 'files' && <span className="tab-row-panel__note">always shown</span>}
            {isSettings && (
              <span className="tab-row-panel__moves">
                <button
                  type="button"
                  className="tab-row-panel__move"
                  aria-label={`Move ${TAB_LABEL[tab]} up`}
                  title={`Move ${TAB_LABEL[tab]} up`}
                  disabled={index === 0}
                  onClick={() => write({ ...prefs, order: moveTab(prefs.order, index, index - 1) })}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="tab-row-panel__move"
                  aria-label={`Move ${TAB_LABEL[tab]} down`}
                  title={`Move ${TAB_LABEL[tab]} down`}
                  disabled={index === prefs.order.length - 1}
                  onClick={() => write({ ...prefs, order: moveTab(prefs.order, index, index + 1) })}
                >
                  ↓
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="tab-row-panel__sep" />
      <div className="tab-row-panel__head">Buttons at the right</div>
      {SIDEBAR_BUTTONS.map((button) => {
        const on = !prefs.hiddenButtons.includes(button)
        return (
          <div key={button} className="tab-row-panel__button-row" data-button={button}>
            <span className="tab-row-panel__grip" aria-hidden="true" />
            <button type="button" role="checkbox" className="tab-row-panel__check" aria-checked={on} aria-label={`Show ${BUTTON_LABEL[button]}`} onClick={() => write(toggleButton(prefs, button))}>
              {on ? '✓' : ''}
            </button>
            <span className="tab-row-panel__icon" aria-hidden="true">
              {rowGlyph(button)}
            </span>
            <span className="tab-row-panel__name">{BUTTON_LABEL[button]}</span>
          </div>
        )
      })}
    </div>
  )
}
