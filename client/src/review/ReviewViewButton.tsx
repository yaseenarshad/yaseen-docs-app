/**
 * THE REVIEW TOP ROW'S "VIEW" (YAZ-5689, Yaseen: "should we make it behind one icon click? … I don't like that there's
 * that much stuff on the top right … it takes away from the folder breadcrumb area"): at rest the row's right end is the
 * count and ONE quiet icon, the page header's sliders (`PropertiesIcon`). A CLICK (not a hover: YAZ-5686's fade is gone)
 * opens a small panel under it:
 *
 *  - Time: today's review time, as Settings › Review › Time so far says. Hidden (the default): "Show", a click shows
 *    it until the panel closes. Shown: the time. Off: no Time row.
 *  - Zoom: the Inbox zoom's own pill (− 100% +, `DocumentZoom`). The keys (⌘+ / ⌘− / ⌘0) work with the panel shut.
 *  - Focus mode: the bar's focus button (F, Esc leave it), only where the App gives the door.
 *
 * Esc, a click outside or a click on the icon closes it. Away from 100% the icon wears a small accent dot, so a zoomed
 * card says why at rest. The phone has no View: it has no zoom or focus mode, and its time stays in its sheet.
 */
import { useRef, useState } from 'react'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import { DocumentZoom } from '../editor/DocumentZoom'
import type { TimeSoFar } from '@shared/reviews'
import { PropertiesIcon } from '../views/view/icons'
import { FocusIcon } from './cardInboxIcons'
import { todayDuration } from './reviewTime'

/** The panel's width in px: it opens right-aligned under the icon. */
const PANEL_WIDTH = 220

interface ReviewViewButtonProps {
  /** Today's seconds of review (`ReviewedToday.seconds`). */
  seconds: number
  time: TimeSoFar
  zoom: number
  setZoom: (zoom: number) => void
  /** Focus mode and its door; without a door, no Focus mode row. */
  focusMode: boolean
  onFocusMode?: (on: boolean) => void
}

export function ReviewViewButton({ seconds, time, zoom, setZoom, focusMode, onFocusMode }: ReviewViewButtonProps) {
  const button = useRef<HTMLButtonElement>(null)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const [timeShown, setTimeShown] = useState(false)
  const close = () => {
    setAt(null)
    setTimeShown(false)
  }
  const toggle = () => {
    if (at !== null) return close()
    const r = button.current?.getBoundingClientRect()
    setAt({ x: (r?.right ?? PANEL_WIDTH) - PANEL_WIDTH, y: (r?.bottom ?? 0) + 4 })
  }
  const spent = todayDuration(seconds)
  return (
    <>
      <button
        ref={button}
        type="button"
        className="card-inbox__view"
        aria-label="View"
        aria-haspopup="dialog"
        aria-expanded={at !== null}
        data-zoomed={zoom !== 100 || undefined}
        title={zoom !== 100 ? `View · Zoom ${zoom}%` : 'View'}
        // Not the panel's close-on-press: the click toggles it. The keyboard stays in the Inbox.
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onClick={toggle}
      >
        <PropertiesIcon />
      </button>
      {at !== null && (
        <ContextMenuSurface x={at.x} y={at.y} width={PANEL_WIDTH} onClose={close} role="dialog" className="card-inbox__view-panel">
          <div className="card-inbox__view-list" role="group" aria-label="View">
            {time !== 'off' && (
              <div className="card-inbox__view-row" data-row="time">
                <span className="card-inbox__view-label">Time</span>
                {time === 'shown' || timeShown ? (
                  <span className="card-inbox__view-time">{spent}</span>
                ) : (
                  <button type="button" className="card-inbox__view-time" aria-label="Show time so far" onMouseDown={(e) => e.preventDefault()} onClick={() => setTimeShown(true)}>
                    Show
                  </button>
                )}
              </div>
            )}
            <div className="card-inbox__view-row" data-row="zoom">
              <span className="card-inbox__view-label">Zoom</span>
              <DocumentZoom value={zoom} onChange={setZoom} label="Inbox zoom" />
            </div>
            {onFocusMode !== undefined && (
              <div className="card-inbox__view-row" data-row="focus">
                <span className="card-inbox__view-label">Focus mode</span>
                <kbd className="card-inbox__view-key" aria-hidden="true">
                  F
                </kbd>
                <button type="button" className="card-inbox__focus" aria-label="Focus mode" aria-pressed={focusMode} onMouseDown={(e) => e.preventDefault()} onClick={() => onFocusMode(!focusMode)}>
                  <FocusIcon on={focusMode} />
                </button>
              </div>
            )}
          </div>
        </ContextMenuSurface>
      )}
    </>
  )
}
