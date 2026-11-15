/**
 * THE COURSE'S TIMELINE (YAZ-5120, Yaseen: "scrub through the timeline so they can go back and forth"): the chapter's
 * progress bar is a slider for the whole chapter.
 *
 * - Drag it, or click anywhere on it: the player seeks there (`seek`, a time in the chapter). The clip under the
 *   pointer and the time in it come from the clips' lengths, the same ones the player uses (the voice's seconds when
 *   the sound is here, else the reading-time estimate). The stage follows the drag; a tip above the pointer shows the
 *   clip's caption and the time. The sound pauses while dragging and plays again on release if it played before.
 * - Thin ticks where each clip starts.
 * - Keys (it is a focusable slider named "Chapter progress"): Left / Right 5 seconds, Shift + Left / Right one clip,
 *   Home / End the chapter's start / end. Space stays the course's Play / Pause. No key goes on to the page.
 * - `paint()` (each frame, from the layer) moves the fill and the handle and sets the time for a screen reader, with
 *   no React render.
 */
import { forwardRef, useImperativeHandle, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { chapterTime, chapterTimes, type PlayerAction, type PlayerContext, type PlayerState } from './player'

/** The arrows' jump, in seconds. */
export const SCRUB_STEP_SECONDS = 5
/** Shift + Left in a clip after this many seconds goes to the clip's start; before it, to the clip before. */
const CLIP_RESTART_SECONDS = 1

/** `m:ss`. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export interface CourseScrubberProps {
  ctx: PlayerContext
  /** The player now (live, not the render's copy). */
  read: () => PlayerState
  dispatch: (action: PlayerAction) => void
}

export interface CourseScrubberHandle {
  paint(): void
}

interface Tip {
  fraction: number
  text: string
  time: string
}

export const CourseScrubber = forwardRef<CourseScrubberHandle, CourseScrubberProps>(function CourseScrubber({ ctx, read, dispatch }, ref) {
  const root = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  const handle = useRef<HTMLSpanElement>(null)
  const drag = useRef<{ pointer: number; wasPlaying: boolean } | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const [dragging, setDragging] = useState(false)

  const s = read()
  const times = chapterTimes(ctx, s.chapter)

  useImperativeHandle(ref, () => ({
    paint() {
      const p = read()
      const { total } = chapterTimes(ctx, p.chapter)
      const now = chapterTime(ctx, p)
      const fraction = total <= 0 ? 0 : Math.min(1, now / total)
      if (fill.current !== null) fill.current.style.transform = `scaleX(${fraction.toFixed(4)})`
      if (handle.current !== null) handle.current.style.left = `${(fraction * 100).toFixed(3)}%`
      const el = root.current
      if (el !== null) {
        el.setAttribute('aria-valuemax', String(Math.round(total)))
        el.setAttribute('aria-valuenow', String(Math.round(now)))
        el.setAttribute('aria-valuetext', `${clockText(now)} of ${clockText(total)}`)
      }
    },
  }))

  /** The chapter time under a pointer's x. */
  const timeAt = (clientX: number): { t: number; fraction: number } => {
    const box = track.current?.getBoundingClientRect()
    const { total } = chapterTimes(ctx, read().chapter)
    if (box === undefined || box.width <= 0) return { t: 0, fraction: 0 }
    const fraction = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
    return { t: fraction * total, fraction }
  }
  const seekTo = (t: number): void => dispatch({ type: 'seek', t })
  const showTip = (t: number, fraction: number): void => {
    const p = read()
    const { starts, total } = chapterTimes(ctx, p.chapter)
    let i = starts.length - 1
    while (i > 0 && starts[i] > t) i -= 1
    setTip({ fraction, text: ctx.course[p.chapter].clips[i].text, time: `${clockText(t)} / ${clockText(total)}` })
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    root.current?.focus({ preventScroll: true })
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // A pointer the element cannot take (a test's): the drag still works while it stays on the bar.
    }
    const wasPlaying = read().playing
    drag.current = { pointer: e.pointerId, wasPlaying }
    if (wasPlaying) dispatch({ type: 'pause' })
    setDragging(true)
    const { t, fraction } = timeAt(e.clientX)
    showTip(t, fraction)
    seekTo(t)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag.current === null || drag.current.pointer !== e.pointerId) return
    const { t, fraction } = timeAt(e.clientX)
    showTip(t, fraction)
    seekTo(t)
  }
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean): void => {
    const d = drag.current
    if (d === null || d.pointer !== e.pointerId) return
    drag.current = null
    if (!cancelled) seekTo(timeAt(e.clientX).t)
    setDragging(false)
    setTip(null)
    // The sound seeks to the same moment and plays again if it played (the layer's sync does the seek).
    if (d.wasPlaying) dispatch({ type: 'play' })
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const p = read()
    const { starts, total } = chapterTimes(ctx, p.chapter)
    const now = chapterTime(ctx, p)
    const clip = p.phase === 'clip' ? p.clip : starts.length
    let to: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') to = e.shiftKey ? (starts[clip + 1] ?? total) : Math.min(total, now + SCRUB_STEP_SECONDS)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      if (!e.shiftKey) to = Math.max(0, now - SCRUB_STEP_SECONDS)
      else {
        const start = clip < starts.length ? starts[clip] : total
        to = now - start > CLIP_RESTART_SECONDS ? (clip < starts.length ? start : starts[starts.length - 1]) : (starts[clip - 1] ?? 0)
      }
    } else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = total
    if (to === null) return
    e.preventDefault()
    e.stopPropagation()
    seekTo(to)
  }

  return (
    <div
      ref={root}
      className="course__scrub"
      role="slider"
      tabIndex={0}
      aria-label="Chapter progress"
      aria-valuemin={0}
      aria-orientation="horizontal"
      data-dragging={dragging ? 'true' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
      onKeyDown={onKeyDown}
    >
      <div ref={track} className="course__bar">
        <span ref={fill} />
        {times.starts.slice(1).map((start) => (
          <i key={start} className="course__scrub-tick" style={{ left: `${((start / times.total) * 100).toFixed(3)}%` }} aria-hidden="true" />
        ))}
      </div>
      <span ref={handle} className="course__scrub-handle" aria-hidden="true" />
      {tip !== null && (
        <span className="course__scrub-tip" aria-hidden="true" style={{ left: `${(tip.fraction * 100).toFixed(3)}%`, transform: `translateX(${(-tip.fraction * 100).toFixed(3)}%)` }}>
          <span className="course__scrub-tip-text">{tip.text}</span>
          <span className="course__scrub-tip-time">{tip.time}</span>
        </span>
      )}
    </div>
  )
})
