import { useEffect } from 'react'
import './outsideUpdateChip.css'

export interface OutsideUpdateStep {
  /** 0-based active stop index, or -1 before the user has jumped. */
  index: number
  /** Total number of spatial change stops. */
  total: number
  onPrev: () => void
  onNext: () => void
}

export interface OutsideUpdateChipProps {
  /** Number of shapes added or changed by the outside update. */
  count: number
  /** Monotonic sequence counter so consecutive updates with the same count reset the auto-dismiss timer. */
  seq?: number
  /** Whether at least one changed shape is off-screen (shows the "Show" button). Defaults to true. */
  canShow?: boolean
  /** Pan/scroll the canvas to the updated shapes. */
  onShow: () => void
  /** Prev/Next cycling when changes span multiple stops on the board (YAZ-6402). */
  step?: OutsideUpdateStep
  /** Return to the previous viewport after clicking Show (YAZ-6396). */
  onBack?: () => void
  /** Clear all green/amber outside-change outlines on the board and dismiss the chip (YAZ-6399). */
  onClear?: () => void
  /** Dismiss the chip. */
  onDismiss: () => void
  /** Auto-dismiss timeout in milliseconds. Pass 0 to stay open until checked (YAZ-6399). */
  autoDismissMs?: number
}

/**
 * Passive floating pill shown on a drawing canvas when an outside write (e.g. AI or another app)
 * merges shapes into the open board (YAZ-4279 item 10, YAZ-6396, YAZ-6399, YAZ-6402).
 */
export function OutsideUpdateChip({ count, seq = 0, canShow = true, onShow, step, onBack, onClear, onDismiss, autoDismissMs = 0 }: OutsideUpdateChipProps) {
  useEffect(() => {
    if (autoDismissMs <= 0) return
    const timer = setTimeout(onDismiss, autoDismissMs)
    return () => clearTimeout(timer)
  }, [count, seq, autoDismissMs, onDismiss])

  if (count <= 0) return null

  const multi = step !== undefined && step.total >= 2

  return (
    <div className="outside-update-chip" role="status" aria-live="polite">
      <span className="outside-update-chip__dot" aria-hidden="true" />
      <span className="outside-update-chip__text">
        Outside update: {count} {count === 1 ? 'shape' : 'shapes'} changed
      </span>
      {multi ? (
        <>
          <button type="button" className="outside-update-chip__show" aria-label="Previous change" onClick={step.onPrev}>
            ‹
          </button>
          <span className="outside-update-chip__text">
            {step.index >= 0 ? `${step.index + 1} / ${step.total}` : `${step.total} spots`}
          </span>
          <button type="button" className="outside-update-chip__show" aria-label="Next change" onClick={step.onNext}>
            ›
          </button>
        </>
      ) : onBack === undefined && canShow ? (
        <button type="button" className="outside-update-chip__show" onClick={onShow}>
          Show
        </button>
      ) : null}
      {onBack !== undefined && (
        <button type="button" className="outside-update-chip__show" onClick={onBack}>
          Back
        </button>
      )}
      {onClear !== undefined && (
        <button type="button" className="outside-update-chip__show" onClick={onClear}>
          Mark checked
        </button>
      )}
      <button type="button" className="outside-update-chip__dismiss" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}
