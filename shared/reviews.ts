import { isRecord } from './guards'

/**
 * A vault's note card review settings (YAZ-4959 D14): `<root>/.yaseendocs/review.json`, per vault, so every Mac
 * computes the same due dates. They replace page upkeep review (YAZ-2322, D6: no legacy). A missing or malformed file
 * is the defaults; each bad field falls back to its default alone, and a key this build does not know is ignored.
 * The schedule that reads them is `cardSchedule.ts`.
 */

export const REVIEW_SETTINGS_FILE = 'review.json'

/** How many answer buttons a review shows (D5): Forgot and Remembered, or Again, Hard, Good and Easy. */
export type ReviewButtons = 2 | 4

export interface ReviewSettings {
  /** Review cards in this vault: off, no card is due and the Inbox shows none. */
  enabled: boolean
  /** Two buttons (`again`, `good`) or four. The file stores the FSRS names either way. */
  buttons: ReviewButtons
  /** The remember rate FSRS aims at ("request retention"), 0.7 to 0.99. */
  retention: number
  /** The longest wait, in days. */
  maxDays: number
  /** How many new cards the Inbox shows in one day. */
  newPerDay: number
  /** Spread due dates (FSRS fuzz): cards made together do not all come back on one day. */
  fuzz: boolean
  /** The FSRS weights: 21 numbers (FSRS-6); 17 or 19 are read too (ts-fsrs fills in the rest). */
  weights: number[]
}

/** Yaseen's 21 Mochi weights (YAZ-2322, YAZ-4948 "Approved: run to the end"). */
export const DEFAULT_CARD_WEIGHTS: readonly number[] = Object.freeze([
  0.2172, 1.1771, 3.2602, 16.1507, 7.0114, 0.57, 2.0966, 0.0069, 1.5261, 0.112, 1.0178, 1.849, 0.1133, 0.3127, 2.2934, 0.2191, 3.0004, 0.7536, 0.3332, 0.1437, 0.2,
])

export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = Object.freeze({
  enabled: true,
  buttons: 2,
  retention: 0.9,
  maxDays: 365,
  newPerDay: 10,
  fuzz: true,
  weights: [...DEFAULT_CARD_WEIGHTS],
}) as ReviewSettings

const wholeIn = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const isWeights = (v: unknown): v is number[] => Array.isArray(v) && [17, 19, 21].includes(v.length) && v.every((n) => typeof n === 'number' && Number.isFinite(n))

/** The settings a parsed `review.json` holds, every field checked on its own. */
export function sanitizeReviewSettings(raw: unknown): ReviewSettings {
  const r = isRecord(raw) ? raw : {}
  const d = DEFAULT_REVIEW_SETTINGS
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    buttons: r.buttons === 2 || r.buttons === 4 ? r.buttons : d.buttons,
    retention: typeof r.retention === 'number' && r.retention >= 0.7 && r.retention <= 0.99 ? r.retention : d.retention,
    maxDays: wholeIn(r.maxDays, 1, 36500) ? r.maxDays : d.maxDays,
    newPerDay: wholeIn(r.newPerDay, 0, 9999) ? r.newPerDay : d.newPerDay,
    fuzz: typeof r.fuzz === 'boolean' ? r.fuzz : d.fuzz,
    weights: isWeights(r.weights) ? [...r.weights] : [...d.weights],
  }
}
