import { isRecord } from './guards'

/**
 * A vault's card review settings (YAZ-4959 D14): `<root>/.yaseendocs/review.json`, per vault, so every Mac
 * computes the same due dates. They replace page upkeep review (YAZ-2322, D6: no legacy). A missing or malformed file
 * is the defaults; each bad field falls back to its default alone, and a key this build does not know is ignored.
 * The schedule that reads them is `cardSchedule.ts`.
 */

export const REVIEW_SETTINGS_FILE = 'review.json'

/** How many answer buttons a review shows (D5): Forgot and Remembered, or Again, Hard, Good and Easy. */
export type ReviewButtons = 2 | 4

/** The choices of "Pause the timer after" (YAZ-5033), in seconds with no key or mouse. */
export const PAUSE_AFTER_CHOICES = [30, 60, 120, 300] as const
export type PauseAfter = (typeof PAUSE_AFTER_CHOICES)[number]

/**
 * Settings › Review › Time so far (YAZ-5130, Yaseen: "having it in sight will be stressful"): today's review time in
 * the Inbox. `hidden` (the default) shows a small clock in its place, and a click on it shows the time; `shown` shows
 * it as before; `off` shows no time and no clock. The answer timer runs the same in all three: each answer still saves its seconds.
 */
export const TIME_SO_FAR_CHOICES = ['hidden', 'shown', 'off'] as const
export type TimeSoFar = (typeof TIME_SO_FAR_CHOICES)[number]

/** Which new cards the Inbox takes first (YAZ-4999 D2), by the card's ID number: the vault's counter grows with time. */
export type NewCardOrder = 'oldest' | 'newest'

export interface ReviewSettings {
  /** Review cards in this vault: off, no card is due and the Inbox shows none. */
  enabled: boolean
  /** Two buttons (`again`, `good`) or four. The file stores the FSRS names either way. */
  buttons: ReviewButtons
  /** The remember rate FSRS aims at ("request retention"), 0.7 to 0.99. */
  retention: number
  /** The longest wait, in days. */
  maxDays: number
  /** How many new cards the Inbox shows in one day; null for no limit (YAZ-4999 D1: the user emptied the box). */
  newPerDay: number | null
  /**
   * How many Up next cards jump to the front of the Inbox in one day; null for no limit (YAZ-5028, the default). The
   * others keep the mark and wait for another day, unless due anyway (YAZ-5042; `cardQueue`).
   */
  upNextPerDay: number | null
  /** Which new cards come first: the oldest (the lowest ID number) or the newest. */
  newOrder: NewCardOrder
  /** Spread due dates (FSRS fuzz): cards made together do not all come back on one day. */
  fuzz: boolean
  /**
   * The answer timer's idle pause, in seconds (YAZ-5033, Settings › Review › "Pause the timer after"): a stretch this
   * long with no key, click, scroll or mouse move counts nothing toward how long an answer took. 30, 60, 120 or 300.
   */
  pauseAfter: PauseAfter
  /** How the Inbox shows today's review time (YAZ-5130): hidden behind a click, shown, or off. Only how it shows. */
  timeSoFar: TimeSoFar
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
  upNextPerDay: null,
  newOrder: 'oldest',
  fuzz: true,
  pauseAfter: 60,
  timeSoFar: 'hidden',
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
    // `null` is written only when the user empties the box: no limit. A missing field (no file) keeps the default.
    newPerDay: r.newPerDay === null || wholeIn(r.newPerDay, 0, 9999) ? r.newPerDay : d.newPerDay,
    // YAZ-5028: as newPerDay; a missing field is the default, no limit.
    upNextPerDay: r.upNextPerDay === null || wholeIn(r.upNextPerDay, 0, 9999) ? r.upNextPerDay : d.upNextPerDay,
    newOrder: r.newOrder === 'oldest' || r.newOrder === 'newest' ? r.newOrder : d.newOrder,
    fuzz: typeof r.fuzz === 'boolean' ? r.fuzz : d.fuzz,
    pauseAfter: (PAUSE_AFTER_CHOICES as readonly unknown[]).includes(r.pauseAfter) ? (r.pauseAfter as PauseAfter) : d.pauseAfter,
    timeSoFar: (TIME_SO_FAR_CHOICES as readonly unknown[]).includes(r.timeSoFar) ? (r.timeSoFar as TimeSoFar) : d.timeSoFar,
    weights: isWeights(r.weights) ? [...r.weights] : [...d.weights],
  }
}
