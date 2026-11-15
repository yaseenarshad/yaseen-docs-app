/**
 * The session's numbers, ONE source for the Inbox's progress bar (YAZ-5020) and the end of Due today's ring (YAZ-5043,
 * `DueTodayEnd`). Each answer of the session is kept with what its card was when it was answered (new or not, Up next
 * or not), so each filter reads its own share of the same list.
 *
 * The bar counts only the tab on show (YAZ-5432, Yaseen: "Due today's progress bar is specific to due today. New's
 * progress bar is specific to new, and then all's progress bar is specific to all"): its parts are the answers of the
 * cards that filter shows, in order (a Forgot red, a Remembered grey), and its whole is those answers plus the filter's
 * cards still waiting (`left`, missed cards waiting for their pass among them). So Due today done fills it, and a
 * switch of tab shows that tab's own progress. A page's or a folder's review, and the new cards' "from Spanish", are
 * the session's queue already: the bar follows them.
 *
 * The ring's % is each due card's FIRST answer of the session (`dueFirsts`): a card missed then got right counts as
 * missed, a new card never counts. The same answers draw the bar's red and grey in the first pass.
 */
import type { CardRating } from '@shared/cardLine'
import type { DueCard } from '@shared/cardSchedule'
import type { CardFilter } from './useCardReview'

/**
 * Whether `card` shows under `filter`: next = marked up next (YAZ-5028), due = reviewed before (due now), new = never
 * reviewed; To fix (YAZ-5097) is a list of cards to look at, so none of the queue.
 */
export const matchesFilter = (card: Pick<DueCard, 'isNew' | 'next'>, filter: CardFilter): boolean =>
  filter === 'all' || (filter === 'fix' ? false : filter === 'next' ? card.next : (filter === 'new') === card.isNew)

/** One answer of the session: its card (`key`), its rating, what the card was when answered, and whether it was a due card's first answer. */
export interface SessionAnswer {
  key: string
  rating: CardRating
  isNew: boolean
  next: boolean
  first: boolean
}

/** A run of the same answer: one part of the bar (YAZ-5020), so a long session draws a few boxes, not one per card. */
export interface ProgressRun {
  missed: boolean
  count: number
}

/** The bar of one filter: its parts, how many answers they hold, and its whole. */
export interface FilterProgress {
  runs: ProgressRun[]
  done: number
  size: number
}

/** The bar's parts (YAZ-5020): each run of the same answer as one part. */
export function progressRuns(answered: readonly CardRating[]): ProgressRun[] {
  const runs: ProgressRun[] = []
  for (const rating of answered) {
    const missed = rating === 'again'
    const last = runs.at(-1)
    if (last !== undefined && last.missed === missed) last.count++
    else runs.push({ missed, count: 1 })
  }
  return runs
}

/** The bar under `filter` (YAZ-5432): its answers, in order, out of those answers and the `left` cards it still shows. */
export function filterProgress(answers: readonly SessionAnswer[], filter: CardFilter, left: number): FilterProgress {
  const mine = answers.filter((a) => matchesFilter(a, filter)).map((a) => a.rating)
  return { runs: progressRuns(mine), done: mine.length, size: mine.length + left }
}

/** The ring's numbers (YAZ-5043): the due cards' first answers, how many were Remembered, the whole % (never 100 while one was missed). */
export function dueFirsts(answers: readonly SessionAnswer[]): { count: number; remembered: number; percent: number } {
  const firsts = answers.filter((a) => a.first)
  const count = firsts.length
  const remembered = firsts.filter((a) => a.rating !== 'again').length
  return { count, remembered, percent: count === 0 ? 100 : Math.floor((100 * remembered) / count) }
}
