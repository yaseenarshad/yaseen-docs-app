import { useCallback, useEffect, useReducer } from 'react'

/** How long a NEW card is on the screen before a tap acts on it (a double tap is about 150 ms apart). */
export const SEEN_MS = 400
/**
 * YAZ-5596 (2): the longest an answer's save holds the taps. A save with no answer by then (iOS storage that hangs
 * after a wake) counts as failed for the screen: the card stays and taps act again. The save itself goes on, and an
 * answer that lands later still counts.
 */
export const SAVE_LIMIT_MS = 10_000

/**
 * THE TAP GUARD (YAZ-5266): one small state machine with ONE owner (the Review screen), so the
 * second tap of a double tap never answers a card the person has not seen, and no path can leave the card stuck.
 *
 *  - `ready`: taps act (a tap on the card shows the next part; the answer buttons answer).
 *  - `answering`: an answer is being saved (`from`: the card it answers). Taps are dropped (never queued).
 *  - `awaiting`: the save is done; the next card is not drawn yet (its text reads). Taps are dropped.
 *  - `settling`: ANOTHER card is drawn on the screen; taps are dropped for `SEEN_MS` from that moment.
 *
 * Every way out goes back to `ready`:
 *  - `shown`: a card drawn in `awaiting`, or another card than `from` drawn in `answering`: `settling`, timed from the
 *    drawing. (A caller that sends no `shown` gets `settling` at `answered`, timed from the end of the save.)
 *  - `answered` with the same card still on the screen (the save failed; the screen says so), or no card (the session
 *    ended): `ready` at once. With another card: `awaiting` (or nothing, when `shown` came first).
 *  - `undo` (any time, also at 0 ms): `ready` (the card that comes back is one the person saw). But from the screen
 *    after the last card (`fromDone`, sweep2 M-A): `settling`. The card that comes back is drawn where the
 *    finger is (its ✓ sits under "Undo"), so the second tap of a double tap on Undo answered it. Its key is `UNDONE`:
 *    the drawing of the card that comes back starts the 400 ms again; the timer still ends it.
 *  - `arrive`: a card is drawn where the screen after the last card was ("Review missed cards", "Learn new cards", an
 *    Undo): `settling`, as `undo` with `fromDone` (sweep2 nit 3: the second tap of a double tap showed side 2).
 *  - `reset` (the tab hidden or shown again, the session starts again): `ready`, but a save that runs keeps
 *    `answering` (its next card still gets its 400 ms).
 *  - `shown` of another drawing in `settling` starts its 400 ms again.
 *  - `seen`: the `SEEN_MS` timer of `settling` ran out.
 *  - a save with no answer in `SAVE_LIMIT_MS` (YAZ-5596): `answered` with the same card, so `ready`; the late end of
 *    that save sends nothing.
 */
export type GuardState = { kind: 'ready' } | { kind: 'answering'; from: string | null; follows: boolean } | { kind: 'awaiting'; from: string | null } | { kind: 'settling'; turn: number; key?: string }

export type GuardEvent =
  | { type: 'answer'; from?: string | null }
  | { type: 'shown'; key: string }
  | { type: 'answered'; sameCard: boolean; cardOnScreen: boolean }
  | { type: 'undo'; fromDone?: boolean }
  | { type: 'arrive' }
  | { type: 'reset' }
  | { type: 'seen'; turn: number }

const READY: GuardState = { kind: 'ready' }
/** The key of the `settling` an Undo starts: no drawing has it, so the card that comes back starts its own 400 ms. */
const UNDONE = ''
let turns = 0

export function guardStep(state: GuardState, event: GuardEvent): GuardState {
  switch (event.type) {
    case 'answer':
      return state.kind === 'ready' ? { kind: 'answering', from: event.from ?? null, follows: event.from !== undefined } : state
    case 'shown':
      // ANOTHER card drawn, during the save or after it. (A card that comes back has a new key: its place moved. The old
      // card drawn again while the next one reads is not "another".)
      if ((state.kind === 'awaiting' || (state.kind === 'answering' && state.follows)) && event.key !== state.from) return { kind: 'settling', turn: ++turns, key: event.key }
      // Another drawing while settling (the next card drawn after a redraw of the answered one): the 400 ms
      // start again from it. It can only make the wait longer, never shorter.
      if (state.kind === 'settling' && state.key !== undefined && event.key !== state.key) return { kind: 'settling', turn: ++turns, key: event.key }
      return state
    case 'answered':
      if (state.kind !== 'answering') return state
      if (event.sameCard || !event.cardOnScreen) return READY
      // The screen tells when the next card is drawn (`shown`): the 400 ms count from there. Without it: from now.
      return state.follows ? { kind: 'awaiting', from: state.from } : { kind: 'settling', turn: ++turns }
    case 'arrive':
      return { kind: 'settling', turn: ++turns, key: UNDONE }
    case 'undo':
      if (event.fromDone === true) return { kind: 'settling', turn: ++turns, key: UNDONE }
      return state.kind === 'ready' ? state : READY
    case 'reset':
      return state.kind === 'ready' || state.kind === 'answering' ? state : READY
    case 'seen':
      return state.kind === 'settling' && state.turn === event.turn ? READY : state
  }
}

/** The guard of the Review screen: `taps` is true in `ready`; `answer(from, run)` wraps one answer; `shown`, `undo`, `reset`. */
export function useTapGuard() {
  const [state, dispatch] = useReducer(guardStep, READY)
  // One timer, owned here: `settling` always ends.
  useEffect(() => {
    if (state.kind !== 'settling') return
    const timer = setTimeout(() => dispatch({ type: 'seen', turn: state.turn }), SEEN_MS)
    return () => clearTimeout(timer)
  }, [state])
  /**
   * Runs one answer; `after()` says what is on the screen when the save ended (`sameCard`: the save failed, the card
   * stays). `from`: the card answered, when the caller also sends `shown` for each card drawn (the Review screen).
   * `onLate`: the save had no answer in `SAVE_LIMIT_MS`; the taps act again from then (YAZ-5596).
   */
  const answer = useCallback(async (run: () => Promise<unknown>, after: () => { sameCard: boolean; cardOnScreen: boolean }, from?: string | null, onLate?: () => void) => {
    dispatch(from === undefined ? { type: 'answer' } : { type: 'answer', from })
    let late = false
    const limit = setTimeout(() => {
      late = true
      onLate?.()
      dispatch({ type: 'answered', sameCard: true, cardOnScreen: true })
    }, SAVE_LIMIT_MS)
    try {
      await run()
    } finally {
      clearTimeout(limit)
      if (!late) dispatch({ type: 'answered', ...after() })
    }
  }, [])
  const shown = useCallback((key: string) => dispatch({ type: 'shown', key }), [])
  const undo = useCallback((fromDone = false) => dispatch({ type: 'undo', fromDone }), [])
  const reset = useCallback(() => dispatch({ type: 'reset' }), [])
  const arrive = useCallback(() => dispatch({ type: 'arrive' }), [])
  return { taps: state.kind === 'ready', state, answer, shown, undo, reset, arrive }
}
