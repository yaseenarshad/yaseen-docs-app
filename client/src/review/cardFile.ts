/**
 * One note card in its page, read and written by ID (YAZ-4967): what the Inbox and the card window (YAZ-4962) do to
 * a card file, usable with or without a review session. The index holds no card text (D4), so a card shows from the
 * page as it is on disk now. Each write is ONE `transformFile` (`changeCard` on the bytes just read, a re-read and a
 * second try on a conflict): the page may be open in a tab, and the app merges an outside write into an open note.
 */
import { CardNotFoundError, cardIdOf, cardReviewsOf, changeCard, isCardOff, pageCards, withCardReview, withoutCardReview, type CardReview } from '@shared/cardLine'
import { BridgeRequestError, api } from '../api'
import { transformFile } from '../views/writeProperty'

/** A card as its page holds it now. */
export interface CardOnPage {
  path: string
  id: string
  /** The card's raw Markdown (`cardSides`, `cardPieces` and `cardTitle` read it). */
  text: string
  /** Its reviews, in the order the line holds them (`cardHistory`, `cardState` and `recallChance` read them). */
  reviews: CardReview[]
  off: boolean
}

/** Card `id` of page `path`, or null when the page or the card is gone (deleted, moved, or its ID changed). */
export async function readCard(path: string, id: string): Promise<CardOnPage | null> {
  let content: string
  try {
    content = (await api.readFile(path)).content
  } catch (err) {
    if (err instanceof BridgeRequestError && err.code === 'NOT_FOUND') return null
    throw err
  }
  const card = pageCards(content).find((c) => cardIdOf(c.line) === id)
  return card === undefined ? null : { path, id, text: card.text, reviews: cardReviewsOf(card.line), off: isCardOff(card.line) }
}

/** Writes `review` to card `id`'s line: the answer the hover showed, as it showed it (D13). Throws `CardNotFoundError`. */
export const writeCardReview = (path: string, id: string, review: CardReview): Promise<unknown> => transformFile(path, (c) => changeCard(c, id, (l) => withCardReview(l, review)))

/** Removes the review made at `at` from card `id` (undo, and the Reviews table's delete). An unknown `at` writes nothing. */
export const deleteCardReview = (path: string, id: string, at: string): Promise<unknown> => transformFile(path, (c) => changeCard(c, id, (l) => withoutCardReview(l, at)))

/** A write that found no card: the page changed under the review. */
export const isCardGone = (err: unknown): boolean => err instanceof CardNotFoundError || (err instanceof BridgeRequestError && err.code === 'NOT_FOUND')
