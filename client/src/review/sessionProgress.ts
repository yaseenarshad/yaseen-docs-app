/**
 * The session's numbers, ONE source for the Mac's Inbox and the phone's Review (both run `useCardReview`): the top
 * right's "✕ K · done / total", the progress bar and the end of Due today's ring.
 *
 * MOCHI'S NUMBERS (YAZ-5672, YAZ-5675; Yaseen: "my #1 priority is to replicate mochi 1:1 exactly right now"; measured
 * in Mochi, YAZ-5671 findings 5, 6, 7, 11, 15, 17, 18). Each filter reads its own share of the session's answers, so
 * its numbers survive a filter switch:
 *  - done: a due card's FIRST answer (Forgot or Remembered) is done +1; a later answer of it adds nothing. A new card's
 *    Remembered is done +1 (it leaves New cards); its Forgot moves nothing.
 *  - total = done + the filter's cards still waiting in the session, each once. So a Forgot on a due card adds 1 (the
 *    card comes back), a new card learned under All cards adds 1 (its second ✓ comes today, as a Due today card), and
 *    in the missed pass each Remembered takes 1 off (the card is let go) while a Forgot moves nothing.
 *  - waiting: the filter's due cards back after a Forgot (the bar's red, after the grey), and the top right's ✕ K.
 * YAZ-5681 (Yaseen: "shouldn't the three x only be representative of what's in only in that part?"): the ✕ counts the
 * OPEN filter's misses, so it and the red always agree. Mochi shows the session's ✕ on every filter (finding 2); we
 * differ on purpose. A Forgot on a new card never makes a ✕ (finding 11).
 *
 * The ring's % is each due card's FIRST answer of the session (`dueFirsts`): a card missed then got right counts as
 * missed, a new card never counts.
 */
import type { CardRating } from '@shared/cardLine'
import type { DueCard } from '@shared/cardSchedule'
import type { CardFilter } from './useCardReview'

/**
 * Whether `card` shows under `filter`: next = marked up next (YAZ-5028), due = a card with a ✓, due now, new = no ✓ yet.
 * Each card is in ONE list only (Review rules v1, rule 7, YAZ-5655): an Up next card is under Up next alone, so All
 * cards = Up next + Due today + New cards.
 */
export const matchesFilter = (card: Pick<DueCard, 'isNew' | 'next'>, filter: CardFilter): boolean =>
  filter === 'all' || (filter === 'next' ? card.next : !card.next && (filter === 'new') === card.isNew)

/** One answer of the session: its card (`key`), its rating, what the card was when answered, and whether it was a due card's first answer. */
export interface SessionAnswer {
  key: string
  rating: CardRating
  isNew: boolean
  next: boolean
  first: boolean
}

/** A card still waiting in the session's queue: its kind, and `forgot` when a Forgot put it back. */
export interface SessionCard {
  path: string
  id: string
  isNew: boolean
  next: boolean
  forgot?: boolean
}

/** One filter's numbers: "done / total", and its due cards waiting after a Forgot (the bar's red). */
export interface FilterCount {
  done: number
  total: number
  waiting: number
}

const missed = (c: SessionCard): boolean => c.forgot === true && !c.isNew

/** The filter's numbers (YAZ-5675): `queue` is the cards still waiting in the session. */
export function filterCount(answers: readonly SessionAnswer[], queue: readonly SessionCard[], filter: CardFilter): FilterCount {
  const seen = new Set<string>()
  let done = 0
  for (const a of answers) {
    if (!matchesFilter(a, filter)) continue
    if (a.isNew) {
      if (a.rating !== 'again') done++
    } else if (!seen.has(a.key)) {
      seen.add(a.key)
      done++
    }
  }
  const left = queue.filter((c) => matchesFilter(c, filter))
  return { done, total: done + left.length, waiting: left.filter(missed).length }
}

/** The ring's numbers (YAZ-5043): the due cards' first answers, how many were Remembered, the whole % (never 100 while one was missed). */
export function dueFirsts(answers: readonly SessionAnswer[]): { count: number; remembered: number; percent: number } {
  const firsts = answers.filter((a) => a.first)
  const count = firsts.length
  const remembered = firsts.filter((a) => a.rating !== 'again').length
  return { count, remembered, percent: count === 0 ? 100 : Math.floor((100 * remembered) / count) }
}
