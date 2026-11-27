import { CARD_TITLE_MARK_SHOW, CARD_TITLE_SHOW, OLD_TITLE_AT, type CardTitleMarkShow, type CardTitleShow } from './cardTitleAt'
import { isRecord } from './guards'

/**
 * A vault's card review settings (YAZ-4959 D14; consolidated in `<vault>/.yaseendocs/settings.json` under `review`,
 * YAZ-6546), per vault, so every Mac and Phone share the same due dates and Inbox behavior. `REVIEW_SETTINGS_FILE`
 * stays for legacy read fallback only. A missing or malformed section uses the defaults; each bad field falls back
 * to its default alone, and unknown keys are ignored. The schedule that reads them is `cardSchedule.ts`.
 */

export const REVIEW_SETTINGS_FILE = 'review.json'

/** How many answer buttons a review shows (D5): Forgot and Remembered, or Again, Hard, Good and Easy. */
export type ReviewButtons = 2 | 4

/** The choices of "Pause the timer after" (YAZ-5033), in seconds with no key or mouse. */
export const PAUSE_AFTER_CHOICES = [30, 60, 120, 300] as const
export type PauseAfter = (typeof PAUSE_AFTER_CHOICES)[number]

/**
 * Settings › Review › Time so far (YAZ-5130, Yaseen: "having it in sight will be stressful"): today's review time in
 * the Inbox DURING the review. `hidden` (the default) shows a small clock in its place, and a click on it shows the time;
 * `shown` shows it as before; `off` shows no time and no clock. Every finish screen shows the time whatever this says
 * (YAZ-5665). The answer timer runs the same in all three: each answer still saves its seconds.
 */
export const TIME_SO_FAR_CHOICES = ['hidden', 'shown', 'off'] as const
export type TimeSoFar = (typeof TIME_SO_FAR_CHOICES)[number]

/**
 * Which new cards the Inbox takes first (YAZ-4999 D2), by the card's ID number: the vault's counter grows with time.
 * `random` (YAZ-5322, Settings › Cards › New cards order): one order for the whole day (`cardPlan` seeds it with the
 * local date), so the queue does not change when the Inbox draws again; another day has another order.
 */
export const NEW_CARD_ORDERS = ['oldest', 'newest', 'random'] as const
export type NewCardOrder = (typeof NEW_CARD_ORDERS)[number]

/**
 * The order of an All cards run (YAZ-5707, the cards menu's ⚙ › All cards › Order): `due-first` (the default) every due
 * card, then today's new cards; `shuffle` the due and the new cards mixed at random, as Mochi's Shuffle, once per
 * session (`useCardReview`). Up next cards go first either way.
 */
export const ALL_CARDS_ORDERS = ['due-first', 'shuffle'] as const
export type AllCardsOrder = (typeof ALL_CARDS_ORDERS)[number]

/**
 * The order of Due today (YAZ-5707, Yaseen's "one row per filter"; the ⚙ › Due today › Order): `shuffle` (the default,
 * as Mochi, finding E6) the due cards in a random order, once per session; `in-order` the queue's own order (most
 * overdue first, then one order for the day: `cardPlan`). It orders the due cards under All cards too.
 */
export const DUE_TODAY_ORDERS = ['in-order', 'shuffle'] as const
export type DueTodayOrder = (typeof DUE_TODAY_ORDERS)[number]

/** What Spacebar (and Phone tap) does when the next hidden word is below view (YAZ-6591): step-scroll or direct jump. */
export const SPACE_BEHAVIORS = ['scroll', 'jump'] as const
export type SpaceBehavior = (typeof SPACE_BEHAVIORS)[number]

/** When the Inbox top bar shows the card's folder › page location (YAZ-6591). */
export const CARD_LOCATION_MODES = ['focus-hide', 'until-revealed', 'show', 'hide'] as const
export type CardLocationMode = (typeof CARD_LOCATION_MODES)[number]

