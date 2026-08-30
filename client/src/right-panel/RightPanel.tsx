import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { RIGHT_PANEL_MAX_W, RIGHT_PANEL_MIN_W } from '@shared/types'
import { basename, stripExt } from '../lib/paths'
import './right-panel.css'

export interface RightPanelProps {
  items: readonly string[]
  expanded: string | null
  width: number
  overlay: boolean
  canBack: boolean
  canForward: boolean
  onBack(): void
  onForward(): void
  onToggle(path: string): void
  onClose(path: string): void
  onHide(): void
  onResizeCommit(width: number): void
  children?: ReactNode
}

const HIDE_THRESHOLD = 192
const KEYBOARD_STEP = 16
const clamp = (width: number): number => Math.min(RIGHT_PANEL_MAX_W, Math.max(RIGHT_PANEL_MIN_W, width))

const Chevron = ({ d }: { d: string }) => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)

export function RightPanel({ items, expanded, width, overlay, canBack, canForward, onBack, onForward, onToggle, onClose, onHide, onResizeCommit, children }: RightPanelProps) {
  const [previewWidth, setPreviewWidth] = useState(width)
  const headerRefs = useRef(new Map<string, HTMLButtonElement>())
  const hideRef = useRef<HTMLButtonElement | null>(null)
  const resizeCleanup = useRef<(() => void) | null>(null)

  useEffect(() => setPreviewWidth(width), [width])
  useEffect(() => () => resizeCleanup.current?.(), [])

  const startResize = (event: ReactMouseEvent): void => {
    event.preventDefault()
    resizeCleanup.current?.()
    const x0 = event.clientX
    let raw = width
    let next = width
    const move = (e: MouseEvent) => {
      raw = width + x0 - e.clientX
      next = clamp(raw)
      setPreviewWidth(next)
    }
    const cleanup = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      resizeCleanup.current = null
    }
    const up = () => {
      cleanup()
      setPreviewWidth(width)
      if (raw < HIDE_THRESHOLD) onHide()
      else if (next !== width) onResizeCommit(next)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    document.body.style.cursor = 'col-resize'
    resizeCleanup.current = cleanup
  }

  const resizeByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = clamp(width + KEYBOARD_STEP)
    if (event.key === 'ArrowRight') next = clamp(width - KEYBOARD_STEP)
    if (event.key === 'Home') next = RIGHT_PANEL_MIN_W
    if (event.key === 'End') next = RIGHT_PANEL_MAX_W
    if (next === null) return
    event.preventDefault()
    if (next !== width) onResizeCommit(next)
  }

  const close = (path: string, index: number): void => {
    const focusPath = items[index + 1] ?? items[index - 1]
    onClose(path)
    queueMicrotask(() => {
      if (focusPath !== undefined) headerRefs.current.get(focusPath)?.focus()
      else hideRef.current?.focus()
    })
  }

  return (
    <aside
      className={`right-panel${overlay ? ' right-panel--overlay' : ''}`}
      role="complementary"
      aria-label="Right panel"
      style={{ '--right-panel-width': `${previewWidth}px` } as CSSProperties}
      onKeyDown={(event) => {
        if (overlay && event.key === 'Escape') {
          event.preventDefault()
          onHide()
        }
      }}
    >
      <div
        className="right-panel__resize"
        role="separator"
        aria-label="Resize right panel"
        aria-orientation="vertical"
        aria-valuemin={RIGHT_PANEL_MIN_W}
        aria-valuemax={RIGHT_PANEL_MAX_W}
        aria-valuenow={previewWidth}
        tabIndex={0}
        onMouseDown={startResize}
        onKeyDown={resizeByKeyboard}
      />
      <div className="right-panel__toolbar">
        <button type="button" className="right-panel__tool" aria-label="Back in right panel" title="Back" disabled={!canBack} onClick={onBack}>
          <Chevron d="m10 4-4 4 4 4" />
        </button>
        <button type="button" className="right-panel__tool" aria-label="Forward in right panel" title="Forward" disabled={!canForward} onClick={onForward}>
          <Chevron d="m6 4 4 4-4 4" />
        </button>
        <span className="right-panel__toolbar-spacer" />
        <button ref={hideRef} type="button" className="right-panel__tool right-panel__hide" aria-label="Hide right panel" title="Hide right panel" onClick={onHide}>
          <Chevron d="m11 4-4 4 4 4" />
        </button>
      </div>
      <ul className="right-panel__headers" aria-label="Open pages in right panel">
        {items.map((path, index) => {
          const label = stripExt(basename(path))
          const isExpanded = path === expanded
          return (
            <li key={path} className={`right-panel__item${isExpanded ? ' right-panel__item--expanded' : ''}`}>
              <button
                ref={(node) => {
                  if (node === null) headerRefs.current.delete(path)
                  else headerRefs.current.set(path, node)
                }}
                type="button"
                className="right-panel__header"
                aria-expanded={isExpanded}
                title={path}
                onClick={() => onToggle(path)}
              >
                <Chevron d={isExpanded ? 'm4 6 4 4 4-4' : 'm6 4 4 4-4 4'} />
                <span className="right-panel__label">{label}</span>
              </button>
              <button type="button" className="right-panel__close" aria-label={`Close ${label}`} title={`Close ${label}`} onClick={() => close(path, index)}>
                ×
              </button>
            </li>
          )
        })}
      </ul>
      <div className="right-panel__viewer">
        {items.length === 0 ? <p className="right-panel__empty">Open a page in the right panel</p> : children}
      </div>
    </aside>
  )
}
