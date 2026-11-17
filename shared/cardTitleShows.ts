import { hiddenCount } from './cardText'
import type { CardTitleAt, CardTitleShow } from './cardTitleAt'

/**
 * The card's timing (YAZ-5696): its own choice, else the global one. A global Never with no own choice gave no title
 * (`reviewTitleOf`); a title that is here then shows at once. The Mac's Inbox and Preview and the phone's Review.
 */
export const reviewTitleAt = (own: CardTitleAt | undefined, global: CardTitleShow): CardTitleAt => own ?? (global === 'never' ? 'always' : global)

/**
 * Where the title is its OWN step (YAZ-5709, Yaseen: "the title should be one click by itself"): After the first click
 * is the first step ('first'); Before Side 2 the step just before Side 2, or a one-sided card's last ('side2'). None for
 * Always, for no title, and for a title that holds a hidden-word mark (`{{…}}`): it waits until the card is fully shown.
 * The steps themselves: `nextStep` (`client/src/review/cardSteps.ts`).
 */
export type TitleStep = 'first' | 'side2' | null
export function titleStepOf(title: string, at: CardTitleAt): TitleStep {
  if (title === '' || hiddenCount(title) > 0 || at === 'always') return null
  return at === 'click' ? 'first' : 'side2'
}

/**
 * WHEN A CARD'S TITLE SHOWS IN REVIEW (YAZ-5696; YAZ-5709: Never · Always · After the first click · Before Side 2): the
 * one rule for a step, the Mac's Inbox and Preview and the phone's Review alike. `at` is `reviewTitleAt`. Never never
 * comes here: `reviewTitleOf` gives that title as ''. Pure.
 *  - always: from the front.
 *  - click, side2: once the title's own step has come (`titled`, `nextStep`).
 *  - A title that holds a hidden-word mark (`{{…}}`) waits until the card is fully shown, whatever `at` says: its
 *    words may be the answer.
 * `counts` are each side's hidden words; `sides`, `open` and `titled` the step (`cardSteps.ts`).
 */
export function titleShows(card: { title: string; at: CardTitleAt; counts: readonly number[]; sides: number; open: readonly number[]; titled: boolean }): boolean {
  const { title, at, counts, sides, open, titled } = card
  if (title === '') return false
  if (hiddenCount(title) > 0) return sides >= counts.length && open.length >= counts.reduce((a, b) => a + b, 0)
  return titleStepOf(title, at) === null || titled
}

/** The choices' words live with the choice (`cardTitleAt.ts`, small: the phone's status line names them too). */
export { CARD_TITLE_CHOICES, CARD_TITLE_HELP, CARD_TITLE_SHOW_OPTIONS, cardTitleChoiceLabel } from './cardTitleAt'
