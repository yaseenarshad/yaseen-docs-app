/**
 * WHEN a card's title shows in Review (YAZ-5696; round 2, Yaseen: "never, always, after the first click, and with side
 * two"). The global choice is review.json's `titleAt` (`reviews.ts`, Always by default: as before); a card's own choice
 * is one card line part (`CARD_TITLE_AT_WORDS`, `cardLine.ts`), and its Never is `notitle`. Its own small module: the
 * phone's first load reads review.json, never the card line's parser.
 *  - never: no title in Review at all.
 *  - always: as soon as the card shows.
 *  - click: after the first Space or tap on the card, whatever it shows (a hidden word or Side 2).
 *  - side2: when Side 2 (the last side) shows.
 */
export type CardTitleShow = 'never' | 'always' | 'click' | 'side2'
export const CARD_TITLE_SHOW: readonly CardTitleShow[] = ['never', 'always', 'click', 'side2']
/** A card line's own timing part (its Never is `notitle`). */
export type CardTitleAt = Exclude<CardTitleShow, 'never'>
export const CARD_TITLE_AT: readonly CardTitleAt[] = ['always', 'click', 'side2']
/** The ⋯ menu's "Title in review" choice: Default (no part: the global choice), or one of the four. */
export type CardTitleChoice = 'default' | CardTitleShow
/** Round 1's words (YAZ-5696 round 1, in review.json and on card lines): read as their new meanings, never written. */
export const OLD_TITLE_AT: Readonly<Record<string, CardTitleAt>> = { once: 'always', front: 'click' }
