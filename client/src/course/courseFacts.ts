/**
 * The small facts of the card course that the app needs before the course loads (YAZ-5120): the length that Settings
 * and the notice say, and when the app offers the course. This file is in the startup bundle, so it never imports the
 * script (`script.ts`) or the player: those load only when the course opens.
 */
import type { CourseState } from '@shared/courseState'
import type { SettingsState } from '@shared/types'

/**
 * The course's length in minutes: the voice's, the sum of the chapters' `seconds` in the voice manifest that ships in
 * the app (`desktop/src/main/courseAudio/course-audio.json`), rounded. A literal, because this file is in the startup
 * bundle; a test (`courseFacts.test.ts`) sums the manifest and fails when the two differ.
 */
export const COURSE_MINUTES = 28

/** Settings › Cards › Card course: the row's hint. */
export const COURSE_HINT = `About ${COURSE_MINUTES} minutes. Learn how cards work, and make your first ones.`

/** The one notice, the first time this Mac shows a person new to cards (`offerNotice`). */
export const COURSE_NOTICE = `New to cards? Take the ${COURSE_MINUTES}-minute course`

/** The empty Inbox's line (YAZ-5059 suggestion 24). */
export const COURSE_INBOX_LINE = 'No cards yet. Take the course, or make a card.'

/**
 * "Card tips" (issue 4 of YAZ-5059, `SettingsState.cardTips`) turns off each offer of the course: the notice and the
 * empty Inbox's line. The Settings button always shows. Any value but an explicit false is on (the default).
 */
export const cardTipsOn = (settings: SettingsState): boolean => settings.cardTips !== false

/** The vault the offer reads (YAZ-5272): its cards are on, and whether it holds a card (null: its index has not loaded). */
export interface OfferVault {
  cardsOn: boolean
  hasCards: boolean | null
}

/**
 * New to cards (YAZ-5272; Yaseen: the offer "is for someone completely brand new, they don't have any cards"): the vault
 * has cards on and holds no card yet, no card file and no card in a page, by the vault's own index. A vault whose
 * index has not loaded is not new yet.
 */
export const newToCards = (vault: OfferVault): boolean => vault.cardsOn && vault.hasCards === false

/** The empty Inbox's line: only for a person new to cards in the Inbox's vault, the course not done, no "Don't show again". */
export const offerInInbox = (course: CourseState, settings: SettingsState, vault: OfferVault): boolean =>
  cardTipsOn(settings) && newToCards(vault) && !course.done && !course.dismissed

/** The notice: once per Mac, for a person new to cards in the vault in front, while the course is not done. */
export const offerNotice = (course: CourseState, settings: SettingsState, vault: OfferVault): boolean =>
  newToCards(vault) && cardTipsOn(settings) && !course.offered && !course.done
