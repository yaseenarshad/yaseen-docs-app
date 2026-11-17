/**
 * THE CARD MENU'S ASKS (YAZ-5697, Yaseen: "how come archive is so easily clicked and there's no double confirmation?
 * Same thing with title on front"): the rows of a card's ⋯ that change the card on one click ask in place first, with
 * Cancel first. The Mac's card menu (`cardMenuSections`, client/src/review/cardPane.tsx) and the phone's card actions
 * (`cardActions`, mobile/src/cardMenu/cardActions.ts) say the same words, from here.
 *
 * Unarchive card does not ask: it only brings a card back. Put at top of Inbox and Fix later do not ask: each is taken
 * back on the same row (and by Undo in the Inbox).
 */
import type { CardTitleChoice } from './cardLine'
import { cardTitleChoiceLabel } from './cardTitleShows'

export interface CardAsk {
  question: string
  /** The answer's words, after Cancel. */
  yes: string
  /** The answer in the danger colour (Archive). */
  danger?: boolean
}

export const ARCHIVE_ASK: CardAsk = { question: 'Archive this card?', yes: 'Archive', danger: true }

/**
 * The ⋯ menu's "Title in review ›" ask (YAZ-5696, the YAZ-5697 step): a change of when the card's title shows in
 * Review. The answer is the choice's own name.
 */
export function titleChoiceAsk(choice: CardTitleChoice): CardAsk {
  const question: Record<CardTitleChoice, string> = {
    default: 'Use the default from Settings › Cards?',
    once: 'Show the title at once?',
    front: 'Show the title after the front?',
    side2: 'Show the title with Side 2?',
    never: 'Never show the title in review?',
  }
  return { question: question[choice], yes: cardTitleChoiceLabel(choice) }
}

/** Title on the front's ask: `hide` when the click hides the title (the line takes `notitle`), else it shows it again. */
export function titleFrontAsk(hide: boolean): CardAsk {
  return hide ? { question: 'Hide the title on the front?', yes: 'Hide' } : { question: 'Show the title on the front?', yes: 'Show' }
}
