import { useEffect } from 'react'
import type { ReviewSession } from './useReview'
import './reviewBar.css'

/**
 * The review surface's own chrome (YAZ-2322). A session REPLACES the main pane and is not a tab:
 * App puts `ReviewBar` where the tab strip was, shows the session's note under it, and
 * `ReviewAnswers` under that. Presentational — the session and every answer are `useReview`'s.
 */

/** An open dialog, sheet, picker or menu owns the keys: each closes on its own Escape, and not all of them swallow it. */
const KEY_OWNERS = '[role="dialog"], [role="menu"]'

interface ReviewBarProps {
  session: ReviewSession
  onKeep: () => void
  onSkip: () => void
  onUndo: () => void
  onClose: () => void
}

/**
 * The top bar, in the tab strip's place and dress. It is mounted exactly while a session is open,
 * so the session's keys live here: with no session there is nothing listening.
 */
export function ReviewBar({ session, onKeep, onSkip, onUndo, onClose }: ReviewBarProps) {
  useEffect(() => {
    // CAPTURE, and the key stops here: the answers work with the caret in the note, and
    // nothing under the window may also act on them — a comment box submits on any ⌘⏎.
    const onAnswer = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase()
      if (!event.metaKey || !event.shiftKey || event.ctrlKey || event.altKey || (key !== 'enter' && key !== 's')) return
      if (document.querySelector(KEY_OWNERS) !== null) return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      if (key === 'enter') onKeep()
      else onSkip()
    }
    // BUBBLE: Escape closes the review only when nothing nearer took it — the find bar, a cell edit.
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented && document.querySelector(KEY_OWNERS) === null) onClose()
    }
    window.addEventListener('keydown', onAnswer, true)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('keydown', onAnswer, true)
      window.removeEventListener('keydown', onEscape)
    }
  }, [onKeep, onSkip, onClose])

  return (
    <div className="tabbar-row review-bar">
      <span className="review-bar__label">{session.label}</span>
      {session.path !== null && (
        <span className="review-bar__count">
          {session.position} of {session.total}
        </span>
      )}
      <button type="button" className="tabbar-nav__btn review-bar__undo" disabled={!session.canUndo} onClick={onUndo}>
        Undo
      </button>
      <button type="button" className="tabbar-nav__btn" aria-label="Close review" title="Close review" onClick={onClose}>
        ✕
      </button>
    </div>
  )
}

/** The two answers, under the note, each with the chord that gives it. */
export function ReviewAnswers({ onKeep, onSkip }: Pick<ReviewBarProps, 'onKeep' | 'onSkip'>) {
  return (
    <div className="review-answers">
      <button type="button" className="confirm__btn" onClick={onKeep}>
        Still relevant<kbd>⌘⇧⏎</kbd>
      </button>
      <button type="button" className="confirm__btn" onClick={onSkip}>
        Skip<kbd>⌘⇧S</kbd>
      </button>
    </div>
  )
}

/**
 * What the main pane says when the session has no page of its own to show there: nothing is left,
 * or the note is open in the side panel — one editor per note, so it is reviewed there.
 */
export function ReviewMessage({ session, onClose }: Pick<ReviewBarProps, 'session' | 'onClose'>) {
  if (session.path !== null) return <p className="review-message">This note is open in the side panel.</p>
  return (
    <div className="review-message">
      <p>{session.label === 'Inbox' ? 'Inbox complete.' : `Nothing due in ${session.label}.`}</p>
      <button type="button" className="confirm__btn" onClick={onClose}>
        Back to tabs
      </button>
    </div>
  )
}
