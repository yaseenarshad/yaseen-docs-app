/**
 * A card read from the text of its file, with no bridge and no app state (YAZ-5161): pure, so the desktop's
 * `cardFile.ts` and every other review host (the phone's, a test's) read a card the same way. `cardFile.ts` gives out
 * the same names.
 */
import { CardNotFoundError, cardIdOf, cardReviewsOf, isCardFix, isCardNext, isCardNoTitle, isCardOff, pageCards, type CardReview } from '@shared/cardLine'
import { isCardKind } from '@shared/cardFileFormat'
import { cardTitle, cardWithTitle } from '@shared/cardText'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { titleOf } from '@shared/pageName'
import { BridgeRequestError } from '../bridgeError'

/** A card as its page holds it now. */
export interface CardOnPage {
  path: string
  id: string
  /** The card's raw Markdown (`cardSides`, `cardPieces` and `cardTitle` read it). */
  text: string
  /** Its reviews, in the order the line holds them (`cardHistory`, `cardState` and `recallChance` read them). */
  reviews: CardReview[]
  off: boolean
  /** Up next (YAZ-4999 D3): the line's `next`. */
  next: boolean
  /** The title is hidden on the Inbox's front (YAZ-5030): the line's `notitle`. Absent: it shows. */
  notitle?: boolean
  /** Marked "Fix later" (YAZ-5097): the line's `fix`. Absent: no mark. */
  fix?: true
  /** A CARD FILE's card (YAZ-5044): the file's `title`, which `readCard` also puts above `text`. Absent for a card in a page. */
  fileTitle?: string
}

/** A card found by its ID or, before it has one, by its place (the card window, YAZ-4962). */
export interface CardAtPage extends Omit<CardOnPage, 'id'> {
  id: string | null
  /** Its place among the page's cards now. */
  index: number
  /**
   * A CARD FILE's card (YAZ-5044, decision A): the file's `title`, which its `text` does not hold. Absent for a card in a
   * page, and for a card file from before A (its first line is still its title).
   */
  fileTitle?: string
}

/** A card's title: a card file's `title` (YAZ-5044), else its first line (`cardTitle`). */
export const titleOfCard = (card: Pick<CardAtPage, 'text' | 'fileTitle'>): string => card.fileTitle ?? cardTitle(card.text)

/** `readCardAt` on bytes already read (a card embed's one read per file version, and a card file's tab, which holds its file's bytes: YAZ-5037): the same choice of card. */
export function cardInContent(path: string, content: string, id: string | null, index: number): CardAtPage | null {
  const cards = pageCards(content)
  const at = id === null || (cards[index] !== undefined && cardIdOf(cards[index].line) === id) ? index : cards.findIndex((c) => cardIdOf(c.line) === id)
  const card = cards[at]
  if (card === undefined) return null
  // A card file's own card (its first): the file's `title`, read off its properties, when it has one (YAZ-5044).
  const { properties, error } = at === 0 ? parseFrontmatter(splitFrontmatter(content).frontmatter) : { properties: {}, error: 'none' }
  const fileTitle = error === undefined && isCardKind(properties) ? titleOf(properties, '') : ''
  return { path, id: cardIdOf(card.line), index: at, text: card.text, reviews: cardReviewsOf(card.line), off: isCardOff(card.line), next: isCardNext(card.line), notitle: isCardNoTitle(card.line), ...(isCardFix(card.line) && { fix: true as const }), ...(fileTitle !== '' && { fileTitle }) }
}

/**
 * `readCard` on bytes already read: pure, so every review host reads a card the same way (YAZ-5067; the phone's host
 * reads its stored text with it).
 */
export function cardOnPageIn(path: string, content: string, id: string): CardOnPage | null {
  const card = cardInContent(path, content, id, -1)
  if (card === null || card.id === null) return null
  return { ...card, id: card.id, ...(card.fileTitle !== undefined && { text: cardWithTitle(card.fileTitle, card.text) }) }
}

/** A write that found no card: the page changed under the review. */
export const isCardGone = (err: unknown): boolean => err instanceof CardNotFoundError || (err instanceof BridgeRequestError && err.code === 'NOT_FOUND')