/** Where O in the Inbox opens a card that lives in a page (YAZ-5307; moved to vault settings in YAZ-6591). */
export const REVIEW_INBOX_OPEN_AT = ['top', 'card'] as const
export type ReviewInboxOpenAt = (typeof REVIEW_INBOX_OPEN_AT)[number]

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
  /** Which new cards come first: the oldest (the lowest ID number), the newest, or a random order for the day. */
  newOrder: NewCardOrder
  /**
   * Where new cards come from (YAZ-5322, the Inbox's New cards row and the done screen's "from Spanish ▾"): the
   * root-relative folders picked, each with its subfolders; empty for All folders. It stays until cleared. It narrows
   * only NEW cards (due cards and Up next come from everywhere); with no new card left in them, new cards come from
   * All folders (`CardPlan.newFallback`). No Settings row: the Inbox is where it is picked.
   */
  newFrom: string[]
  /** The order of an All cards run (YAZ-5707): Due first or Shuffle. Saved here so the phone follows the Mac. */
  allCardsOrder: AllCardsOrder
  /** The order of Due today (YAZ-5707): In order or Shuffle. Saved here so the phone follows the Mac. */
  dueTodayOrder: DueTodayOrder
  /** Spread due dates (FSRS fuzz): cards made together do not all come back on one day. */
  fuzz: boolean
  /**
   * The answer timer's idle pause, in seconds (YAZ-5033, Settings › Review › "Pause the timer after"): a stretch this
   * long with no key, click, scroll or mouse move counts nothing toward how long an answer took. 30, 60, 120 or 300.
   */
  pauseAfter: PauseAfter
  /** How the Inbox shows today's review time (YAZ-5130): hidden behind a click, shown, or off. Only how it shows. */
  timeSoFar: TimeSoFar
  /**
   * What ← and → do at the first and last card of the open filter (YAZ-6019): `false` (the default) stops at the
   * ends so ← always reaches the first card of the day; `true` loops around (YAZ-5715). Saved here so the phone
   * follows the Mac.
   */
  loopArrows: boolean
  /**
   * What Space (and Phone tap) does when the next hidden word or side is below view (YAZ-6591): `scroll` (the default)
   * walks down in ~35% reading steps so non-cloze sections are not skipped; `jump` jumps straight to the next hidden word.
   */
  spaceBehavior: SpaceBehavior
  /**
   * When the Inbox top bar hides the card's folder › page breadcrumb (YAZ-6591): `focus-hide` (default, hides in Focus
   * mode), `until-revealed` (hides until all blanks and sides show), `show` (always show), or `hide` (always hide).
   */
  cardLocation: CardLocationMode
  /** Whether Focus mode (`F`) hides the sidebar along with the tab bar (YAZ-6591): `false` (default, tab bar only) or `true`. */
  focusHidesSidebar: boolean
  /** Where O in the Inbox opens a card that lives in a page (`top` default, or `card`, YAZ-5307 / YAZ-6591). */
  inboxOpenAt: ReviewInboxOpenAt
  /**
   * When a card's title shows in Review (YAZ-5696, Settings › Cards › Card look › "Show card titles"): Never, Always
   * (the default: as before), After the first click, Before Side 2. A card's own choice on its line wins
   * (`cardTitleAtOf`); `notitle` never shows it. Round 1's `once` and `front` read as Always and After the first click.
   */
  titleAt: CardTitleShow
  /**
   * The title band's room in Review (YAZ-5880, D3 on YAZ-5858; Settings › Cards › Card look › "Title room"): `always`
   * (the default), every card in the Inbox and Preview has the band, empty when its title does not show, and a waiting
   * title fades in, so nothing moves; `shown`, no band until the title shows, the text flush with the top (YAZ-5864).
   */
  titleRoom: TitleRoom
  /**
   * The title mark in a card's head (YAZ-5965, Settings › Cards › "Title mark in the card head"): `always`, `different`
   * (the default: only a card with a title rule of its own) or `never` (`cardTitleMarkShows`). Every head reads it: a
   * card in a page, an embed, a card page and the phone.
   */
  titleMark: CardTitleMarkShow
  /** The FSRS weights: 21 numbers (FSRS-6); 17 or 19 are read too (ts-fsrs fills in the rest). */
  weights: number[]
}

