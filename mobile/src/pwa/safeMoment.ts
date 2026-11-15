/**
 * THE UPDATE RULE (YAZ-5087; YAZ-5555): when a new version may take over (the page loads it).
 *
 * ONLY WHEN THE PERSON TAPS RESTART (YAZ-5555, Yaseen's decision: "I'll always know when to restart and I'll be able to
 * manually select it"). Keep this, and keep the README's "Updates" note in step with it:
 * - NEVER by itself: not at a cold start (the worker keeps serving the version the person runs, even after the browser
 *   activated a newer one: `swCore.ts`, `CHOSEN_KEY`), not when the app comes back from the background, not after a
 *   while. There is no automatic restart, so nothing the person is doing can be lost to one.
 * - Whenever a new version is there, "A new version is ready." shows over the tabs with Restart (`UpdateLine.tsx`). The
 *   state is read at the start and at each return to the foreground, so the line shows on a cold start and on return.
 * - Restart works on any tab (the Review tab too, and over a review in progress: the person chose it), and over
 *   comments that wait (each is stored with its id, so a retry never posts one twice).
 * - Restart is held, and the line says why instead of showing the button: answers that wait to be sent (a reload in
 *   the middle of a send is never done); words in a comment box not sent (`page/comments/unsentDrafts.ts`); the first
 *   download. A screen or form over the tabs hides the line (typed text would be lost); it shows again on the tabs.
 */

export type Hold = 'answers' | 'typing' | 'review' | 'screen' | 'download'
export type Holds = readonly Hold[]

export interface AppMoment {
  phase: 'loading' | 'sign-in' | 'sign-in-again' | 'ready'
  /** A screen over the tabs is open (Settings, a form, Scan a code, the guide). */
  routeOpen: boolean
  tab: 'friends' | 'review' | 'search'
  downloading: boolean
  /** The open vault's answers that wait to be sent (the stored answer list). */
  answersWaiting: number
  /** A Review session is in its middle, on any tab (YAZ-5269, `reviewInProgress()`). Absent: none. */
  reviewInProgress?: boolean
  /** YAZ-5555: a comment box holds words that are not sent (`hasAnyUnsentDraft`). Absent: none. */
  unsentText?: boolean
}

export function holdsOf(m: AppMoment): Hold[] {
  const holds: Hold[] = []
  if (m.answersWaiting > 0) holds.push('answers')
  if (m.unsentText === true) holds.push('typing')
  if (m.phase !== 'ready' || m.routeOpen) holds.push('screen')
  else if (m.downloading) holds.push('download')
  else if (m.tab === 'review' || m.reviewInProgress === true) holds.push('review')
  return holds
}

/** What a tap on Restart does not wait for: the person chose it. */
const TAP_IGNORES: readonly Hold[] = ['review', 'screen']

/** The tap on Restart (the ONLY way a new version takes over): yes, unless something would be lost. */
export function swapNow(m: { ready: boolean; holds: Holds }): boolean {
  return m.ready && m.holds.every((h) => TAP_IGNORES.includes(h))
}

/** The line on the tabs (plain words; no version number). Held: it says why, with no button. */
export function lineFor(holds: Holds): { text: string; restart: boolean } {
  if (holds.includes('answers')) return { text: 'A new version is ready. Restart after your answers are sent.', restart: false }
  if (holds.includes('typing')) return { text: 'A new version is ready. Restart after you send or clear your comment.', restart: false }
  if (holds.includes('download')) return { text: 'A new version is ready. Restart after the first download.', restart: false }
  return { text: 'A new version is ready.', restart: true }
}
