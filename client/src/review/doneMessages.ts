/**
 * Rotating completion messages and 2-step "Add more" questions for the Inbox / Review finish screen (YAZ-6041).
 * Shared by Mac (`CardInbox`) and mobile (`ReviewView`) via `DoneScreen`. Every completion message is a 2-phrase tuple
 * so narrow mobile screens break cleanly onto line 2 while wider screens read as one line.
 */
import type { CardRating } from '@shared/cardLine'

export type DonePhrase = readonly [string, string]

export const DONE_MESSAGES: readonly DonePhrase[] = [
  ["You're all caught up for today.", 'Enjoy your day!'],
  ['Daily goal hit.', 'Go live your life!'],
  ['Inbox zero.', 'Your future self thanks you.'],
  ['All done for today.', 'Let it sink in!'],
  ['Reps are in.', 'Memory does the rest.'],
  ['Clean sweep today.', 'See you tomorrow!'],
  ['You showed up today.', "That's the whole game."],
  ['Brain fed.', 'Enjoy the rest of your day!'],
  ['Another brick laid.', "That's how mastery builds."],
  ['Quiet work, loud results.', 'Enjoy your day!'],
  ['All clear for today.', 'Go build something cool.'],
  ['Done and dusted.', 'See you tomorrow!'],
  ["That's a wrap for today.", 'Rest up!'],
  ['Small reps, big compounding.', 'Nice work today.'],
  ['Nothing left in the queue.', 'Go enjoy your day!'],
  ['Memory updated.', 'Back to the real world!'],
  ['Consistency beats intensity.', 'Great session today.'],
  ['Queue cleared.', 'Take a breather!'],
  ['One more day in the streak.', 'Keep it rolling!'],
  ['Sharp today.', 'Enjoy the rest of your day!'],
  ['Every card accounted for.', "You're free!"],
  ['You put in the work.', 'Let your brain do the rest.'],
  ["Today's deck is done.", 'Go crush the rest of your day!'],
  ['Locked in for today.', 'See you next round!'],
  ['Nothing waiting on you.', 'Enjoy the quiet.'],
  ['Solid session.', 'Come back fresh tomorrow!'],
  ['All caught up.', 'Go do something fun!'],
  ['Knowledge compounded.', 'Enjoy your day!'],
  ['Zero cards left.', 'Smooth sailing from here.'],
  ['Session complete.', "Your brain's already wiring it in."],
]

export const ADD_MORE_QUESTIONS: readonly string[] = [
  'Up for more?',
  'Want to go for extra credit?',
  'Keep going?',
  'Hungry for more?',
  'Want a few more?',
  'Want a bonus round?',
  'Still in the zone?',
  'Care for another set?',
  'Got room for a few more?',
  'Want to go for round two?',
]

/** Local calendar day index (deterministic, timezone-aware via local year/month/day). */
function localDayIndex(now: Date): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000)
}

/** Deterministic non-negative offset from a landing token (`string`, `number`, or `null`). */
function landingOffset(landing: string | number | null | undefined): number {
  if (typeof landing === 'number') return Number.isFinite(landing) ? Math.abs(Math.trunc(landing)) : 0
  if (typeof landing === 'string' && landing.length > 0) {
    let hash = 0
    for (let i = 0; i < landing.length; i++) hash = (hash * 31 + landing.charCodeAt(i)) | 0
    return Math.abs(hash)
  }
  return 0
}

export interface DoneMessageContext {
  landing: string | number | null | undefined
  todayCards: number
  answered: readonly CardRating[]
}

/**
 * Picks a deterministic completion message for today + landing.
 * On ~1 in 3 completions when earned (`todayCards > 0`), surfaces a session-aware line (flawless run, big volume,
 * early bird, or late night) before falling back to the 30-message rotation.
 */
export function pickDoneMessage(ctx: DoneMessageContext, now: Date = new Date()): DonePhrase {
  const day = Number.isFinite(now.getTime()) ? localDayIndex(now) : 0
  const seed = Math.abs(day + landingOffset(ctx.landing))
  if (ctx.todayCards > 0 && seed % 3 === 0) {
    if (ctx.answered.length >= 5 && ctx.answered.every((r) => r !== 'again')) {
      return ['Flawless run today.', 'Not a single miss!']
    }
    if (ctx.todayCards >= 30) {
      return [`${ctx.todayCards} cards in the bank today.`, 'That compounds!']
    }
    const hour = now.getHours()
    if (hour < 10) return ['Done before 10 AM.', 'The whole day is yours!']
    if (hour >= 21) return ['Late-night reps locked in.', 'Sleep does the rest!']
  }
  return DONE_MESSAGES[seed % DONE_MESSAGES.length]!
}

/** Picks a deterministic playful question for the 2-step "Add more" expand button. */
export function pickAddMoreQuestion(landing: string | number | null | undefined, now: Date = new Date()): string {
  const day = Number.isFinite(now.getTime()) ? localDayIndex(now) : 0
  const seed = Math.abs(day + landingOffset(landing))
  return ADD_MORE_QUESTIONS[seed % ADD_MORE_QUESTIONS.length]!
}
