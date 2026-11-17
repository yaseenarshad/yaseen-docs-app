/**
 * MOCHI'S NUMBERS ON SCREEN (YAZ-5672), ONE piece for the Mac's Inbox (`CardInboxBar`) and the phone's Review
 * (`ReviewView`); the numbers are the session's (`filterCount`, `sessionMisses`).
 *
 *  - `SessionCount` (YAZ-5674), the top right: a red ✕ K (the due cards back after a Forgot; hidden at 0 and in the
 *    missed pass), the open filter's icon (the menu's own: an inbox tray for All cards, a dotted circle for New
 *    cards), then "done / total". It replaces "N of M" and the top row's "Today: N cards · ⏱".
 *  - `SessionBar` (YAZ-5676, YAZ-5671 finding 14, measured from Mochi's page): a 6 px track with 3 px corners; a red
 *    fill under a grey fill, both from the left edge; grey = done ÷ total, red = (done + waiting) ÷ total, so the red
 *    always sits right after the grey and travels right with it. Both widths move with Mochi's own easing; with Reduce
 *    motion they jump. It replaces option B's steps (YAZ-5660).
 */
import type { ReactNode } from 'react'
import type { CardReviewSession } from './useCardReview'
import './sessionCount.css'

type Numbers = Pick<CardReviewSession, 'progress' | 'misses'>

const share = (n: number, total: number): string => `${total <= 0 ? 0 : Math.min(100, (100 * n) / total)}%`

/** The top right: "✕ 2 · ▣ 4 / 6". `icon`: the open filter's glyph. */
export function SessionCount({ session, icon }: { session: Numbers; icon: ReactNode }) {
  const { done, total } = session.progress
  const misses = session.misses
  return (
    <span className="session-count" aria-label={`${misses > 0 ? `${misses} missed, ` : ''}${done} of ${total} done`}>
      {misses > 0 && (
        <span className="session-count__misses" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
            <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
          </svg>
          {misses}
        </span>
      )}
      <span className="session-count__done" aria-hidden="true">
        {icon}
        {done} / {total}
      </span>
    </span>
  )
}

/** The progress bar: grey done, then red for the misses waiting, on a quiet track. */
export function SessionBar({ session, className }: { session: Numbers; className?: string }) {
  const { done, total, waiting } = session.progress
  return (
    <div className={className === undefined ? 'session-bar' : `session-bar ${className}`} role="progressbar" aria-label="Cards done" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
      <span className="session-bar__red" style={{ width: share(done + waiting, total) }} />
      <span className="session-bar__grey" style={{ width: share(done, total) }} />
    </div>
  )
}
