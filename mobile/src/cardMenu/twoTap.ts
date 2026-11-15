import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * THE TWO-TAP RULE (Yaseen: "any change that we make through the mobile device on a card needs a two-click").
 * The first tap on a row ARMS it: the row says "Tap again to …" in place (no pop-up). A second tap on the SAME row
 * within `TWO_TAP_MS` does it. Anything else cancels: a tap on another row (which arms that one instead), a tap
 * outside, closing the menu (the rows unmount), or the time passing.
 *
 * VoiceOver: its double tap is ONE click, so a VoiceOver user activates the row two times, as a finger taps it two
 * times. The row stays the same element (its focus stays), and the live line says "Tap again to archive".
 */
export const TWO_TAP_MS = 3000

export interface TwoTapState {
  /** The armed row, or null. */
  armed: string | null
  /** When it was armed (ms). */
  at: number
}

export const UNARMED: TwoTapState = Object.freeze({ armed: null, at: 0 })

/** Pure: a tap on row `id` at `now`. `fire`: this tap does the action (the second one, in time). */
export function twoTap(state: TwoTapState, id: string, now: number, ms = TWO_TAP_MS): { state: TwoTapState; fire: boolean } {
  if (state.armed === id && now - state.at <= ms) return { state: UNARMED, fire: true }
  return { state: { armed: id, at: now }, fire: false }
}

/** The rule as a hook: `tap(id)` gives true when the action should run now; `cancel()` disarms. */
export function useTwoTap(options: { ms?: number; now?: () => number } = {}): { armed: string | null; tap: (id: string) => boolean; cancel: () => void } {
  const ms = options.ms ?? TWO_TAP_MS
  const now = options.now ?? Date.now
  // The state in a ref too: two taps faster than a render still read the first one.
  const state = useRef<TwoTapState>(UNARMED)
  const [armed, setArmed] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stop = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  const cancel = useCallback(() => {
    stop()
    state.current = UNARMED
    setArmed(null)
  }, [])
  useEffect(() => stop, [])
  const tap = (id: string): boolean => {
    const next = twoTap(state.current, id, now(), ms)
    stop()
    state.current = next.state
    setArmed(next.state.armed)
    if (next.state.armed !== null) timer.current = setTimeout(cancel, ms)
    return next.fire
  }
  return { armed, tap, cancel }
}
