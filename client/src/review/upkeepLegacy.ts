import { Document, isMap } from 'yaml'
import { textFingerprint } from '@shared/comments'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { isRecord } from '@shared/guards'
import { type IndexRecord, inFolder } from '@shared/types'

export { REVIEW_SETTINGS_FILE } from '@shared/reviews'
export { textFingerprint }

/**
 * LEGACY SHIM (YAZ-4959, handoff to YAZ-4962): page upkeep review (YAZ-2322), moved here UNCHANGED from
 * `shared/reviews.ts` and `shared/schedule.ts` when note cards replaced it (YAZ-4946 D6: no legacy). It is INERT: the
 * index no longer gives a page `reviews` or `text`, so `isInReview` is false for every page and nothing is due. It
 * exists only so the client code that YAZ-4962 replaces (`useReview`, `ReviewBar`, `ReviewsSection`, the Review
 * settings rows, the sidebar's "In review") still builds. YAZ-4962 deletes this file. Do not add to it.
 *
 * `UpkeepSettings` is the old `UpkeepSettings`; `review.json` now holds the CARD settings (`@shared/reviews`).
 */

/** An index record as upkeep read it: the old `reviews` log and body fingerprint, which the index no longer gives. */
export type UpkeepRecord = IndexRecord & { reviews?: ReviewEntry[]; text?: string }

export const REVIEWS_KEY = 'reviews'
/** The opt-out (🔒 D6): `review: false` takes a note out of review, `true` puts it in whatever the vault default. */
export const REVIEW_KEY = 'review'
/** The one answer the upkeep algorithm writes: "Still relevant" (🔒 D4). */
const KEEP = 'keep'

export interface ReviewEntry {
  /** ISO UTC at seconds precision (`2026-10-04T14:02:11Z`), so it sorts as a string. */
  at: string
  /** `keep` in v1; another algorithm's grades are carried, and count as a check. */
  rating: string
  /** `textFingerprint` of the body this review was written into; '' on an entry that has none. */
  text: string
}

const isEntry = (e: unknown): e is Record<string, unknown> & { at: string } => isRecord(e) && typeof e.at === 'string' && !Number.isNaN(Date.parse(e.at))

/**
 * The reviews in a parsed frontmatter value, `at` ascending, as the three fields the schedule
 * reads: a non-list is none, an entry with a missing or unreadable `at` is skipped here, and both
 * it and any other key stay in the file on write.
 */
