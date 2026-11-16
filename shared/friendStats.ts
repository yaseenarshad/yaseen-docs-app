import { cardTime, type CardReview } from './cardLine'
import { cardHistory } from './cardSchedule'
import { FRIEND_DAYS, MATURE_DAYS, calendarOf, pad, type FriendDay, type FriendStats, type FriendTotals, type FriendVault } from './friendStatsFormat'

/**
 * THE FRIENDS NUMBERS (YAZ-5069, decisions 23, 24 and 25 on YAZ-5057; the files of round 16): what a person shares with
 * friends and groups, counted from the card lines of the vaults that count. One numbers gist for the person
 * (`FriendStats`), and one small pointer gist for each friend and each group (`FriendPointer`). Numbers only: no card text and no title ever goes in. The
 * phone (4E1) and the Mac (4E5) send the result; the Friends screens (4E4) read its shape. The card lines sync, so each
 * device that holds the same vaults counts the same numbers. Pure: no Node import, no DOM.
 *
 * A day is the person's own day (YAZ-5058), midnight to midnight. YAZ-5251: in the person's HOME time zone, which their
 * own friends list keeps (`FriendsIndex.zone`), so a phone and a Mac in two zones put each answer on the same day. With
 * no zone, the device's own zone (as `reviewedToday` counts the Mac's "Today"). "The daily" is the DUE cards only (round 8): a new card is never part of it.
 *
 * The shapes, the days and the file checks live in `./friendStatsFormat` (no `cardSchedule`, YAZ-5509); this file
 * re-exports them and holds the count, the one part that needs FSRS.
 */
export { FRIEND_DAYS, FRIEND_FILE_MAX_BYTES, MATURE_DAYS, RECENT_DAYS, dayIn, daysReviewed, deviceZone, isTimeZone, parseFriendPointer, parseFriendStats, rememberedPercent } from './friendStatsFormat'
export type { FriendDay, FriendFileRead, FriendMark, FriendPointer, FriendStats, FriendTotals, FriendVault } from './friendStatsFormat'

/** The reviews in time order (a hand edit can change the line's order). */
const inOrder = (reviews: readonly CardReview[]): CardReview[] => [...reviews].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

