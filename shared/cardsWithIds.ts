/**
 * The cards of a page that each list ONE row (YAZ-5047, YAZ-5319), in a file of its own with no import but a type: the
 * phone's Search (`searchCandidates`) reads it in the phone's first load, and `cardLine.ts` brings the YAML parser
 * (YAZ-5377: the first load holds no YAML). `cardLine.ts` gives it out too.
 */
import type { CardRecord } from './cardLine'

/** A card of a page that has an ID, with its place among the page's cards (`findCards` order, 0 first). */
export interface CardWithId {
  card: CardRecord
  id: string
  index: number
}

/**
 * The cards of a page that each list ONE row for (search's card rows, YAZ-5047; a folder table's card rows, YAZ-5319),
 * off the index's `cards`: each card with an ID, in page order. A copy whose ID a card before it on the page holds is
 * left out, as the review leaves it out (`cardPlan`): one row per ID, so each row's path stays its own.
 */
export function cardsWithIds(cards: readonly CardRecord[] | undefined): CardWithId[] {
  const out: CardWithId[] = []
  const seen = new Set<string>()
  cards?.forEach((card, index) => {
    if (card.id === null || seen.has(card.id)) return
    seen.add(card.id)
    out.push({ card, id: card.id, index })
  })
  return out
}
