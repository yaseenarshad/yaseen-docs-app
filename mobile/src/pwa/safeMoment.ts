/**
 * THE SAFE MOMENT (YAZ-5087): when a new version may take over (the page loads again).
 *
 * - At the start, before the app runs: always. Nothing is open yet, and the answer list is in IndexedDB, so it survives
 *   the reload (3C: "answers made with no signal, the app closed: at the next start they are still there").
 * - Back from the background after `RESUME_AFTER_MS` (for the person, a new open), with nothing held.
 * - A tap on "Restart": the person chose it, so the Review tab does not hold it; waiting answers and the first
 *   download still do.
 *
 * Held: answers that wait to be sent (a reload in the middle of a send is never done), the Review tab (a review can
 * be in its middle; 4B may narrow this to "a session runs"), a screen over the tabs or the sign-in form (typed text
 * would be lost), the first download.
 */

export const RESUME_AFTER_MS = 5 * 60_000

export type Hold = 'answers' | 'review' | 'screen' | 'download'
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
}

export function holdsOf(m: AppMoment): Hold[] {
  const holds: Hold[] = []
  if (m.answersWaiting > 0) holds.push('answers')
  if (m.phase !== 'ready' || m.routeOpen) holds.push('screen')
  else if (m.downloading) holds.push('download')
  else if (m.tab === 'review') holds.push('review')
  return holds
}

const TAP_IGNORES: readonly Hold[] = ['review', 'screen']

export function swapNow(m: { ready: boolean; trigger: Trigger; holds: Holds; hiddenMs: number }): boolean {
  if (!m.ready) return false
  if (m.trigger === 'start') return true
  if (m.trigger === 'tap') return m.holds.every((h) => TAP_IGNORES.includes(h))
  return m.holds.length === 0 && m.hiddenMs >= RESUME_AFTER_MS
}

/** The line on the tabs (plain words; no version number). */
export function lineFor(holds: Holds): { text: string; restart: boolean } {
  if (holds.includes('answers')) return { text: 'A new version is ready. It starts after your answers are sent.', restart: false }
  return { text: 'A new version is ready.', restart: true }
}
