import { useEffect } from 'react'
import './outsideUpdateChip.css'

export interface OutsideUpdateChipProps {
  /** Number of shapes added or changed by the outside update. */
  count: number
  /** Monotonic sequence counter so consecutive updates with the same count reset the auto-dismiss timer. */
  seq?: number
  /** Pan/scroll the canvas to the updated shapes. */
  onShow: () => void
  /** Dismiss the chip. */
  onDismiss: () => void
  /** Auto-dismiss timeout in milliseconds (default 12s). Pass 0 to disable. */
  autoDismissMs?: number
}

/**
 * Passive floating pill shown on a drawing canvas when an outside write (e.g. AI or another app)
 * merges shapes into the open board (YAZ-4279 item 10). Offers a one-click "Show" jump and dismiss.
 */
export function OutsideUpdateChip({ count, seq = 0, onShow, onDismiss, autoDismissMs = 12_000 }: OutsideUpdateChipProps) {
  useEffect(() => {
    if (autoDismissMs <= 0) return
    const timer = setTimeout(onDismiss, autoDismissMs)
    return () => clearTimeout(timer)
  }, [count, seq, autoDismissMs, onDismiss])

  if (count <= 0) return null

  return (
    <div className="outside-update-chip" role="status" aria-live="polite">
      <span className="outside-update-chip__dot" aria-hidden="true" />
      <span className="outside-update-chip__text">
        Outside update: {count} {count === 1 ? 'shape' : 'shapes'} changed
      </span>
      <button type="button" className="outside-update-chip__show" onClick={onShow}>
        Show
      </button>
      <button type="button" className="outside-update-chip__dismiss" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}
