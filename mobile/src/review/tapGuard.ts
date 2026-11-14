import { useCallback, useEffect, useReducer } from 'react'

/** YAZ-5226: how long a NEW card is on the screen before a tap acts on it (a double tap is about 150 ms apart). */
export const SEEN_MS = 400

/**
 * THE TAP GUARD (YAZ-5226, fixed in YAZ-5266): one small state machine with ONE owner (the Review screen), so the
 * second tap of a double tap never answers a card the person has not seen, and no path can leave the card stuck.
 *
 *  - `ready`: taps act (a tap on the card shows the next part; the answer buttons answer).
 *  - `answering`: an answer is being saved. Taps are dropped (never queued).
 *  - `settling`: the answer is saved and ANOTHER card is on the screen; taps are dropped for `SEEN_MS`.
 *
 * Every way out goes back to `ready`:
 *  - `answered` with the same card still on the screen (the save failed; the screen says so): `ready` at once.
 *  - `answered` with another card, or no card (the session ended): `settling`, then `ready` after `SEEN_MS`; no card:
 *    `ready` at once.
 *  - `undo` (any time, also at 0 ms): `ready` (the card that comes back is one the person saw).
 *  - `reset` (the tab is hidden or shown again, the session starts again): `ready`.
 *  - `seen`: the `SEEN_MS` timer of `settling` ran out.
 */
export type GuardState = { kind: 'ready' } | { kind: 'answering' } | { kind: 'settling'; turn: number }

export type GuardEvent =
  | { type: 'answer' }
  | { type: 'answered'; sameCard: boolean; cardOnScreen: boolean }
  | { type: 'undo' }
  | { type: 'reset' }
  | { type: 'seen'; turn: number }

const READY: GuardState = { kind: 'ready' }
let turns = 0

export function guardStep(state: GuardState, event: GuardEvent): GuardState {
  switch (event.type) {
    case 'answer':
      return state.kind === 'ready' ? { kind: 'answering' } : state
    case 'answered':
      if (state.kind !== 'answering') return state
      return event.sameCard || !event.cardOnScreen ? READY : { kind: 'settling', turn: ++turns }
    case 'undo':
    case 'reset':
      return state.kind === 'ready' ? state : READY
    case 'seen':
      return state.kind === 'settling' && state.turn === event.turn ? READY : state
  }
}

/** The guard of the Review screen: `taps` is true in `ready`; `answer(run)` wraps one answer; `undo` and `reset`. */
export function useTapGuard() {
  const [state, dispatch] = useReducer(guardStep, READY)
  // One timer, owned here: `settling` always ends.
  useEffect(() => {
    if (state.kind !== 'settling') return
    const timer = setTimeout(() => dispatch({ type: 'seen', turn: state.turn }), SEEN_MS)
    return () => clearTimeout(timer)
  }, [state])
  /** Runs one answer; `after()` says what is on the screen when the save ended (a failed save keeps the card). */
  const answer = useCallback(async (run: () => Promise<unknown>, after: () => { sameCard: boolean; cardOnScreen: boolean }) => {
    dispatch({ type: 'answer' })
    try {
      await run()
    } finally {
      dispatch({ type: 'answered', ...after() })
    }
  }, [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const reset = useCallback(() => dispatch({ type: 'reset' }), [])
  return { taps: state.kind === 'ready', state, answer, undo, reset }
}
