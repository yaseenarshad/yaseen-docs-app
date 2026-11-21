/**
 * THE ANSWER TIMER (YAZ-5033, Yaseen's decision: "the time pauses when you are idle; no cap"): how long the card
 * showing in the Inbox has been worked on, in seconds of ACTIVITY, for the answer's review part (`… good 13s`).
 *
 *  - It starts when a card shows (`restart`), and again when ⌘Z shows a card again (a new card key).
 *  - It pauses while the Inbox is not in front: the Inbox tab behind a page tab, the window hidden or blurred.
 *  - Each key, click, scroll or mouse move is a touch. The time from one touch to the next counts only when it is no
 *    longer than the setting (`pauseAfter`, 60 s by default): a longer stretch with no touch counts NOTHING, and the
 *    time goes on from the next touch. So 10 s of work, 90 s away and 5 s of work is 15 s. No cap: a long card that is
 *    worked on counts in full.
 *
 * Cheap: no interval and no per-frame work. A touch is one subtraction and one compare (`AnswerClock.touch`), the
 * listeners are on `window` and `document` (passive, capture: they see a key before the Inbox's own handler answers),
 * and the seconds are read once, at the answer.
 */
import { useCallback, useEffect, useRef } from 'react'
import { CARD_SECONDS_MAX } from '@shared/cardLine'

/** What counts as a touch (YAZ-5033): a key, a click (pointerdown), a scroll, a mouse move. */
export const ANSWER_TIMER_TOUCHES = ['keydown', 'pointerdown', 'wheel', 'mousemove'] as const

/** The timer itself, with no DOM: `now` is the clock (ms), the tests' fake one or `Date.now`. */
export class AnswerClock {
  /** Active ms counted so far. */
  private total = 0
  /** The last touch (or the start, or the resume), in ms; null while paused. */
  private last: number | null = null

  constructor(
    private idleMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** A new idle setting, from the next stretch on. */
  setIdle(ms: number): void {
    this.idleMs = ms
  }

  /** The time from the last touch to now, counted when it is no stretch of idle. */
  private settle(t: number): void {
    if (this.last === null) return
    const gap = t - this.last
    if (gap > 0 && gap <= this.idleMs) this.total += gap
    this.last = t
  }

  /** A card shows: from zero, running unless the Inbox is not in front. */
  restart(running: boolean): void {
    this.total = 0
    this.last = running ? this.now() : null
  }

  /** A key, a click, a scroll, a mouse move. Paused (the Inbox not in front), it does nothing. */
  touch(): void {
    this.settle(this.now())
  }

  /** The Inbox leaves the front: the time up to now counts (if no idle stretch), then nothing until `resume`. */
  pause(): void {
    this.settle(this.now())
    this.last = null
  }

  /** The Inbox is in front again: the time goes on from now. */
  resume(): void {
    if (this.last === null) this.last = this.now()
  }

  get running(): boolean {
    return this.last !== null
  }

  /** The whole seconds of activity so far (the time up to now counts if no idle stretch), at most `CARD_SECONDS_MAX`. */
  seconds(): number {
    this.settle(this.now())
    return Math.min(CARD_SECONDS_MAX, Math.round(this.total / 1000))
  }
}

/**
 * Is the window shown? Its focus is read from its `blur` and `focus` events only: a card shows after a key or a click
 * in this window (an answer, ⌘Z, ← →, the Inbox opened), so the window is focused then.
 */
const windowShown = (): boolean => document.visibilityState !== 'hidden'

/**
 * The Inbox's timer for the card showing: `cardKey` is the card on show (a new key restarts it; null: no card),
 * `shown` whether the Inbox tab is in front, `pauseAfter` the setting in seconds. Returns the seconds so far, read at
 * the answer; undefined with no card.
 */
export function useAnswerTimer(cardKey: string | null, shown: boolean, pauseAfter: number): () => number | undefined {
  const clock = useRef<AnswerClock | null>(null)
  clock.current ??= new AnswerClock(pauseAfter * 1000)
  const live = useRef({ cardKey, shown })
  live.current = { cardKey, shown }

  useEffect(() => clock.current!.setIdle(pauseAfter * 1000), [pauseAfter])

  // A card shows: from zero. The Inbox in front or not: running or paused.
  useEffect(() => {
    if (cardKey !== null) clock.current!.restart(shown && windowShown())
  }, [cardKey]) // eslint-disable-line react-hooks/exhaustive-deps -- `shown` is the next effect's
  useEffect(() => {
    if (shown && windowShown()) clock.current!.resume()
    else clock.current!.pause()
  }, [shown])

  const hasCard = cardKey !== null
  useEffect(() => {
    if (!hasCard) return
    const c = clock.current!
    const touch = () => c.touch()
    const away = () => c.pause()
    const back = () => {
      if (live.current.shown && windowShown()) c.resume()
    }
    const seen = () => (document.visibilityState === 'hidden' ? away() : back())
    const opts = { capture: true, passive: true } as const
    for (const type of ANSWER_TIMER_TOUCHES) window.addEventListener(type, touch, opts)
    window.addEventListener('blur', away)
    window.addEventListener('focus', back)
    document.addEventListener('visibilitychange', seen)
    return () => {
      for (const type of ANSWER_TIMER_TOUCHES) window.removeEventListener(type, touch, opts)
      window.removeEventListener('blur', away)
      window.removeEventListener('focus', back)
      document.removeEventListener('visibilitychange', seen)
    }
  }, [hasCard])

  return useCallback(() => (live.current.cardKey === null ? undefined : clock.current!.seconds()), [])
}
