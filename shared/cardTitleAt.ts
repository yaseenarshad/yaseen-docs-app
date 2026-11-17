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

/** The ⋯ menu's "Title in review ›" choices (YAZ-5696), in order, with their words: the one card menu (`cardMenu.ts`) on the Mac and the phone. */
export const CARD_TITLE_CHOICES: readonly { choice: CardTitleChoice; label: string }[] = [
  { choice: 'default', label: 'Default' },
  { choice: 'once', label: 'At once' },
  { choice: 'front', label: 'After the front' },
  { choice: 'side2', label: 'With Side 2' },
  { choice: 'never', label: 'Never' },
]
export const cardTitleChoiceLabel = (choice: CardTitleChoice): string => CARD_TITLE_CHOICES.find((c) => c.choice === choice)!.label