/** The title band's room in Review (YAZ-5880): every card (`always`), or only while its title shows (`shown`). */
export type TitleRoom = 'always' | 'shown'

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
  newFrom: [],
  allCardsOrder: 'due-first',
  dueTodayOrder: 'shuffle',
  fuzz: true,
  pauseAfter: 60,
  timeSoFar: 'hidden',
  loopArrows: false,
  spaceBehavior: 'scroll',
  cardLocation: 'focus-hide',
  focusHidesSidebar: false,
  inboxOpenAt: 'top',
  titleAt: 'always',
  titleRoom: 'always',
  titleMark: 'different',
  weights: [...DEFAULT_CARD_WEIGHTS],
}) as ReviewSettings

/** The keys this build's writer owns (YAZ-5483): every other key of the file is kept on a save. */
export const REVIEW_SETTINGS_KEYS: readonly string[] = Object.keys(DEFAULT_REVIEW_SETTINGS)

const wholeIn = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max
const isWeights = (v: unknown): v is number[] => Array.isArray(v) && [17, 19, 21].includes(v.length) && v.every((n) => typeof n === 'number' && Number.isFinite(n))

/**
 * The folder pick, clean (YAZ-5322): root-relative folder paths with no slash at either end, each one time, none inside
 * another picked folder (a tick takes subfolders); anything that is not a list is All folders.
 */
export function sanitizeNewFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const folders = [...new Set(raw.filter((f): f is string => typeof f === 'string').map((f) => f.replace(/^\/+|\/+$/g, '')).filter((f) => f !== ''))]
  return folders.filter((f) => !folders.some((other) => other !== f && f.startsWith(`${other}/`)))
}

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
    newOrder: (NEW_CARD_ORDERS as readonly unknown[]).includes(r.newOrder) ? (r.newOrder as NewCardOrder) : d.newOrder,
    newFrom: sanitizeNewFrom(r.newFrom),
    allCardsOrder: (ALL_CARDS_ORDERS as readonly unknown[]).includes(r.allCardsOrder) ? (r.allCardsOrder as AllCardsOrder) : d.allCardsOrder,
    dueTodayOrder: (DUE_TODAY_ORDERS as readonly unknown[]).includes(r.dueTodayOrder) ? (r.dueTodayOrder as DueTodayOrder) : d.dueTodayOrder,
    fuzz: typeof r.fuzz === 'boolean' ? r.fuzz : d.fuzz,
    pauseAfter: (PAUSE_AFTER_CHOICES as readonly unknown[]).includes(r.pauseAfter) ? (r.pauseAfter as PauseAfter) : d.pauseAfter,
    timeSoFar: (TIME_SO_FAR_CHOICES as readonly unknown[]).includes(r.timeSoFar) ? (r.timeSoFar as TimeSoFar) : d.timeSoFar,
    loopArrows: typeof r.loopArrows === 'boolean' ? r.loopArrows : d.loopArrows,
    spaceBehavior: (SPACE_BEHAVIORS as readonly unknown[]).includes(r.spaceBehavior) ? (r.spaceBehavior as SpaceBehavior) : d.spaceBehavior,
    cardLocation: (CARD_LOCATION_MODES as readonly unknown[]).includes(r.cardLocation) ? (r.cardLocation as CardLocationMode) : d.cardLocation,
    focusHidesSidebar: typeof r.focusHidesSidebar === 'boolean' ? r.focusHidesSidebar : d.focusHidesSidebar,
    inboxOpenAt: (REVIEW_INBOX_OPEN_AT as readonly unknown[]).includes(r.inboxOpenAt) ? (r.inboxOpenAt as ReviewInboxOpenAt) : d.inboxOpenAt,
    titleAt: (CARD_TITLE_SHOW as readonly unknown[]).includes(r.titleAt) ? (r.titleAt as CardTitleShow) : typeof r.titleAt === 'string' && Object.hasOwn(OLD_TITLE_AT, r.titleAt) ? OLD_TITLE_AT[r.titleAt] : d.titleAt,
    // Anything but 'shown' is the default, Always.
    titleRoom: r.titleRoom === 'shown' ? 'shown' : d.titleRoom,
    titleMark: (CARD_TITLE_MARK_SHOW as readonly unknown[]).includes(r.titleMark) ? (r.titleMark as CardTitleMarkShow) : d.titleMark,
    weights: isWeights(r.weights) ? [...r.weights] : [...d.weights],
  }
}
