/**
 * THE END OF DUE TODAY (YAZ-5043, Option A, Yaseen's picks): the screen in place of the card when Due today stops
 * (`useCardReview`'s `end`). ONE screen for the Mac's Inbox, a page's or a folder's review (item 8), and the phone's
 * Review tab (YAZ-5665: the phone's own copy, `DueEnd.tsx`, is gone). Each app gives its look (`DoneLook`).
 *
 *  - After the first pass: the top bar's grey and red slide down into a small ring, which fills to the % (600 ms), and
 *    four small dots float out once. Mochi's words (YAZ-5677): "You remembered 93% of cards." / "Now let's review the
 *    cards you missed again." and ONE button, "Review missed cards 5" (item 7, and Yaseen on YAZ-5672: no Skip and finish).
 *  - Due today done: the ring closes in green and a ✓ pops in, with one burst of confetti (item 13, lazy:
 *    `confetti.ts` loads only here). "Due today is done." then "Learn new cards 11" with its "from Spanish ▾".
 *  - Smooth on a phone (the phone's ring, YAZ-5665): the ring fills by turning two half rings (`transform`), every
 *    animation is `transform` or `opacity`.
 *  - Reduce motion (item 5): the ring full at once, no dots, no confetti.
 *  - It plays ONCE per stop, and only while it shows (item 16): behind a page tab, in a hidden window or app, it waits
 *    and plays when it shows. A stop seen already (focus mode, a tab back) shows still. The confetti stops if the tab or
 *    the app goes away.
 *  - Enter and Space do nothing new here (item 4).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { DueTodayEnd as End } from './useCardReview'
import type { ConfettiOptions } from './confetti'
import { reducedMotion, useInFront } from './DoneCheer'
import './dueTodayEnd.css'

/** How each app draws the finish screens' words and buttons (`DoneScreen`, `DueTodayEnd`); the rules and words are one. */
export interface DoneLook {
  /** The title's class: `card-inbox__done-title`, `review__done-title`. */
  title: string
  /** A quiet line under it. */
  line: string
  /** A way on: "3 more in All cards", "Review 12 more", "21 more in the Inbox". */
  more: string
  /** "Today: 25 cards · 12 min". */
  today: string
  /** "Review missed cards" / "Learn new cards". */
  go: string
  /** Where the confetti plays (a selector the screen is inside; default the window) and how (the phone's lighter burst). */
  area?: string
  burst?: Omit<ConfettiOptions, 'within'>
}

/** The stops whose animation played (by `End.id`): each plays once, also when the screen draws again. */
const played = new Set<string>()

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

// The icons size with the button's words (14 px on the Mac, 16 px on the phone).
const RefreshIcon = () => (
  <svg width="1em" height="1em" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" />
  </svg>
)
const NewIcon = () => (
  <svg width="1em" height="1em" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden="true">
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
)

interface Props {
  end: End
  /** The screen's tab is the one on show. */
  shown: boolean
  look: DoneLook
  /** "Review missed cards" / "Learn new cards". */
  onGoOn: () => void
  /** The new cards' "from Spanish ▾" (YAZ-5322), after "Learn new cards". */
  from?: ReactNode
  /** The done screen with no new card left: what the screen says after (what waits, Add, the way on). */
  children?: ReactNode
}

export function DueTodayEnd({ end, shown, look, onGoOn, from, children }: Props) {
  const inFront = useInFront(shown)
  const front = useRef(inFront)
  front.current = inFront
  const ringRef = useRef<HTMLDivElement>(null)
  const stopConfetti = useRef<(() => void) | null>(null)
  // 'wait' until in front; then 'play' once; 'still' when seen already or with Reduce motion.
  const still = () => played.has(end.id) || reducedMotion()
  const [motion, setMotion] = useState<'wait' | 'play' | 'still'>(() => (still() ? 'still' : 'wait'))
  useEffect(() => setMotion(still() ? 'still' : 'wait'), [end.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (motion !== 'wait' || !inFront) return
    played.add(end.id)
    setMotion('play')
    if (end.kind !== 'done') return
    // Due today done: the confetti as the ring closes, its code loaded only now (no eager weight). It ends by itself in 2 s.
    const ring = ringRef.current
    setTimeout(() => {
      if (ring === null || !ring.isConnected || !front.current || reducedMotion()) return
      void import('./confetti').then((m) => {
        if (!ring.isConnected || !front.current) return
        stopConfetti.current = m.confettiBurst(ring, { ...look.burst, within: look.area === undefined ? undefined : ring.closest(look.area) })
      })
    }, FILL_MS)
  }, [motion, inFront, end.id, end.kind]) // eslint-disable-line react-hooks/exhaustive-deps
  // The tab or the app goes away: the confetti stops (it never shows over another tab).
  useEffect(() => {
    if (inFront) return
    stopConfetti.current?.()
    stopConfetti.current = null
  }, [inFront])
  useEffect(() => () => stopConfetti.current?.(), [])
  // Played: still from now on, so a tab hidden and shown again (its CSS animations would start over) shows the end.
  useEffect(() => {
    if (motion !== 'play') return
    const timer = setTimeout(() => setMotion('still'), 1400)
    return () => clearTimeout(timer)
  }, [motion])

  const done = end.kind === 'done'
  const green = done ? 100 : end.percent
  const go = (icon: ReactNode, words: string, count: number) => (
    <button type="button" className={look.go} onMouseDown={(e) => e.preventDefault()} onClick={onGoOn}>
      {icon}
      {words}{' '}
      <span className="due-end__count">{count}</span>
    </button>
  )
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
          <p className={look.title}>Due today is done.</p>
          {end.count > 0 && <p className={look.line}>You remembered {end.percent}% of {cards(end.count)}.</p>}
          {end.fresh > 0 ? (
            <>
              <p className={look.line}>Do you want to learn some new cards?</p>
              <div className="due-end__actions">
                {go(<NewIcon />, 'Learn new cards', end.fresh)}
                {from}
              </div>
            </>
          ) : (
            children
          )}
        </>
      ) : (
        <>
          {/* YAZ-5677: Mochi's words (YAZ-5671 findings 8, 15, 16); no Skip and finish (Yaseen, YAZ-5672). */}
          <p className={look.title}>You remembered {end.percent}% of cards.</p>
          <p className={look.line}>Now let&apos;s review the cards you missed again.</p>
          <div className="due-end__actions">{go(<RefreshIcon />, 'Review missed cards', end.missed)}</div>
        </>
      )}
    </div>
  )
}
