import { REVIEW_KEY, type ReviewEntry, type ReviewSettings } from './reviews'
import type { IndexRecord } from './types'

/**
 * The upkeep schedule (YAZ-2322): when a note is next due, and what is due now. The ONLY place
 * a due date is computed (🔒 D2) — a smarter rule later changes `dueAt` and no note.
 */

const DAY = 86_400_000

/** A number of days as the UI says it: "1 day", "30 days". */
export const dayCount = (n: number): string => `${n} day${n === 1 ? '' : 's'}`

/** The wait, in days, after `streak` reviews in a row: `baseDays × growth^streak`, capped at `maxDays`. */
function waitDays(s: ReviewSettings, streak: number): number {
  return Math.min(s.baseDays * s.growth ** streak, s.maxDays)
}

/**
 * The rule: a note never reviewed, or whose body changed since its last review, is due
 * `baseDays` after the file last changed. Otherwise it is due after its last review by
 * `baseDays × growth^n`, capped at `maxDays`, where n is the reviews in a row that saw the body as
 * it is now — so an edit starts the wait over, and each "Still relevant" lengthens it.
 */
export function dueAt({ mtime, reviews = [], text }: Pick<IndexRecord, 'mtime' | 'reviews' | 'text'>, s: ReviewSettings): number {
  let streak = 0
  while (streak < reviews.length && reviews[reviews.length - 1 - streak].text === text) streak++
  if (streak === 0) return mtime + s.baseDays * DAY
  return Date.parse(reviews[reviews.length - 1].at) + waitDays(s, streak) * DAY
}

/**
 * The settings as the Settings dialog says them: each wait up to the longest — "30 days, then
 * 60, 120, 240, 365." — or "Every 30 days." when the wait never grows. Six waits at most are
 * listed, then the longest is named, so a growth just over 1 is still one line.
 */
export function scheduleInWords(s: ReviewSettings): string {
  const waits = [s.baseDays]
  while (s.growth > 1 && waits.length < 6 && waits[waits.length - 1] < s.maxDays) waits.push(waitDays(s, waits.length))
  const [first, ...rest] = waits.map((days) => Math.round(days))
  if (rest.length === 0) return `Every ${dayCount(first)}.`
  return `${dayCount(first)}, then ${rest.join(', ')}${waits[waits.length - 1] < s.maxDays ? `, … up to ${s.maxDays}` : ''}.`
}

/** Due now (🔒 D9): due before local midnight tonight — the one test the Inbox and a note's own page share. */
export const isDue = (due: number, now: number): boolean => due < new Date(now).setHours(24, 0, 0, 0)

/** The date review `index` set when it was written: the log up to it, read against the text it saw. */
export function dueAfter(reviews: readonly ReviewEntry[], index: number, s: ReviewSettings): number {
  return dueAt({ mtime: 0, reviews: reviews.slice(0, index + 1), text: reviews[index].text }, s)
}

/**
 * In review (🔒 D6): the note's own `review: true | false`, else the vault default. A note
 * a review could not be written into — broken frontmatter, or too large to be read (no `text`) — never is.
 */
export function isInReview(record: IndexRecord, s: ReviewSettings): boolean {
  if (record.frontmatterError !== undefined || record.text === undefined) return false
  const own = record.properties[REVIEW_KEY]
  return typeof own === 'boolean' ? own : s.reviewByDefault
}

/**
 * The notes due now, most overdue first (🔒 D9): in review, and due before local midnight
 * tonight. `folder` (root-relative, '' = the vault) keeps that folder and its subfolders.
 */
export function reviewQueue(records: readonly IndexRecord[], s: ReviewSettings, now: number, folder = ''): IndexRecord[] {
  return records
    .filter((r) => isInReview(r, s) && (folder === '' || r.folder === folder || r.folder.startsWith(`${folder}/`)))
    .map((record) => ({ record, due: dueAt(record, s) }))
    .filter(({ due }) => isDue(due, now))
    .sort((a, b) => a.due - b.due || (a.record.path < b.record.path ? -1 : 1))
    .map(({ record }) => record)
}
