/**
 * CONFIRM CHANGES (YAZ-3746 13AN): a change to a page's own values from a folder page asks first, so a stray key in a
 * cell never changes a page. On by default: Settings › Folder pages › Confirm changes, and the folder's cog
 * (`confirm_changes` in its `.folder.md`) can say otherwise.
 *
 * The ask is a small card by the cell or card that changes: what changes, from what to what, with Change (Enter) and
 * Cancel (Esc). Its foot applies the change and stops asking for a while — 1, 5 or 10 minutes, on this page, in this
 * window, until the time is up or the app restarts — or for good on this page ("Don't ask on this page", the cog's Off).
 * Nothing is written before Change; Cancel puts the old value back (`CHANGE_CANCELLED`). Undo and redo never ask: the
 * change they step over was asked for.
 *
 * The card is in `document.body`, outside the zoomed folder page, so it is placed in screen px and keeps its size.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { KeyLabel } from '../keys/KeyLabel'

/** A write's rejection when its ask was cancelled: the cell drops what it showed, and no error is shown. */
export const CHANGE_CANCELLED = new Error('The change was cancelled')

export interface ChangeAsk {
  /** What changes: the column's name, or the gesture ("Clear", "Paste into", "Rename", "Move"). */
  kind: string
  /** The page it changes, by title. */
  page?: string
  /** The value before; absent where it is not known (a move). */
  from?: unknown
  /** The value after. */
  to?: unknown
  /** A bulk change's size instead of a before → after: "44 cells in 44 pages". */
  summary?: string
  /** The go button's word (13AS): "Clear", "Paste", "Move", "Rename"…; absent: "Change". */
  action?: string
  /** The cell or card that changes: the card opens under it. */
  anchor?: Element | null
  /** Else a point on screen (a drop): the card opens there. */
  point?: { x: number; y: number }
}

/** Resolves true to go ahead, false when cancelled. Absent where the page does not ask. */
export type ConfirmChange = (ask: ChangeAsk) => Promise<boolean>

/** The pauses the ask offers, in minutes (13AN): a quick fix, a short pass, a longer clean-up. */
export const PAUSE_MINUTES = [1, 5, 10] as const

/** Each folder page's pause, in this window: its path → the time it ends. */
const pauses = new Map<string, number>()
const pauseListeners = new Set<() => void>()
const pausedNow = (folder: string): boolean => (pauses.get(folder) ?? 0) > Date.now()
const setPause = (folder: string, until: number | null): void => {
  if (until === null) pauses.delete(folder)
  else pauses.set(folder, until)
  pauseListeners.forEach((listener) => listener())
}

/** The words for a value in an ask: "Empty", "Checked", a list joined by commas, cut at 40 characters. */
const isEmptyValue = (value: unknown): boolean => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

export function askValue(value: unknown): string {
  if (isEmptyValue(value)) return 'Empty'
  if (value === true) return 'Checked'
  if (value === false) return 'Unchecked'
  const text = Array.isArray(value) ? value.map((item) => askValue(item)).join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.length > 40 ? `${text.slice(0, 39)}…` : text
}

interface Pending {
  ask: ChangeAsk
  resolve: (ok: boolean) => void
  /** Where the keyboard was, to give it back. */
  focus: Element | null
}

/**
 * A folder page's ask: `confirm` (undefined while the page does not ask), the card while one is open, and the
 * toolbar's "Not asking · 4:32 · Resume" while a pause runs. `onTurnOff` is "Don't ask on this page".
 */
