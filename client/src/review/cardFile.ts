/**
 * One note card in its page, read and written by ID (YAZ-4967): what the Inbox and the card window (YAZ-4962) do to
 * a card file, usable with or without a review session. The index holds no card text (D4), so a card shows from the
 * page as it is on disk now. Each write is ONE `transformFile` (`changeCard` on the bytes just read, a re-read and a
 * second try on a conflict): the page may be open in a tab, and the app merges an outside write into an open note.
 */
import { CardNotFoundError, cardIdOf, cardReviewsOf, changeCard, isCardOff, pageCards, withCardReview, withoutCardReview, type CardLine, type CardReview } from '@shared/cardLine'
import { BridgeRequestError, api } from '../api'
import { announcedWrite } from '../lib/twinEditors'
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

/** A card found by its ID or, before it has one, by its place (the card window, YAZ-4962). */
export interface CardAtPage extends Omit<CardOnPage, 'id'> {
  id: string | null
  /** Its place among the page's cards now. */
  index: number
}

/**
 * Card `id` of `path` — the one at `index` when that one holds `id` (two cards with one ID before the sweep settles
 * the copy: each card window shows its own card), else the first that holds it — or with no ID the card at `index`.
 * Null when the page or the card is gone (an ID no card has; no card at `index`).
 */
export async function readCardAt(path: string, id: string | null, index: number): Promise<CardAtPage | null> {
  let content: string
  try {
    content = (await api.readFile(path)).content
  } catch (err) {
    if (err instanceof BridgeRequestError && err.code === 'NOT_FOUND') return null
    throw err
  }
  const cards = pageCards(content)
  const at = id === null || (cards[index] !== undefined && cardIdOf(cards[index].line) === id) ? index : cards.findIndex((c) => cardIdOf(c.line) === id)
  const card = cards[at]
  if (card === undefined) return null
  return { path, id: cardIdOf(card.line), index: at, text: card.text, reviews: cardReviewsOf(card.line), off: isCardOff(card.line) }
}

/** Card `id` of page `path` (the first that holds it), or null when the page or the card is gone (deleted, moved, or its ID changed). */
export async function readCard(path: string, id: string): Promise<CardOnPage | null> {
  const card = await readCardAt(path, id, -1)
  return card === null || card.id === null ? null : { ...card, id: card.id }
}

/**
 * Card `id`'s line changed by `change`: ONE `transformFile`, as the app's own write (`announcedWrite`), so a page open
 * in a tab takes the new line quietly — no outside-change bar, no glow, out of its undo history. `index`: the card's
 * place, when two cards hold `id` (`changeCard`). Throws `CardNotFoundError`.
 */
export const changeCardLine = (path: string, id: string, change: (line: CardLine) => CardLine, index?: number): Promise<unknown> =>
  announcedWrite(path, () => transformFile(path, (c) => changeCard(c, id, change, index)))

/** Writes `review` to card `id`'s line: the answer the hover showed, as it showed it (D13). Throws `CardNotFoundError`. */
export const writeCardReview = (path: string, id: string, review: CardReview): Promise<unknown> => changeCardLine(path, id, (l) => withCardReview(l, review))

/** Removes the review made at `at` from card `id` (undo, and the Reviews table's delete). An unknown `at` writes nothing. */
export const deleteCardReview = (path: string, id: string, at: string): Promise<unknown> => changeCardLine(path, id, (l) => withoutCardReview(l, at))

/** A write that found no card: the page changed under the review. */
export const isCardGone = (err: unknown): boolean => err instanceof CardNotFoundError || (err instanceof BridgeRequestError && err.code === 'NOT_FOUND')
