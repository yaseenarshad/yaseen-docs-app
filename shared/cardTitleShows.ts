import { hiddenCount } from './cardText'
import type { CardTitleAt } from './cardTitleAt'

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

/** The choices' words live with the choice (`cardTitleAt.ts`, small: the phone's status line names them too). */
export { CARD_TITLE_CHOICES, CARD_TITLE_HELP, CARD_TITLE_SHOW_OPTIONS, cardTitleChoiceLabel } from './cardTitleAt'
