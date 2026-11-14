/**
 * The small facts of the card course that the app needs before the course loads (YAZ-5120): the length that Settings
 * and the notice say, and when the app offers the course. This file is in the startup bundle, so it never imports the
 * script (`script.ts`) or the player: those load only when the course opens.
 */
import type { CourseState } from '@shared/courseState'
import type { SettingsState } from '@shared/types'

/** The speaking rate of the reading-time estimate (YAZ-5119: the script's minutes are words at 145 a minute). */
export const WORDS_PER_MINUTE = 145

/**
 * The course's length in minutes, from the script's words at `WORDS_PER_MINUTE`. A test (`courseFacts.test.ts`)
 * computes it from `COURSE` and fails when the script changed and this number did not.
 */
export const COURSE_MINUTES = 26

/** Settings › Review › Card course: the row's hint. */
export const COURSE_HINT = `About ${COURSE_MINUTES} minutes. Learn how cards work, and make your first ones.`

/** The one notice, the first time this Mac shows a vault with Review on. */
export const COURSE_NOTICE = `New to cards? Take the ${COURSE_MINUTES}-minute course`

/** The empty Inbox's line (YAZ-5059 suggestion 24). */
export const COURSE_INBOX_LINE = 'No cards yet. Take the course, or make a card.'

/**
 * "Card tips" (issue 4 of YAZ-5059) turns off each offer of the course: the notice and the empty Inbox's line. The
 * Settings button always shows. The switch is `SettingsState.cardTips` when issue 4 has added it; until then, and for
 * any value but an explicit false, the tips are on.
 */
export const cardTipsOn = (settings: SettingsState): boolean => (settings as SettingsState & { cardTips?: unknown }).cardTips !== false

/** The empty Inbox offers the course only to a beginner (Yaseen): the vault has no card, the course is not done, and no "Don't show again". */
export const offerInInbox = (course: CourseState, settings: SettingsState, vaultHasCards: boolean): boolean =>
  cardTipsOn(settings) && !vaultHasCards && !course.done && !course.dismissed

/** The notice shows once per Mac: the first time a window shows a vault with Review on, while the course is not done. */
export const offerNotice = (course: CourseState, settings: SettingsState, reviewOn: boolean): boolean =>
  reviewOn && cardTipsOn(settings) && !course.offered && !course.done
