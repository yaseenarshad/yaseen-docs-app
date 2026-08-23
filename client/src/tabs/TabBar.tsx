import { useEffect, useRef, useState, type DragEvent } from 'react'
import { fileKind } from '@shared/fileKind'
import { basename, stripExt } from '../lib/paths'
import { BaseGlyph } from '../sidebar/Tree'
import './tabs.css'

export interface TabBarProps {
  /** Open tabs, absolute paths, left→right. */
  tabs: readonly string[]
  /** The active tab (the window's `file`); null with no tabs open. */
  active: string | null
  onActivate: (path: string) => void
  onClose: (path: string) => void
  /** Drag-to-reorder (I3, GRO-2235): the tab at `from` lands at final index `to`. */
  onMove: (from: number, to: number) => void
  /** History (YAZ-762): the active tab's own back/forward stack has somewhere to go. */
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
}

/** In-flight drag state: the grabbed tab's index + the hovered insertion slot (0…tabs.length). */
interface DragState {
  from: number
  over: number | null
}

/**
 * The window tab strip (Tabs I2/I3, GRO-2234/2235): one tab per open file, ViewTabs' tablist
 * semantics (role=tab, aria-selected, active underline). Labels are basenames without the
 * vault extension; the full path lives in the title tooltip. Tabs reorder by HTML5 drag (the
 * groupDrag idiom: `dataTransfer` guarded — jsdom's synthetic drags have none) with an accent
 * insertion indicator; the strip scrolls when full and keeps the ACTIVE tab in view. Left of
 * the strip sit the ◀ ▶ history buttons (YAZ-762), disabled when the active tab's stack has
 * nowhere to go — buttons only, per LOCKED ruling D2: no shortcut, no menu item.
 * Presentational only — all state changes go through the `useTabs` callbacks.
 */
export function TabBar({ tabs, active, onActivate, onClose, onMove, canBack, canForward, onBack, onForward }: TabBarProps) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const activeRef = useRef<HTMLDivElement | null>(null)

  // Overflow polish (I3): tabs shrink to a floor and the strip scrolls, so scroll the active
  // tab fully into view on every activation. jsdom has no scrollIntoView — hence the `?.()`.
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])

  /** The insertion slot a pointer at `clientX` over tab `i` means: before (i) or after (i+1) it. */
  const insertionAt = (e: DragEvent, i: number): number => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientX < r.left + r.width / 2 ? i : i + 1
  }

  const drop = (insertion: number): void => {
    if (drag === null) return
    setDrag(null)
    // The slot is an index in the WITH-dragged-tab list; past the grab point it shifts one left.
    const to = insertion > drag.from ? insertion - 1 : insertion
    if (to !== drag.from) onMove(drag.from, to)
  }

  return (
    <div className="tabbar-row">
      <div className="tabbar-nav">
        <button type="button" className="tabbar-nav__btn" aria-label="Back" title="Back" disabled={!canBack} onClick={onBack}>
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m10 4-4 4 4 4" />
          </svg>
        </button>
        <button type="button" className="tabbar-nav__btn" aria-label="Forward" title="Forward" disabled={!canForward} onClick={onForward}>
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m6 4 4 4-4 4" />
          </svg>
        </button>
      </div>
      <div
        className="tabbar"
        role="tablist"
        aria-label="Open files"
        onDragOver={(e) => {
          // The empty strip tail: only direct hits — tab hovers are handled (and marked) per tab.
          if (drag === null || e.target !== e.currentTarget) return
          e.preventDefault()
          if (drag.over !== tabs.length) setDrag({ ...drag, over: tabs.length })
        }}
        onDrop={(e) => {
          if (drag === null || e.target !== e.currentTarget) return
          e.preventDefault()
          drop(tabs.length)
        }}
      >
        {tabs.map((path, i) => {
          const isActive = path === active
          const label = stripExt(basename(path))
          const cls = ['tabbar__tab']
          if (isActive) cls.push('tabbar__tab--active')
          if (drag !== null && drag.from === i) cls.push('tabbar__tab--dragging')
          // The insertion indicator: an accent edge on the tab the drop would land before —
          // or after the LAST tab for the end slot.
          if (drag?.over === i) cls.push('tabbar__tab--insert-before')
          if (drag !== null && drag.over === tabs.length && i === tabs.length - 1) cls.push('tabbar__tab--insert-after')
          return (
            <div
              key={path}
              ref={isActive ? activeRef : undefined}
              className={cls.join(' ')}
              draggable
              onDragStart={(e) => {
                e.dataTransfer?.setData('text/plain', path)
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                setDrag({ from: i, over: null })
              }}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => {
                if (drag === null) return
                e.preventDefault()
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                const over = insertionAt(e, i)
                if (drag.over !== over) setDrag({ ...drag, over })
              }}
              onDrop={(e) => {
                if (drag === null) return
                e.preventDefault()
                drop(insertionAt(e, i))
              }}
            >
              <button
                type="button"
                role="tab"
                className="tabbar__btn"
                aria-selected={isActive}
                title={path}
                onClick={() => onActivate(path)}
                onAuxClick={(e) => {
                  // Middle-click closes — the browser-tab convention.
                  if (e.button === 1) onClose(path)
                }}
              >
                {fileKind(path) === 'base' && <BaseGlyph className="tabbar__glyph" />}
                <span className="tabbar__label">{label}</span>
              </button>
              <button type="button" className="tabbar__close" aria-label={`Close ${label}`} title={`Close ${label}`} onClick={() => onClose(path)}>
                ✕
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
