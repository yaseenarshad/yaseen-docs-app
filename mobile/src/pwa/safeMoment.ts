/**
 * THE SAFE MOMENT (YAZ-5087; YAZ-5555): when a new version may take over (the page loads again).
 *
 * THE RULE (YAZ-5555; keep it, and keep the README's "Updates" paragraph in step with it):
 * - A cold start, before the app runs: always (`swapAtStart` in `main.tsx`). Nothing is open yet, and the answer list
 *   and the comment list are in IndexedDB, so they survive the reload (3C: "answers made with no signal, the app
 *   closed: at the next start they are still there").
 * - BY ITSELF when the app is idle: the first time it comes back to the foreground after `RESUME_AFTER_MS` (30 s) or
 *   more hidden, once the new version took over, and only with NOTHING held (below). Nothing unsaved is ever lost: the
 *   reload waits for the next return instead.
 * - A tap on "Restart" (the line stays for the active case): the person chose it, so the Review tab, a screen and the
 *   comments that wait (stored, each with its id, so a retry never posts one twice) do not hold it; waiting answers,
 *   the first download and a comment box with words in it still do.
 *
 * Held: answers that wait to be sent (a reload in the middle of a send is never done); comments, ticks and friends
 * removes that wait (`writes`: writes in flight or queued); words typed in a comment box and not sent (`typing`,
 * `page/comments/unsentDrafts.ts`); the Review tab, and a review in progress on ANY tab (YAZ-5269: the session lives on
 * behind Friends and Search; `review/inProgress.ts`); a screen over the tabs or the sign-in form (typed text would be
 * lost); the first download.
 */

/** YAZ-5555: hidden at least this long, a return to the foreground counts as idle (was 5 minutes in YAZ-5087). */
export const RESUME_AFTER_MS = 30_000

export type Hold = 'answers' | 'writes' | 'typing' | 'review' | 'screen' | 'download'
export type Holds = readonly Hold[]
export type Trigger = 'start' | 'resume' | 'tap'

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
  /** YAZ-5555: the open vault's comments and ticks, and the friends removes, that wait to be written. Absent: none. */
  writesWaiting?: number
  /** YAZ-5555: a comment box holds words that are not sent (`hasAnyUnsentDraft`). Absent: none. */
  unsentText?: boolean
}

export function holdsOf(m: AppMoment): Hold[] {
  const holds: Hold[] = []
  if (m.answersWaiting > 0) holds.push('answers')
  if ((m.writesWaiting ?? 0) > 0) holds.push('writes')
  if (m.unsentText === true) holds.push('typing')
  if (m.phase !== 'ready' || m.routeOpen) holds.push('screen')
  else if (m.downloading) holds.push('download')
  else if (m.tab === 'review' || m.reviewInProgress === true) holds.push('review')
  return holds
}

const TAP_IGNORES: readonly Hold[] = ['review', 'screen', 'writes']

export function swapNow(m: { ready: boolean; trigger: Trigger; holds: Holds; hiddenMs: number }): boolean {
  if (!m.ready) return false
  if (m.trigger === 'start') return true
  if (m.trigger === 'tap') return m.holds.every((h) => TAP_IGNORES.includes(h))
  return m.holds.length === 0 && m.hiddenMs >= RESUME_AFTER_MS
}

/** The line on the tabs (plain words; no version number). */
export function lineFor(holds: Holds): { text: string; restart: boolean } {
  if (holds.includes('answers')) return { text: 'A new version is ready. It starts after your answers are sent.', restart: false }
  if (holds.includes('typing')) return { text: 'A new version is ready. It starts after you send or clear your comment.', restart: false }
  return { text: 'A new version is ready.', restart: true }
}
