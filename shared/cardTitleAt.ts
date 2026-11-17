/**
 * WHEN a card's title shows in Review (YAZ-5696, Design 2): at once, after the front (no hidden word left on it), or
 * with Side 2 (the last side). The global default is review.json's `titleAt` (`reviews.ts`); a card's own choice is one
 * card line part (`CARD_TITLE_AT_WORDS`, `cardLine.ts`). Never is `notitle`, as before. Its own small module: the
 * phone's first load reads review.json, never the card line's parser.
 */
export type CardTitleAt = 'once' | 'front' | 'side2'
export const CARD_TITLE_AT: readonly CardTitleAt[] = ['once', 'front', 'side2']
/** The ⋯ menu's "Title in review" choice: Default (no part), one of the three, or Never (`notitle`). */
export type CardTitleChoice = 'default' | CardTitleAt | 'never'
