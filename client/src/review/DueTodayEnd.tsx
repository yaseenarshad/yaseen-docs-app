/**
 * THE END OF DUE TODAY (YAZ-5043, Option A, Yaseen's picks): the screen in place of the card when Due today stops
 * (`useCardReview`'s `end`). ONE screen for the Inbox and a page's or a folder's review (item 8).
 *
 *  - After the first pass: the top bar's grey and red slide down into a small ring, which fills to the % (600 ms), and
 *    four small dots float out once. "You remembered 93% of 73 cards." and ONE button, "Review missed cards 5" (item 7:
 *    no skip; you finish them that day).
 *  - Due today done: the ring closes in green and a ✓ draws, with one natural burst of confetti (item 13, lazy:
 *    `confetti.ts` loads only here). "Due today is done." then "Learn new cards 11" with its "from Spanish ▾".
 *  - Reduce motion (item 5): the ring full at once, no dots, no confetti.
 *  - It plays ONCE per stop, and only while it shows (item 16): behind a page tab or in a hidden window it waits, and
 *    plays when it shows. A stop seen already (focus mode, a tab back) shows still.
 *  - Enter and Space do nothing new here (item 4).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DueTodayEnd as End } from './useCardReview'
import './dueTodayEnd.css'

/** The stops whose animation played (by `End.id`): each plays once, also when the Inbox draws again. */
const played = new Set<string>()

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** Whether the screen is in front: its tab shows and the window is not hidden. */
function useInFront(shown: boolean): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return shown && visible
}

const cards = (n: number): string => `${n} card${n === 1 ? '' : 's'}`

const RefreshIcon = () => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" />
  </svg>
)
const NewIcon = () => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
)

interface Props {
  end: End
  /** The Inbox tab is the one on show. */
  shown: boolean
  /** "Review missed cards" / "Learn new cards". */
  onGoOn: () => void
  /** The new cards' "from Spanish ▾" (YAZ-5322), after "Learn new cards". */
  from?: ReactNode
  /** The done screen with no new card left: what the screen says after (what waits, Add, the way on). */
  children?: ReactNode
}

export function DueTodayEnd({ end, shown, onGoOn, from, children }: Props) {
  const inFront = useInFront(shown)
  const ringRef = useRef<HTMLDivElement>(null)
  // 'wait' until in front; then 'play' once; 'still' when seen already or with Reduce motion.
  const [motion, setMotion] = useState<'wait' | 'play' | 'still'>(() => (played.has(end.id) || reducedMotion() ? 'still' : 'wait'))
  useEffect(() => setMotion(played.has(end.id) || reducedMotion() ? 'still' : 'wait'), [end.id])
  useEffect(() => {
    if (motion !== 'wait' || !inFront) return
    played.add(end.id)
    setMotion('play')
    // Due today done: the confetti as the ring closes, its code loaded only now (no eager weight). It ends by itself in 2 s.
    const ring = ringRef.current
    if (end.kind === 'done' && ring !== null) setTimeout(() => void import('./confetti').then((m) => ring.isConnected && m.confettiBurst(ring)), 600)
  }, [motion, inFront, end.id, end.kind])
  // Played: still from now on, so a tab hidden and shown again (its CSS animations would start over) shows the end.
  useEffect(() => {
    if (motion !== 'play') return
    const timer = setTimeout(() => setMotion('still'), 1400)
    return () => clearTimeout(timer)
  }, [motion])

  const done = end.kind === 'done'
  const green = done ? 100 : end.percent
  return (
    <div className="due-end" data-kind={end.kind} data-motion={motion}>
      <div ref={ringRef} className="due-end__ring" aria-hidden>
        <svg viewBox="0 0 72 72" width={72} height={72}>
          <circle className="due-end__track" cx={36} cy={36} r={30} pathLength={100} />
          {!done && green < 100 && <circle className="due-end__arc due-end__arc--missed" cx={36} cy={36} r={30} pathLength={100} style={{ strokeDasharray: `${100 - green} 100`, strokeDashoffset: -green }} />}
          <circle className="due-end__arc due-end__arc--ok" cx={36} cy={36} r={30} pathLength={100} style={{ strokeDasharray: `${green} 100` }} />
          {done && <path className="due-end__check" d="M25 37l7.5 7.5L48 29" pathLength={1} />}
        </svg>
        {!done && <span className="due-end__pct">{end.percent}%</span>}
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="due-end__dot" data-dot={i} />
        ))}
      </div>
      {done ? (
        <>
          <p className="card-inbox__done-title">Due today is done.</p>
          {end.count > 0 && <p className="card-inbox__done-line">You remembered {end.percent}% of {cards(end.count)}.</p>}
          {end.fresh > 0 ? (
            <>
              <p className="card-inbox__done-line">Do you want to learn some new cards?</p>
              <div className="due-end__actions">
                <button type="button" className="due-end__go" onMouseDown={(e) => e.preventDefault()} onClick={onGoOn}>
                  <NewIcon />
                  Learn new cards{' '}
                  <span className="due-end__count">{end.fresh}</span>
                </button>
                {from}
              </div>
            </>
          ) : (
            children
          )}
        </>
      ) : (
        <>
          <p className="card-inbox__done-title">
            You remembered {end.percent}% of {cards(end.count)}.
          </p>
          <p className="card-inbox__done-line">{cards(end.missed)} to look at again while they are fresh.</p>
          <div className="due-end__actions">
            <button type="button" className="due-end__go" onMouseDown={(e) => e.preventDefault()} onClick={onGoOn}>
              <RefreshIcon />
              Review missed cards{' '}
              <span className="due-end__count">{end.missed}</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
