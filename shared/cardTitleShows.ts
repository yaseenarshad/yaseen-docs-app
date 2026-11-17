import { hiddenCount } from './cardText'
import type { CardTitleAt, CardTitleChoice, CardTitleShow } from './cardTitleAt'

/**
 * WHEN A CARD'S TITLE SHOWS IN REVIEW (YAZ-5696; round 2: Never · Always · After the first click · With Side 2): the one
 * rule for a step, the Mac's Inbox and Preview and the phone's Review alike. `at` is the card's own choice
 * (`cardTitleAtOf`), else the global `titleAt`. Never never comes here: `reviewTitleOf` gives that title as ''. Pure.
 *  - always: from the front.
 *  - click: after the first Space or tap on the card, whatever it showed (a hidden word or the next side); a word clicked
 *    hidden again is a click too (`next` holds it). A card with nothing to click: at once (it is fully shown).
 *  - side2: once the last side shows. A one-sided card: once it is fully shown (no hidden word: at once).
 *  - A title that holds a hidden-word mark (`{{…}}`) waits until the card is fully shown, whatever `at` says: its
 *    words may be the answer.
 * `counts` are each side's hidden words; `sides`, `open` and `next` the step (`cardSteps.ts`).
 */
export function titleShows(card: { title: string; at: CardTitleAt; counts: readonly number[]; sides: number; open: readonly number[]; next: number | null }): boolean {
  const { title, at, counts, sides, open, next } = card
  if (title === '') return false
  const all = counts.reduce((a, b) => a + b, 0)
  const done = sides >= counts.length && open.length >= all
  if (hiddenCount(title) > 0) return done
  if (at === 'always') return true
  if (at === 'click') return done || sides > 1 || open.length > 0 || next !== null
  return counts.length <= 1 ? done : sides >= counts.length
}

const LABELS: Readonly<Record<CardTitleShow, string>> = { never: 'Never', always: 'Always', click: 'After the first click', side2: 'With Side 2' }

/**
 * The ⋯ menu's "Title in review ›" choices (YAZ-5696), in order: Default first (every card starts on it), then the four
 * as the setting lists them. One list for the Mac's card menus and the phone's.
 */
export const CARD_TITLE_CHOICES: readonly { choice: CardTitleChoice }[] = [{ choice: 'default' }, { choice: 'never' }, { choice: 'always' }, { choice: 'click' }, { choice: 'side2' }]

/** A choice's words; Default says what it means now, as the table menu's "Default (On)": "Default (Always)". */
export const cardTitleChoiceLabel = (choice: CardTitleChoice, global: CardTitleShow): string => (choice === 'default' ? `Default (${LABELS[global]})` : LABELS[choice])

/** The setting's choices, in order, with their words. */
export const CARD_TITLE_SHOW_OPTIONS: readonly { value: CardTitleShow; label: string }[] = (['never', 'always', 'click', 'side2'] as const).map((value) => ({ value, label: LABELS[value] }))

/** The eye's help (round 2, Yaseen: "a tooltip with a small eye"): each of the four in one line. */
export const CARD_TITLE_HELP: readonly { label: string; text: string }[] = [
  { label: LABELS.never, text: 'The title never shows in Review.' },
  { label: LABELS.always, text: 'The title shows as soon as the card shows.' },
  { label: LABELS.click, text: 'The title shows after your first Space or tap on the card.' },
  { label: LABELS.side2, text: 'The title shows when Side 2 shows.' },
]
