/**
 * THE CARD MENU'S ASKS (YAZ-5697, Yaseen: "how come archive is so easily clicked and there's no double confirmation?
 * Same thing with title on front"). The one card menu (`cardMenu.ts`: every card ⋯ on the Mac and the phone) says
 * these words. Two kinds:
 *
 *  - CLICK TWICE (YAZ-5966, the app's own pattern, as the tab board's "Click again to close …"): the review rows —
 *    Archive card, Move to Up next / Remove from Up next, and a Title in review choice. The first click turns the row's
 *    words into `CardTwice.words` and keeps the menu open; a second click on the same row runs it. Leaving the row or
 *    closing the menu puts it back. The phone says "Tap again to …".
 *  - AN ASK IN PLACE (`CardAsk`): the file rows, which change two files or rename one with no Undo — Move to its own
 *    file, Put back into this page, Turn into a page (`cardMenu.ts`). The row turns into the question, Cancel first.
 *
 * Unarchive card, Fix later and Remove Fix later do neither: each is taken back on the same row.
 */
import type { CardTitleChoice } from './cardTitleAt'

export interface CardAsk {
  question: string
  /** The answer's words, after Cancel. */
  yes: string
  /** The answer in the danger colour. */
  danger?: boolean
}

/** A click-twice row (YAZ-5966): the armed row's words, and its colour (red for one that takes something away). */
export interface CardTwice {
  words: string
  danger?: boolean
}

export const ARCHIVE_TWICE: CardTwice = { words: 'Click again to archive', danger: true }

/** Move to Up next (accent) / Remove from Up next (red), as the sidebar's "Click again to add" / "… to remove". */
export function nextTwice(on: boolean): CardTwice {
  return on ? { words: 'Click again to move to Up next' } : { words: 'Click again to remove from Up next', danger: true }
}

/** A Title in review choice (YAZ-5696): what the second click sets. */
export function titleChoiceTwice(choice: CardTitleChoice): CardTwice {
  const words: Record<CardTitleChoice, string> = {
    default: 'Click again to use the default',
    never: 'Click again to never show the title',
    always: 'Click again to always show the title',
    click: 'Click again to show the title after a click',
    side2: 'Click again to show the title before Side 2',
  }
  return { words: words[choice] }
}

/** The phone's words for a click-twice row: "Tap again to …". */
export function tapWords(twice: CardTwice): string {
  return twice.words.replace(/^Click again/, 'Tap again')
}
