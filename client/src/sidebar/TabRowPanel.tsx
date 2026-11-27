import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DEFAULT_SIDEBAR_TABS, type SidebarTab, type SidebarTabsPrefs } from '@shared/types'
import { SidebarTabsEditor, rowGlyph, TabFace } from './SidebarTabsEditor'
import { sameTabRow } from './tabRow'

export { rowGlyph, TabFace }

export interface TabRowScope {
  label: string
  note?: string
}

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
  /** Which vault or workspace this tab row applies to (YAZ-6593). */
  scope?: TabRowScope
  /** Closes the popover and opens Settings › Sidebar › Tab row (YAZ-6593). */
  onEditInSettings?: () => void
  onClose: () => void
}

/**
 * The Tab row panel (YAZ-3273 D4, D5, D9, D10; YAZ-6593): a popover of its own, not `ContextMenu` —
 * a menu cannot hold rows that drag. Delegates the interactive tab & button editor to `SidebarTabsEditor`.
 *
 * It closes on Esc, a press outside it and the window losing focus (S26); it stays open while the
 * boxes tick and the rows move.
 */
export function TabRowPanel({ x, y, prefs, focus, autoFocus, onChange, scope, onEditInSettings, onClose }: TabRowPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelDragRef = useRef<(() => boolean) | null>(null)
  const [pos, setPos] = useState({ left: x, top: y })
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
        if (cancelDragRef.current?.() !== true) latest.current.onClose()
      } else if (!(inside && e.key.startsWith('Arrow'))) return
      e.preventDefault()
      e.stopPropagation()
    }
    // `pointerdown` only: it also covers a press the system's pointer makes, and a `mousedown` after it would close the panel twice.
    const onDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && panelRef.current?.contains(e.target) === true) return
      latest.current.onClose()
    }
    const onBlur = (): void => latest.current.onClose()
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const write = (next: SidebarTabsPrefs) => {
    if (!sameTabRow(next, latest.current.prefs)) latest.current.onChange(next)
  }

  return (
    <div ref={panelRef} className="ctx-menu tab-row-panel" role="dialog" aria-label="Edit tab row" style={{ left: pos.left, top: pos.top }}>
      {scope !== undefined && (
        <>
          <div className="tab-row-panel__scope">
            <div className="tab-row-panel__scope-label">
              Tabs for: <strong>{scope.label}</strong>
            </div>
            {scope.note !== undefined && <div className="tab-row-panel__scope-note">{scope.note}</div>}
          </div>
          <div className="tab-row-panel__sep" />
        </>
      )}
      <SidebarTabsEditor prefs={prefs} focus={focus} onChange={write} cancelDragRef={cancelDragRef} variant="popover" />
      <div className="tab-row-panel__sep" />
      <button type="button" className="tab-row-panel__reset" onClick={() => write(DEFAULT_SIDEBAR_TABS)}>
        Reset to default
      </button>
      {onEditInSettings !== undefined && (
        <button
          type="button"
          className="tab-row-panel__action"
          onClick={() => {
            onClose()
            onEditInSettings()
          }}
        >
          Edit in Settings…
        </button>
      )}
    </div>
  )
}
