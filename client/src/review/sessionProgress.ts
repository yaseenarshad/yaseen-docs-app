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
 * ALL CARDS (YAZ-5707, Mochi's finding E5 on YAZ-5703): ONE run with no stop, and since YAZ-6018 EVERY filter carries
 * the whole local day's work (`earlierAnswers`, derived live from the vault index for the open scope + `upNextTaken`):
 * closing and reopening the Inbox, restarting the app, or syncing answers from the phone keeps `done / total` for the
 * whole day instead of resetting to 0 (leaving Mochi's per-session reset on purpose). Each card's learning answer (first
 * ✓) and due answer (first review after a ✓) count at most once per filter across `earlier` and this sitting's `answers`.
 * And the exact rule stays:
 *   total = done + every card still waiting in the filter (each once), where the waiting cards are the cards not
 *   answered yet, a new card back after a ✕ (it moved nothing), each learned new card's same-day review (+1 when
 *   learned) and each missed card (+1 when missed, −1 when remembered at the end).
 * So the bar is full exactly when nothing is left: then "Inbox complete.".
 *
 * The ring's % is each due card's FIRST answer of the session (`dueFirsts`): a card missed then got right counts as
 * missed, a new card never counts.
 */
import type { CardRating, CardReview } from '@shared/cardLine'
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

const NO_TAKEN: ReadonlySet<string> = new Set()

/**
 * The filter's numbers (YAZ-5675, YAZ-6018): `queue` is the cards still waiting in the session; `earlier` is today's
 * answers across the open scope (`earlierAnswers`), counted first and deduplicated against `answers` so neither a
 * new card's first ✓ nor a due card's first answer ever counts twice.
 */
export function filterCount(answers: readonly SessionAnswer[], queue: readonly SessionCard[], filter: CardFilter, earlier: readonly SessionAnswer[] = []): FilterCount {
  const seen = new Set<string>()
  const seenNew = new Set<string>()
  let done = 0
  for (const a of [...earlier, ...answers]) {
    if (!matchesFilter(a, filter)) continue
    if (a.isNew) {
      if (a.rating !== 'again' && !seenNew.has(a.key)) {
        seenNew.add(a.key)
        done++
      }
    } else if (!seen.has(a.key)) {
      seen.add(a.key)
      done++
    }
  }
  const left = queue.filter((c) => matchesFilter(c, filter))
  return { done, total: done + left.length, waiting: left.filter(missed).length }
}

/**
 * Today's answers across `cards` (YAZ-5707, extended to the whole local day and every filter in YAZ-6018): each answer
 * in `[from, to)` (local midnight to tomorrow's local midnight), tagged with what the card was when answered by
 * replaying its review timestamps:
 *  - before its first ✓: `isNew: true` (New cards)
 *  - once it has a ✓: `isNew: false` (Due today)
 *  - its first answer today when `card.id` is in `upNextTaken`: `next: true` (Up next, on the same device)
 * Cards with no review in `[from, to)` are skipped without sorting or allocating. Cards archived (`off`) AFTER being
 * reviewed today still keep today's count, matching `reviewedToday` ("Today: N cards").
 */
export function earlierAnswers(
  cards: Iterable<{ key: string; id?: string | null; off?: boolean; reviews: readonly CardReview[] }>,
  from: string,
  to: string,
  upNextTaken: ReadonlySet<string> = NO_TAKEN,
  upNextBegun: ReadonlySet<string> = NO_TAKEN,
): SessionAnswer[] {
  const out: SessionAnswer[] = []
  for (const card of cards) {
    if (card.reviews.length === 0) continue
    // Fast path: skip cards with no review today without copying or sorting.
    let anyToday = false
    for (const r of card.reviews) {
      if (r.at >= from && r.at < to) {
        anyToday = true
        break
      }
    }
    if (!anyToday) continue
    let known = false
    const takenId = card.id != null && upNextTaken.has(card.id)
    const begunAsNext = takenId && upNextBegun.has(card.id!)
    let nextLeft = takenId
    for (const r of [...card.reviews].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) {
      if (r.at >= to) break
      if (r.at >= from) {
        const isNew = !known
        // Only a card begun as Up next (`UP_NEXT_BEGUN`) used Up next on its `isNew` review; a due card (or one learned
        // earlier today and marked Up next later) used Up next on a known (`!isNew`) review.
        const next = nextLeft && (begunAsNext ? isNew : !isNew)
        if (next) nextLeft = false
        out.push({ key: card.key, rating: r.rating, isNew, next, first: false })
      }
      if (r.rating !== 'again') known = true
    }
  }
  return out
}

/**
 * A card of a session's queue at its start that waits for its re-check (YAZ-5708, rules 7 and 18): a card with a ✓ whose
 * last answer, today, was ✕. It stays a miss waiting when the Inbox opens again: the red, the ✕ K, the "Again" chip, at
 * the end of the run.
 */
export function missedToday(reviews: readonly CardReview[], from: string): boolean {
  let last: CardReview | undefined
  for (const r of reviews) if (last === undefined || r.at > last.at) last = r
  return last !== undefined && last.rating === 'again' && last.at >= from && reviews.some((r) => r.rating !== 'again')
}

/** The ring's numbers (YAZ-5043): the due cards' first answers, how many were Remembered, the % to the nearest (never 100 while one was missed). */
export function dueFirsts(answers: readonly SessionAnswer[]): { count: number; remembered: number; percent: number } {
  const firsts = answers.filter((a) => a.first)
  const count = firsts.length
  const remembered = firsts.filter((a) => a.rating !== 'again').length
  // To the nearest, as Mochi (YAZ-5680 check: 2 of 3 is 67%); never 100 while one was missed (199 of 200 is 99%).
  const percent = count === 0 ? 100 : Math.min(remembered < count ? 99 : 100, Math.round((100 * remembered) / count))
  return { count, remembered, percent }
}
