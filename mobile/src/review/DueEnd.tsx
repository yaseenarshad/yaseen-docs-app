import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { DueTodayEnd } from '@client/review/useCardReview'
import './dueEnd.css'

/**
 * THE END OF DUE TODAY ON THE PHONE (the Mac's `DueTodayEnd.tsx`, YAZ-5043, Option A). The stop itself is
 * the Mac's shared hook (`useCardReview`'s `end`, `goOn`): the same rules, the same words. This is its screen, made for
 * a phone:
 *
 *  - After the first pass: the ring comes down from the step bar and fills to the % (600 ms); four dots float out once.
 *    "You remembered 93% of 73 cards." and ONE button, "Review missed cards 5" (no skip).
 *  - Due today done: the ring closes in green and a ✓ shows, with one burst of confetti (the Mac's own `confetti.ts`,
 *    loaded only here). "Due today is done." then "Learn new cards 11" with its "from All folders ›".
 *  - Smooth on a phone: the ring fills by turning two half rings (`transform`), everything else is `transform` and
 *    `opacity`; the confetti is one canvas, at most 2× the pixels.
 *  - Reduce Motion: the ring full at once, no dots, no confetti.
 *  - It plays ONCE per stop, and only while the Review tab shows and the app is in front: hidden, it waits and plays
 *    when it shows. A stop seen already shows still. The confetti stops if the tab or the app goes away.
 */

/** The stops whose animation played (by `DueTodayEnd.id`): each plays once, also when the tab draws again. */
const played = new Set<string>()

export const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Whether the screen is in front: the Review tab shows and the app is not hidden. */
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

/** The fill (ms) and where it starts after the ring lands. */
const FILL_MS = 600
const FILL_AT = 220

/**
 * The ring's fill as two half rings that turn into place (`transform` only): the right half first, then the left.
 * Each turns from -180° (out of its half) to where `green` % ends; the time splits by the share of each half.
 */
export function ringTurns(green: number): CSSProperties {
  const g = Math.max(0, Math.min(100, green))
  const right = Math.min(g, 50) / 50
  const left = Math.max(g - 50, 0) / 50
  const d1 = g === 0 ? 0 : Math.round((FILL_MS * Math.min(g, 50)) / g)
  return {
    '--due-r1': `${45 - 180 + 180 * right}deg`,
    '--due-r2': `${225 - 180 + 180 * left}deg`,
    '--due-d1': `${d1}ms`,
    '--due-d2': `${FILL_MS - d1}ms`,
    '--due-at2': `${FILL_AT + d1}ms`,
    '--due-e1': g > 50 ? 'linear' : 'cubic-bezier(0.3, 0.7, 0.2, 1)',
  } as CSSProperties
}

const RefreshIcon = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" />
  </svg>
)
const NewIcon = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
)

interface Props {
  end: DueTodayEnd
  /** The Review tab is the one on show. */
  shown: boolean
  /** "Review missed cards" / "Learn new cards". */
  onGoOn: () => void
  /** The new cards' "from All folders ›", after "Learn new cards". */
  from?: ReactNode
  /** The done screen with no new card left: what the screen says after (what waits, Add). */
  children?: ReactNode
}

export function DueEnd({ end, shown, onGoOn, from, children }: Props) {
  const inFront = useInFront(shown)
  const front = useRef(inFront)
  front.current = inFront
  const ringRef = useRef<HTMLDivElement>(null)
  const stopConfetti = useRef<(() => void) | null>(null)
  // 'wait' until in front; then 'play' once; 'still' when seen already or with Reduce Motion.
  const still = () => played.has(end.id) || reducedMotion()
  const [motion, setMotion] = useState<'wait' | 'play' | 'still'>(() => (still() ? 'still' : 'wait'))
  useEffect(() => setMotion(still() ? 'still' : 'wait'), [end.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (motion !== 'wait' || !inFront) return
    played.add(end.id)
    setMotion('play')
    if (end.kind !== 'done') return
    // Due today done: the confetti as the ring closes, its code loaded only now. It ends by itself in 2 s.
    const ring = ringRef.current
    setTimeout(() => {
      if (ring === null || !ring.isConnected || !front.current || reducedMotion()) return
      void import('@client/review/confetti').then((m) => {
        if (!ring.isConnected || !front.current) return
        stopConfetti.current = m.confettiBurst(ring, { within: ring.closest('.review'), maxDpr: 2, pieces: 80 })
      })
    }, FILL_MS)
  }, [motion, inFront, end.id, end.kind])
  // The tab or the app goes away: the confetti stops (it never shows over another tab).
  useEffect(() => {
    if (inFront) return
    stopConfetti.current?.()
    stopConfetti.current = null
  }, [inFront])
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
      <div ref={ringRef} className="due-end__ring" aria-hidden="true" style={ringTurns(green)}>
        <span className="due-end__track" />
        {!done && green < 100 && <span className="due-end__missed" />}
        <span className="due-end__half" data-half="r">
          <span className="due-end__fill" />
        </span>
        <span className="due-end__half" data-half="l">
          <span className="due-end__fill" />
        </span>
        {done && (
          <svg className="due-end__check" viewBox="0 0 72 72" width={72} height={72}>
            <path d="M25 37l7.5 7.5L48 29" />
          </svg>
        )}
        {!done && <span className="due-end__pct">{end.percent}%</span>}
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="due-end__dot" data-dot={i} />
        ))}
      </div>
      {done ? (
        <>
          <p className="review__done-title">Due today is done.</p>
          {end.count > 0 && <p className="muted due-end__line">You remembered {end.percent}% of {cards(end.count)}.</p>}
          {end.fresh > 0 ? (
            <>
              <p className="muted due-end__line">Do you want to learn some new cards?</p>
              <div className="due-end__actions">
                <button type="button" className="btn due-end__go" onClick={onGoOn}>
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
          <p className="review__done-title">
            You remembered {end.percent}% of {cards(end.count)}.
          </p>
          <p className="muted due-end__line">{cards(end.missed)} to look at again while they are fresh.</p>
          <div className="due-end__actions">
            <button type="button" className="btn due-end__go" onClick={onGoOn}>
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
