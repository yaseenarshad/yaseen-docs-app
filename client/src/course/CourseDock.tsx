/**
 * THE DOCK'S CONTROLS (YAZ-5365): the size switch (full, side, corner), the side panel's resize edge, and the corner's
 * move handle. Each works with the pointer and with the keyboard. The layer (`CardCourse`) owns the state; these only
 * report what the person did.
 */
import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { COURSE_SIDE, cornerToward, nearestCorner, sideAt, type DockCorner, type DockSize, type View } from './dock'

export const SIZE_LABEL: Record<DockSize, string> = { full: 'Full size', side: 'Side panel', corner: 'Corner' }

/** A small picture of each size: the window, and the player's part of it filled. */
function SizeIcon({ size }: { size: DockSize }) {
  return (
    <svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true" focusable="false">
      <rect x="0.75" y="0.75" width="14.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {size === 'full' && <rect x="2.5" y="2.5" width="11" height="7" rx="0.5" fill="currentColor" />}
      {size === 'side' && <rect x="9.5" y="2.5" width="4" height="7" rx="0.5" fill="currentColor" />}
      {size === 'corner' && <rect x="8.5" y="6" width="5" height="3.5" rx="0.5" fill="currentColor" />}
    </svg>
  )
}

export function SizeSwitch({ size, onChoose }: { size: DockSize; onChoose: (size: DockSize) => void }) {
  return (
    <span className="course__sizes" role="group" aria-label="Player size">
      {(['full', 'side', 'corner'] as const).map((s) => (
        <button key={s} type="button" className="course__btn course__btn--size" aria-label={SIZE_LABEL[s]} title={SIZE_LABEL[s]} aria-pressed={size === s} data-size-choice={s} onClick={() => onChoose(s)}>
          <SizeIcon size={s} />
        </button>
      ))}
    </span>
  )
}

/** The arrows' step on the side panel's edge (a part of the window). */
export const SIDE_STEP = 0.02

/** The side panel's left edge: drag it, or use the arrows, to make the panel wider or narrower within its limits. */
export function SideEdge({ side, view, onLive, onEnd }: { side: number; view: () => View; onLive: (part: number) => void; onEnd: (part: number) => void }) {
  const dragging = useRef<number | null>(null)
  const last = useRef(side)
  last.current = side
  const clampPart = (v: number): number => Math.round(Math.min(COURSE_SIDE.max, Math.max(COURSE_SIDE.min, v)) * 1000) / 1000
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const next =
      e.key === 'ArrowLeft' ? side + SIDE_STEP
      : e.key === 'ArrowRight' ? side - SIDE_STEP
      : e.key === 'Home' ? COURSE_SIDE.max
      : e.key === 'End' ? COURSE_SIDE.min
      : null
    if (next === null) return
    e.preventDefault()
    onEnd(clampPart(next))
  }
  return (
    <div
      className="course__edge"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the course"
      aria-valuemin={Math.round(COURSE_SIDE.min * 100)}
      aria-valuemax={Math.round(COURSE_SIDE.max * 100)}
      aria-valuenow={Math.round(side * 100)}
      aria-valuetext={`${Math.round(side * 100)}% of the window`}
      tabIndex={0}
      data-dragging={dragging.current !== null ? 'true' : undefined}
      onKeyDown={onKey}
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return
        e.preventDefault()
        dragging.current = e.pointerId
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (dragging.current !== e.pointerId) return
        onLive(sideAt(e.clientX, view()))
      }}
      onPointerUp={(e) => {
        if (dragging.current !== e.pointerId) return
        dragging.current = null
        onEnd(sideAt(e.clientX, view()))
      }}
      onPointerCancel={() => {
        if (dragging.current === null) return
        dragging.current = null
        onEnd(last.current)
      }}
    />
  )
}

/**
 * The corner's move handle: drag the player to another corner (it snaps to the nearest one on release), or use the
 * arrows. `onDrag` moves the player with the pointer while it drags; `onDrop` gives the new corner.
 */
export function CornerGrip({ corner, box, view, onDrag, onDrop }: { corner: DockCorner; box: () => { left: number; top: number; width: number; height: number } | null; view: () => View; onDrag: (dx: number, dy: number) => void; onDrop: (corner: DockCorner) => void }) {
  const start = useRef<{ pointer: number; x: number; y: number } | null>(null)
  const end = (e: ReactPointerEvent<HTMLButtonElement>, drop: boolean): void => {
    const s = start.current
    if (s === null || s.pointer !== e.pointerId) return
    start.current = null
    const b = box()
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    onDrag(0, 0)
    if (!drop || b === null || Math.hypot(dx, dy) < 4) return
    onDrop(nearestCorner(b.left + dx + b.width / 2, b.top + dy + b.height / 2, view()))
  }
  return (
    <button
      type="button"
      className="course__grip"
      aria-label="Move the player"
      title="Drag to another corner, or use the arrow keys"
      onKeyDown={(e) => {
        const next = cornerToward(corner, e.key)
        if (!e.key.startsWith('Arrow')) return
        e.preventDefault()
        if (next !== corner) onDrop(next)
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        start.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY }
        e.currentTarget.setPointerCapture?.(e.pointerId)
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (s === null || s.pointer !== e.pointerId) return
        onDrag(e.clientX - s.x, e.clientY - s.y)
      }}
      onPointerUp={(e) => end(e, true)}
      onPointerCancel={(e) => end(e, false)}
    >
      <svg viewBox="0 0 10 14" width="10" height="14" aria-hidden="true" focusable="false">
        {[2, 7, 12].flatMap((y) => [3, 7].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="currentColor" />))}
      </svg>
    </button>
  )
}
