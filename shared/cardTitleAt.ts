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

const LABELS: Readonly<Record<CardTitleShow, string>> = { never: 'Never', always: 'Always', click: 'After the first click', side2: 'With Side 2' }

/**
 * The ⋯ menu's "Title in review ›" choices (YAZ-5696), in order, with their words: Default first (every card starts on
 * it), then the four as the setting lists them. The one card menu (`cardMenu.ts`) on the Mac and the phone; small,
 * as the phone's status line names them too.
 */
export const CARD_TITLE_CHOICES: readonly { choice: CardTitleChoice; label: string }[] = [
  { choice: 'default', label: 'Default' },
  ...(['never', 'always', 'click', 'side2'] as const).map((choice) => ({ choice, label: LABELS[choice] })),
]

/**
 * A choice's words. With `global` (the vault's Show card titles), Default says what it means now, as the table menu's
 * "Default (On)" (round 2, Yaseen): "Default (Always)".
 */
export const cardTitleChoiceLabel = (choice: CardTitleChoice, global?: CardTitleShow): string =>
  choice === 'default' ? (global === undefined ? 'Default' : `Default (${LABELS[global]})`) : LABELS[choice]

/** The setting's choices, in order, with their words. */
export const CARD_TITLE_SHOW_OPTIONS: readonly { value: CardTitleShow; label: string }[] = (['never', 'always', 'click', 'side2'] as const).map((value) => ({ value, label: LABELS[value] }))

/** The eye's help (round 2, Yaseen: "a tooltip with a small eye"): each of the four in one line. */
export const CARD_TITLE_HELP: readonly { label: string; text: string }[] = [
  { label: LABELS.never, text: 'The title never shows in Review.' },
  { label: LABELS.always, text: 'The title shows as soon as the card shows.' },
  { label: LABELS.click, text: 'The title shows after your first Space or tap on the card.' },
  { label: LABELS.side2, text: 'The title shows when Side 2 shows.' },
]