export function reviewEntries(value: unknown): ReviewEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isEntry)
    .map((e) => ({ at: e.at, rating: typeof e.rating === 'string' ? e.rating : KEEP, text: typeof e.text === 'string' ? e.text : '' }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

type ReviewsShape = 'absent' | 'list' | 'foreign' | 'invalid'

/** Thrown INSTEAD of writing when the fresh bytes hold a `reviews` value that is not a list, or a block that does not parse. */
export class ReviewsShapeError extends Error {
  constructor(readonly shape: ReviewsShape) {
    super(shape === 'invalid' ? 'the properties block does not parse' : `the ${REVIEWS_KEY} property is not a review log`)
    this.name = 'ReviewsShapeError'
  }
}

function rawList(content: string): { shape: ReviewsShape; list: readonly unknown[] } {
  const { properties, error } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  if (error !== undefined) return { shape: 'invalid', list: [] }
  const raw = properties[REVIEWS_KEY]
  if (raw === undefined || raw === null) return { shape: 'absent', list: [] }
  return Array.isArray(raw) ? { shape: 'list', list: raw } : { shape: 'foreign', list: [] }
}

function writable(content: string): readonly unknown[] {
  const { shape, list } = rawList(content)
  if (shape === 'foreign' || shape === 'invalid') throw new ReviewsShapeError(shape)
  return list
}

/** One review per line (`- {at: …, rating: keep, text: …}`); an emptied list deletes the KEY. */
function write(content: string, list: readonly unknown[]): string {
  if (list.length === 0) return setFrontmatterProperty(content, REVIEWS_KEY, undefined)
  const seq = new Document(list).contents
  if (seq !== null && 'items' in seq) for (const item of seq.items) if (isMap(item)) item.flow = true
  return setFrontmatterProperty(content, REVIEWS_KEY, seq)
}

export function reviewsOf(content: string): ReviewEntry[] {
  return reviewEntries(rawList(content).list)
}

/** Append one review, stamped with the fingerprint of the body it is written into. */
export function addReview(content: string, at: string): string {
  return write(content, [...writable(content), { at, rating: KEEP, text: textFingerprint(splitFrontmatter(content).body) }])
}

/** Remove the review made at `at` (the latest, should two share a second). An unknown `at` changes nothing. */
export function deleteReview(content: string, at: string): string {
  const list = writable(content)
  const i = list.map((e) => isEntry(e) && e.at === at).lastIndexOf(true)
  return i === -1 ? content : write(content, list.filter((_, j) => j !== i))
}

export function resetReviews(content: string): string {
  writable(content)
  return write(content, [])
}

// ---------- A vault's review settings (`<root>/.yaseendocs/review.json`, 🔒 D7) ----------

/**
 * Per vault, so every device computes the same dates. `algorithm` has one value in v1; it is in
 * the file so a second algorithm is a new value, not a new shape (🔒 D3).
 */
export interface UpkeepSettings {
  algorithm: 'upkeep'
  /** Whether the vault has upkeep review at all; off, no note is in review and the app shows none of it. */
  enabled: boolean
  /** A note untouched this many days comes up. */
  baseDays: number
  /** Each "Still relevant" in a row multiplies the wait; 1 is a fixed rotation. */
  growth: number
  /** The longest wait. */
  maxDays: number
  /** Whether a note with no `review` key is in review. */
  reviewByDefault: boolean
}

export const DEFAULT_UPKEEP_SETTINGS: UpkeepSettings = { algorithm: 'upkeep', enabled: false, baseDays: 30, growth: 2, maxDays: 365, reviewByDefault: true }

const wholeDays = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min

/** Take a note in or out of review (🔒 D6): the flag is written only when it differs from the vault default; the log is untouched. */
export function setInReview(content: string, on: boolean, s: UpkeepSettings): string {
  return setFrontmatterProperty(content, REVIEW_KEY, on === s.reviewByDefault ? undefined : on)
}

/** A missing or malformed file is the defaults, so upkeep is off; a bad field falls back alone. `maxDays` is never under `baseDays`. */
export function sanitizeUpkeepSettings(raw: unknown): UpkeepSettings {
  const r = isRecord(raw) ? raw : {}
  const d = DEFAULT_UPKEEP_SETTINGS
  const baseDays = wholeDays(r.baseDays, 1) ? r.baseDays : d.baseDays
  return {
    algorithm: 'upkeep',
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    baseDays,
    growth: typeof r.growth === 'number' && Number.isFinite(r.growth) && r.growth >= 1 ? r.growth : d.growth,
    maxDays: wholeDays(r.maxDays, baseDays) ? r.maxDays : Math.max(d.maxDays, baseDays),
    reviewByDefault: typeof r.reviewByDefault === 'boolean' ? r.reviewByDefault : d.reviewByDefault,
  }
}

// ---------- the old schedule (`shared/schedule.ts`) ----------

const DAY = 86_400_000

/** A number of days as the UI says it: "1 day", "30 days". */
export const dayCount = (n: number): string => `${n} day${n === 1 ? '' : 's'}`

/** The wait, in days, after `streak` reviews in a row: `baseDays × growth^streak`, capped at `maxDays`. */
function waitDays(s: UpkeepSettings, streak: number): number {
  return Math.min(s.baseDays * s.growth ** streak, s.maxDays)
}

/**
 * The rule: a note never reviewed, or whose body changed since its last review, is due
 * `baseDays` after the file last changed. Otherwise it is due after its last review by
 * `baseDays × growth^n`, capped at `maxDays`, where n is the reviews in a row that saw the body as
 * it is now — so an edit starts the wait over, and each "Still relevant" lengthens it.
 */
export function dueAt({ mtime, reviews = [], text }: Pick<UpkeepRecord, 'mtime' | 'reviews' | 'text'>, s: UpkeepSettings): number {
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
export function scheduleInWords(s: UpkeepSettings): string {
  const waits = [s.baseDays]
  while (s.growth > 1 && waits.length < 6 && waits[waits.length - 1] < s.maxDays) waits.push(waitDays(s, waits.length))
  const [first, ...rest] = waits.map((days) => Math.round(days))
  if (rest.length === 0) return `Every ${dayCount(first)}.`
  return `${dayCount(first)}, then ${rest.join(', ')}${waits[waits.length - 1] < s.maxDays ? `, … up to ${s.maxDays}` : ''}.`
}

/** Due now (🔒 D9): due before local midnight tonight — the one test the Inbox and a note's own page share. */
export const isDue = (due: number, now: number): boolean => due < new Date(now).setHours(24, 0, 0, 0)

/** The date review `index` set when it was written: the log up to it, read against the text it saw. */
export function dueAfter(reviews: readonly ReviewEntry[], index: number, s: UpkeepSettings): number {
  return dueAt({ mtime: 0, reviews: reviews.slice(0, index + 1), text: reviews[index].text }, s)
}

/**
 * In review (🔒 D6): the note's own `review: true | false`, else the vault default. A note
 * a review could not be written into — broken frontmatter, or too large to be read (no `text`) — never is,
 * and no note is while the vault has upkeep off (🔒 D7).
 */
export function isInReview(record: UpkeepRecord, s: UpkeepSettings): boolean {
  if (!s.enabled || record.frontmatterError !== undefined || record.text === undefined) return false
  const own = record.properties[REVIEW_KEY]
  return typeof own === 'boolean' ? own : s.reviewByDefault
}

/**
 * The notes due now, most overdue first (🔒 D9): in review, and due before local midnight
 * tonight. `folder` (root-relative, '' = the vault) keeps that folder and its subfolders.
 */
export function reviewQueue(records: readonly UpkeepRecord[], s: UpkeepSettings, now: number, folder = ''): UpkeepRecord[] {
  return records
    .filter((r) => isInReview(r, s) && inFolder(r.folder, folder))
    .map((record) => ({ record, due: dueAt(record, s) }))
    .filter(({ due }) => isDue(due, now))
    .sort((a, b) => a.due - b.due || (a.record.path < b.record.path ? -1 : 1))
    .map(({ record }) => record)
}
