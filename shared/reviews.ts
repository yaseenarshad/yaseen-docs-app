import { Document, isMap } from 'yaml'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from './frontmatter'
import { isRecord } from './guards'

/**
 * Upkeep review (YAZ-2322): a notecard's review log lives ON the notecard, under the reserved
 * frontmatter key `reviews` — a flat list, one line per review (🔒 D1). The file stores only what
 * happened; when the notecard is next due is computed (`shared/schedule.ts`, 🔒 D2), never written.
 * Pure: no React, no fs. The app writes through `transformFile`, the index lifts the list onto
 * the record and drops the key from `properties`, the Properties panel chips it "Reserved".
 *
 * Like `shared/comments.ts`, every writer CARRIES what it does not understand: unknown keys on an
 * entry (a later algorithm's) and unknown entries in the list are never rebuilt from the typed
 * subset, and a value of the user's own under this name is never overwritten.
 */

export const REVIEWS_KEY = 'reviews'
/** The opt-out (🔒 D6): `review: false` takes a notecard out of review, `true` puts it in whatever the vault default. */
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

/**
 * Eight hex characters standing for a notecard's body (🔒 C): a review records the one it saw, and
 * the body counts as changed when it no longer matches. FNV-1a over UTF-16 units, so the renderer
 * and the main process agree without a crypto dependency; line-ending style and blank space around
 * the text do not count.
 */
export function textFingerprint(body: string): string {
  const text = body.replace(/\r\n/g, '\n').trim()
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, '0')
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

export const REVIEW_SETTINGS_FILE = 'review.json'

/**
 * Per vault, so every device computes the same dates. `algorithm` has one value in v1; it is in
 * the file so a second algorithm is a new value, not a new shape (🔒 D3).
 */
export interface ReviewSettings {
  algorithm: 'upkeep'
  /** A notecard untouched this many days comes up. */
  baseDays: number
  /** Each "Still relevant" in a row multiplies the wait; 1 is a fixed rotation. */
  growth: number
  /** The longest wait. */
  maxDays: number
  /** Whether a notecard with no `review` key is in review. */
  reviewByDefault: boolean
}

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = { algorithm: 'upkeep', baseDays: 30, growth: 2, maxDays: 365, reviewByDefault: true }

const wholeDays = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min

/** Take a notecard in or out of review (🔒 D6): the flag is written only when it differs from the vault default; the log is untouched. */
export function setInReview(content: string, on: boolean, s: ReviewSettings): string {
  return setFrontmatterProperty(content, REVIEW_KEY, on === s.reviewByDefault ? undefined : on)
}

/** A missing or malformed file is the defaults; a bad field falls back alone. `maxDays` is never under `baseDays`. */
export function sanitizeReviewSettings(raw: unknown): ReviewSettings {
  const r = isRecord(raw) ? raw : {}
  const d = DEFAULT_REVIEW_SETTINGS
  const baseDays = wholeDays(r.baseDays, 1) ? r.baseDays : d.baseDays
  return {
    algorithm: 'upkeep',
    baseDays,
    growth: typeof r.growth === 'number' && Number.isFinite(r.growth) && r.growth >= 1 ? r.growth : d.growth,
    maxDays: wholeDays(r.maxDays, baseDays) ? r.maxDays : Math.max(d.maxDays, baseDays),
    reviewByDefault: typeof r.reviewByDefault === 'boolean' ? r.reviewByDefault : d.reviewByDefault,
  }
}
