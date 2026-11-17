import { hiddenCount } from './cardText'
import type { CardTitleAt, CardTitleChoice } from './cardLine'

/**
 * WHEN A CARD'S TITLE SHOWS IN REVIEW (YAZ-5696, Design 2): the one rule for a step, the Mac's Inbox and Preview and
 * the phone's Review alike. `at` is the card's own choice (`cardTitleAtOf`), else the global `titleAt`. A title hidden
 * in review (`notitle`) never comes here: `reviewTitleOf` gives it as ''. Pure.
 *  - once: from the front.
 *  - front: once the front has no hidden word left (a front with none: at once). A word hidden again takes it away.
 *  - side2: once the last side shows. A one-sided card: once it is fully shown (no hidden word: at once).
 *  - A title that holds a hidden-word mark (`{{…}}`) waits until the card is fully shown, whatever `at` says: its
 *    words may be the answer.
 * `counts` are each side's hidden words, `sides` how many sides show, `open` the shown words' numbers (`cardSteps.ts`).
 */
export function titleShows(card: { title: string; at: CardTitleAt; counts: readonly number[]; sides: number; open: readonly number[] }): boolean {
  const { title, at, counts, sides, open } = card
  if (title === '') return false
  const all = counts.reduce((a, b) => a + b, 0)
  const done = sides >= counts.length && open.length >= all
  if (hiddenCount(title) > 0) return done
  if (at === 'once') return true
  if (counts.length <= 1) return done
  if (at === 'side2') return sides >= counts.length
  const front = counts[0] ?? 0
  return open.filter((n) => n < front).length >= front
}


/** The ⋯ menu's "Title in review ›" choices (YAZ-5696), in order, with their words: the Mac's two card menus share them. */
export const CARD_TITLE_CHOICES: readonly { choice: CardTitleChoice; label: string }[] = [
  { choice: 'default', label: 'Default' },
  { choice: 'once', label: 'At once' },
  { choice: 'front', label: 'After the front' },
  { choice: 'side2', label: 'With Side 2' },
  { choice: 'never', label: 'Never' },
]
export const cardTitleChoiceLabel = (choice: CardTitleChoice): string => CARD_TITLE_CHOICES.find((c) => c.choice === choice)!.label