export function useConfirmChanges(folder: string, on: boolean, onTurnOff?: () => void): { confirm: ConfirmChange | undefined; card: ReactNode; pauseChip: ReactNode } {
  const [queue, setQueue] = useState<readonly Pending[]>([])
  const [, tick] = useState(0)
  const paused = pausedNow(folder)
  // A pause's countdown, once a second while it runs; any page's pause or resume renders this one too.
  useEffect(() => {
    const listener = () => tick((n) => n + 1)
    pauseListeners.add(listener)
    return () => void pauseListeners.delete(listener)
  }, [])
  useEffect(() => {
    if (!paused) return
    const timer = window.setInterval(() => {
      tick((n) => n + 1)
      if (!pausedNow(folder)) setPause(folder, null)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [folder, paused])

  const settle = useCallback((ok: boolean, all = false) => {
    setQueue((q) => {
      const done = all ? q : q.slice(0, 1)
      for (const item of done) {
        item.resolve(ok)
        if (item.focus instanceof HTMLElement && item.focus.isConnected) item.focus.focus({ preventScroll: true })
      }
      return all ? [] : q.slice(1)
    })
  }, [])

  const confirm = useCallback<ConfirmChange>(
    (ask) => {
      if (pausedNow(folder)) return Promise.resolve(true)
      return new Promise<boolean>((resolve) => setQueue((q) => [...q, { ask, resolve, focus: document.activeElement }]))
    },
    [folder],
  )

  const current = queue[0]
  const card =
    current === undefined
      ? null
      : createPortal(
          <ChangeAskCard
            ask={current.ask}
            onChange={() => settle(true)}
            onCancel={() => settle(false)}
            onPause={(minutes) => {
              setPause(folder, Date.now() + minutes * 60_000)
              settle(true, true)
            }}
            onTurnOff={
              onTurnOff &&
              (() => {
                onTurnOff()
                settle(true, true)
              })
            }
          />,
          document.body,
        )

  const left = paused ? Math.max(0, (pauses.get(folder) ?? 0) - Date.now()) : 0
  const pauseChip = paused ? (
    <span className="change-pause" role="status" title="Changes on this folder page do not ask until the time is up">
      Not asking · {Math.floor(left / 60_000)}:{String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}
      <button type="button" className="change-pause__resume" onClick={() => setPause(folder, null)}>
        Resume
      </button>
    </span>
  ) : null

  return { confirm: on ? confirm : undefined, card, pauseChip }
}

/** The ask card: under its anchor (or at its point), inside the window. Enter is Change, Esc and a click outside Cancel. */
function ChangeAskCard({ ask, onChange, onCancel, onPause, onTurnOff }: { ask: ChangeAsk; onChange: () => void; onCancel: () => void; onPause: (minutes: number) => void; onTurnOff?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const box = el.getBoundingClientRect()
    const at = ask.anchor?.isConnected ? ask.anchor.getBoundingClientRect() : null
    const x = at !== null ? at.left : ask.point?.x ?? (window.innerWidth - box.width) / 2
    let y = at !== null ? at.bottom + 6 : ask.point !== undefined ? ask.point.y + 12 : window.innerHeight / 3
    // No room under the cell: above it.
    if (at !== null && y + box.height > window.innerHeight - 8) y = at.top - 6 - box.height
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - 8 - box.width)), top: Math.max(8, Math.min(y, window.innerHeight - 8 - box.height)) })
    // The cell's editor gives the keyboard back to its cell as it closes: the card takes it after that, a frame later.
    const go = () => el.querySelector<HTMLButtonElement>('.change-ask__go')?.focus({ preventScroll: true })
    go()
    const frame = requestAnimationFrame(go)
    return () => cancelAnimationFrame(frame)
  }, [ask])
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) onCancel()
    }
    // A capture listener: the table's own keys never see the Esc or Enter that answers the card. Enter on one of the
    // card's other buttons presses that button.
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement && ref.current?.contains(e.target) && !e.target.classList.contains('change-ask__go'))) {
        e.preventDefault()
        e.stopPropagation()
        onChange()
      }
    }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [onCancel, onChange])
  const label = ask.summary !== undefined ? `${ask.kind} ${ask.summary}?` : `${ask.kind}${ask.page === undefined ? '' : ` of ${ask.page}`}: ${'from' in ask ? `${askValue(ask.from)} to ` : ''}${askValue(ask.to)}?`
  const value = (v: unknown, side: 'from' | 'to') => (
    <span className={`change-ask__val change-ask__val--${side}${isEmptyValue(v) ? ' change-ask__val--empty' : ''}`} title={askValue(v)}>
      {askValue(v)}
    </span>
  )
  return (
    <div ref={ref} className="change-ask" role="alertdialog" aria-label={label} style={pos === null ? { visibility: 'hidden' } : { left: pos.left, top: pos.top }}>
      <div className="change-ask__body">
        <div className="change-ask__head">
          <span className="change-ask__kind">{ask.kind}</span>
          {ask.page !== undefined && (
            <span className="change-ask__note" title={ask.page}>
              {ask.page}
            </span>
          )}
        </div>
        {ask.summary !== undefined ? (
          <p className="change-ask__summary">{ask.summary}</p>
        ) : (
          <div className="change-ask__diff">
            {'from' in ask && value(ask.from, 'from')}
            <svg className="change-ask__arrow" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
            {value(ask.to, 'to')}
          </div>
        )}
        <div className="change-ask__actions">
          <button type="button" className="change-ask__cancel" onClick={onCancel}>
            <KeyLabel action="Cancel" keys="esc" />
          </button>
          <button type="button" className="change-ask__go" onClick={onChange}>
            <KeyLabel action={ask.action ?? 'Change'} keys="↵" />
          </button>
        </div>
      </div>
      <div className="change-ask__foot">
        <span className="change-ask__foot-label">Pause asking</span>
        <div className="change-ask__pauses" role="group" aria-label="Change, then pause asking for">
          {PAUSE_MINUTES.map((minutes) => (
            <button key={minutes} type="button" className="change-ask__pause" title={`Change, then stop asking on this folder page for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`} onClick={() => onPause(minutes)}>
              {minutes} min
            </button>
          ))}
        </div>
        {onTurnOff !== undefined && (
          <button type="button" className="change-ask__off" title="Change, and stop asking on this folder page (its ⚙ › Confirm changes: Off)" onClick={onTurnOff}>
            Don't ask here
          </button>
        )}
      </div>
    </div>
  )
}
