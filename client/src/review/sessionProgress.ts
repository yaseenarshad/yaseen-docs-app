/**
 * The session's numbers, ONE source for the Inbox's progress bar (YAZ-5020) and the end of Due today's ring (YAZ-5043,
 * `DueTodayEnd`). Each answer of the session is kept with what its card was when it was answered (new or not, Up next
 * or not), so each filter reads its own share of the same list.
 *
 * The bar counts only the tab on show (YAZ-5432, Yaseen: "Due today's progress bar is specific to due today. New's
 * progress bar is specific to new, and then all's progress bar is specific to all"). A page's or a folder's review, and
 * the new cards' "from Spanish", are the session's queue already: the bar follows them.
 *
 * One step per CARD, not per answer (YAZ-5594, Yaseen: "isnt the progress bar based not on the number of times you
 * click green or red but on how many cards are LEFT?"; YAZ-5610: "that shouldnt move the deterministic number of
 * cards"). The whole is the filter's cards in this session: the cards it answered and the cards it still shows, each
 * ONCE — a card back in its steps (a Forgot, a new card's first Remembered) is the same card, not a new one. A card is
 * done when the session lets it go (no repeat of it waits under the filter). Its step, in the order the cards were
 * first answered: grey once it is done; red while it waits after a Forgot of this session (a Remembered that keeps it in
 * its steps leaves it red); empty while it waits otherwise (a new card back after its first Remembered, a card not
 * answered yet). The "3 / 13" count reads the same cards (`filterPlace`).
 *
 * Option B (YAZ-5660, Yaseen picked it): in the first pass a red stays where the card was missed. Once the pass is over
 * (no card of the filter waits unanswered) and the session moves on from its % screen, the bar is full and the reds
 * slide to the right end: grey on the left, the cards still to come back empty, all red on the right. Then each ✓ of
 * Review missed cards turns the leftmost red grey. A card that joins (the other device, Add more) opens the pass again.
 *
 * The ring's % is each due card's FIRST answer of the session (`dueFirsts`): a card missed then got right counts as
 * missed, a new card never counts. The same answers draw the bar's red and grey in the first pass.
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

/** A card of the session's queue as the bar sees it: its card (`cardKey`) and its kind. */
export interface SessionCard {
  path: string
  id: string
  isNew: boolean
  next: boolean
}

/**
 * A run of the same step: one part of the bar (YAZ-5020), so a long session draws a few boxes, not one per card. `open`
 * (YAZ-5594): answered but waiting to come back with a Remembered, drawn empty as a card still to come.
 */
export interface ProgressRun {
  missed: boolean
  count: number
  open?: boolean
}

/**
 * The bar of one filter: its parts (the answered cards, in order), how many cards are done, and how many cards in all.
 * `moved` (YAZ-5660): only as the reds slide to the right end, how many steps each red (left to right) moved, to draw
 * the slide once.
 */
export interface FilterProgress {
  runs: ProgressRun[]
  done: number
  size: number
  moved?: number[]
}

/** The bar's parts (YAZ-5020): each run of the same step as one part. */
function runsOf(steps: readonly { missed: boolean; open: boolean }[]): ProgressRun[] {
  const runs: ProgressRun[] = []
  for (const { missed, open } of steps) {
    const last = runs.at(-1)
    if (last !== undefined && last.missed === missed && (last.open === true) === open) last.count++
    else runs.push(open ? { missed, count: 1, open } : { missed, count: 1 })
  }
  return runs
}

const keyOf = (card: Pick<SessionCard, 'path' | 'id'>): string => `${card.path}\n${card.id}`

/** The filter's answered cards (YAZ-5594), each once, in the order first answered: whether one of its answers was a Forgot. */
function answeredCards(answers: readonly SessionAnswer[], filter: CardFilter): Map<string, boolean> {
  const missed = new Map<string, boolean>()
  for (const a of answers) if (matchesFilter(a, filter)) missed.set(a.key, missed.get(a.key) === true || a.rating === 'again')
  return missed
}

type Step = { missed: boolean; open: boolean }

/**
 * The bar under `filter` (YAZ-5432, YAZ-5594): one step per card of the session, `queue` the cards still to show.
 * `paused`: the % screen of the pass is on show, so the reds still stand where they were missed (YAZ-5660).
 */
export function filterProgress(answers: readonly SessionAnswer[], queue: readonly SessionCard[], filter: CardFilter, { paused = false } = {}): FilterProgress {
  const answered = answeredCards(answers, filter)
  const waiting = new Set(queue.filter((c) => matchesFilter(c, filter)).map(keyOf))
  const steps: Step[] = []
  let done = 0
  for (const [key, missed] of answered) {
    const back = waiting.has(key)
    if (!back) done++
    steps.push({ missed: back && missed, open: back && !missed })
  }
  let fresh = 0
  for (const key of waiting) if (!answered.has(key)) fresh++
  const size = answered.size + fresh
  if (fresh > 0 || paused || !steps.some((s) => s.missed)) return { runs: runsOf(steps), done, size }
  // The pass is over: grey, then the cards still to come back, then the reds (YAZ-5660).
  const rank = (s: Step) => (s.missed ? 2 : s.open ? 1 : 0)
  const order = steps.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
  const progress: FilterProgress = { runs: runsOf(order.map((o) => o.s)), done, size }
  // The slide is drawn once: as the session leaves the % screen, or at the answer that ends the pass (no % screen).
  const last = answers.at(-1)
  const ended = last !== undefined && matchesFilter(last, filter) && answers.filter((a) => a.key === last.key && matchesFilter(a, filter)).length === 1
  const moved = order.flatMap((o, to) => (o.s.missed ? [to - o.i] : []))
  if (ended && moved.some((m) => m > 0)) progress.moved = moved
  return progress
}

/**
 * "3 / 13" under `filter` (YAZ-5594, YAZ-5610): the card on show (`queue[at]`) among the filter's cards, each once. A
 * card not answered yet is the one after the cards answered (and the ones passed over with →, before it); a card back
 * in its steps adds nothing.
 */
export function filterPlace(answers: readonly SessionAnswer[], queue: readonly SessionCard[], at: number, filter: CardFilter): { position: number; total: number } {
  const answered = answeredCards(answers, filter)
  const total = filterProgress(answers, queue, filter).size
  const before = new Set(
    queue
      .slice(0, at)
      .filter((c) => matchesFilter(c, filter))
      .map(keyOf)
      .filter((k) => !answered.has(k)),
  ).size
  const shown = queue[at]
  const own = shown !== undefined && !answered.has(keyOf(shown)) ? 1 : 0
  return { position: Math.max(1, Math.min(answered.size + before + own, total)), total }
}

/** The ring's numbers (YAZ-5043): the due cards' first answers, how many were Remembered, the whole % (never 100 while one was missed). */
export function dueFirsts(answers: readonly SessionAnswer[]): { count: number; remembered: number; percent: number } {
  const firsts = answers.filter((a) => a.first)
  const count = firsts.length
  const remembered = firsts.filter((a) => a.rating !== 'again').length
  return { count, remembered, percent: count === 0 ? 100 : Math.floor((100 * remembered) / count) }
}