/** How many of `bounds` (sorted card times) are at or before `at`, less one: the index of the day `at` is in. */
function dayOf(bounds: readonly string[], at: string): number {
  let lo = 0
  let hi = bounds.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (bounds[mid] <= at) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/**
 * Pure: the numbers of `vaults` at `now`. "Remembered %" and "days reviewed of 30" are worked out from `days`
 * (`rememberedPercent`, `daysReviewed`). The days run from the local day of the first answer (90 at most go out);
 * today is always there.
 *
 * Due cards, for today and for each past day: a card is a due card of a day when it was answered before that day, it
 * is not archived, it has an ID, and the answers made before that day made it due before the day's end (or left it in
 * its same-day steps). It is finished when the answers up to the day's end move its due date past the day's end, out
 * of its steps. So a card that is new that day, or an Up next card that was not due, is never a due card of it. A copy
 * of an ID on the same page counts one time, as the Inbox shows it one time. A vault with review off has no due card.
 */
export function friendStats(vaults: readonly FriendVault[], now: number, zone?: string | null): Omit<FriendStats, 'login' | 'name' | 'avatar'> {
  const steps = friendStatsSteps(vaults, now, zone)
  for (let step = steps.next(); ; step = steps.next()) if (step.done === true) return step.value
}

/**
 * The same count as `friendStats`, in small steps (YAZ-5255): it waits for `slice()` after each card, so the phone
 * gives the UI thread back (`uiSlicer`) and no step comes near a long task (50 ms). Same numbers, same order.
 */
export async function friendStatsSliced(vaults: readonly FriendVault[], now: number, slice: () => Promise<void>, zone?: string | null): Promise<Omit<FriendStats, 'login' | 'name' | 'avatar'>> {
  const steps = friendStatsSteps(vaults, now, zone)
  for (let step = steps.next(); ; step = steps.next()) {
    if (step.done === true) return step.value
    await slice()
  }
}

/** The count of `friendStats` as steps: it yields after each card (and after each page in the first scan). */
function* friendStatsSteps(vaults: readonly FriendVault[], now: number, zone?: string | null): Generator<void, Omit<FriendStats, 'login' | 'name' | 'avatar'>> {
  const cal = calendarOf(zone)
  /** The date `days` after `t` (pure date arithmetic, no clock). */
  const plus = (t: { y: number; m: number; d: number }, days: number) => {
    const u = new Date(Date.UTC(t.y, t.m - 1, t.d + days))
    return { y: u.getUTCFullYear(), m: u.getUTCMonth() + 1, d: u.getUTCDate() }
  }
  const startOf = (t: { y: number; m: number; d: number }) => cal.start(t.y, t.m, t.d)
  const today = cal.date(now)
  const todayEnd = cardTime(startOf(plus(today, 1)))
  // The first answer across all vaults, before the end of today: the history starts on its local day.
  let firstAt: string | null = null
  for (const { pages } of vaults)
    for (const page of pages) {
      for (const card of page.cards ?? []) for (const r of card.reviews) if (r.at < todayEnd && (firstAt === null || r.at < firstAt)) firstAt = r.at
      yield
    }
  let start = firstAt === null ? today : cal.date(Date.parse(firstAt))
  if (startOf(start) > startOf(today)) start = today

  // Each local day from the first one to today: its date, its start and end (ms), and its start as a card time.
  const keys: string[] = []
  const ends: number[] = []
  const bounds: string[] = []
  const weekStarts: boolean[] = []
  const todayStart = startOf(today)
  for (let d = start; startOf(d) <= todayStart; d = plus(d, 1)) {
    keys.push(`${d.y}-${pad(d.m)}-${pad(d.d)}`)
    bounds.push(cardTime(startOf(d)))
    ends.push(startOf(plus(d, 1)))
    weekStarts.push(new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay() === 1)
  }
  const n = keys.length
  const last = n - 1
  const cards = new Array<number>(n).fill(0)
  const seconds = new Array<number>(n).fill(0)
  const remembered = new Array<number>(n).fill(0)
  const forgot = new Array<number>(n).fill(0)
  const newCards = new Array<number>(n).fill(0)
  const undone = new Array<boolean>(n).fill(false)
  const totals = { cards: 0, inReview: 0, newLeft: 0, mature: 0, dueLeft: 0 }

  for (const { pages, settings } of vaults) {
    for (const page of pages) {
      const ids = new Set<string>()
      for (const card of page.cards ?? []) {
        yield
        totals.cards++
        const reviews = inOrder(card.reviews).filter((r) => r.at < todayEnd)
        // The day's numbers: every answer counts, archived cards too (their answers were made).
        let prev = -1
        for (const r of reviews) {
          const i = dayOf(bounds, r.at)
          if (i < 0) continue
          seconds[i] += r.seconds ?? 0
          if (r.rating === 'again') forgot[i]++
          else remembered[i]++
          if (i !== prev) cards[i]++
          prev = i
        }
        const firstDay = reviews.length > 0 ? dayOf(bounds, reviews[0].at) : -1
        if (firstDay >= 0) newCards[firstDay]++
        if (card.off) continue
        if (reviews.length === 0) {
          totals.newLeft++
          continue
        }
        totals.inReview++
        const history = cardHistory(reviews, settings)
        if (history[history.length - 1].interval >= MATURE_DAYS) totals.mature++
        if (!settings.enabled || card.id === null || ids.has(card.id)) continue
        ids.add(card.id)
        // Each day after the first answer: was the card due that day, and did the day's answers finish it?
        let before = 0
        for (let d = Math.max(firstDay + 1, 0); d <= last; d++) {
          while (before < history.length && history[before].review.at < bounds[d]) before++
          const was = history[before - 1]
          if (!(was.inSteps || was.due < ends[d])) continue
          let upTo = before
          const end = d === last ? todayEnd : bounds[d + 1]
          while (upTo < history.length && history[upTo].review.at < end) upTo++
          const after = history[upTo - 1]
          if (after.inSteps || after.due < ends[d]) {
            undone[d] = true
            if (d === last) totals.dueLeft++
          }
        }
      }
    }
  }

  // The streak: finished days in a row up to today, or up to yesterday while today is not finished yet.
  // With no answer ever, there is no streak day (YAZ-5168): each day is before the first answer. Today still shows
  // `done: true`, as a day with no due card does (round 8); only the streak waits for the first answer.
  const answered = firstAt !== null
  let streak = 0
  if (answered) for (let d = undone[last] ? last - 1 : last; d >= 0 && !undone[d]; d--) streak++
  let bestStreak = 0
  let run = 0
  let bestWeek = 0
  let week = 0
  // This week's first day: the last Monday at or before today (or the first day of the history).
  let thisWeek = 0
  for (let d = 0; d <= last; d++) {
    run = undone[d] || !answered ? 0 : run + 1
    bestStreak = Math.max(bestStreak, run)
    if (weekStarts[d]) {
      week = 0
      thisWeek = d
    }
    week += cards[d]
    bestWeek = Math.max(bestWeek, week)
  }
  let addedThisWeek = 0
  for (let d = thisWeek; d <= last; d++) addedThisWeek += newCards[d]

  const days: FriendDay[] = []
  for (let d = last; d >= 0 && days.length < FRIEND_DAYS; d--) {
    days.push({ day: keys[d], cards: cards[d], seconds: seconds[d], remembered: remembered[d], forgot: forgot[d], newCards: newCards[d], done: !undone[d] })
  }
  return {
    v: 1,
    days,
    totals: { ...totals, addedThisWeek, streak, bestStreak, bestDay: cards.reduce((a, b) => Math.max(a, b), 0), bestWeek },
    at: new Date(now).toISOString(),
  }
}
